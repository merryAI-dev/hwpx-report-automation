import OpenAI from "openai";
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";

type RequestBody = {
  originalText?: string;
  modifiedText?: string;
  instruction?: string;
  model?: string;
};

async function handlePost(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 500 });
  }

  const body = (await request.json()) as RequestBody;
  const { originalText, modifiedText, instruction } = body;

  if (!originalText || !modifiedText) {
    return NextResponse.json({ error: "originalText와 modifiedText가 필요합니다." }, { status: 400 });
  }

  const model = body.model || defaultModel;
  const client = new OpenAI({ apiKey, baseURL });

  try {
    const completion = await client.chat.completions.create({
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
    });

    const text = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text);

    return NextResponse.json({
      passed: typeof parsed.passed === "boolean" ? parsed.passed : true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "검증 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const POST = withApiAuth(handlePost);
