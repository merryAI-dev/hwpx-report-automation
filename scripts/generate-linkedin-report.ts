import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";
import OpenAI from "openai";
import { applyTextEdits, inspectHwpx } from "../src/lib/hwpx";
import { formatHwpxValidationReport, validateHwpxForNode } from "../src/lib/node/hwpx-validator";

const TARGET_LINE_COUNT = 25;

function fallbackLines(today: string): string[] {
  return [
    "LinkedIn 공유용 프로젝트 업데이트",
    `${today}`,
    "프로젝트: HWPX Studio",
    "오늘은 HWPX 자동 편집의 실사용성을 검증했습니다.",
    "1. 오늘 완료한 핵심 작업",
    "- HWPX 업로드 후 텍스트 노드 탐색 UI 안정화",
    "- 스타일 카탈로그 기반 편집 흐름 정리",
    "- 수정 큐 반영 후 HWPX 재생성 품질 점검",
    "2. AI 기능 고도화",
    "- 단건 제안 API(/api/suggest) 응답 품질 개선",
    "- 일괄 제안 API(/api/suggest-batch) 처리 안정화",
    "- 문맥 보존 중심 프롬프트 규칙 재정비",
    "3. 안정성 검증",
    "- XML 텍스트 구간 치환 방식으로 손상 리스크 축소",
    "- 무결성 검사(mimetype/version.xml/content.hpf) 유지",
    "- 편집 후 XML 파싱 검증 자동화",
    "4. 사용자 경험 개선",
    "- Undo/Redo 흐름과 단축키 동작 확인",
    "- 헤딩 기반 섹션 자동 선택 정확도 개선",
    "- 원문/제안 Diff 비교 가독성 보강",
    "5. 다음 실행 계획",
    "- 실무 샘플 다건 회귀 테스트 확대",
    "- 템플릿별 스타일 규칙 사전 정밀화",
    "- 배포 환경 API 키 연동으로 자동화 확장",
    "#HWPX #Vercel #DocumentAI #OpenAI #ProductEngineering",
  ];
}

type NormalizeResult = {
  lines: string[];
  source: "ai" | "mixed" | "fallback";
};

function normalizeLines(raw: unknown, today: string): NormalizeResult {
  const fallback = fallbackLines(today);
  if (!Array.isArray(raw)) {
    return { lines: fallback, source: "fallback" };
  }

  const flat = raw
    .map((item) => String(item ?? ""))
    .flatMap((item) => item.split(/\r?\n/g))
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0)
    .map((item) => item.replace(/^[-*]\s+/, "- "));

  if (flat.length >= TARGET_LINE_COUNT) {
    return { lines: flat.slice(0, TARGET_LINE_COUNT), source: "ai" };
  }

  if (flat.length >= 12) {
    const filled = [...flat];
    while (filled.length < TARGET_LINE_COUNT) {
      filled.push(fallback[filled.length]);
    }
    return { lines: filled, source: "mixed" };
  }

  return { lines: fallback, source: "fallback" };
}

function parseJsonObject(raw: string): { lines?: unknown } {
  try {
    return JSON.parse(raw) as { lines?: unknown };
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as { lines?: unknown };
    }
    throw new Error("JSON parse failed");
  }
}

async function generateLines(
  client: OpenAI,
  model: string,
  today: string,
): Promise<NormalizeResult> {
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "너는 B2B SaaS/개발자 제품의 링크드인 게시글 작성자다. 반드시 JSON 객체로만 답하고, 키는 lines 하나만 사용한다.",
      },
      {
        role: "user",
        content:
          `아래 조건으로 한국어 보고서 라인 25개를 작성해줘.\n` +
          `- 형식: {\"lines\":[\"...\"]}\n` +
          `- lines 길이: 정확히 25개\n` +
          `- 각 라인은 1문장/짧은 구 형태, XML/마크다운 코드블록 금지\n` +
          `- 톤: 링크드인에 올릴 수 있는 전문적/실무 공유 톤\n` +
          `- 프로젝트 맥락: HWPX Studio, AI 제안 API(/api/suggest, /api/suggest-batch), XML 텍스트 치환, 무결성 검사(mimetype/version.xml/content.hpf), Undo/Redo, 섹션 자동 선택, Diff 프리뷰\n` +
          `- 구성: 제목, 날짜(${today}), 핵심성과, 기술포인트, 다음계획, 마지막 해시태그 라인\n` +
          `- 과장 금지, 숫자/성과 중심으로 명확하게 작성`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJsonObject(content);
  return normalizeLines(parsed.lines, today);
}

function findStartIndex(sectionNodes: Array<{ text: string }>): number {
  const idx = sectionNodes.findIndex((node) => node.text.trim() === "오늘 작업 보고서");
  return idx >= 0 ? idx : 0;
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      model: { type: "string" },
    },
    allowPositionals: false,
  });

  const dom = new JSDOM("");
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
  (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

  const inputPath = path.resolve(
    process.cwd(),
    values.input ?? "../examples/today-project-report.hwpx",
  );
  const outputPath = path.resolve(
    process.cwd(),
    values.output ?? "../examples/today-project-report-linkedin.hwpx",
  );

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = values.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const today = new Date().toISOString().slice(0, 10);

  const input = await fs.readFile(inputPath);
  const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const beforeReport = await validateHwpxForNode(inputBuffer);
  if (beforeReport.issues.length) {
    throw new Error(formatHwpxValidationReport("input", beforeReport));
  }

  const inspected = await inspectHwpx(inputBuffer);
  const sectionNodes = inspected.textNodes.filter(
    (node) => node.fileName === "Contents/section0.xml" && node.text.trim().length > 0,
  );

  const startIndex = findStartIndex(sectionNodes);
  if (sectionNodes.length < startIndex + TARGET_LINE_COUNT) {
    throw new Error(
      `대상 노드 부족: start=${startIndex}, need=${TARGET_LINE_COUNT}, has=${sectionNodes.length}`,
    );
  }

  const client = new OpenAI({ apiKey, baseURL });
  const result = await generateLines(client, model, today);
  const lines = result.lines;

  const edits = lines.map((line, idx) => {
    const node = sectionNodes[startIndex + idx];
    return {
      id: node.id,
      fileName: node.fileName,
      textIndex: node.textIndex,
      oldText: node.text,
      newText: line,
    };
  });

  const outputBlob = await applyTextEdits(inputBuffer, edits);
  const outputArray = new Uint8Array(await outputBlob.arrayBuffer());
  const afterReport = await validateHwpxForNode(outputArray.buffer);
  if (afterReport.issues.length) {
    throw new Error(formatHwpxValidationReport("output", afterReport));
  }

  await fs.writeFile(outputPath, outputArray);

  console.log(`created: ${outputPath}`);
  console.log(`line source: ${result.source}`);
  console.log(`applied edits: ${edits.length}`);
  console.log(formatHwpxValidationReport("output", afterReport));
  console.log("preview lines:");
  for (const line of lines.slice(0, 8)) {
    console.log(`- ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
