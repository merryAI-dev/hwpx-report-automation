/**
 * CSV → HWPX 일괄 생성 파이프라인.
 *
 * Phase 1 (simple): CSV 데이터를 직접 양식 셀에 주입.
 * Phase 2 (ai-refine): Claude API로 보고서를 "주요 내용 / 시사점" 구조로 정제 후 주입.
 *
 * 셀 좌표는 HWPX 양식을 동적으로 파싱하여 도출 — 하드코딩 없음.
 */

import JSZip from "jszip";
import Anthropic from "@anthropic-ai/sdk";
import { parseCsv, type CsvRow } from "./csv-parser";
import { injectMultipleCells, type CellInjection } from "./hwpx-cell-injector";
import {
  parseHwpxTemplate,
  buildFieldCoordMap,
  describeTemplate,
  type ParsedTemplate,
} from "./hwpx-template-parser";

// ── 컬럼 매핑 설정 ────────────────────────────────────────────────────────────

/**
 * CSV 컬럼명 → 양식 필드명 매핑.
 *
 * fieldName 은 HWPX 양식의 레이블 텍스트에서 자동 도출된 이름
 * (예: "주제" → "topic", "참여자" → "participants").
 * 또는 원문 레이블 텍스트를 직접 사용할 수도 있음.
 */
export type ColumnMapping = {
  /** fieldName → CSV 컬럼명 */
  [fieldName: string]: string;
};

/** "2025_전체일정.csv" 기준 기본 매핑 */
export const DEFAULT_COLUMN_MAPPING: ColumnMapping = {
  topic:        "아젠다 명",
  participants: "참여기업 명",
  date:         "일정",
  location:     "",           // CSV에 없음 → 빈칸
  content:      "보고서",
  photo:        "첨부파일링크",
};

export type BatchMode = "simple" | "ai-refine";

export type BatchOptions = {
  mode: BatchMode;
  mapping: ColumnMapping;
  /** 상태 필터. 기본값: "종료" 또는 "완료"인 행만 처리 */
  statusFilter?: string[];
  /** Phase 2 전용: API 키 (없으면 process.env.ANTHROPIC_API_KEY 사용) */
  anthropicApiKey?: string;
  /** 진행 콜백 */
  onProgress?: (done: number, total: number, fileName: string) => void;
};

// ── 텍스트 정제 ───────────────────────────────────────────────────────────────

/**
 * 보고서 텍스트를 HWPX 셀에 맞게 정제한다.
 * - 마크다운 기호 제거 (**bold**, ## 헤더, -- 구분선 등)
 * - 연속 빈 줄 압축 (2개 이상 → 1개)
 * - 각 줄 앞뒤 공백 제거
 * - 최대 줄 수 제한 (셀 높이 초과 방지)
 */
export function normalizeReportText(text: string, maxLines = 18): string {
  return text
    .replace(/\*\*([^*]*)\*\*/g, "$1")   // **bold**
    .replace(/\*([^*]*)\*/g, "$1")        // *italic*
    .replace(/^#+\s*/gm, "")             // ## 헤더
    .replace(/^[-─—]{3,}\s*$/gm, "")     // --- 구분선
    .replace(/`([^`]*)`/g, "$1")          // `code`
    .split("\n")
    .map((l) => l.trimEnd())
    .reduce<string[]>((acc, line) => {
      if (line === "" && acc.at(-1) === "") return acc;
      acc.push(line);
      return acc;
    }, [])
    .join("\n")
    .trim()
    .split("\n")
    .slice(0, maxLines)
    .join("\n");
}

// ── Phase 2 AI 정제 ───────────────────────────────────────────────────────────

const REFINE_SYSTEM_PROMPT = `당신은 컨설팅 보고서를 정제하는 전문가입니다.
입력된 보고서 텍스트를 분석하여 JSON으로 응답하세요.

응답 형식 (반드시 JSON만):
{
  "content": "주요 내용 (핵심 사항을 간결하게 요약, 최대 500자)",
  "sisakjeom": "주요 시사점 및 향후 개선·보완사항 (2~4문장)"
}

규칙:
- 원문의 핵심 내용을 유지하면서 명확하고 간결하게 작성
- 마크다운 기호(**bold**, ## 헤더 등) 제거
- 존댓말 유지
- 시사점이 원문에 없으면 내용을 바탕으로 합리적으로 도출`;

async function refineWithAI(
  reportText: string,
  client: Anthropic,
): Promise<{ content: string; sisakjeom: string }> {
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: REFINE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: reportText.slice(0, 3000) }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
  try {
    const parsed = JSON.parse(raw) as { content?: string; sisakjeom?: string };
    return {
      content: parsed.content ?? reportText,
      sisakjeom: parsed.sisakjeom ?? "",
    };
  } catch {
    return { content: reportText, sisakjeom: "" };
  }
}

// ── HWPX 생성 ─────────────────────────────────────────────────────────────────

async function generateHwpx(
  templateBuffer: ArrayBuffer,
  injections: CellInjection[],
  paraIdBase: number,
): Promise<Uint8Array> {
  const templateZip = await JSZip.loadAsync(templateBuffer);
  const outputZip = new JSZip();

  const SECTION_FILE = "Contents/section0.xml";

  const sectionFile = templateZip.file(SECTION_FILE);
  if (!sectionFile) throw new Error("section0.xml not found in template");
  const originalXml = await sectionFile.async("string");
  const patchedXml = injectMultipleCells(originalXml, injections, paraIdBase);

  // HWPX 규격상 STORE(무압축)이어야 하는 파일
  const STORE_FILES = new Set(["mimetype", "version.xml", "Preview/PrvImage.png"]);

  for (const [name, file] of Object.entries(templateZip.files)) {
    if (file.dir) continue;

    const compression = STORE_FILES.has(name) ? "STORE" : "DEFLATE";

    if (name === SECTION_FILE) {
      outputZip.file(name, patchedXml, { compression, createFolders: false });
    } else {
      const content = await file.async("uint8array");
      outputZip.file(name, content, { compression, createFolders: false });
    }
  }

  return outputZip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

// ── 주입 데이터 구성 ──────────────────────────────────────────────────────────

/**
 * CSV 행 + 컬럼 매핑 + 템플릿 필드 좌표 → CellInjection[] 생성
 *
 * @param row       CSV 행 데이터
 * @param mapping   fieldName → CSV 컬럼명
 * @param coordMap  fieldName → { col, row } (양식에서 파싱된 좌표)
 */
function buildInjections(
  row: CsvRow,
  mapping: ColumnMapping,
  coordMap: Map<string, { col: number; row: number }>,
): CellInjection[] {
  const injections: CellInjection[] = [];

  for (const [fieldName, csvColumn] of Object.entries(mapping)) {
    if (!csvColumn) continue; // 빈 매핑 → 스킵

    const coord = coordMap.get(fieldName);
    if (!coord) continue; // 양식에 해당 필드 없음

    let text = row[csvColumn] ?? "";

    // 참여자 필드: 컨설턴트 명 병합
    if (fieldName === "participants") {
      const consultant = row["컨설턴트 명"] ?? "";
      text = [text, consultant].filter(Boolean).join(" / ");
    }

    // 내용 필드: 마크다운 정제
    if (fieldName === "content") {
      text = normalizeReportText(text);
    }

    // 사진 링크: "-" 는 빈칸으로
    if (fieldName === "photo" && text === "-") {
      text = "";
    }

    if (text.trim()) {
      injections.push({ ...coord, text });
    }
  }

  return injections;
}

// ── 파일명 생성 ───────────────────────────────────────────────────────────────

function buildFileName(row: CsvRow, idx: number): string {
  const biz = (row["사업 명"] ?? "").slice(0, 20).replace(/[/\\:*?"<>|]/g, "_");
  const company = (row["참여기업 명"] ?? "").slice(0, 15).replace(/[/\\:*?"<>|]/g, "_");
  const date = (row["일정"] ?? "").slice(0, 10);
  const base = [biz, company, date].filter(Boolean).join("_") || `report_${idx + 1}`;
  return `${base}.hwpx`;
}

// ── 메인 파이프라인 ───────────────────────────────────────────────────────────

export async function runBatchPipeline(
  csvText: string,
  templateBuffer: ArrayBuffer,
  options: BatchOptions,
): Promise<Blob> {
  const {
    mode,
    mapping,
    statusFilter = ["종료", "완료"],
    anthropicApiKey,
    onProgress,
  } = options;

  // 1. HWPX 양식 파싱 — 레이블→입력 셀 좌표 동적 탐지
  const templateZip = await JSZip.loadAsync(templateBuffer);
  const sectionFile = templateZip.file("Contents/section0.xml");
  if (!sectionFile) throw new Error("유효하지 않은 HWPX 양식: section0.xml 없음");

  const sectionXml = await sectionFile.async("string");
  const parsedTemplate: ParsedTemplate = parseHwpxTemplate(sectionXml);

  if (parsedTemplate.fields.length === 0) {
    throw new Error(
      "HWPX 양식에서 레이블-입력 셀 쌍을 찾을 수 없습니다.\n" +
      "양식에 레이블(주제, 참여자 등)과 인접한 빈 입력 셀이 있는지 확인하세요."
    );
  }

  const coordMap = buildFieldCoordMap(parsedTemplate);

  // 2. CSV 파싱
  let rows = parseCsv(csvText);

  // 3. 상태 필터링
  if (statusFilter.length > 0) {
    rows = rows.filter((r) => {
      const status = r["상태"] ?? "";
      return statusFilter.includes(status) || status === "";
    });
  }

  // 4. 보고서 내용 없는 행 스킵
  const contentColumn = mapping["content"];
  if (contentColumn) {
    rows = rows.filter((r) => (r[contentColumn] ?? "").trim() !== "");
  }

  const total = rows.length;
  const outputZip = new JSZip();

  // 5. Phase 2용 AI 클라이언트 초기화
  let aiClient: Anthropic | null = null;
  if (mode === "ai-refine") {
    const apiKey = anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
    aiClient = new Anthropic({ apiKey });
  }

  // sisakjeom 필드의 좌표 (AI 정제 결과 주입용)
  const sisakjeomCoord = coordMap.get("sisakjeom");

  // 6. 행별 처리
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const paraIdBase = (idx + 1) * 10000;

    let injections = buildInjections(row, mapping, coordMap);

    if (mode === "ai-refine" && aiClient && contentColumn) {
      const reportText = row[contentColumn] ?? "";
      if (reportText.trim()) {
        const refined = await refineWithAI(reportText, aiClient);

        // content 주입을 AI 정제 결과로 교체
        const contentCoord = coordMap.get("content");
        if (contentCoord) {
          injections = injections.filter(
            (inj) => !(inj.col === contentCoord.col && inj.row === contentCoord.row)
          );
          injections.push({ ...contentCoord, text: refined.content });
        }

        // 시사점 주입
        if (refined.sisakjeom && sisakjeomCoord) {
          injections.push({ ...sisakjeomCoord, text: refined.sisakjeom });
        }
      }
    }

    const hwpxBytes = await generateHwpx(templateBuffer, injections, paraIdBase);
    const fileName = buildFileName(row, idx);
    outputZip.file(fileName, hwpxBytes);

    onProgress?.(idx + 1, total, fileName);
  }

  // 7. ZIP 생성
  return outputZip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/**
 * HWPX 템플릿에서 {{KEY}} 플레이스홀더를 탐지한다.
 * 플레이스홀더가 1개 이상 있으면 해당 키 목록을 반환, 없으면 빈 배열.
 */
export async function detectPlaceholders(templateBuffer: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const sectionFile = zip.file("Contents/section0.xml");
  if (!sectionFile) return [];
  const xml = await sectionFile.async("string");
  const matches = xml.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  const keys = [...new Set(matches.map((m) => m.replace(/^\{\{|\}\}$/g, "")))];
  return keys;
}

/** 양식 파싱 결과 미리보기 (UI 표시용) */
export async function inspectTemplate(templateBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const sectionFile = zip.file("Contents/section0.xml");
  if (!sectionFile) return "유효하지 않은 HWPX 파일";

  const sectionXml = await sectionFile.async("string");
  const parsed = parseHwpxTemplate(sectionXml);
  return describeTemplate(parsed);
}

// ── 플레이스홀더 방식 파이프라인 ─────────────────────────────────────────────
//
// 양식에 {{주제}}, {{참여자}} 등의 플레이스홀더가 이미 삽입된 경우 사용.
// 배치 템플릿 패널에서 AI가 생성한 양식을 처리하는 핵심 경로.

export type PlaceholderMapping = {
  /** 플레이스홀더 키 → CSV 컬럼명. 예: { "주제": "아젠다 명", "참여자": "참여기업 명" } */
  [placeholder: string]: string;
};

export type PlaceholderBatchOptions = {
  mapping: PlaceholderMapping;
  statusFilter?: string[];
  anthropicApiKey?: string;
  onProgress?: (done: number, total: number, fileName: string) => void;
};

/**
 * HWPX section XML 내의 모든 {{KEY}} 플레이스홀더를 data로 치환한다.
 * 한 번의 string replace로 처리 — XML 구조 파싱 불필요.
 */
function applyPlaceholders(
  sectionXml: string,
  data: Record<string, string>,
): string {
  let result = sectionXml;
  for (const [key, value] of Object.entries(data)) {
    // XML 이스케이프가 된 형태도 처리
    const escaped = value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    // {{KEY}} → 값으로 치환 (XML 내에서도 그대로 교체)
    result = result.replaceAll(`{{${key}}}`, escaped);
  }
  return result;
}

/**
 * 플레이스홀더 방식 배치 파이프라인.
 * 양식 HWPX에 {{주제}}, {{참여자}} 등이 삽입되어 있다고 가정.
 */
export async function runPlaceholderBatchPipeline(
  csvText: string,
  templateBuffer: ArrayBuffer,
  options: PlaceholderBatchOptions,
): Promise<Blob> {
  const { mapping, statusFilter = ["종료", "완료"], onProgress } = options;

  // 1. CSV 파싱 + 필터링
  let rows = parseCsv(csvText);
  if (statusFilter.length > 0) {
    rows = rows.filter((r) => {
      const status = r["상태"] ?? "";
      return statusFilter.includes(status) || status === "";
    });
  }

  // 내용 컬럼이 있으면 빈 행 스킵
  const contentCol = mapping["주요내용"] ?? mapping["내용"] ?? "";
  if (contentCol) {
    rows = rows.filter((r) => (r[contentCol] ?? "").trim() !== "");
  }

  const total = rows.length;
  const outputZip = new JSZip();

  // 2. 템플릿 section0.xml 로드
  const templateZip = await JSZip.loadAsync(templateBuffer);
  const sectionFile = templateZip.file("Contents/section0.xml");
  if (!sectionFile) throw new Error("유효하지 않은 HWPX 양식: section0.xml 없음");
  const templateXml = await sectionFile.async("string");

  const STORE_FILES = new Set(["mimetype", "version.xml", "Preview/PrvImage.png"]);

  // 3. 행별 처리
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];

    // placeholder → 실제 값 맵 구성
    const data: Record<string, string> = {};
    for (const [placeholder, csvColumn] of Object.entries(mapping)) {
      if (!csvColumn) continue;
      let value = row[csvColumn] ?? "";

      // 참여자: 컨설턴트 병합
      if (placeholder === "참여자" || placeholder === "참여기업") {
        const consultant = row["컨설턴트 명"] ?? "";
        value = [value, consultant].filter(Boolean).join(" / ");
      }
      // 내용 계열: 마크다운 정제
      if (["주요내용", "내용", "보고내용"].includes(placeholder)) {
        value = normalizeReportText(value);
      }
      // 사진: "-"는 빈칸
      if (["사진", "진행사진"].includes(placeholder) && value === "-") {
        value = "";
      }

      data[placeholder] = value;
    }

    // 플레이스홀더 치환
    const patchedXml = applyPlaceholders(templateXml, data);

    // HWPX 재조립
    const outZip = new JSZip();
    for (const [name, file] of Object.entries(templateZip.files)) {
      if (file.dir) continue;
      const compression = STORE_FILES.has(name) ? "STORE" : "DEFLATE";
      if (name === "Contents/section0.xml") {
        outZip.file(name, patchedXml, { compression, createFolders: false });
      } else {
        const content = await file.async("uint8array");
        outZip.file(name, content, { compression, createFolders: false });
      }
    }

    const hwpxBytes = await outZip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const fileName = buildFileName(row, idx);
    outputZip.file(fileName, hwpxBytes);
    onProgress?.(idx + 1, total, fileName);
  }

  return outputZip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export type { CsvRow };
