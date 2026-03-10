import OpenAI from "openai";
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import {
  requireString,
  requireApiKey,
  withTimeout,
  handleApiError,
  DEFAULT_API_TIMEOUT_MS,
} from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { validateBodySize, checkRateLimit, checkMonthlyCostLimit, getClientIp } from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";
import { estimateCost } from "@/lib/ai-cost-tracker";

type RequestBody = {
  originalText?: string;
  modifiedText?: string;
  instruction?: string;
  model?: string;
  monthlyCostLimitUsd?: number;
};

async function handlePost(request: Request) {
  // ── Rate limiting ──
  const rateLimitResp = checkRateLimit(getClientIp(request));
  if (rateLimitResp) return rateLimitResp;

  try {
    const apiKey = requireApiKey("OPENAI_API_KEY", "OpenAI");
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
    const originalText = requireString(body.originalText, "originalText");
    const modifiedText = requireString(body.modifiedText, "modifiedText");
    const instruction = (body.instruction || "").trim();

    const model = body.model || defaultModel;

    // ── Monthly cost limit check ──
    const costLimitResp = await checkMonthlyCostLimit(body.monthlyCostLimitUsd ?? 0);
    if (costLimitResp) return costLimitResp;

    const client = new OpenAI({ apiKey, baseURL });

    const completion = await log.time("verify.openai", () =>
      withTimeout(
        client.chat.completions.create({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                '너는 문서 편집 검증 AI다. JSON만 반환한다. 반드시 {"passed":true/false,"issues":["..."]} 구조를 반환한다.',
            },
            {
              role: "user",
              content: `다음 수정이 올바른지 검증하라.

원문:
${originalText}

수정문:
${modifiedText}

수정 지시:
${instruction || "(없음)"}

검증 항목:
1. 정보 손실: 원문의 핵심 정보(날짜, 수치, 고유명사, 사실관계)가 누락되었는가?
2. 톤 일관성: 수정 전후의 문체/격식이 일관되는가?
3. 의미 변질: 원문의 핵심 의미가 왜곡되었는가?

이슈가 없으면 passed: true, issues: []. 이슈가 있으면 passed: false와 구체적 이슈 목록을 반환하라.`,
            },
          ],
        }),
        DEFAULT_API_TIMEOUT_MS,
        "OpenAI verify",
      ),
      { model },
    );

    const text = completion.choices[0]?.message?.content || "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      log.warn("verify: OpenAI returned invalid JSON", { raw: text.slice(0, 200) });
      parsed = { passed: false, issues: ["AI 응답을 파싱할 수 없습니다. 다시 시도해 주세요."] };
    }

    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    const cost = estimateCost(model, inputTokens, outputTokens);
    recordAudit("system", "ai-verify", "/api/verify", {
      passed: parsed.passed,
      model,
      inputTokens,
      outputTokens,
      costUsd: cost.estimatedCostUsd,
    });
    return NextResponse.json({
      passed: typeof parsed.passed === "boolean" ? parsed.passed : false,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    });
  } catch (error) {
    return handleApiError(error, "/api/verify");
  }
}

export const POST = withApiAuth(handlePost);
