import JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import { inspectHwpx } from "../hwpx";

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
};

const SECTION_FILE_RE = /^Contents\/section\d+\.xml$/;

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

function toParagraphNode(segment: EditorSegment, asHeading: boolean): JSONContent {
  const attrs = {
    segmentId: segment.segmentId,
    fileName: segment.fileName,
    textIndex: segment.textIndex,
    originalText: segment.originalText,
  };
  const inlineContent: JSONContent[] = [];
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
    usedSet.add(seg);
    usedSegments.push(seg);
    segments.push(seg);
  }

  if (!segments.length) {
    return null;
  }

  if (segments.length > 1) {
    const mergedText = segments.map((s) => s.text).join("");
    // Mutate primary segment (same object as in usedSegments) to reflect merged state
    segments[0].text = mergedText;
    segments[0].originalText = mergedText;
    extraSegmentsMap[segments[0].segmentId] = segments.slice(1).map((s) => s.segmentId);
  }

  return toParagraphNode(segments[0], asHeading || isHeadingLike(segments[0].text));
}

function parseSectionNode(
  sectionElement: Element,
  fileName: string,
  elementSegmentMap: Map<Element, EditorSegment>,
  usedSegments: EditorSegment[],
  usedSet: Set<EditorSegment>,
  extraSegmentsMap: Record<string, string[]>,
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
          for (const [colIndex, cell] of tableCells.entries()) {
            const sourceRowspan = readPositiveIntAttr(cell, ["rowspan", "row_span"]) || 1;
            const sourceColspan = readPositiveIntAttr(cell, ["colspan", "col_span"]) || 1;
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
            cellNodes.push({
              type: "tableCell",
              attrs: cellAttrs,
              content: paragraphsInCell.length ? paragraphsInCell : [{ type: "paragraph" }],
            });
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
      false,
    );
    if (node) {
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

  const usedSegments: EditorSegment[] = [];
  const content: JSONContent[] = [];
  const extraSegmentsMap: Record<string, string[]> = {};

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

    const sectionBlocks = parseSectionNode(
      doc.documentElement,
      fileName,
      elementSegmentMap,
      usedSegments,
      usedSet,
      extraSegmentsMap,
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

  return {
    doc: {
      type: "doc",
      content,
    },
    segments: usedSegments,
    extraSegmentsMap,
    integrityIssues: inspected.integrityIssues,
  };
}
