import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { handleApiError } from "@/lib/api-utils";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

/**
 * POST /api/batch-template-suggest
 *
 * 양식의 모든 셀 정보 + CSV 헤더/샘플을 받아
 * AI가 레이블↔입력 셀을 판단하고, 플레이스홀더 + 삽입 좌표 + CSV 매핑을 추천한다.
 *
 * 하드코딩 없음 — 모든 판단을 AI에게 위임.
 */
export async function POST(req: NextRequest) {
  const rateLimitResp = checkRateLimit(getClientIp(req));
  if (rateLimitResp) return rateLimitResp;

  try {
    const body = await req.json() as {
      csvHeaders?: string[];
      csvSample?: Record<string, string>;
      templateCells?: { gridCol: number; gridRow: number; colSpan: number; rowSpan: number; text: string }[];
    };

    const { csvHeaders = [], templateCells = [], csvSample = {} } = body;

    if (!csvHeaders.length) {
      return NextResponse.json({ error: "csvHeaders가 비어 있습니다." }, { status: 400 });
    }
    if (!templateCells.length) {
      return NextResponse.json({ error: "templateCells가 비어 있습니다." }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });

    const cellTable = templateCells
      .map((c) => `(${c.gridCol},${c.gridRow}) span=(${c.colSpan},${c.rowSpan}) "${c.text}"`)
      .join("\n");

    const sampleText = Object.keys(csvSample).length
      ? `\nCSV 첫 행 샘플:\n${JSON.stringify(csvSample, null, 2)}`
      : "";

    const prompt = `당신은 한국어 양식 문서를 분석하는 전문가입니다.

아래에 양식 문서의 표 셀 정보와 CSV 데이터가 있습니다.

[양식 표 셀 목록]
각 셀: (열,행) span=(열병합,행병합) "텍스트"
${cellTable}

[CSV 컬럼]
${csvHeaders.map((h, i) => `${i + 1}. "${h}"`).join("\n")}
${sampleText}

작업:
1. 어떤 셀이 "레이블"이고 어떤 셀이 "입력 칸"(데이터를 넣을 곳)인지 판단하세요.
   - 텍스트가 있는 셀은 보통 레이블
   - 비어있는 셀은 보통 입력 칸
   - 레이블 옆 또는 아래의 빈 셀이 해당 레이블의 입력 칸

2. 각 입력 칸에 적합한 플레이스홀더 이름과 CSV 컬럼을 매핑하세요.

응답 형식 (반드시 JSON 배열만, 마크다운 없이):
[
  {
    "placeholder": "{{한국어변수명}}",
    "csvColumn": "매핑할 CSV 컬럼명 (없으면 빈 문자열)",
    "targetGridCol": 입력_셀_열번호,
    "targetGridRow": 입력_셀_행번호,
    "reason": "한 줄 설명"
  }
]

규칙:
- placeholder는 한국어 단어 사용 (예: {{주제}}, {{참여자}})
- 비어있는 입력 셀에만 플레이스홀더를 배치
- 의미상 연결할 CSV 컬럼이 없으면 csvColumn을 빈 문자열로
- targetGridCol/targetGridRow는 반드시 위 셀 목록에 존재하는 빈 셀의 좌표`;

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text : "[]";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const suggestions = JSON.parse(cleaned);

    return NextResponse.json({ suggestions });
  } catch (err) {
    return handleApiError(err, "batch-template-suggest");
  }
}
