import OpenAI from "openai";

export type BatchItem = {
  id: string;
  text: string;
  styleHints?: Record<string, string>;
  prevText?: string;
  nextText?: string;
};

export type BatchSuggestionRow = {
  id: string;
  suggestion: string;
};

export type BatchSuggestionResponse = {
  results: BatchSuggestionRow[];
};

export type GenerateBatchSuggestionsParams = {
  items: BatchItem[];
  instruction: string;
  model?: string;
};

export const MAX_BATCH_ITEMS = 40;

function getOpenAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set on the server.");
  }
  return { apiKey, baseURL, defaultModel };
}

export function normalizeBatchItems(rawItems: BatchItem[]): BatchItem[] {
  return rawItems
    .slice(0, MAX_BATCH_ITEMS)
    .map((item) => ({
      id: String(item.id || "").trim(),
      text: String(item.text || "").trim(),
      styleHints: item.styleHints || {},
      prevText: item.prevText,
      nextText: item.nextText,
    }))
    .filter((item) => item.id && item.text);
}

export async function generateBatchSuggestions(
  params: GenerateBatchSuggestionsParams,
): Promise<BatchSuggestionResponse> {
  const instruction = params.instruction.trim();
  const items = normalizeBatchItems(params.items);
  if (!instruction) {
    throw new Error("instruction is required");
  }
  if (!items.length) {
    throw new Error("items is required");
  }

  const { apiKey, baseURL, defaultModel } = getOpenAiConfig();
  const client = new OpenAI({ apiKey, baseURL });
  const completion = await client.chat.completions.create({
    model: params.model || defaultModel,
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
          `수정 지시:\n${instruction}\n\n`
          + `항목(JSON):\n${JSON.stringify(items)}\n\n`
          + "요구사항: 각 항목의 text만 수정하라. prevText/nextText는 맥락 참고용이며 수정 대상이 아니다. 각 항목의 의미를 보존하고 더 읽기 좋게 다듬어라. 원문 길이와 문장 수는 유사하게 유지하라.",
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw) as Partial<BatchSuggestionResponse>;
  const mapped = new Map(items.map((item) => [item.id, item.text]));
  const results: BatchSuggestionRow[] = [];

  for (const row of parsed.results || []) {
    const id = String(row.id || "");
    if (!mapped.has(id)) {
      continue;
    }
    const suggestion = String(row.suggestion || "").trim();
    if (!suggestion) {
      continue;
    }
    results.push({ id, suggestion });
    mapped.delete(id);
  }

  for (const [id, originalText] of mapped.entries()) {
    results.push({ id, suggestion: originalText });
  }

  return { results };
}
