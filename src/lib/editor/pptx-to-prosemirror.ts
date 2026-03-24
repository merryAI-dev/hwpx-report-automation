import JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import type { EditorSegment, ParsedProseMirrorDocument } from "./hwpx-to-prosemirror";
import { createEmptyComplexObjectReport } from "./hwpx-complex-objects";

const SOURCE_NAME = "pptx";

type SlideContent = {
  slideNumber: number;
  title: string;
  bodyItems: string[];
  tables: string[][][]; // rows × cols
  notes: string;
};

/**
 * Parse a PPTX file into ProseMirror JSONContent + EditorSegments.
 * Extracts text/tables from slide XML, then converts flat slides into
 * a hierarchical document structure.
 */
export async function parsePptxToProseMirror(
  fileBuffer: ArrayBuffer,
): Promise<ParsedProseMirrorDocument> {
  const zip = await JSZip.loadAsync(fileBuffer);
  const warnings: string[] = [];

  // Find slide files
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)/)?.[1] || 0);
      const numB = Number(b.match(/slide(\d+)/)?.[1] || 0);
      return numA - numB;
    });

  if (slideFiles.length === 0) {
    warnings.push("슬라이드를 찾을 수 없습니다.");
    return {
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      segments: [],
      extraSegmentsMap: {},
      integrityIssues: warnings,
      complexObjectReport: createEmptyComplexObjectReport(),
      hwpxDocumentModel: null,
    };
  }

  // Extract content from each slide
  const slides: SlideContent[] = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async("string");
    if (!xml) continue;
    const slideNum = Number(slideFile.match(/slide(\d+)/)?.[1] || slides.length + 1);
    const slide = parseSlideXml(xml, slideNum);
    slides.push(slide);

    // Try to get notes
    const notesFile = slideFile.replace("slides/slide", "notesSlides/notesSlide");
    const notesXml = await zip.file(notesFile)?.async("string");
    if (notesXml) {
      slide.notes = extractAllText(notesXml).join(" ").trim();
    }
  }

  // Convert slides to document structure
  return slidesToDocument(slides, warnings);
}

/* ── Slide XML parsing ── */

function parseSlideXml(xml: string, slideNumber: number): SlideContent {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  const title = extractShapeText(doc, "title") || extractShapeText(doc, "ctrTitle") || "";
  const bodyItems = extractBodyItems(doc);
  const tables = extractTables(doc);

  return { slideNumber, title, bodyItems, tables, notes: "" };
}

/**
 * Extract text from a named placeholder type (title, ctrTitle, body, subTitle).
 */
function extractShapeText(doc: Document, phType: string): string {
  // Look for placeholder with idx/type matching
  const spNodes = doc.getElementsByTagName("p:sp");
  for (const sp of Array.from(spNodes)) {
    const phNodes = sp.getElementsByTagName("p:ph");
    for (const ph of Array.from(phNodes)) {
      const type = ph.getAttribute("type") || "";
      if (type.toLowerCase() === phType.toLowerCase()) {
        return extractTextFromShape(sp);
      }
    }
  }
  return "";
}

function extractBodyItems(doc: Document): string[] {
  const items: string[] = [];
  const spNodes = doc.getElementsByTagName("p:sp");

  for (const sp of Array.from(spNodes)) {
    const phNodes = sp.getElementsByTagName("p:ph");
    let isBody = false;
    let isTitle = false;

    for (const ph of Array.from(phNodes)) {
      const type = (ph.getAttribute("type") || "").toLowerCase();
      if (type === "body" || type === "subTitle" || type === "obj") isBody = true;
      if (type === "title" || type === "ctrTitle") isTitle = true;
    }

    // If no placeholder type, treat as generic text box (body-like)
    if (phNodes.length === 0) isBody = true;
    if (isTitle) continue;

    if (isBody) {
      const paragraphs = sp.getElementsByTagName("a:p");
      for (const p of Array.from(paragraphs)) {
        const text = extractTextFromParagraph(p).trim();
        if (text) items.push(text);
      }
    }
  }

  return items;
}

function extractTextFromShape(sp: Element): string {
  const paragraphs = sp.getElementsByTagName("a:p");
  const texts: string[] = [];
  for (const p of Array.from(paragraphs)) {
    const text = extractTextFromParagraph(p).trim();
    if (text) texts.push(text);
  }
  return texts.join(" ");
}

function extractTextFromParagraph(p: Element): string {
  const runs = p.getElementsByTagName("a:r");
  const parts: string[] = [];
  for (const r of Array.from(runs)) {
    const tNodes = r.getElementsByTagName("a:t");
    for (const t of Array.from(tNodes)) {
      parts.push(t.textContent || "");
    }
  }
  return parts.join("");
}

function extractAllText(xml: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const tNodes = doc.getElementsByTagName("a:t");
  return Array.from(tNodes).map((t) => t.textContent || "").filter(Boolean);
}

function extractTables(doc: Document): string[][][] {
  const tables: string[][][] = [];
  const tblNodes = doc.getElementsByTagName("a:tbl");

  for (const tbl of Array.from(tblNodes)) {
    const rows: string[][] = [];
    const trNodes = tbl.getElementsByTagName("a:tr");
    for (const tr of Array.from(trNodes)) {
      const cells: string[] = [];
      const tcNodes = tr.getElementsByTagName("a:tc");
      for (const tc of Array.from(tcNodes)) {
        const text = Array.from(tc.getElementsByTagName("a:t"))
          .map((t) => t.textContent || "")
          .join("")
          .trim();
        cells.push(text);
      }
      rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }

  return tables;
}

/* ── Convert slides to document ── */

function slidesToDocument(
  slides: SlideContent[],
  warnings: string[],
): ParsedProseMirrorDocument {
  const content: JSONContent[] = [];
  const segments: EditorSegment[] = [];
  let textIndex = 0;

  for (const slide of slides) {
    // Slide title → H2
    if (slide.title) {
      const segmentId = `${SOURCE_NAME}::${textIndex}`;
      segments.push({
        segmentId,
        fileName: SOURCE_NAME,
        textIndex,
        text: slide.title,
        originalText: slide.title,
        tag: "h2",
        styleHints: {
          slideNumber: String(slide.slideNumber),
          pptxRole: "title",
        },
      });
      content.push({
        type: "heading",
        attrs: {
          level: 2,
          segmentId,
          fileName: SOURCE_NAME,
          textIndex,
          originalText: slide.title,
        },
        content: [{ type: "text", text: slide.title }],
      });
      textIndex++;
    }

    // Body items → paragraphs
    for (const item of slide.bodyItems) {
      const segmentId = `${SOURCE_NAME}::${textIndex}`;
      segments.push({
        segmentId,
        fileName: SOURCE_NAME,
        textIndex,
        text: item,
        originalText: item,
        tag: "p",
        styleHints: {
          slideNumber: String(slide.slideNumber),
          pptxRole: "body",
        },
      });
      content.push({
        type: "paragraph",
        attrs: { segmentId, fileName: SOURCE_NAME, textIndex, originalText: item },
        content: [{ type: "text", text: item }],
      });
      textIndex++;
    }

    // Tables
    for (const table of slide.tables) {
      const rows: JSONContent[] = table.map((row, ri) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: ri === 0 ? "tableHeader" : "tableCell",
          attrs: { colspan: 1, rowspan: 1 },
          content: [{ type: "paragraph", content: cell ? [{ type: "text", text: cell }] : undefined }],
        })),
      }));
      content.push({ type: "table", content: rows });
    }

    // Notes → italic paragraph
    if (slide.notes) {
      const segmentId = `${SOURCE_NAME}::${textIndex}`;
      const noteText = `[발표자 노트] ${slide.notes}`;
      segments.push({
        segmentId,
        fileName: SOURCE_NAME,
        textIndex,
        text: noteText,
        originalText: noteText,
        tag: "p",
        styleHints: {
          slideNumber: String(slide.slideNumber),
          pptxRole: "notes",
        },
      });
      content.push({
        type: "paragraph",
        attrs: { segmentId, fileName: SOURCE_NAME, textIndex, originalText: noteText },
        content: [{ type: "text", text: noteText, marks: [{ type: "italic" }] }],
      });
      textIndex++;
    }
  }

  if (content.length === 0) {
    content.push({ type: "paragraph" });
    warnings.push("슬라이드에서 텍스트를 추출하지 못했습니다.");
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
