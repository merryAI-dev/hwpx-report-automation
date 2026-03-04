import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  requireUserApiKey,
  withTimeout,
  handleApiError,
  DEFAULT_API_TIMEOUT_MS,
} from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  validateBodySize,
  validateSegmentCount,
  checkRateLimit,
  checkMonthlyCostLimit,
  getClientIp,
} from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";

type SegmentInput = {
  id: string;
  text: string;
  type: string;
  level?: number;
};

type RequestBody = {
  segments?: SegmentInput[];
  model?: string;
  monthlyCostLimitUsd?: number;
};

export async function POST(request: Request) {
  // ── Rate limiting ──
  const rateLimitResp = checkRateLimit(getClientIp(request));
  if (rateLimitResp) return rateLimitResp;

  try {
    const { apiKey } = await requireUserApiKey("openai");
    const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    // ── Body size validation ──
    const rawBody = await request.text();
    const bodySizeResp = validateBodySize(rawBody);
    if (bodySizeResp) return bodySizeResp;

    let body: RequestBody;
    try {
      body = JSON.parse(rawBody) as RequestBody;
    } catch {
      throw new ValidationError("요청 본문이 올바른 JSON이 아닙니다.");
    }

    const segments = body.segments;

    // ── Segment count validation ──
    if (segments) {
      const segResp = validateSegmentCount(segments);
      if (segResp) return segResp;
    }

    if (!segments || !segments.length) {
      throw new ValidationError("segments가 비어있습니다.");
    }

    const model = body.model || defaultModel;

    // ── Monthly cost limit check ──
    const costLimitResp = await checkMonthlyCostLimit(body.monthlyCostLimitUsd ?? 0);
    if (costLimitResp) return costLimitResp;

    const client = new OpenAI({ apiKey, baseURL });

    // Truncate each segment text to 200 chars, limit to 100 segments
    const truncated = segments.slice(0, 100).map((s) => ({
      id: s.id,
      text: s.text.slice(0, 200),
      type: s.type,
      level: s.level,
    }));

    const completion = await log.time("analyze-document.openai", () =>
      withTimeout(
        client.chat.completions.create({
          model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                '너는 한국어 문서 분석 AI다. JSON만 반환한다. 반드시 {"documentType":"...","suggestedPreset":"...","readabilityScore":0,"globalIssues":["..."],"inconsistentTerms":[{"variants":["..."],"suggestedTerm":"..."}]} 구조를 반환한다.',
            },
            {
              role: "user",
              content: `다음 문서의 세그먼트(최대 100개)를 분석하라.

세그먼트(JSON):
${JSON.stringify(truncated)}

분석 항목:
1. documentType: 문서 유형 (예: "기술제안서", "공문서", "연구보고서", "사업계획서", "일반 보고서" 등)
2. suggestedPreset: 추천 프리셋 키 (technical_proposal, official_document, research_report, business_plan, custom 중 하나)
3. readabilityScore: 가독성 점수 (1-100, 100이 최고)
4. globalIssues: 문서 전체에서 발견되는 문제점 (예: "주어 생략이 빈번함", "수동태 과다 사용", "문장이 지나치게 길음", "경어체와 반말이 혼용됨" 등). 최대 5개.
5. inconsistentTerms: 같은 개념에 다른 단어가 사용된 경우 (예: "시스템"과 "체계"가 혼용). variants에는 사용된 모든 표현, suggestedTerm에는 통일할 용어. 최대 5개.`,
            },
          ],
        }),
        DEFAULT_API_TIMEOUT_MS,
        "OpenAI analyze-document",
      ),
      { model, segmentCount: truncated.length },
    );

    const text = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text);

    recordAudit("system", "analyze-document", "/api/analyze-document", { segmentCount: segments.length });
    return NextResponse.json({
      documentType: parsed.documentType || "일반 문서",
      suggestedPreset: parsed.suggestedPreset || "custom",
      readabilityScore: typeof parsed.readabilityScore === "number" ? parsed.readabilityScore : 50,
      globalIssues: Array.isArray(parsed.globalIssues) ? parsed.globalIssues : [],
      inconsistentTerms: Array.isArray(parsed.inconsistentTerms) ? parsed.inconsistentTerms : [],
    });
  } catch (error) {
    return handleApiError(error, "/api/analyze-document");
  }
}
