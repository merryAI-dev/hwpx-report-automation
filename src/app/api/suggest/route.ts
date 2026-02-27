import OpenAI from "openai";
import { NextResponse } from "next/server";

type RequestBody = {
  text?: string;
  instruction?: string;
  styleHints?: Record<string, string>;
  model?: string;
};

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
    const text = (body.text || "").trim();
    const instruction = (body.instruction || "").trim();

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (!instruction) {
      return NextResponse.json({ error: "instruction is required" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey, baseURL });
    const styleContext = JSON.stringify(body.styleHints || {}, null, 0);

    const completion = await client.chat.completions.create({
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
            `원문:\n${text}\n\n` +
            `수정 지시:\n${instruction}\n\n` +
            `스타일 힌트(JSON):\n${styleContext}\n\n` +
            "요구사항: 문장 수와 길이는 원문과 유사하게 유지하고, 핵심 정보 누락 없이 더 읽기 좋게 고쳐라.",
        },
      ],
    });

    const suggestion = completion.choices[0]?.message?.content?.trim();
    if (!suggestion) {
      return NextResponse.json({ error: "No suggestion generated." }, { status: 502 });
    }

    return NextResponse.json({ suggestion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
