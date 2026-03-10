import mammoth from "mammoth";
import type { JSONContent } from "@tiptap/core";
import type { EditorSegment, ParsedProseMirrorDocument } from "./hwpx-to-prosemirror";
import { createEmptyComplexObjectReport } from "./hwpx-complex-objects";

const SOURCE_NAME = "docx";

/**
 * Parse a DOCX file into ProseMirror JSONContent + EditorSegments.
 * Uses mammoth.js for DOCX→HTML, then walks the DOM to build TipTap-compatible JSON.
 */
export async function parseDocxToProseMirror(
  fileBuffer: ArrayBuffer,
): Promise<ParsedProseMirrorDocument> {
  const result = await mammoth.convertToHtml({ arrayBuffer: fileBuffer });
  const html = result.value;
  const warnings = result.messages
    .filter((m) => m.type === "warning")
    .map((m) => m.message);

  const parser = new DOMParser();
  const dom = parser.parseFromString(html, "text/html");

  const content: JSONContent[] = [];
  const segments: EditorSegment[] = [];
  let textIndex = 0;

  for (const child of Array.from(dom.body.children)) {
    const tag = child.tagName.toLowerCase();

    if (tag === "table") {
      const tableJson = processTable(child as HTMLTableElement);
      if (tableJson) content.push(tableJson);
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      // Flatten list items into paragraphs (TipTap StarterKit doesn't have bulletList by default)
      for (const li of Array.from(child.querySelectorAll("li"))) {
        const text = li.textContent?.trim() || "";
        if (!text) continue;
        const prefix = tag === "ol" ? `${textIndex + 1}. ` : "• ";
        const segmentId = `${SOURCE_NAME}::${textIndex}`;
        const fullText = prefix + text;
        segments.push({
          segmentId,
          fileName: SOURCE_NAME,
          textIndex,
          text: fullText,
          originalText: fullText,
          tag: "p",
          styleHints: {},
        });
        content.push({
          type: "paragraph",
          attrs: { segmentId, fileName: SOURCE_NAME, textIndex, originalText: fullText },
          content: processInlineContent(li, prefix),
        });
        textIndex++;
      }
      continue;
    }

    // Headings
    const headingMatch = tag.match(/^h([1-6])$/);
    if (headingMatch) {
      const level = Math.min(Number(headingMatch[1]), 3) as 1 | 2 | 3;
      const text = child.textContent?.trim() || "";
      if (!text) continue;
      const segmentId = `${SOURCE_NAME}::${textIndex}`;
      segments.push({
        segmentId,
        fileName: SOURCE_NAME,
        textIndex,
        text,
        originalText: text,
        tag: `h${level}`,
        styleHints: {},
      });
      content.push({
        type: "heading",
        attrs: { level, segmentId, fileName: SOURCE_NAME, textIndex, originalText: text },
        content: processInlineContent(child),
      });
      textIndex++;
      continue;
    }

    // Paragraphs and other block elements → paragraph
    const text = child.textContent?.trim() || "";
    if (!text) continue;
    const segmentId = `${SOURCE_NAME}::${textIndex}`;
    segments.push({
      segmentId,
      fileName: SOURCE_NAME,
      textIndex,
      text,
      originalText: text,
      tag: "p",
      styleHints: {},
    });
    content.push({
      type: "paragraph",
      attrs: { segmentId, fileName: SOURCE_NAME, textIndex, originalText: text },
      content: processInlineContent(child),
    });
    textIndex++;
  }

  // Ensure at least one paragraph
  if (content.length === 0) {
    content.push({ type: "paragraph" });
  }

  return {
    doc: { type: "doc", content },
    segments,
    extraSegmentsMap: {},
    integrityIssues: warnings,
    complexObjectReport: createEmptyComplexObjectReport(),
    hwpxDocumentModel: null,
  };
}

/* ── Inline content processing ── */

type MarkDef = { type: string; attrs?: Record<string, unknown> };

function getMarksForTag(tag: string): MarkDef[] {
  switch (tag) {
    case "strong":
    case "b":
      return [{ type: "bold" }];
    case "em":
    case "i":
      return [{ type: "italic" }];
    case "u":
      return [{ type: "underline" }];
    case "s":
    case "del":
    case "strike":
      return [{ type: "strike" }];
    case "sup":
      return [{ type: "superscript" }];
    case "sub":
      return [{ type: "subscript" }];
    default:
      return [];
  }
}

function processInlineContent(
  element: Element | ChildNode,
  prefix?: string,
): JSONContent[] {
  const result: JSONContent[] = [];

  if (prefix) {
    result.push({ type: "text", text: prefix });
  }

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || "";
      if (text) result.push({ type: "text", text });
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "br") {
      result.push({ type: "hardBreak" });
      continue;
    }

    // Recursively process and collect marks
    const inner = processInlineContent(el);
    const marks = getMarksForTag(tag);

    if (marks.length > 0) {
      for (const item of inner) {
        if (item.type === "text") {
          item.marks = [...(item.marks || []), ...marks];
        }
      }
    }
    result.push(...inner);
  }

  return result;
}

/* ── Table processing ── */

function processTable(table: HTMLTableElement): JSONContent | null {
  const rows: JSONContent[] = [];

  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const cells: JSONContent[] = [];
    for (const td of Array.from(tr.querySelectorAll("td, th"))) {
      const isHeader = td.tagName.toLowerCase() === "th";
      const colspan = Number(td.getAttribute("colspan")) || 1;
      const rowspan = Number(td.getAttribute("rowspan")) || 1;
      const cellContent = processInlineContent(td);

      cells.push({
        type: isHeader ? "tableHeader" : "tableCell",
        attrs: { colspan, rowspan },
        content: [
          {
            type: "paragraph",
            content: cellContent.length > 0 ? cellContent : undefined,
          },
        ],
      });
    }
    if (cells.length > 0) {
      rows.push({ type: "tableRow", content: cells });
    }
  }

  if (rows.length === 0) return null;

  return { type: "table", content: rows };
}
