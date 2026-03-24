import OpenAI from "openai";
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import {
  requireString,
  requireUserApiKey,
  withTimeout,
  handleApiError,
  DEFAULT_API_TIMEOUT_MS,
} from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { validateBodySize, checkRateLimit, checkMonthlyCostLimit, getClientIp } from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";
import { estimateCost } from "@/lib/ai-cost-tracker";

type BatchItem = {
  id: string;
  text: string;
  styleHints?: Record<string, string>;
  prevText?: string;
  nextText?: string;
  planContext?: string;
};

type RequestBody = {
  items?: BatchItem[];
  instruction?: string;
  model?: string;
  monthlyCostLimitUsd?: number;
};

type BatchResponse = {
  results: Array<{ id: string; suggestion: string }>;
};

const MAX_ITEMS = 40;

async function handlePost(request: Request) {
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
    const instruction = requireString(body.instruction, "instruction");
    const rawItems = (body.items || []).slice(0, MAX_ITEMS);
    const items = rawItems
      .map((item) => ({
        id: String(item.id || "").trim(),
        text: String(item.text || "").trim(),
        styleHints: item.styleHints || {},
      }))
      .filter((item) => item.id && item.text);

    if (!items.length) {
      throw new ValidationError("유효한 items가 없습니다.");
    }

    // ── Monthly cost limit check ──
    const costLimitResp = await checkMonthlyCostLimit(body.monthlyCostLimitUsd ?? 0);
    if (costLimitResp) return costLimitResp;

    const client = new OpenAI({ apiKey, baseURL });
    const model = body.model || defaultModel;

    const completion = await log.time("suggest-batch.openai", () =>
      withTimeout(
        client.chat.completions.create({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "너는 문서 편집 보조 AI다. JSON만 반환한다. 반드시 {\"results\":[{\"id\":\"...\",\"suggestion\":\"...\"}]} 구조를 반환한다. XML 태그를 만들지 않는다.",
            },
            {
              role: "user",
              content:
                `수정 지시:\n${instruction}\n\n` +
                `항목(JSON):\n${JSON.stringify(items)}\n\n` +
                "요구사항: 각 항목의 text만 수정하라. prevText/nextText는 맥락 참고용이며 수정 대상이 아니다. planContext가 있으면 해당 section plan을 우선 적용하라. 각 항목의 의미를 보존하고 더 읽기 좋게 다듬어라. 원문 길이와 문장 수는 유사하게 유지하라.",
            },
          ],
        }),
        DEFAULT_API_TIMEOUT_MS,
        "OpenAI suggest-batch",
      ),
      { model, itemCount: items.length },
    );

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: Partial<BatchResponse>;
    try {
      parsed = JSON.parse(raw) as Partial<BatchResponse>;
    } catch {
      log.warn("suggest-batch: OpenAI returned invalid JSON", { raw: raw.slice(0, 200) });
      parsed = { results: [] };
    }
    const mapped = new Map(items.map((item) => [item.id, item.text]));
    const results: Array<{ id: string; suggestion: string }> = [];

    for (const row of parsed.results || []) {
      const id = String(row.id || "");
      if (!mapped.has(id)) continue;
      const suggestion = String(row.suggestion || "").trim();
      if (!suggestion) continue;
      results.push({ id, suggestion });
      mapped.delete(id);
    }

    for (const [id, originalText] of mapped.entries()) {
      results.push({ id, suggestion: originalText });
    }

    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    const cost = estimateCost(model, inputTokens, outputTokens);
    recordAudit("system", "ai-batch", "/api/suggest-batch", {
      itemCount: items.length,
      model,
      inputTokens,
      outputTokens,
      costUsd: cost.estimatedCostUsd,
    });
    return NextResponse.json({ results });
  } catch (error) {
    return handleApiError(error, "/api/suggest-batch");
  }
}

export const POST = withApiAuth(handlePost);
