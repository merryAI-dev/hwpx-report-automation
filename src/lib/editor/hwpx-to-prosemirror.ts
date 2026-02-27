import JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import { inspectHwpx, scanTopLevelBlocks } from "../hwpx";
import type { HwpxDocumentModel, HwpxSectionModel, HwpxParaNode, HwpxBlockSlot, HwpxRun } from "../../types/hwpx-model";

export type EditorSegment = {
  segmentId: string;
  fileName: string;
  textIndex: number;
  text: string;
  originalText: string;
  tag: string;
  styleHints: Record<string, string>;
};

export type ParsedProseMirrorDocument = {
  doc: JSONContent;
  segments: EditorSegment[];
  /** Maps primary segmentId → extra segmentIds merged into the same paragraph */
  extraSegmentsMap: Record<string, string[]>;
  integrityIssues: string[];
  /** OWPML in-memory model for lossless para-snapshot round-trip. Null for non-HWPX. */
  hwpxDocumentModel: HwpxDocumentModel | null;
};

const SECTION_FILE_RE = /^Contents\/section\d+\.xml$/;
const HEADER_FILE = "Contents/header.xml";

/**
 * Parse Contents/header.xml and build a map from borderFill id → CSS background color.
 * HWPX stores cell/paragraph fill info as <borderFill> elements in the header.
 * The fill color is in <fillBrush><winBrush faceColor="#RRGGBB"/></fillBrush>.
 */
function extractBorderFillColors(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  const allElements = Array.from(doc.getElementsByTagName("*"));
  for (const el of allElements) {
    if (el.localName !== "borderFill") {
      continue;
    }
    const id = el.getAttribute("id");
    if (!id) {
      continue;
    }
    // Navigate: borderFill → fillBrush → winBrush @faceColor
    for (const child of Array.from(el.children)) {
      if (child.localName !== "fillBrush") {
        continue;
      }
      for (const grandchild of Array.from(child.children)) {
        if (grandchild.localName !== "winBrush") {
          continue;
        }
        const faceColor = grandchild.getAttribute("faceColor");
        if (faceColor && faceColor !== "none" && faceColor !== "#FFFFFF" && faceColor !== "#ffffff") {
          // Normalize: HWPX sometimes uses 8-digit #AARRGGBB; strip leading FF alpha
          let color = faceColor;
          if (/^#[0-9a-fA-F]{8}$/.test(color)) {
            const alpha = Number.parseInt(color.slice(1, 3), 16);
            if (alpha === 0) {
              break; // fully transparent
            }
            color = `#${color.slice(3)}`;
          }
          map.set(id, color);
        }
      }
    }
  }
  return map;
}

function readSignedIntAttr(element: Element, aliases: string[]): number | null {
  const aliasSet = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const attr of Array.from(element.attributes)) {
    const normalizedName = attr.name.toLowerCase().replace(/^[^:]+:/, "");
    if (!aliasSet.has(normalizedName)) {
      continue;
    }
    const parsed = Number.parseInt(attr.value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Parse Contents/header.xml and build a map from charPr id → spacing value.
 * We use hangul spacing first; if missing, fall back to latin/other slots.
 */
function extractCharPrSpacingMap(doc: Document): Map<string, number> {
  const map = new Map<string, number>();
  const allElements = Array.from(doc.getElementsByTagName("*"));
  for (const el of allElements) {
    if (el.localName !== "charPr") {
      continue;
    }
    const id = el.getAttribute("id");
    if (!id) {
      continue;
    }

    const spacing = Array.from(el.children).find((child) => child.localName === "spacing");
    if (!spacing) {
      map.set(id, 0);
      continue;
    }
    const value =
      readSignedIntAttr(spacing, ["hangul"]) ??
      readSignedIntAttr(spacing, ["latin"]) ??
      readSignedIntAttr(spacing, ["hanja"]) ??
      readSignedIntAttr(spacing, ["japanese"]) ??
      readSignedIntAttr(spacing, ["other"]) ??
      readSignedIntAttr(spacing, ["symbol"]) ??
      readSignedIntAttr(spacing, ["user"]) ??
      0;
    map.set(id, value);
  }
  return map;
}

/**
 * Parse Contents/header.xml and build a map from charPr id → marks info.
 * bold:        true if <hh:bold/> child element exists
 * italic:      true if <hh:italic/> child element exists
 * underline:   true if <hh:underline type="SINGLE"> child element exists
 * strike:      true if <hh:strikeout shape != "NONE"> child element exists
 * superscript: true if <hh:superscript/> child element exists
 * subscript:   true if <hh:subscript/> child element exists
 * color:       textColor attribute if not "#000000" (default)
 */
type CharPrMarks = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  color?: string;
};

function extractCharPrMarksMap(doc: Document): Map<string, CharPrMarks> {
  const map = new Map<string, CharPrMarks>();
  const allElements = Array.from(doc.getElementsByTagName("*"));
  for (const el of allElements) {
    if (el.localName !== "charPr") continue;
    const id = el.getAttribute("id");
    if (!id) continue;
    const children = Array.from(el.children);
    const hasBold = children.some((c) => c.localName === "bold");
    const hasItalic = children.some((c) => c.localName === "italic");
    const underlineEl = children.find((c) => c.localName === "underline");
    const hasUnderline = underlineEl ? underlineEl.getAttribute("type") === "SINGLE" : false;
    const strikeoutEl = children.find((c) => c.localName === "strikeout");
    const hasStrike = strikeoutEl ? strikeoutEl.getAttribute("shape") !== "NONE" : false;
    const hasSuperscript = children.some((c) => c.localName === "superscript");
    const hasSubscript = children.some((c) => c.localName === "subscript");
    const rawColor = el.getAttribute("textColor");
    const color = rawColor && rawColor.toUpperCase() !== "#000000" ? rawColor : undefined;
    map.set(id, { bold: hasBold, italic: hasItalic, underline: hasUnderline, strike: hasStrike, superscript: hasSuperscript, subscript: hasSubscript, color });
  }
  return map;
}

/** HWPX paraPr의 파싱된 값 */
type ParaPrValues = {
  align: string;           // "LEFT" | "CENTER" | "RIGHT" | "JUSTIFY"
  lineSpacing: number;     // percentage (e.g. 160 for 160%)
  leftIndent: number;      // HWPUNIT
  rightIndent: number;     // HWPUNIT
  firstLineIndent: number; // HWPUNIT (can be negative for outdent)
  spaceBefore: number;     // HWPUNIT
  spaceAfter: number;      // HWPUNIT
};

/**
 * Parse Contents/header.xml and build a map from paraPr id → paragraph formatting values.
 * HWPX paraPr structure:
 *   <hh:paraPr id="N">
 *     <hh:align horizontal="JUSTIFY"/>
 *     <hp:switch><hp:default>
 *       <hh:margin>
 *         <hc:intent value="0" unit="HWPUNIT"/>  ← first-line indent
 *         <hc:left  value="0" unit="HWPUNIT"/>
 *         <hc:right value="0" unit="HWPUNIT"/>
 *         <hc:prev  value="0" unit="HWPUNIT"/>   ← space before
 *         <hc:next  value="0" unit="HWPUNIT"/>   ← space after
 *       </hh:margin>
 *       <hh:lineSpacing type="PERCENT" value="160"/>
 *     </hp:default></hp:switch>
 *   </hh:paraPr>
 */
function extractParaPrMap(doc: Document): Map<string, ParaPrValues> {
  const map = new Map<string, ParaPrValues>();
  const allElements = Array.from(doc.getElementsByTagName("*"));
  for (const el of allElements) {
    if (el.localName !== "paraPr") continue;
    const id = el.getAttribute("id");
    if (!id) continue;

    const descendants = Array.from(el.getElementsByTagName("*"));

    // Alignment
    const alignEl = descendants.find((c) => c.localName === "align");
    const align = (alignEl?.getAttribute("horizontal") ?? "JUSTIFY").toUpperCase();

    // Line spacing (only handle PERCENT type; default 160%)
    let lineSpacing = 160;
    const lsEl = descendants.find((c) => c.localName === "lineSpacing");
    if (lsEl) {
      const type = (lsEl.getAttribute("type") ?? "").toUpperCase();
      if (type === "PERCENT") {
        const val = Number.parseInt(lsEl.getAttribute("value") ?? "160", 10);
        if (Number.isFinite(val) && val > 0) lineSpacing = val;
      }
    }

    // Margins from <hh:margin> children
    let leftIndent = 0;
    let rightIndent = 0;
    let firstLineIndent = 0;
    let spaceBefore = 0;
    let spaceAfter = 0;
    const marginEl = descendants.find((c) => c.localName === "margin");
    if (marginEl) {
      for (const child of Array.from(marginEl.children)) {
        const rawVal = child.getAttribute("value") ?? "0";
        const val = Number.parseInt(rawVal, 10);
        if (!Number.isFinite(val)) continue;
        switch (child.localName) {
          case "left":   leftIndent = val;      break;
          case "right":  rightIndent = val;     break;
          case "intent": // HWP XML first-line indent (may be "intent" or "indent")
          case "indent": firstLineIndent = val; break;
          case "prev":   spaceBefore = val;     break;
          case "next":   spaceAfter = val;      break;
        }
      }
    }

    map.set(id, { align, lineSpacing, leftIndent, rightIndent, firstLineIndent, spaceBefore, spaceAfter });
  }
  return map;
}

function isHeadingLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/^제\s*\d+\s*(장|절|항)/.test(trimmed)) {
    return true;
  }
  if (/^(\d+(\.\d+){0,2}|[IVXLC]+|[A-Za-z가-힣])[\.\)]\s+/.test(trimmed)) {
    return true;
  }
  return false;
}

function readPositiveIntAttr(element: Element, aliases: string[]): number | null {
  const aliasSet = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const attr of Array.from(element.attributes)) {
    const normalizedName = attr.name.toLowerCase().replace(/^[^:]+:/, "");
    if (!aliasSet.has(normalizedName)) {
      continue;
    }
    const parsed = Number.parseInt(attr.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Read colspan or rowspan from a <hp:tc> element.
 * Real HWPX files store span info in a <hp:cellSpan colSpan="N" rowSpan="M"/>
 * child element. Synthetic test fixtures may use direct attributes on <hp:tc>.
 * This function checks direct attributes first, then <hp:cellSpan> children.
 */
function readCellSpan(cell: Element, attrAliases: string[], cellSpanAttr: string): number {
  // 1. Check direct attributes on <hp:tc> (used by synthetic test fixtures)
  const direct = readPositiveIntAttr(cell, attrAliases);
  if (direct !== null) {
    return direct;
  }
  // 2. Check <hp:cellSpan> child element (used in real HWPX files)
  for (const child of Array.from(cell.children)) {
    if (child.localName === "cellSpan") {
      // The child uses camelCase attribute names: colSpan / rowSpan
      const val = Number.parseInt(child.getAttribute(cellSpanAttr) || "0", 10);
      if (Number.isFinite(val) && val > 1) {
        return val;
      }
    }
  }
  return 1;
}

/**
 * Returns true if this <hp:tc> is a "dirty" covered cell that should be
 * hidden — i.e., it is subsumed by a spanning cell elsewhere in the table.
 * In OWPML format, covered cells carry dirty="1".
 */
function isCoveredCell(cell: Element): boolean {
  return cell.getAttribute("dirty") === "1";
}

function readSegmentLetterSpacing(segment: EditorSegment): number | null {
  const raw = segment.styleHints.hwpxCharSpacing;
  if (raw === undefined) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 연속된 동일 mark 조합의 텍스트+marks 정보 */
type ParsedRunChunk = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  color?: string;
};

function toParagraphNode(
  segment: EditorSegment,
  asHeading: boolean,
  runChunks?: ParsedRunChunk[],
): JSONContent {
  const letterSpacing = readSegmentLetterSpacing(segment);
  const attrs: Record<string, string | number> = {
    segmentId: segment.segmentId,
    fileName: segment.fileName,
    textIndex: segment.textIndex,
    originalText: segment.originalText,
  };
  if (letterSpacing !== null) {
    attrs.letterSpacing = letterSpacing;
  }
  const inlineContent: JSONContent[] = [];

  const hasMarks = runChunks && runChunks.length > 0 && runChunks.some((r) => r.bold || r.italic || r.underline || r.strike || r.superscript || r.subscript || r.color);
  if (hasMarks && runChunks) {
    // 런별 marks 적용
    for (const runChunk of runChunks) {
      const parts = runChunk.text.split(/\r\n|\r|\n/);
      for (const [index, part] of parts.entries()) {
        if (index > 0) {
          inlineContent.push({ type: "hardBreak" });
        }
        if (!part.length) continue;
        const marks: ({ type: string } | { type: string; attrs: Record<string, unknown> })[] = [];
        if (runChunk.bold) marks.push({ type: "bold" });
        if (runChunk.italic) marks.push({ type: "italic" });
        if (runChunk.underline) marks.push({ type: "underline" });
        if (runChunk.strike) marks.push({ type: "strike" });
        if (runChunk.superscript) marks.push({ type: "superscript" });
        if (runChunk.subscript) marks.push({ type: "subscript" });
        if (runChunk.color) marks.push({ type: "textStyle", attrs: { color: runChunk.color } });
        inlineContent.push({
          type: "text",
          text: part,
          ...(marks.length > 0 ? { marks } : {}),
        });
      }
    }
  } else {
    // marks 없음 — 기존 동작 유지
    const chunks = segment.text.split(/\r\n|\r|\n/);
    for (const [index, chunk] of chunks.entries()) {
      if (index > 0) {
        inlineContent.push({ type: "hardBreak" });
      }
      if (!chunk.length) {
        continue;
      }
      inlineContent.push({ type: "text", text: chunk });
    }
  }

  return {
    type: asHeading ? "heading" : "paragraph",
    attrs: asHeading ? { ...attrs, level: 2 } : attrs,
    content: inlineContent,
  };
}

/**
 * Build a map from each DOM Element to its EditorSegment by traversing the
 * document in document order (depth-first, same order as scanXmlTextSegments
 * in hwpx.ts). For each non-whitespace text node encountered, the next entry
 * in the sorted pool is assigned to that text node's parent Element.
 *
 * This approach avoids createTreeWalker/NodeFilter (which can behave
 * inconsistently for XML documents in different JSDOM contexts) and guarantees
 * that Element objects from the same document map directly to their segments.
 */
function buildElementSegmentMap(
  xmlDoc: Document,
  pool: EditorSegment[],
): Map<Element, EditorSegment> {
  const map = new Map<Element, EditorSegment>();
  let poolIndex = 0;

  function visit(node: Node): void {
    const nodeType = node.nodeType;
    if (nodeType === 3 /* TEXT_NODE */ || nodeType === 4 /* CDATA_SECTION_NODE */) {
      if ((node.nodeValue || "").trim().length > 0 && poolIndex < pool.length) {
        const parent = (node as Text).parentElement;
        // Only record the first non-whitespace text child per element
        if (parent && !map.has(parent)) {
          map.set(parent, pool[poolIndex]);
        }
        poolIndex += 1;
      }
      // Whitespace-only text nodes: do NOT increment poolIndex — they are not
      // in the pool (scanXmlTextSegments skips whitespace-only runs too).
    } else {
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        visit(children[i]);
      }
    }
  }

  visit(xmlDoc);
  return map;
}

/**
 * Collect all <hp:t> descendants of `parent`, but stop descending into nested
 * <hp:tbl> elements so that text inside nested tables is not attributed to the
 * outer cell paragraph.
 */
function getTextElementsExcludingNestedTables(parent: Element): Element[] {
  const result: Element[] = [];
  function traverse(el: Element): void {
    for (const child of Array.from(el.children)) {
      if (child.localName === "t") {
        result.push(child);
      } else if (child.localName !== "tbl") {
        traverse(child);
      }
    }
  }
  traverse(parent);
  return result;
}

function findClosestRunElement(element: Element): Element | null {
  let current: Element | null = element;
  while (current) {
    if (current.localName === "run") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function applyRunStyleHintsToSegment(
  segment: EditorSegment,
  textElement: Element,
  charPrSpacingById: Map<string, number>,
  charPrMarksById: Map<string, CharPrMarks>,
): void {
  const run = findClosestRunElement(textElement);
  if (!run) {
    return;
  }
  const charPrIDRef = run.getAttribute("charPrIDRef");
  if (!charPrIDRef) {
    return;
  }
  segment.styleHints.charPrIDRef = charPrIDRef;
  const spacing = charPrSpacingById.get(charPrIDRef);
  if (spacing !== undefined) {
    segment.styleHints.hwpxCharSpacing = String(spacing);
  }
  const marks = charPrMarksById.get(charPrIDRef);
  if (marks) {
    if (marks.bold) segment.styleHints.hwpxBold = "true";
    if (marks.italic) segment.styleHints.hwpxItalic = "true";
    if (marks.underline) segment.styleHints.hwpxUnderline = "true";
    if (marks.strike) segment.styleHints.hwpxStrike = "true";
    if (marks.superscript) segment.styleHints.hwpxSuperscript = "true";
    if (marks.subscript) segment.styleHints.hwpxSubscript = "true";
    if (marks.color) segment.styleHints.hwpxTextColor = marks.color;
  }
}

/**
 * For each <hp:t> element in textEls, retrieve its segment via direct Element
 * identity lookup (built by buildElementSegmentMap), merge multiple runs from
 * the same <hp:p> into one ProseMirror paragraph, and record extra segmentIds.
 */
function consumeAndMergeParagraph(
  textEls: Element[],
  elementSegmentMap: Map<Element, EditorSegment>,
  usedSegments: EditorSegment[],
  usedSet: Set<EditorSegment>,
  extraSegmentsMap: Record<string, string[]>,
  charPrSpacingById: Map<string, number>,
  charPrMarksById: Map<string, CharPrMarks>,
  asHeading: boolean,
): JSONContent | null {
  const segments: EditorSegment[] = [];
  for (const el of textEls) {
    if (!(el.textContent || "").trim()) {
      continue;
    }
    const seg = elementSegmentMap.get(el);
    if (!seg || usedSet.has(seg)) {
      continue;
    }
    applyRunStyleHintsToSegment(seg, el, charPrSpacingById, charPrMarksById);
    usedSet.add(seg);
    usedSegments.push(seg);
    segments.push(seg);
  }

  if (!segments.length) {
    return null;
  }

  // 병합 전에 per-segment marks 정보 수집
  const runChunks: ParsedRunChunk[] = segments.map((seg) => ({
    text: seg.text,
    bold: seg.styleHints.hwpxBold === "true",
    italic: seg.styleHints.hwpxItalic === "true",
    underline: seg.styleHints.hwpxUnderline === "true",
    strike: seg.styleHints.hwpxStrike === "true",
    superscript: seg.styleHints.hwpxSuperscript === "true",
    subscript: seg.styleHints.hwpxSubscript === "true",
    color: seg.styleHints.hwpxTextColor,
  }));

  if (segments.length > 1) {
    const mergedText = segments.map((s) => s.text).join("");
    // Mutate primary segment (same object as in usedSegments) to reflect merged state
    segments[0].text = mergedText;
    segments[0].originalText = mergedText;
    extraSegmentsMap[segments[0].segmentId] = segments.slice(1).map((s) => s.segmentId);
  }

  return toParagraphNode(
    segments[0],
    asHeading || isHeadingLike(segments[0].text),
    runChunks,
  );
}

/**
 * 섹션 XML 텍스트와 DOM을 사용하여 HwpxSectionModel을 구축한다.
 * 각 <hp:p> 블록에 paraId를 할당하고 paraIdByDomElement와 paraStore에 등록.
 * buildHwpxSectionModel은 parseSectionNode보다 먼저 호출해야 한다
 * (consumeAndMergeParagraph가 segments를 뮤테이션하기 전에 원본 run 텍스트 보존).
 */
function buildHwpxSectionModel(
  fileName: string,
  xmlText: string,
  sectionDoc: Document,
  elementSegmentMap: Map<Element, EditorSegment>,
  paraIdByDomElement: Map<Element, string>, // OUTPUT
  paraStore: Map<string, HwpxParaNode>, // OUTPUT
): HwpxSectionModel {
  const { xmlPrefix, blocks: rawBlocks, xmlSuffix } = scanTopLevelBlocks(xmlText);

  // DOM에서 직계 자식 <hp:p> 수집 (순서 보존 — rawBlocks의 <p> 순서와 1:1 대응)
  const rootEl = sectionDoc.documentElement;
  const domParaElements: Element[] = [];
  for (let i = 0; i < rootEl.children.length; i++) {
    const child = rootEl.children[i];
    if (child.localName === "p") domParaElements.push(child);
  }

  const blocks: HwpxBlockSlot[] = [];
  let domParaIndex = 0;

  for (const rawBlock of rawBlocks) {
    if (rawBlock.localName !== "p") {
      // 테이블, colDef 등 → raw 블록
      blocks.push({ type: "raw", xml: rawBlock.xml, leadingWhitespace: rawBlock.leadingWhitespace });
      continue;
    }

    const domParaEl = domParaElements[domParaIndex++];
    if (!domParaEl) {
      // DOM/raw XML 불일치 — 안전망으로 raw 출력
      blocks.push({ type: "raw", xml: rawBlock.xml, leadingWhitespace: rawBlock.leadingWhitespace });
      continue;
    }

    const paraId = crypto.randomUUID();
    paraIdByDomElement.set(domParaEl, paraId);

    // 런 정보 추출: <hp:run> 직계 자식의 <hp:t> 매핑
    const runs: HwpxRun[] = [];
    for (let i = 0; i < domParaEl.children.length; i++) {
      const child = domParaEl.children[i];
      if (child.localName !== "run") continue;
      const charPrIDRef = child.getAttribute("charPrIDRef") ?? null;
      for (let j = 0; j < child.children.length; j++) {
        const maybeT = child.children[j];
        if (maybeT.localName !== "t") continue;
        const seg = elementSegmentMap.get(maybeT);
        if (!seg) continue;
        runs.push({ globalTextIndex: seg.textIndex, charPrIDRef, text: seg.text });
      }
    }

    const hasContent = runs.length > 0;
    const sourceSegmentId = runs.length > 0 ? `${fileName}::${runs[0].globalTextIndex}` : null;

    const paraNode: HwpxParaNode = {
      paraId,
      paraXml: rawBlock.xml,
      runs,
      hasContent,
      sourceSegmentId,
      isSynthesized: false,
    };
    paraStore.set(paraId, paraNode);
    blocks.push({ type: "para", paraId, leadingWhitespace: rawBlock.leadingWhitespace });
  }

  return { fileName, xmlPrefix, blocks, xmlSuffix };
}

function parseSectionNode(
  sectionElement: Element,
  fileName: string,
  elementSegmentMap: Map<Element, EditorSegment>,
  usedSegments: EditorSegment[],
  usedSet: Set<EditorSegment>,
  extraSegmentsMap: Record<string, string[]>,
  borderFillColors: Map<string, string>,
  charPrSpacingById: Map<string, number>,
  charPrMarksById: Map<string, CharPrMarks>,
  paraIdByDomElement: Map<Element, string>,
  paraPrById: Map<string, ParaPrValues>,
): JSONContent[] {
  const content: JSONContent[] = [];
  const paragraphs = Array.from(sectionElement.children).filter((child) => child.localName === "p");
  let tableIndex = 0;

  for (const paragraph of paragraphs) {
    const tableNodes = Array.from(paragraph.getElementsByTagName("*")).filter(
      (element) => element.localName === "tbl",
    );

    if (tableNodes.length) {
      for (const table of tableNodes) {
        const tableId = `${fileName}::tbl::${tableIndex}`;
        tableIndex += 1;
        const tableRows = Array.from(table.children).filter((child) => child.localName === "tr");
        const sourceRowCount =
          readPositiveIntAttr(table, ["rowcnt", "row_count", "rows"]) || tableRows.length;
        const inferredColCount = tableRows.reduce((max, row) => {
          const cellCount = Array.from(row.children).filter((child) => child.localName === "tc").length;
          return Math.max(max, cellCount);
        }, 0);
        const sourceColCount =
          readPositiveIntAttr(table, ["colcnt", "col_count", "cols"]) || inferredColCount;
        const rowNodes: JSONContent[] = [];
        for (const [rowIndex, row] of tableRows.entries()) {
          const tableCells = Array.from(row.children).filter((child) => child.localName === "tc");
          const cellNodes: JSONContent[] = [];
          let colIndex = 0;
          for (const cell of tableCells) {
            // Skip covered/dirty cells — they are subsumed by a spanning cell
            if (isCoveredCell(cell)) {
              colIndex += 1;
              continue;
            }
            const sourceRowspan = readCellSpan(cell, ["rowspan", "row_span"], "rowSpan");
            const sourceColspan = readCellSpan(cell, ["colspan", "col_span"], "colSpan");
            const paragraphsInCell: JSONContent[] = [];

            // Group <hp:t> by their enclosing <hp:p> within <hp:subList>.
            // getTextElementsExcludingNestedTables ensures nested table text
            // is not consumed here (it belongs to the nested table's cells).
            const subLists = Array.from(cell.children).filter((child) => child.localName === "subList");
            if (subLists.length) {
              for (const subList of subLists) {
                const cellParas = Array.from(subList.children).filter((child) => child.localName === "p");
                for (const cellPara of cellParas) {
                  const cellTextEls = getTextElementsExcludingNestedTables(cellPara);
                  const node = consumeAndMergeParagraph(
                    cellTextEls,
                    elementSegmentMap,
                    usedSegments,
                    usedSet,
                    extraSegmentsMap,
                    charPrSpacingById,
                    charPrMarksById,
                    false,
                  );
                  if (node) {
                    paragraphsInCell.push(node);
                  }
                }
              }
            } else {
              // Fallback: no subList – treat all <hp:t> in the cell as one paragraph
              const cellTextEls = getTextElementsExcludingNestedTables(cell);
              const node = consumeAndMergeParagraph(
                cellTextEls,
                elementSegmentMap,
                usedSegments,
                usedSet,
                extraSegmentsMap,
                charPrSpacingById,
                charPrMarksById,
                false,
              );
              if (node) {
                paragraphsInCell.push(node);
              }
            }

            const cellAttrs: Record<string, string | number> = {
              cellId: `${tableId}::r${rowIndex}c${colIndex}`,
              rowIndex,
              colIndex,
              sourceRowspan,
              sourceColspan,
            };
            if (sourceRowspan > 1) {
              cellAttrs.rowspan = sourceRowspan;
            }
            if (sourceColspan > 1) {
              cellAttrs.colspan = sourceColspan;
            }
            // Apply cell background color from HWPX borderFill definition
            const bfRef = cell.getAttribute("borderFillIDRef");
            if (bfRef) {
              const bgColor = borderFillColors.get(bfRef);
              if (bgColor) {
                cellAttrs.backgroundColor = bgColor;
              }
            }
            cellNodes.push({
              type: "tableCell",
              attrs: cellAttrs,
              content: paragraphsInCell.length ? paragraphsInCell : [{ type: "paragraph" }],
            });
            colIndex += 1;
          }
          rowNodes.push({
            type: "tableRow",
            attrs: {
              rowIndex,
              sourceCellCount: tableCells.length,
            },
            content: cellNodes.length ? cellNodes : [{ type: "tableCell", content: [{ type: "paragraph" }] }],
          });
        }
        content.push({
          type: "table",
          attrs: {
            tableId,
            sourceRowCount,
            sourceColCount,
          },
          content: rowNodes.length ? rowNodes : [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }],
        });
      }
      continue;
    }

    // For a non-table <hp:p>, collect only <hp:t> not inside any nested table.
    const textElements = getTextElementsExcludingNestedTables(paragraph);
    const node = consumeAndMergeParagraph(
      textElements,
      elementSegmentMap,
      usedSegments,
      usedSet,
      extraSegmentsMap,
      charPrSpacingById,
      charPrMarksById,
      false,
    );
    if (node) {
      // Inject paraId from buildHwpxSectionModel (para-snapshot round-trip key)
      const paraId = paraIdByDomElement.get(paragraph);
      if (paraId) {
        node.attrs = { ...(node.attrs || {}), paraId };
      }
      // Inject paraPr attrs for paragraph formatting round-trip
      const paraPrIDRef = paragraph.getAttribute("paraPrIDRef");
      if (paraPrIDRef) {
        const paraPr = paraPrById.get(paraPrIDRef);
        if (paraPr) {
          const alignMap: Record<string, string> = {
            LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFY: "justify",
          };
          node.attrs = {
            ...(node.attrs || {}),
            hwpxParaPrId: paraPrIDRef,
            hwpxLineSpacing: paraPr.lineSpacing,
            hwpxAlign: paraPr.align,
            hwpxLeftIndent: paraPr.leftIndent,
            hwpxRightIndent: paraPr.rightIndent,
            hwpxFirstLineIndent: paraPr.firstLineIndent,
            hwpxSpaceBefore: paraPr.spaceBefore,
            hwpxSpaceAfter: paraPr.spaceAfter,
            // Also set textAlign for TipTap TextAlign extension visual rendering
            textAlign: alignMap[paraPr.align] ?? "left",
          };
        }
      }
      content.push(node);
    }
  }

  if (!content.length) {
    content.push({
      type: "paragraph",
      attrs: {
        segmentId: `${fileName}::-1`,
        fileName,
        textIndex: -1,
        originalText: "",
      },
      content: [],
    });
  }

  return content;
}

export async function parseHwpxToProseMirror(fileBuffer: ArrayBuffer): Promise<ParsedProseMirrorDocument> {
  const inspected = await inspectHwpx(fileBuffer);
  const zip = await JSZip.loadAsync(fileBuffer);
  const sectionFiles = Object.keys(zip.files)
    .filter((name) => SECTION_FILE_RE.test(name) && !zip.files[name].dir)
    .sort();

  const segmentsByFile = new Map<string, EditorSegment[]>();
  for (const node of inspected.textNodes) {
    if (!SECTION_FILE_RE.test(node.fileName)) {
      continue;
    }
    if (!segmentsByFile.has(node.fileName)) {
      segmentsByFile.set(node.fileName, []);
    }
    segmentsByFile.get(node.fileName)!.push({
      segmentId: `${node.fileName}::${node.textIndex}`,
      fileName: node.fileName,
      textIndex: node.textIndex,
      text: node.text,
      originalText: node.text,
      tag: node.tag,
      styleHints: node.styleHints,
    });
  }
  for (const file of segmentsByFile.values()) {
    file.sort((a, b) => a.textIndex - b.textIndex);
  }

  // Extract cell background colors from Contents/header.xml borderFill definitions
  let borderFillColors = new Map<string, string>();
  let charPrSpacingById = new Map<string, number>();
  let charPrMarksById = new Map<string, CharPrMarks>();
  let paraPrById = new Map<string, ParaPrValues>();
  let headerXmlText = "";
  if (zip.files[HEADER_FILE] && !zip.files[HEADER_FILE].dir) {
    try {
      headerXmlText = await zip.files[HEADER_FILE].async("string");
      const headerDoc = new DOMParser().parseFromString(headerXmlText, "application/xml");
      if (!headerDoc.querySelector("parsererror")) {
        borderFillColors = extractBorderFillColors(headerDoc);
        charPrSpacingById = extractCharPrSpacingMap(headerDoc);
        charPrMarksById = extractCharPrMarksMap(headerDoc);
        paraPrById = extractParaPrMap(headerDoc);
      }
    } catch {
      // Non-fatal — proceed without fill colors
    }
  }

  const usedSegments: EditorSegment[] = [];
  const content: JSONContent[] = [];
  const extraSegmentsMap: Record<string, string[]> = {};

  // OWPML in-memory model
  const paraStore = new Map<string, HwpxParaNode>();
  const hwpxSections: HwpxSectionModel[] = [];

  for (const fileName of sectionFiles) {
    const sectionData = await zip.files[fileName].async("string");
    const doc = new DOMParser().parseFromString(sectionData, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError || !doc.documentElement) {
      continue;
    }

    const pool = segmentsByFile.get(fileName) || [];
    // Build a direct Element→EditorSegment map by traversing the DOM in
    // document order (same order as scanXmlTextSegments), matching each
    // non-whitespace text node to the next pool entry by position.
    // This replaces the old sequential consumeSegment() which drifted when
    // a <hp:p> containing a <hp:tbl> left its own <hp:t> unconsumed.
    const elementSegmentMap = buildElementSegmentMap(doc, pool);
    const usedSet = new Set<EditorSegment>();

    // Build section model BEFORE parseSectionNode to capture original (unmerged) run texts.
    const paraIdByDomElement = new Map<Element, string>();
    const sectionModel = buildHwpxSectionModel(
      fileName,
      sectionData,
      doc,
      elementSegmentMap,
      paraIdByDomElement,
      paraStore,
    );
    hwpxSections.push(sectionModel);

    const sectionBlocks = parseSectionNode(
      doc.documentElement,
      fileName,
      elementSegmentMap,
      usedSegments,
      usedSet,
      extraSegmentsMap,
      borderFillColors,
      charPrSpacingById,
      charPrMarksById,
      paraIdByDomElement,
      paraPrById,
    );
    content.push(...sectionBlocks);
  }

  if (!content.length) {
    content.push({
      type: "paragraph",
      attrs: {
        segmentId: "__empty__",
        fileName: "",
        textIndex: -1,
        originalText: "",
      },
      content: [{ type: "text", text: "" }],
    });
  }

  const hwpxDocumentModel: HwpxDocumentModel =
    hwpxSections.length > 0
      ? { sections: hwpxSections, paraStore, headerXml: headerXmlText, baseBuffer: fileBuffer }
      : { sections: [], paraStore: new Map(), headerXml: "", baseBuffer: fileBuffer };

  return {
    doc: {
      type: "doc",
      content,
    },
    segments: usedSegments,
    extraSegmentsMap,
    integrityIssues: inspected.integrityIssues,
    hwpxDocumentModel: hwpxSections.length > 0 ? hwpxDocumentModel : null,
  };
}
