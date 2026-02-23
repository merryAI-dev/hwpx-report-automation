import OpenAI from "openai";
import { NextResponse } from "next/server";

type SegmentInput = {
  id: string;
  text: string;
  type: string;
  level?: number;
};

type RequestBody = {
  segments?: SegmentInput[];
  model?: string;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY가 설정되지 않았습니다." }, { status: 500 });
  }

  const body = (await request.json()) as RequestBody;
  const segments = body.segments;

  if (!segments || !segments.length) {
    return NextResponse.json({ error: "segments가 비어있습니다." }, { status: 400 });
  }

  const model = body.model || defaultModel;
  const client = new OpenAI({ apiKey, baseURL });

  // Truncate each segment text to 200 chars, limit to 100 segments
  const truncated = segments.slice(0, 100).map((s) => ({
    id: s.id,
    text: s.text.slice(0, 200),
    type: s.type,
    level: s.level,
  }));

  try {
    const completion = await client.chat.completions.create({
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
    });

    const text = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text);

    return NextResponse.json({
      documentType: parsed.documentType || "일반 문서",
      suggestedPreset: parsed.suggestedPreset || "custom",
      readabilityScore: typeof parsed.readabilityScore === "number" ? parsed.readabilityScore : 50,
      globalIssues: Array.isArray(parsed.globalIssues) ? parsed.globalIssues : [],
      inconsistentTerms: Array.isArray(parsed.inconsistentTerms) ? parsed.inconsistentTerms : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "문서 분석 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
