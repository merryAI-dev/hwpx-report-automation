import OpenAI from "openai";
import { NextResponse } from "next/server";

type BatchItem = {
  id: string;
  text: string;
  styleHints?: Record<string, string>;
};

type RequestBody = {
  items?: BatchItem[];
  instruction?: string;
  model?: string;
};

type BatchResponse = {
  results: Array<{ id: string; suggestion: string }>;
};

const MAX_ITEMS = 40;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not set on the server." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const instruction = (body.instruction || "").trim();
    const rawItems = (body.items || []).slice(0, MAX_ITEMS);
    const items = rawItems
      .map((item) => ({
        id: String(item.id || "").trim(),
        text: String(item.text || "").trim(),
        styleHints: item.styleHints || {},
      }))
      .filter((item) => item.id && item.text);

    if (!instruction) {
      return NextResponse.json({ error: "instruction is required" }, { status: 400 });
    }
    if (!items.length) {
      return NextResponse.json({ error: "items is required" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey, baseURL });
    const completion = await client.chat.completions.create({
      model: body.model || defaultModel,
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
            "요구사항: 각 항목의 의미를 보존하고 더 읽기 좋게 다듬어라. 원문 길이와 문장 수는 유사하게 유지하라.",
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as Partial<BatchResponse>;
    const mapped = new Map(items.map((item) => [item.id, item.text]));
    const results: Array<{ id: string; suggestion: string }> = [];

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

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
