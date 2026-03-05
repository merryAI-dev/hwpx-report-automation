/**
 * HWPX 양식 파서 — 동적 셀 좌표 탐지
 *
 * 알고리즘:
 * 1. section0.xml 에서 모든 <hp:tc> 블록을 파싱
 * 2. 각 셀의 colAddr, rowAddr, colSpan, rowSpan, 텍스트를 추출
 * 3. 레이블 셀(텍스트 있음)과 인접한 빈 입력 셀(오른쪽 또는 아래)을 매칭
 * 4. 레이블 텍스트 → 입력 셀 좌표 맵을 반환
 *
 * 하드코딩 없음. 어떤 HWPX 양식이든 자동으로 분석.
 */

export type CellInfo = {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  text: string;
  /** 원본 <hp:tc> XML — 주입 시 템플릿으로 사용 */
  rawXml: string;
};

export type TemplateField = {
  /** 레이블 셀 텍스트 (예: "주제", "참여자", "주요 내용") */
  labelText: string;
  /** 레이블 셀 정보 */
  labelCell: Omit<CellInfo, "rawXml">;
  /** 입력 셀 좌표 — 여기에 데이터를 주입 */
  inputCell: { col: number; row: number };
};

export type ParsedTemplate = {
  fields: TemplateField[];
  /** col,row 키 → CellInfo 룩업 (주입용) */
  cellMap: Map<string, CellInfo>;
};

// ── XML 파싱 유틸리티 ──────────────────────────────────────────────────────────

function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** section XML 에서 모든 <hp:tc> 블록을 순서대로 추출 */
function extractTcBlocks(sectionXml: string): string[] {
  const results: string[] = [];
  let pos = 0;
  const START = "<hp:tc ";
  const END = "</hp:tc>";

  while (pos < sectionXml.length) {
    const startIdx = sectionXml.indexOf(START, pos);
    if (startIdx === -1) break;

    const endIdx = sectionXml.indexOf(END, startIdx);
    if (endIdx === -1) break;

    results.push(sectionXml.slice(startIdx, endIdx + END.length));
    pos = endIdx + END.length;
  }

  return results;
}

/** <hp:tc> XML 에서 셀 정보를 파싱 */
function parseCellInfo(tcXml: string): CellInfo | null {
  const addrMatch = tcXml.match(/colAddr="(\d+)"\s+rowAddr="(\d+)"/);
  if (!addrMatch) return null;

  const spanMatch = tcXml.match(/colSpan="(\d+)"\s+rowSpan="(\d+)"/);
  const textMatches = [...tcXml.matchAll(/<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g)];

  const rawText = textMatches
    .map((m) => unescapeXml(m[1].trim()))
    .filter(Boolean)
    .join(" ");

  return {
    col: parseInt(addrMatch[1], 10),
    row: parseInt(addrMatch[2], 10),
    colSpan: spanMatch ? parseInt(spanMatch[1], 10) : 1,
    rowSpan: spanMatch ? parseInt(spanMatch[2], 10) : 1,
    text: rawText,
    rawXml: tcXml,
  };
}

// ── 레이블-입력 셀 매칭 ────────────────────────────────────────────────────────

/**
 * 레이블 셀 텍스트를 정규화 — 공백 압축, 중간 점/줄임표 등 정리
 */
function normalizeLabel(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[·⸱∙•]/g, "·") // 중간점 통일
    .trim();
}

/**
 * 레이블 텍스트 → 표준 필드 이름 매핑
 *
 * 한국어 양식에서 자주 사용되는 레이블을 인식.
 * 일치하지 않으면 원문 그대로 필드 이름으로 사용.
 */
const LABEL_ALIASES: Record<string, string> = {
  // 아젠다/주제
  "주제": "topic",
  "아젠다": "topic",
  "제목": "topic",
  // 참여자
  "참여자": "participants",
  "참여기업": "participants",
  "참가자": "participants",
  "성명": "participants",
  // 일시/날짜
  "일시": "date",
  "날짜": "date",
  "일정": "date",
  // 장소
  "장소": "location",
  "위치": "location",
  // 주요 내용
  "주요 내용": "content",
  "내용": "content",
  "보고내용": "content",
  // 진행 사진
  "진행 사진": "photo",
  "사진": "photo",
  "첨부파일": "photo",
  // 시사점
  "주요 시사점 및 향후 개선·보완사항": "sisakjeom",
  "시사점": "sisakjeom",
  "개선사항": "sisakjeom",
  "주요 시사점": "sisakjeom",
};

function labelToFieldName(labelText: string): string {
  const normalized = normalizeLabel(labelText);

  // 정확히 일치하는 별칭 먼저
  if (LABEL_ALIASES[normalized]) return LABEL_ALIASES[normalized];

  // 부분 일치 (레이블이 더 길거나 포함된 경우)
  for (const [alias, field] of Object.entries(LABEL_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return field;
    }
  }

  // 일치하지 않으면 원문 사용 (소문자 + 공백→언더스코어)
  return normalized.toLowerCase().replace(/\s+/g, "_");
}

// ── 메인 파서 ─────────────────────────────────────────────────────────────────

/**
 * HWPX section0.xml 을 파싱하여 템플릿 필드(레이블→입력 셀 쌍)를 탐지한다.
 *
 * @param sectionXml - Contents/section0.xml 전체 텍스트
 * @returns ParsedTemplate
 */
export function parseHwpxTemplate(sectionXml: string): ParsedTemplate {
  const tcBlocks = extractTcBlocks(sectionXml);
  const cells: CellInfo[] = tcBlocks
    .map(parseCellInfo)
    .filter((c): c is CellInfo => c !== null);

  // col,row → CellInfo 룩업 테이블
  const cellMap = new Map<string, CellInfo>();
  for (const cell of cells) {
    cellMap.set(`${cell.col},${cell.row}`, cell);
  }

  const fields: TemplateField[] = [];
  const usedInputCells = new Set<string>();

  for (const cell of cells) {
    if (!cell.text) continue; // 빈 셀은 레이블이 아님

    // 1. 오른쪽 인접 셀 확인 (같은 row, col + colSpan)
    const rightKey = `${cell.col + cell.colSpan},${cell.row}`;
    const rightCell = cellMap.get(rightKey);
    if (rightCell && !rightCell.text && !usedInputCells.has(rightKey)) {
      fields.push({
        labelText: cell.text,
        labelCell: { col: cell.col, row: cell.row, colSpan: cell.colSpan, rowSpan: cell.rowSpan, text: cell.text },
        inputCell: { col: rightCell.col, row: rightCell.row },
      });
      usedInputCells.add(rightKey);
      continue;
    }

    // 2. 아래쪽 인접 셀 확인 (같은 col, row + rowSpan)
    const belowKey = `${cell.col},${cell.row + cell.rowSpan}`;
    const belowCell = cellMap.get(belowKey);
    if (belowCell && !belowCell.text && !usedInputCells.has(belowKey)) {
      fields.push({
        labelText: cell.text,
        labelCell: { col: cell.col, row: cell.row, colSpan: cell.colSpan, rowSpan: cell.rowSpan, text: cell.text },
        inputCell: { col: belowCell.col, row: belowCell.row },
      });
      usedInputCells.add(belowKey);
    }
  }

  return { fields, cellMap };
}

/**
 * ParsedTemplate 에서 fieldName → inputCell 좌표 맵을 생성한다.
 *
 * 사용 예:
 *   const coordMap = buildFieldCoordMap(template);
 *   const topicCell = coordMap.get("topic"); // { col: 1, row: 0 }
 */
export function buildFieldCoordMap(
  template: ParsedTemplate,
): Map<string, { col: number; row: number }> {
  const map = new Map<string, { col: number; row: number }>();

  for (const field of template.fields) {
    const fieldName = labelToFieldName(field.labelText);
    // 중복 시 먼저 발견된 것 우선
    if (!map.has(fieldName)) {
      map.set(fieldName, field.inputCell);
    }
    // 원문 레이블도 키로 저장 (사용자 정의 매핑 지원)
    const rawKey = normalizeLabel(field.labelText);
    if (!map.has(rawKey)) {
      map.set(rawKey, field.inputCell);
    }
  }

  return map;
}

/**
 * HWPX 양식의 필드 탐지 결과를 사람이 읽기 쉬운 형식으로 요약
 * (디버깅 / UI 표시용)
 */
export function describeTemplate(template: ParsedTemplate): string {
  if (template.fields.length === 0) return "감지된 필드 없음";

  return template.fields
    .map((f) => {
      const fieldName = labelToFieldName(f.labelText);
      return `"${f.labelText}" (${fieldName}) → 입력셀 (col=${f.inputCell.col}, row=${f.inputCell.row})`;
    })
    .join("\n");
}
