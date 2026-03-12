/**
 * HWPX page layout utilities.
 *
 * Responsibilities:
 *  1. Parse <hp:pagePr> / <hp:margin> from section XML → PagePrValues
 *  2. Estimate paragraph height in HWPUNIT (CJK character approximation)
 *  3. Inject pageSeparator nodes into a ProseMirror JSONContent array
 *
 * Unit: HWPUNIT = 1/7200 inch (A4: width 59528, height 84188)
 * 1 pt = 100 HWPUNIT  (charPr height="1000" = 10pt = 1000 HWPUNIT)
 */

import type { JSONContent } from "@tiptap/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PagePrValues = {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  headerHeight: number;
  footerHeight: number;
};

// A4 defaults (from real HWPX sample)
const DEFAULT_PAGE_PR: PagePrValues = {
  width: 59528,
  height: 84188,
  marginLeft: 7087,
  marginRight: 7087,
  marginTop: 4252,
  marginBottom: 2835,
  headerHeight: 2835,
  footerHeight: 2835,
};

// ─── pagePr extraction ────────────────────────────────────────────────────────

function readAttr(str: string, name: string): number {
  const m = str.match(new RegExp(`\\b${name}="([^"]*)"`));
  const v = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Extract page layout values from a section XML string.
 * Looks for <hp:pagePr> (or any ns:pagePr) and its child <hp:margin>.
 * Falls back to A4 defaults for any missing value.
 */
export function extractPagePr(sectionXml: string): PagePrValues {
  const pagePrMatch = sectionXml.match(/<[a-zA-Z0-9]*:pagePr\b([^>]*)>/);
  if (!pagePrMatch) return { ...DEFAULT_PAGE_PR };

  const pagePrAttrs = pagePrMatch[1];
  const marginMatch = sectionXml.match(/<[a-zA-Z0-9]*:margin\b([^>]*)\/?>/);
  const ma = marginMatch ? marginMatch[1] : "";

  return {
    width:        readAttr(pagePrAttrs, "width")  || DEFAULT_PAGE_PR.width,
    height:       readAttr(pagePrAttrs, "height") || DEFAULT_PAGE_PR.height,
    marginLeft:   readAttr(ma, "left")   || DEFAULT_PAGE_PR.marginLeft,
    marginRight:  readAttr(ma, "right")  || DEFAULT_PAGE_PR.marginRight,
    marginTop:    readAttr(ma, "top")    || DEFAULT_PAGE_PR.marginTop,
    marginBottom: readAttr(ma, "bottom") || DEFAULT_PAGE_PR.marginBottom,
    headerHeight: readAttr(ma, "header") || DEFAULT_PAGE_PR.headerHeight,
    footerHeight: readAttr(ma, "footer") || DEFAULT_PAGE_PR.footerHeight,
  };
}

// ─── Height estimation ────────────────────────────────────────────────────────

const DEFAULT_FONT_HEIGHT_HWP = 1000; // 10pt

/**
 * Walk inline content and return the dominant font size in HWPUNIT.
 * "Dominant" = the font size used by the most characters.
 */
function dominantFontHeightHwp(content: JSONContent[]): number {
  const tally = new Map<number, number>();
  for (const inline of content) {
    if (inline.type !== "text") continue;
    const len = (inline.text ?? "").length;
    if (len === 0) continue;
    let sizePt = 10;
    for (const mark of inline.marks ?? []) {
      if (mark.type === "textStyle" && mark.attrs?.fontSize) {
        const parsed = parseFloat(String(mark.attrs.fontSize));
        if (Number.isFinite(parsed) && parsed > 0) { sizePt = parsed; break; }
      }
    }
    const hwp = Math.round(sizePt * 100); // 1pt = 100 HWPUNIT
    tally.set(hwp, (tally.get(hwp) ?? 0) + len);
  }
  if (tally.size === 0) return DEFAULT_FONT_HEIGHT_HWP;
  let best = DEFAULT_FONT_HEIGHT_HWP;
  let bestLen = 0;
  for (const [hwp, len] of tally) {
    if (len > bestLen) { bestLen = len; best = hwp; }
  }
  return best;
}

function textLength(content: JSONContent[]): number {
  let n = 0;
  for (const inline of content) {
    if (inline.type === "text") n += (inline.text ?? "").length;
  }
  return n;
}

/**
 * Estimate the rendered height of a paragraph or heading in HWPUNIT.
 * Uses CJK approximation: 1 character ≈ font-size wide.
 */
export function estimateParaHeightHwp(node: JSONContent, pagePr: PagePrValues): number {
  const attrs = node.attrs ?? {};
  const lineSpacingPct: number = typeof attrs.hwpxLineSpacing === "number" ? attrs.hwpxLineSpacing : 160;
  const spaceBefore: number   = typeof attrs.hwpxSpaceBefore  === "number" ? attrs.hwpxSpaceBefore  : 0;
  const spaceAfter: number    = typeof attrs.hwpxSpaceAfter   === "number" ? attrs.hwpxSpaceAfter   : 0;
  const leftIndent: number    = typeof attrs.hwpxLeftIndent   === "number" ? attrs.hwpxLeftIndent   : 0;
  const rightIndent: number   = typeof attrs.hwpxRightIndent  === "number" ? attrs.hwpxRightIndent  : 0;

  const content = node.content ?? [];
  const fontHwp = dominantFontHeightHwp(content);
  const textLen = textLength(content);

  const textWidth = pagePr.width - pagePr.marginLeft - pagePr.marginRight - leftIndent - rightIndent;
  const charsPerLine = Math.max(1, Math.floor(textWidth / fontHwp));
  const numLines = Math.max(1, Math.ceil(textLen / charsPerLine));

  const lineHeight = fontHwp * (lineSpacingPct / 100);
  return numLines * lineHeight + spaceBefore + spaceAfter;
}

/**
 * Rough table height: sum of cell paragraphs' heights across the first column,
 * capped to avoid overly aggressive splitting.
 */
function estimateTableHeightHwp(node: JSONContent, pagePr: PagePrValues): number {
  let total = 0;
  for (const row of node.content ?? []) {
    let rowMax = 0;
    for (const cell of row.content ?? []) {
      let cellH = 0;
      for (const para of cell.content ?? []) {
        if (para.type === "paragraph" || para.type === "heading") {
          cellH += estimateParaHeightHwp(para, pagePr);
        }
      }
      rowMax = Math.max(rowMax, cellH);
    }
    total += rowMax;
  }
  return total || DEFAULT_FONT_HEIGHT_HWP * 2;
}

// ─── Separator injection ──────────────────────────────────────────────────────

/**
 * Insert pageSeparator nodes into a flat ProseMirror content array.
 *
 * Two sources of page breaks:
 *  1. Explicit: node.attrs.hwpxPageBreak === true  → forced break before that node
 *  2. Natural:  accumulated height exceeds usable page area
 *
 * The paragraph immediately following a pageSeparator gets
 * hwpxPageBreak=true so the save path writes pageBreak="1" to the HWPX file.
 */
export function injectPageSeparators(
  nodes: JSONContent[],
  pagePr: PagePrValues,
): JSONContent[] {
  const usableHeight =
    pagePr.height - pagePr.marginTop - pagePr.marginBottom -
    pagePr.headerHeight - pagePr.footerHeight;

  const result: JSONContent[] = [];
  let accumulated = 0;
  let pageNumber = 1;
  let previousWasSeparator = false;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Already a separator (shouldn't happen on first run, but guard for re-runs)
    if (node.type === "pageSeparator") {
      result.push(node);
      accumulated = 0;
      const existingPageNumber = Number(node.attrs?.pageNumber);
      if (Number.isFinite(existingPageNumber) && existingPageNumber > 0) {
        pageNumber = existingPageNumber;
      }
      previousWasSeparator = true;
      continue;
    }

    // Estimate height for this block
    let nodeHeight = 0;
    if (node.type === "paragraph" || node.type === "heading") {
      nodeHeight = estimateParaHeightHwp(node, pagePr);
    } else if (node.type === "table") {
      nodeHeight = estimateTableHeightHwp(node, pagePr);
    } else if (node.type === "image") {
      // Images carry hwpx dimensions — rough estimate
      const h = Number(node.attrs?.height ?? 0);
      nodeHeight = h > 0 ? h : DEFAULT_FONT_HEIGHT_HWP * 3;
    }

    // Explicit page break from original HWPX
    if (node.attrs?.hwpxPageBreak) {
      if (!previousWasSeparator) {
        pageNumber++;
        result.push({ type: "pageSeparator", attrs: { pageNumber, isExplicit: true } });
      }
      accumulated = nodeHeight;
      result.push(node);
      previousWasSeparator = false;
      continue;
    }

    // Natural page overflow
    if (accumulated + nodeHeight > usableHeight && accumulated > 0) {
      pageNumber++;
      // Mark this node as page-break-before so the save path writes pageBreak="1"
      const markedNode: JSONContent = {
        ...node,
        attrs: { ...(node.attrs ?? {}), hwpxPageBreak: true },
      };
      result.push({ type: "pageSeparator", attrs: { pageNumber, isExplicit: false } });
      result.push(markedNode);
      accumulated = nodeHeight;
      previousWasSeparator = false;
      continue;
    }

    result.push(node);
    accumulated += nodeHeight;
    previousWasSeparator = false;
  }

  return result;
}
