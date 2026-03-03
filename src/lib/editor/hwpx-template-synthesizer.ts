/**
 * DOCX/PPTX → HwpxDocumentModel 합성
 *
 * public/base.hwpx 템플릿의 header.xml(스타일/폰트/borderFill 정의)과
 * ZIP 구조를 재사용하여 ProseMirror doc으로부터 새 HwpxDocumentModel을 생성한다.
 * 생성된 모델은 기존 para-snapshot 익스포트 경로를 그대로 통해 HWPX로 저장된다.
 */

import JSZip from "jszip";
import { scanTopLevelBlocks } from "../hwpx";
import type { HwpxDocumentModel, HwpxParaNode, HwpxBlockSlot, HwpxRun } from "../../types/hwpx-model";
import type { JSONContent } from "@tiptap/core";

// ────────────────────────────────────────────────────────────────────────────
// 상수: A4 기준 사용 가능 너비 (HWPUNIT), borderFill ID (base.hwpx 기준)
// ────────────────────────────────────────────────────────────────────────────
const PAGE_USABLE_WIDTH = 43096; // A4 (좌우 여백 제외)
const BORDER_FILL_TABLE = 1; // 테이블 외곽선 borderFillIDRef
const BORDER_FILL_CELL = 1; // 셀 borderFillIDRef

// ────────────────────────────────────────────────────────────────────────────
// 스타일 매핑 타입
// ────────────────────────────────────────────────────────────────────────────
type StyleEntry = {
  styleIDRef: number;
  paraPrIDRef: number;
  charPrIDRef: number;
};

// ────────────────────────────────────────────────────────────────────────────
// XML 유틸리티
// ────────────────────────────────────────────────────────────────────────────
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(extractText).join("");
}

// ────────────────────────────────────────────────────────────────────────────
// header.xml 파싱: 스타일명 → {styleIDRef, paraPrIDRef, charPrIDRef}
// ────────────────────────────────────────────────────────────────────────────
function parseStyleMap(headerXml: string): Map<string, StyleEntry> {
  const map = new Map<string, StyleEntry>();
  for (const m of headerXml.matchAll(/<hh:style\s[^>]*>/g)) {
    const s = m[0];
    const name = s.match(/\bname="([^"]+)"/)?.[1];
    const id = s.match(/\bid="(\d+)"/)?.[1];
    const ppr = s.match(/paraPrIDRef="(\d+)"/)?.[1];
    const cpr = s.match(/charPrIDRef="(\d+)"/)?.[1];
    if (name && id !== undefined && ppr !== undefined && cpr !== undefined) {
      map.set(name, {
        styleIDRef: Number(id),
        paraPrIDRef: Number(ppr),
        charPrIDRef: Number(cpr),
      });
    }
  }
  return map;
}

// ProseMirror 노드 타입 + heading level → HWPX 스타일명
function resolveStyleName(node: JSONContent): string {
  if (node.type === "heading") {
    const level = (node.attrs as { level?: number })?.level ?? 1;
    const nameMap: Record<number, string> = {
      1: "개요 1",
      2: "개요 2",
      3: "개요 3",
      4: "개요 4",
      5: "개요 5",
    };
    return nameMap[level] ?? "개요 1";
  }
  return "바탕글";
}

// ────────────────────────────────────────────────────────────────────────────
// 문단 XML 생성
// ────────────────────────────────────────────────────────────────────────────
function buildParaXml(
  idx: number,
  text: string,
  paraPrIDRef: number,
  styleIDRef: number,
  charPrIDRef: number,
): string {
  const escaped = escapeXml(text);
  return (
    `<hp:p id="${idx}" paraPrIDRef="${paraPrIDRef}" styleIDRef="${styleIDRef}" ` +
    `pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${charPrIDRef}">` +
    `<hp:t>${escaped}</hp:t>` +
    `</hp:run>` +
    `<hp:linesegarray/>` +
    `</hp:p>`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 테이블 XML 생성
// ────────────────────────────────────────────────────────────────────────────

/** 단일 셀 XML */
function buildCellXml(
  colAddr: number,
  rowAddr: number,
  cellWidth: number,
  colSpan: number,
  rowSpan: number,
  paraIdx: number,
  text: string,
  style: StyleEntry,
  isHeader: boolean,
): string {
  const escapedText = escapeXml(text);
  const headerFlag = isHeader ? "1" : "0";
  const para =
    `<hp:p id="${paraIdx}" paraPrIDRef="${style.paraPrIDRef}" styleIDRef="${style.styleIDRef}" ` +
    `pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${style.charPrIDRef}">` +
    `<hp:t>${escapedText}</hp:t>` +
    `</hp:run>` +
    `<hp:linesegarray/>` +
    `</hp:p>`;

  return (
    `<hp:tc name="" header="${headerFlag}" hasMargin="0" protect="0" editable="0" dirty="0" ` +
    `borderFillIDRef="${BORDER_FILL_CELL}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
    `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
    para +
    `</hp:subList>` +
    `<hp:cellAddr colAddr="${colAddr}" rowAddr="${rowAddr}"/>` +
    `<hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/>` +
    `<hp:cellSz width="${cellWidth}" height="0"/>` +
    `<hp:cellMargin left="141" right="141" top="141" bottom="141"/>` +
    `</hp:tc>`
  );
}

/** 테이블 전체 XML 생성 */
function buildTableXml(node: JSONContent, style: StyleEntry, paraIdxStart: number): string {
  const rows = node.content ?? [];
  const rowCnt = rows.length;
  // 첫 번째 행의 셀 수로 열 수 결정
  const colCnt = Math.max(1, rows[0]?.content?.length ?? 1);
  const cellWidth = Math.floor(PAGE_USABLE_WIDTH / colCnt);
  const totalWidth = cellWidth * colCnt;

  let paraIdx = paraIdxStart;
  let rowsXml = "";
  let rowAddr = 0;

  for (const row of rows) {
    const cells = row.content ?? [];
    // 첫 행은 헤더로 처리 (tableHeader 타입)
    const isHeaderRow = rowAddr === 0 && cells.some((c) => c.type === "tableHeader");

    let cellsXml = "";
    let colAddr = 0;

    for (const cell of cells) {
      const cellText = (cell.content ?? [])
        .flatMap((p) => (p.type === "paragraph" || p.type === "heading" ? [extractText(p)] : []))
        .join("\n");
      const colSpan = (cell.attrs as { colspan?: number })?.colspan ?? 1;
      const rowSpan = (cell.attrs as { rowspan?: number })?.rowspan ?? 1;

      cellsXml += buildCellXml(
        colAddr,
        rowAddr,
        cellWidth * colSpan,
        colSpan,
        rowSpan,
        paraIdx++,
        cellText,
        style,
        isHeaderRow,
      );
      colAddr += colSpan;
    }

    rowsXml += `<hp:tr>${cellsXml}</hp:tr>`;
    rowAddr++;
  }

  const tblId = Math.floor(Math.random() * 2000000000);
  return (
    `<hp:tbl id="${tblId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
    `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" ` +
    `rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="${BORDER_FILL_TABLE}" noAdjust="0">` +
    `<hp:sz width="${totalWidth}" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
    `vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="283" right="283" top="283" bottom="283"/>` +
    `<hp:inMargin left="141" right="141" top="141" bottom="141"/>` +
    rowsXml +
    `</hp:tbl>`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 메인 함수
// ────────────────────────────────────────────────────────────────────────────

/**
 * DOCX/PPTX ProseMirror doc + HWPX 템플릿으로 HwpxDocumentModel 합성.
 *
 * @param templateBuffer  /base.hwpx fetch 결과 (ArrayBuffer)
 * @param doc             parseDocxToProseMirror / parsePptxToProseMirror 결과
 */
export async function buildHwpxModelFromDoc(
  templateBuffer: ArrayBuffer,
  doc: JSONContent,
): Promise<HwpxDocumentModel> {
  const zip = await JSZip.loadAsync(templateBuffer);

  const headerXml = await zip.file("Contents/header.xml")!.async("text");
  const sectionXml = await zip.file("Contents/section0.xml")!.async("text");

  const styleMap = parseStyleMap(headerXml);
  // xmlPrefix: XML 선언 + <hs:sec xmlns:...> — 네임스페이스 선언 포함
  // xmlSuffix: </hs:sec>
  const { xmlPrefix, xmlSuffix } = scanTopLevelBlocks(sectionXml);

  const paraStore = new Map<string, HwpxParaNode>();
  const blocks: HwpxBlockSlot[] = [];
  const defaultStyle = styleMap.get("바탕글") ?? { styleIDRef: 0, paraPrIDRef: 6, charPrIDRef: 0 };

  let globalParaIdx = 0;

  for (const node of doc.content ?? []) {
    if (node.type === "paragraph" || node.type === "heading") {
      const text = extractText(node);
      const styleName = resolveStyleName(node);
      const style = styleMap.get(styleName) ?? defaultStyle;

      const paraId = crypto.randomUUID();
      const paraXml = buildParaXml(
        globalParaIdx++,
        text,
        style.paraPrIDRef,
        style.styleIDRef,
        style.charPrIDRef,
      );

      const run: HwpxRun = {
        globalTextIndex: -1,
        charPrIDRef: String(style.charPrIDRef),
        text,
      };

      const paraNode: HwpxParaNode = {
        paraId,
        paraXml,
        runs: [run],
        hasContent: true,
        sourceSegmentId: null,
        isSynthesized: true,
      };

      // paraId를 ProseMirror 노드 attrs에 주입:
      // 에디터 로드 시 HwpxParaAutoAssign이 재할당하지 않도록 함
      node.attrs = { ...(node.attrs ?? {}), paraId, fileName: "Contents/section0.xml" };

      paraStore.set(paraId, paraNode);
      blocks.push({ type: "para", paraId, leadingWhitespace: "\n  " });
    } else if (node.type === "table") {
      // 테이블은 raw 블록으로 직접 섹션 XML에 삽입
      // 테이블 내 셀 문단들은 paraStore에 등록하지 않고 raw XML에 포함
      const tableXml = buildTableXml(node, defaultStyle, globalParaIdx);
      // 테이블 안의 셀 수만큼 paraIdx 소비 (셀 내 문단 id 중복 방지)
      const cellCount = (node.content ?? []).reduce(
        (sum, row) => sum + (row.content?.length ?? 0),
        0,
      );
      globalParaIdx += cellCount;

      blocks.push({ type: "raw", xml: tableXml, leadingWhitespace: "\n  " });
    }
    // 그 외 노드 타입 (horizontalRule 등)은 무시
  }

  // 빈 문서 보호: 최소 한 개의 빈 문단
  if (blocks.length === 0) {
    const paraId = crypto.randomUUID();
    const paraXml = buildParaXml(globalParaIdx, "", defaultStyle.paraPrIDRef, defaultStyle.styleIDRef, defaultStyle.charPrIDRef);
    paraStore.set(paraId, {
      paraId,
      paraXml,
      runs: [{ globalTextIndex: -1, charPrIDRef: String(defaultStyle.charPrIDRef), text: "" }],
      hasContent: false,
      sourceSegmentId: null,
      isSynthesized: true,
    });
    blocks.push({ type: "para", paraId, leadingWhitespace: "\n  " });
  }

  return {
    sections: [
      {
        fileName: "Contents/section0.xml",
        xmlPrefix,
        blocks,
        xmlSuffix,
      },
    ],
    paraStore,
    headerXml,
    baseBuffer: templateBuffer,
  };
}
