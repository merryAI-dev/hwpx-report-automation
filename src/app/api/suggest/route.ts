import { NextResponse } from "next/server";
import { withApiAuth, type AuthenticatedSession } from "@/lib/auth/with-api-auth";
import {
  requireString,
  withTimeout,
  handleApiError,
  DEFAULT_API_TIMEOUT_MS,
} from "@/lib/api-utils";
import { requireOpenAIClientFromRequest } from "@/lib/server/openai-client";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { validateBodySize, checkRateLimit, checkMonthlyCostLimit, getClientIp } from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";
import { estimateCost } from "@/lib/ai-cost-tracker";

type RequestBody = {
  text?: string;
  instruction?: string;
  planContext?: string;
  styleHints?: Record<string, string>;
  prevText?: string;
  nextText?: string;
  model?: string;
  monthlyCostLimitUsd?: number;
};

async function handlePost(request: Request, _session: AuthenticatedSession) {
  // ── Rate limiting ──
  const rateLimitResp = checkRateLimit(getClientIp(request));
  if (rateLimitResp) return rateLimitResp;


  try {
    const { client, defaultModel } = requireOpenAIClientFromRequest(request);

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
    const text = requireString(body.text, "text");
    const instruction = requireString(body.instruction, "instruction");
    const planContext = String(body.planContext || "").trim();

    // ── Monthly cost limit check ──
    const costLimitResp = await checkMonthlyCostLimit(body.monthlyCostLimitUsd ?? 0);
    if (costLimitResp) return costLimitResp;

    const styleContext = JSON.stringify(body.styleHints || {}, null, 0);

    const completion = await log.time("suggest.openai", () =>
      withTimeout(
        client.chat.completions.create({
          model: body.model || defaultModel,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "너는 문서 편집 보조 AI다. 출력은 수정 제안 텍스트만 반환한다. XML 태그는 절대 만들지 않는다.",
            },
            {
              role: "user",
              content:
                (body.prevText ? `앞 문단:\n${body.prevText}\n\n` : "") +
                `원문:\n${text}\n\n` +
                (body.nextText ? `뒤 문단:\n${body.nextText}\n\n` : "") +
                (planContext ? `리포트 패밀리 섹션 계획:\n${planContext}\n\n` : "") +
                `수정 지시:\n${instruction}\n\n` +
                `스타일 힌트(JSON):\n${styleContext}\n\n` +
                "요구사항: 원문만 수정하라. 앞/뒤 문단은 맥락 참고용이다. planContext가 있으면 해당 section plan을 우선 적용하라. 문장 수와 길이는 원문과 유사하게 유지하고, 핵심 정보 누락 없이 더 읽기 좋게 고쳐라.",
            },
          ],
        }),
        DEFAULT_API_TIMEOUT_MS,
        "OpenAI suggest",
      ),
      { model: body.model || defaultModel, textLen: text.length },
    );

    const suggestion = completion.choices[0]?.message?.content?.trim();
    if (!suggestion) {
      return NextResponse.json(
        { error: "AI가 제안을 생성하지 못했습니다.", code: "NO_SUGGESTION" },
        { status: 502 },
      );
    }

    const usedModel = body.model || defaultModel;
    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    const cost = estimateCost(usedModel, inputTokens, outputTokens);
    recordAudit("system", "ai-suggest", "/api/suggest", {
      model: usedModel,
      inputTokens,
      outputTokens,
      costUsd: cost.estimatedCostUsd,
    });
    return NextResponse.json({ suggestion });
  } catch (error) {
    return handleApiError(error, "/api/suggest");
  }
}

export const POST = withApiAuth(handlePost);
