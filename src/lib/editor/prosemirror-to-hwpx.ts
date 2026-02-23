import JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import { applyTextEdits, validateHwpxArchive } from "../hwpx";
import type { TextEdit } from "../hwpx";
import type { EditorSegment } from "./hwpx-to-prosemirror";

type MetadataAttrs = {
  segmentId?: string;
  fileName?: string;
  textIndex?: number;
  originalText?: string;
  letterSpacing?: number | string;
};

type TableMetadataAttrs = {
  tableId?: string;
  sourceRowCount?: number | string;
  sourceColCount?: number | string;
};

type TableRowMetadataAttrs = {
  rowIndex?: number | string;
  sourceCellCount?: number | string;
};

type TableCellMetadataAttrs = {
  cellId?: string;
  sourceRowspan?: number | string;
  sourceColspan?: number | string;
  rowspan?: number | string;
  colspan?: number | string;
};

type TableCellPatch = {
  colSpan: number;
  rowSpan: number;
  lines: string[];
};

type TableRowPatch = {
  cells: TableCellPatch[];
};

type TablePatch = {
  tableId: string;
  fileName: string;
  tableIndex: number;
  rowCount: number;
  colCount: number;
  rows: TableRowPatch[];
};

type TablePatchCollectResult = {
  patches: TablePatch[];
  warnings: string[];
};

export type CollectEditsResult = {
  edits: TextEdit[];
  warnings: string[];
};

type LetterSpacingEdit = {
  segmentId: string;
  fileName: string;
  textIndex: number;
  sourceCharPrIDRef: string;
  newSpacing: number;
};

type CollectLetterSpacingResult = {
  edits: LetterSpacingEdit[];
  warnings: string[];
};

const HEADER_FILE = "Contents/header.xml";

function extractNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text || "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (!node.content?.length) {
    return "";
  }
  return node.content.map((child) => extractNodeText(child)).join("");
}

function walk(node: JSONContent, visitor: (node: JSONContent) => void): void {
  visitor(node);
  if (!node.content?.length) {
    return;
  }
  for (const child of node.content) {
    walk(child, visitor);
  }
}

function isTextBlockNode(node: JSONContent): boolean {
  return node.type === "paragraph" || node.type === "heading";
}

function asPositiveInt(input: unknown): number | null {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  const parsed = Number.parseInt(String(input), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asNonNegativeInt(input: unknown): number | null {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  const parsed = Number.parseInt(String(input), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function asInt(input: unknown): number | null {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  const parsed = Number.parseInt(String(input), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueWarnings(items: string[]): string[] {
  return Array.from(new Set(items));
}

function readSegmentCharPrIDRef(segment: EditorSegment): string | null {
  const direct = segment.styleHints.charPrIDRef;
  if (direct && String(direct).trim()) {
    return String(direct).trim();
  }
  const styleEntries = Object.entries(segment.styleHints);
  const fallback = styleEntries.find(([key]) => key.toLowerCase() === "charpridref");
  return fallback && String(fallback[1]).trim() ? String(fallback[1]).trim() : null;
}

function readSegmentLetterSpacing(segment: EditorSegment): number {
  const fromHint =
    asInt(segment.styleHints.hwpxCharSpacing) ??
    asInt(segment.styleHints.letterSpacing) ??
    asInt(segment.styleHints.spacing);
  return fromHint ?? 0;
}

function isXmlName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".xml");
}

function parseTableId(tableId: string): { fileName: string; tableIndex: number } | null {
  const match = tableId.match(/^(.*)::tbl::(\d+)$/);
  if (!match) {
    return null;
  }
  const tableIndex = Number.parseInt(match[2], 10);
  if (!Number.isFinite(tableIndex) || tableIndex < 0) {
    return null;
  }
  return {
    fileName: match[1],
    tableIndex,
  };
}

function getRowNodes(tableNode: JSONContent): JSONContent[] {
  return (tableNode.content || []).filter((child) => child.type === "tableRow");
}

function getCellNodes(rowNode: JSONContent): JSONContent[] {
  return (rowNode.content || []).filter((child) => child.type === "tableCell");
}

function getCellSpans(cellAttrs: TableCellMetadataAttrs): { colSpan: number; rowSpan: number } {
  const colSpan = asPositiveInt(cellAttrs.colspan) || asPositiveInt(cellAttrs.sourceColspan) || 1;
  const rowSpan = asPositiveInt(cellAttrs.rowspan) || asPositiveInt(cellAttrs.sourceRowspan) || 1;
  return { colSpan, rowSpan };
}

function collectCellLines(cellNode: JSONContent): string[] {
  const lines: string[] = [];
  const blockNodes = (cellNode.content || []).filter((child) => child.type === "paragraph" || child.type === "heading");

  if (blockNodes.length) {
    for (const block of blockNodes) {
      const text = extractNodeText(block);
      const split = text.split(/\r\n|\r|\n/);
      lines.push(...split);
    }
  } else {
    const text = extractNodeText(cellNode);
    if (text.length) {
      lines.push(...text.split(/\r\n|\r|\n/));
    }
  }

  if (!lines.length) {
    lines.push("");
  }
  return lines;
}

function collectTablePatches(doc: JSONContent): TablePatchCollectResult {
  const patches: TablePatch[] = [];
  const warnings: string[] = [];

  walk(doc, (node) => {
    if (node.type !== "table") {
      return;
    }

    const tableAttrs = (node.attrs || {}) as TableMetadataAttrs;
    const tableId = String(tableAttrs.tableId || "").trim();
    if (!tableId) {
      warnings.push("새로 추가된 표는 원본 tableId가 없어 HWPX에 구조 반영할 수 없습니다.");
      return;
    }
    const target = parseTableId(tableId);
    if (!target) {
      warnings.push(`tableId 형식이 올바르지 않아 표 반영을 건너뜁니다: ${tableId}`);
      return;
    }

    const rows = getRowNodes(node);
    const rowCount = rows.length;
    const rowPatches: TableRowPatch[] = [];
    let colCount = 0;
    let structureChanged = false;

    for (const [rowOffset, rowNode] of rows.entries()) {
      const rowAttrs = (rowNode.attrs || {}) as TableRowMetadataAttrs;
      const cells = getCellNodes(rowNode);
      const sourceCellCount = asPositiveInt(rowAttrs.sourceCellCount);
      if (sourceCellCount !== null && sourceCellCount !== cells.length) {
        structureChanged = true;
      }

      let logicalColCount = 0;
      const cellPatches: TableCellPatch[] = [];
      for (const cellNode of cells) {
        const cellAttrs = (cellNode.attrs || {}) as TableCellMetadataAttrs;
        const { colSpan, rowSpan } = getCellSpans(cellAttrs);
        const sourceColspan = asPositiveInt(cellAttrs.sourceColspan) || 1;
        const sourceRowspan = asPositiveInt(cellAttrs.sourceRowspan) || 1;
        if (sourceColspan !== colSpan || sourceRowspan !== rowSpan) {
          structureChanged = true;
        }
        logicalColCount += colSpan;
        cellPatches.push({
          colSpan,
          rowSpan,
          lines: collectCellLines(cellNode),
        });
      }
      colCount = Math.max(colCount, logicalColCount);
      rowPatches.push({ cells: cellPatches });

      const explicitRowIndex = asNonNegativeInt(((rowNode.attrs || {}) as { rowIndex?: unknown }).rowIndex);
      if (explicitRowIndex !== null && explicitRowIndex !== rowOffset) {
        structureChanged = true;
      }
    }

    const sourceRowCount = asPositiveInt(tableAttrs.sourceRowCount);
    const sourceColCount = asPositiveInt(tableAttrs.sourceColCount);
    if (sourceRowCount !== null && sourceRowCount !== rowCount) {
      structureChanged = true;
    }
    if (sourceColCount !== null && sourceColCount !== colCount) {
      structureChanged = true;
    }

    if (!structureChanged) {
      return;
    }

    patches.push({
      tableId,
      fileName: target.fileName,
      tableIndex: target.tableIndex,
      rowCount,
      colCount,
      rows: rowPatches,
    });
  });

  return {
    patches,
    warnings: uniqueWarnings(warnings),
  };
}

function directChildrenByLocalName(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === localName);
}

function firstDirectChildByLocalName(parent: Element, localName: string): Element | null {
  return directChildrenByLocalName(parent, localName)[0] || null;
}

function firstDescendantByLocalName(parent: Element, localName: string): Element | null {
  return Array.from(parent.getElementsByTagName("*")).find((child) => child.localName === localName) || null;
}

function removeDirectChildrenByLocalName(parent: Element, localName: string): void {
  for (const child of directChildrenByLocalName(parent, localName)) {
    parent.removeChild(child);
  }
}

function createHpElement(document: Document, namespaceUri: string, prefix: string, localName: string): Element {
  return document.createElementNS(namespaceUri, `${prefix}:${localName}`);
}

function ensureDirectChild(
  parent: Element,
  localName: string,
  document: Document,
  namespaceUri: string,
  prefix: string,
): Element {
  const existing = firstDirectChildByLocalName(parent, localName);
  if (existing) {
    return existing;
  }
  const next = createHpElement(document, namespaceUri, prefix, localName);
  parent.appendChild(next);
  return next;
}

function createParagraphNode(
  document: Document,
  namespaceUri: string,
  prefix: string,
  templateParagraph: Element | null,
  line: string,
): Element {
  const paragraph = templateParagraph
    ? (templateParagraph.cloneNode(true) as Element)
    : createHpElement(document, namespaceUri, prefix, "p");

  let run = firstDescendantByLocalName(paragraph, "run");
  if (!run) {
    run = createHpElement(document, namespaceUri, prefix, "run");
    paragraph.appendChild(run);
  }

  let textNodes = Array.from(run.getElementsByTagName("*")).filter((child) => child.localName === "t");
  if (!textNodes.length) {
    const nextTextNode = createHpElement(document, namespaceUri, prefix, "t");
    run.appendChild(nextTextNode);
    textNodes = [nextTextNode];
  }

  textNodes[0].textContent = line;
  for (const extra of textNodes.slice(1)) {
    extra.textContent = "";
  }
  return paragraph;
}

function applyPatchToTableElement(tableElement: Element, patch: TablePatch, document: Document): void {
  const namespaceUri = tableElement.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/paragraph";
  const prefix = tableElement.prefix || "hp";

  const originalRows = directChildrenByLocalName(tableElement, "tr");
  const firstRowTemplate = originalRows[0] || null;
  const firstCellTemplate = firstRowTemplate ? directChildrenByLocalName(firstRowTemplate, "tc")[0] || null : null;

  tableElement.setAttribute("rowCnt", String(patch.rowCount));
  tableElement.setAttribute("colCnt", String(patch.colCount));
  removeDirectChildrenByLocalName(tableElement, "tr");

  for (const [rowIndex, rowPatch] of patch.rows.entries()) {
    const rowTemplate = originalRows[rowIndex] || firstRowTemplate;
    const rowElement = rowTemplate
      ? (rowTemplate.cloneNode(false) as Element)
      : createHpElement(document, namespaceUri, prefix, "tr");

    const rowCellTemplates = rowTemplate ? directChildrenByLocalName(rowTemplate, "tc") : [];
    const fallbackCellTemplate = rowCellTemplates[0] || firstCellTemplate;
    let colCursor = 0;

    for (const [cellIndex, cellPatch] of rowPatch.cells.entries()) {
      const cellTemplate = rowCellTemplates[cellIndex] || fallbackCellTemplate;
      const cellElement = cellTemplate
        ? (cellTemplate.cloneNode(true) as Element)
        : createHpElement(document, namespaceUri, prefix, "tc");

      const subList = ensureDirectChild(cellElement, "subList", document, namespaceUri, prefix);
      const paragraphTemplate = firstDescendantByLocalName(subList, "p");
      removeDirectChildrenByLocalName(subList, "p");
      for (const line of cellPatch.lines.length ? cellPatch.lines : [""]) {
        subList.appendChild(createParagraphNode(document, namespaceUri, prefix, paragraphTemplate, line));
      }

      const cellAddr = ensureDirectChild(cellElement, "cellAddr", document, namespaceUri, prefix);
      cellAddr.setAttribute("colAddr", String(colCursor));
      cellAddr.setAttribute("rowAddr", String(rowIndex));

      const cellSpan = ensureDirectChild(cellElement, "cellSpan", document, namespaceUri, prefix);
      cellSpan.setAttribute("colSpan", String(cellPatch.colSpan));
      cellSpan.setAttribute("rowSpan", String(cellPatch.rowSpan));

      rowElement.appendChild(cellElement);
      colCursor += cellPatch.colSpan;
    }

    tableElement.appendChild(rowElement);
  }
}

// Returns start/end positions (end is exclusive) of every top-level <*:tbl> element
// in the raw XML string.  Handles nested tables and quoted attribute values.
function findTblPositions(xmlText: string): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = [];
  const len = xmlText.length;
  let i = 0;

  while (i < len) {
    if (xmlText[i] !== "<") {
      i += 1;
      continue;
    }

    // Skip XML comments
    if (xmlText.startsWith("<!--", i)) {
      const end = xmlText.indexOf("-->", i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }

    // Skip CDATA
    if (xmlText.startsWith("<![CDATA[", i)) {
      const end = xmlText.indexOf("]]>", i + 9);
      i = end === -1 ? len : end + 3;
      continue;
    }

    // Skip closing tags and processing instructions
    if (i + 1 < len && (xmlText[i + 1] === "/" || xmlText[i + 1] === "?")) {
      const end = xmlText.indexOf(">", i + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }

    // Check if this is a <*:tbl or <tbl opening tag
    const tagMatch = /^<([a-z][a-z0-9]*:)?tbl[\s\/>]/.exec(xmlText.slice(i));
    if (!tagMatch) {
      i += 1;
      continue;
    }

    const tblStart = i;
    const prefix = tagMatch[1] || ""; // e.g. "hp:" or ""

    // Advance past the opening tag, skipping quoted attributes
    i += 1;
    while (i < len && xmlText[i] !== ">") {
      if (xmlText[i] === '"' || xmlText[i] === "'") {
        const q = xmlText[i];
        i += 1;
        while (i < len && xmlText[i] !== q) i += 1;
      }
      i += 1;
    }

    // Self-closing tag?
    if (i > 0 && xmlText[i - 1] === "/") {
      positions.push({ start: tblStart, end: i + 1 });
      i += 1;
      continue;
    }
    i += 1; // skip ">"

    // Find matching close tag with depth tracking (handles nested tables)
    const openPattern = `<${prefix}tbl`;
    const closePattern = `</${prefix}tbl>`;
    let depth = 1;

    while (i < len && depth > 0) {
      const nextLt = xmlText.indexOf("<", i);
      if (nextLt === -1) break;

      if (xmlText.startsWith(closePattern, nextLt)) {
        depth -= 1;
        if (depth === 0) {
          positions.push({ start: tblStart, end: nextLt + closePattern.length });
          i = nextLt + closePattern.length;
          break;
        }
        i = nextLt + closePattern.length;
      } else if (xmlText.startsWith(openPattern, nextLt)) {
        // Only a true opening tag (not e.g. <hp:tblPr)
        const charAfter = xmlText[nextLt + openPattern.length];
        if (charAfter === " " || charAfter === "\t" || charAfter === "\n" || charAfter === "\r" || charAfter === ">" || charAfter === "/") {
          depth += 1;
        }
        i = nextLt + 1;
      } else {
        i = nextLt + 1;
      }
    }
  }

  return positions;
}

// Serialize a single DOM element to an XML string fragment.
// Guarantees the original namespace prefix is preserved even if XMLSerializer
// internally assigns a different one (common in browser XMLSerializer).
function serializeElementSafely(element: Element): string {
  const nsUri = element.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/paragraph";
  const desiredPrefix = element.prefix || "hp";

  // Declare the namespace on this element so it is self-contained when serialized
  element.setAttributeNS("http://www.w3.org/2000/xmlns/", `xmlns:${desiredPrefix}`, nsUri);

  let xml = new XMLSerializer().serializeToString(element);

  // XMLSerializer may silently rename the prefix (e.g. hp: → ns1:).
  // Detect the actual prefix used and rename it back.
  const nsEscaped = nsUri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nsPattern = new RegExp(`xmlns:([a-z][a-z0-9]*)="${nsEscaped}"`);
  const nsMatch = nsPattern.exec(xml);
  if (nsMatch && nsMatch[1] !== desiredPrefix) {
    const actualPrefix = nsMatch[1];
    // Replace every occurrence of the wrong prefix with the desired one
    xml = xml.replaceAll(`${actualPrefix}:`, `${desiredPrefix}:`);
    xml = xml.replace(`xmlns:${actualPrefix}=`, `xmlns:${desiredPrefix}=`);
  }

  return xml;
}

function applyTablePatchesToXml(
  xmlText: string,
  fileName: string,
  patches: TablePatch[],
): { xml: string; warnings: string[] } {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  const parseError = document.querySelector("parsererror");
  if (parseError) {
    return {
      xml: xmlText,
      warnings: [`XML 파싱 실패로 표 반영을 건너뜁니다: ${fileName}`],
    };
  }

  const warnings: string[] = [];
  const tables = Array.from(document.getElementsByTagName("*")).filter((node) => node.localName === "tbl");
  const sorted = [...patches].sort((a, b) => a.tableIndex - b.tableIndex);

  // Find positions of all <tbl> elements in the ORIGINAL XML string.
  // We will splice only the modified tables back into the original, preserving
  // all other XML verbatim (including namespace declarations, PI, etc.).
  const tblPositions = findTblPositions(xmlText);

  // Collect splice operations; apply in reverse order to preserve string positions.
  const splices: Array<{ start: number; end: number; newXml: string }> = [];

  for (const patch of sorted) {
    const targetTable = tables[patch.tableIndex];
    if (!targetTable) {
      warnings.push(`원본 표를 찾지 못해 반영을 건너뜁니다: ${patch.tableId}`);
      continue;
    }

    const pos = tblPositions[patch.tableIndex];
    if (!pos) {
      warnings.push(`XML에서 표 위치를 찾지 못해 반영을 건너뜁니다: ${patch.tableId}`);
      continue;
    }

    // Apply the structural patch to the DOM node
    applyPatchToTableElement(targetTable, patch, document);

    // Serialize only this <tbl> element (not the whole document)
    const newTableXml = serializeElementSafely(targetTable);

    splices.push({ start: pos.start, end: pos.end, newXml: newTableXml });
  }

  // Apply splices in reverse order so earlier positions stay valid
  let resultXml = xmlText;
  for (const splice of splices.sort((a, b) => b.start - a.start)) {
    resultXml = resultXml.slice(0, splice.start) + splice.newXml + resultXml.slice(splice.end);
  }

  return {
    xml: resultXml,
    warnings: uniqueWarnings(warnings),
  };
}

async function applyTablePatches(
  fileBuffer: ArrayBuffer,
  patches: TablePatch[],
): Promise<{ buffer: ArrayBuffer; warnings: string[] }> {
  if (!patches.length) {
    return { buffer: fileBuffer, warnings: [] };
  }

  const grouped = new Map<string, TablePatch[]>();
  for (const patch of patches) {
    if (!grouped.has(patch.fileName)) {
      grouped.set(patch.fileName, []);
    }
    grouped.get(patch.fileName)!.push(patch);
  }

  const zip = await JSZip.loadAsync(fileBuffer);
  const names = Object.keys(zip.files);
  const stagedEntries: Array<{ fileName: string; data: string | Uint8Array }> = [];
  const warnings: string[] = [];

  for (const fileName of names) {
    const item = zip.files[fileName];
    if (item.dir) {
      continue;
    }
    if (!grouped.has(fileName) || !isXmlName(fileName)) {
      stagedEntries.push({
        fileName,
        data: await item.async("uint8array"),
      });
      continue;
    }

    const xmlText = await item.async("string");
    const patched = applyTablePatchesToXml(xmlText, fileName, grouped.get(fileName)!);
    stagedEntries.push({
      fileName,
      data: patched.xml,
    });
    warnings.push(...patched.warnings);
  }

  const out = new JSZip();
  const map = new Map(stagedEntries.map((entry) => [entry.fileName, entry]));
  const ordered: Array<{ fileName: string; data: string | Uint8Array }> = [];

  if (map.has("mimetype")) {
    ordered.push(map.get("mimetype")!);
    map.delete("mimetype");
  }
  for (const entry of stagedEntries) {
    if (!map.has(entry.fileName)) {
      continue;
    }
    ordered.push(entry);
    map.delete(entry.fileName);
  }
  for (const entry of map.values()) {
    ordered.push(entry);
  }

  for (const entry of ordered) {
    const options = entry.fileName === "mimetype" ? { compression: "STORE" as const } : undefined;
    out.file(entry.fileName, entry.data, options);
  }

  const buffer = await out.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    mimeType: "application/zip",
  });

  return {
    buffer,
    warnings: uniqueWarnings(warnings),
  };
}

function readNodeLetterSpacing(attrs: MetadataAttrs): number {
  return asInt(attrs.letterSpacing) ?? 0;
}

function collectLetterSpacingEdits(
  doc: JSONContent,
  sourceSegments: EditorSegment[],
  extraSegmentsMap?: Record<string, string[]>,
): CollectLetterSpacingResult {
  const bySegmentId = new Map(sourceSegments.map((segment) => [segment.segmentId, segment]));
  const edits = new Map<string, LetterSpacingEdit>();
  const warnings: string[] = [];

  const registerEdit = (segment: EditorSegment, nextSpacing: number): void => {
    const sourceCharPrIDRef = readSegmentCharPrIDRef(segment);
    if (!sourceCharPrIDRef) {
      warnings.push(`segment(${segment.segmentId})의 charPrIDRef를 찾지 못해 자간 반영을 건너뜁니다.`);
      return;
    }
    if (readSegmentLetterSpacing(segment) === nextSpacing) {
      return;
    }
    edits.set(segment.segmentId, {
      segmentId: segment.segmentId,
      fileName: segment.fileName,
      textIndex: segment.textIndex,
      sourceCharPrIDRef,
      newSpacing: nextSpacing,
    });
  };

  walk(doc, (node) => {
    if (!isTextBlockNode(node)) {
      return;
    }

    const attrs = (node.attrs || {}) as MetadataAttrs;
    const segmentId = attrs.segmentId;
    if (!segmentId) {
      return;
    }
    const source = bySegmentId.get(segmentId);
    if (!source) {
      return;
    }
    const nextSpacing = readNodeLetterSpacing(attrs);
    registerEdit(source, nextSpacing);

    if (extraSegmentsMap) {
      for (const extraId of extraSegmentsMap[segmentId] || []) {
        const extra = bySegmentId.get(extraId);
        if (!extra) {
          continue;
        }
        registerEdit(extra, nextSpacing);
      }
    }
  });

  return {
    edits: Array.from(edits.values()).sort((a, b) => a.textIndex - b.textIndex),
    warnings: uniqueWarnings(warnings),
  };
}

function closestAncestorByLocalName(element: Element | null, localName: string): Element | null {
  let current = element;
  while (current) {
    if (current.localName === localName) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function readCharPrSpacing(charPr: Element): number {
  const spacing = Array.from(charPr.children).find((child) => child.localName === "spacing");
  if (!spacing) {
    return 0;
  }
  return (
    asInt(spacing.getAttribute("hangul")) ??
    asInt(spacing.getAttribute("latin")) ??
    asInt(spacing.getAttribute("hanja")) ??
    asInt(spacing.getAttribute("japanese")) ??
    asInt(spacing.getAttribute("other")) ??
    asInt(spacing.getAttribute("symbol")) ??
    asInt(spacing.getAttribute("user")) ??
    0
  );
}

function ensureCharPrSpacingElement(charPr: Element, document: Document): Element {
  const existing = Array.from(charPr.children).find((child) => child.localName === "spacing");
  if (existing) {
    return existing;
  }
  const namespaceUri = charPr.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/head";
  const prefix = charPr.prefix || "hh";
  const spacing = document.createElementNS(namespaceUri, `${prefix}:spacing`);
  charPr.appendChild(spacing);
  return spacing;
}

function setSpacingAttributes(spacingElement: Element, value: number): void {
  const serialized = String(value);
  for (const attr of ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"]) {
    spacingElement.setAttribute(attr, serialized);
  }
}

async function applyLetterSpacingPatches(
  fileBuffer: ArrayBuffer,
  edits: LetterSpacingEdit[],
  sourceSegments: EditorSegment[],
): Promise<{ buffer: ArrayBuffer; warnings: string[] }> {
  if (!edits.length) {
    return { buffer: fileBuffer, warnings: [] };
  }

  const zip = await JSZip.loadAsync(fileBuffer);
  const headerFile = zip.files[HEADER_FILE];
  if (!headerFile || headerFile.dir) {
    return {
      buffer: fileBuffer,
      warnings: ["Contents/header.xml을 찾지 못해 자간 반영을 건너뜁니다."],
    };
  }

  const warnings: string[] = [];
  const headerXml = await headerFile.async("string");
  const headerDoc = new DOMParser().parseFromString(headerXml, "application/xml");
  if (headerDoc.querySelector("parsererror")) {
    return {
      buffer: fileBuffer,
      warnings: ["header.xml 파싱 실패로 자간 반영을 건너뜁니다."],
    };
  }

  const charProperties = Array.from(headerDoc.getElementsByTagName("*")).find(
    (node) => node.localName === "charProperties",
  );
  if (!charProperties) {
    return {
      buffer: fileBuffer,
      warnings: ["header.xml에 charProperties가 없어 자간 반영을 건너뜁니다."],
    };
  }

  const charPrNodes = Array.from(charProperties.children).filter((child) => child.localName === "charPr");
  const charPrById = new Map<string, Element>();
  let maxId = 0;
  for (const charPr of charPrNodes) {
    const id = charPr.getAttribute("id");
    if (!id) {
      continue;
    }
    charPrById.set(id, charPr);
    const parsed = asInt(id);
    if (parsed !== null) {
      maxId = Math.max(maxId, parsed);
    }
  }
  let nextCharPrId = maxId + 1;
  const charPrCache = new Map<string, string>();
  const targetCharPrBySegment = new Map<string, string>();

  for (const edit of edits) {
    const cacheKey = `${edit.sourceCharPrIDRef}::${edit.newSpacing}`;
    if (charPrCache.has(cacheKey)) {
      targetCharPrBySegment.set(edit.segmentId, charPrCache.get(cacheKey)!);
      continue;
    }

    const sourceCharPr = charPrById.get(edit.sourceCharPrIDRef);
    if (!sourceCharPr) {
      warnings.push(
        `charPr(${edit.sourceCharPrIDRef})를 찾지 못해 segment(${edit.segmentId}) 자간 반영을 건너뜁니다.`,
      );
      continue;
    }

    const sourceSpacing = readCharPrSpacing(sourceCharPr);
    if (sourceSpacing === edit.newSpacing) {
      charPrCache.set(cacheKey, edit.sourceCharPrIDRef);
      targetCharPrBySegment.set(edit.segmentId, edit.sourceCharPrIDRef);
      continue;
    }

    const cloned = sourceCharPr.cloneNode(true) as Element;
    const nextId = String(nextCharPrId);
    nextCharPrId += 1;
    cloned.setAttribute("id", nextId);
    const spacingElement = ensureCharPrSpacingElement(cloned, headerDoc);
    setSpacingAttributes(spacingElement, edit.newSpacing);
    charProperties.appendChild(cloned);
    charPrById.set(nextId, cloned);
    charPrCache.set(cacheKey, nextId);
    targetCharPrBySegment.set(edit.segmentId, nextId);
  }

  if (!targetCharPrBySegment.size) {
    return {
      buffer: fileBuffer,
      warnings: uniqueWarnings(warnings),
    };
  }

  const nextCharPrCount = Array.from(charProperties.children).filter((child) => child.localName === "charPr").length;
  charProperties.setAttribute("itemCnt", String(nextCharPrCount));

  const targetBySegmentId = new Map<string, string>();
  for (const edit of edits) {
    const targetCharPrId = targetCharPrBySegment.get(edit.segmentId);
    if (!targetCharPrId) {
      continue;
    }
    targetBySegmentId.set(edit.segmentId, targetCharPrId);
  }

  const names = Object.keys(zip.files);
  const filesToPatch = new Set(edits.map((edit) => edit.fileName));
  const stagedEntries: Array<{ fileName: string; data: string | Uint8Array }> = [];
  for (const fileName of names) {
    const item = zip.files[fileName];
    if (item.dir) {
      continue;
    }
    if (!isXmlName(fileName)) {
      stagedEntries.push({ fileName, data: await item.async("uint8array") });
      continue;
    }
    if (fileName === HEADER_FILE) {
      stagedEntries.push({ fileName, data: new XMLSerializer().serializeToString(headerDoc) });
      continue;
    }
    if (!filesToPatch.has(fileName)) {
      stagedEntries.push({ fileName, data: await item.async("uint8array") });
      continue;
    }

    const sectionXml = await item.async("string");
    const sectionDoc = new DOMParser().parseFromString(sectionXml, "application/xml");
    if (sectionDoc.querySelector("parsererror")) {
      warnings.push(`section XML 파싱 실패로 자간 반영을 건너뜁니다: ${fileName}`);
      stagedEntries.push({ fileName, data: await item.async("uint8array") });
      continue;
    }

    const pool = sourceSegments
      .filter((segment) => segment.fileName === fileName)
      .sort((a, b) => a.textIndex - b.textIndex);
    let poolIndex = 0;
    const visit = (node: Node): void => {
      if (node.nodeType === 3 /* TEXT_NODE */ || node.nodeType === 4 /* CDATA_SECTION_NODE */) {
        const textNode = node as Text;
        if ((textNode.nodeValue || "").trim().length > 0 && poolIndex < pool.length) {
          const segment = pool[poolIndex];
          const targetCharPrId = targetBySegmentId.get(segment.segmentId);
          if (targetCharPrId) {
            const run = closestAncestorByLocalName(textNode.parentElement, "run");
            if (run) {
              run.setAttribute("charPrIDRef", targetCharPrId);
            }
          }
          poolIndex += 1;
        }
        return;
      }
      for (const child of Array.from(node.childNodes)) {
        visit(child);
      }
    };
    visit(sectionDoc);

    stagedEntries.push({
      fileName,
      data: new XMLSerializer().serializeToString(sectionDoc),
    });
  }

  const out = new JSZip();
  const map = new Map(stagedEntries.map((entry) => [entry.fileName, entry]));
  const ordered: Array<{ fileName: string; data: string | Uint8Array }> = [];

  if (map.has("mimetype")) {
    ordered.push(map.get("mimetype")!);
    map.delete("mimetype");
  }
  for (const entry of stagedEntries) {
    if (!map.has(entry.fileName)) {
      continue;
    }
    ordered.push(entry);
    map.delete(entry.fileName);
  }
  for (const entry of map.values()) {
    ordered.push(entry);
  }

  for (const entry of ordered) {
    const options = entry.fileName === "mimetype" ? { compression: "STORE" as const } : undefined;
    out.file(entry.fileName, entry.data, options);
  }

  const buffer = await out.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    mimeType: "application/zip",
  });

  return {
    buffer,
    warnings: uniqueWarnings(warnings),
  };
}

export function collectDocumentEdits(
  doc: JSONContent,
  sourceSegments: EditorSegment[],
  extraSegmentsMap?: Record<string, string[]>,
): CollectEditsResult {
  const bySegmentId = new Map(sourceSegments.map((segment) => [segment.segmentId, segment]));
  const edits: TextEdit[] = [];
  const warnings: string[] = [];

  walk(doc, (node) => {
    if (!isTextBlockNode(node)) {
      return;
    }

    const attrs = (node.attrs || {}) as MetadataAttrs;
    const text = extractNodeText(node);
    const segmentId = attrs.segmentId;
    if (!segmentId) {
      if (text.trim()) {
        warnings.push("metadata 없는 새 텍스트 블록은 현재 HWPX 내보내기에 반영되지 않습니다.");
      }
      return;
    }

    const source = bySegmentId.get(segmentId);
    if (!source) {
      if (text.trim()) {
        warnings.push(`알 수 없는 segmentId(${segmentId}) 텍스트는 건너뜁니다.`);
      }
      return;
    }

    if (text === source.originalText) {
      return;
    }
    edits.push({
      id: source.segmentId,
      fileName: source.fileName,
      textIndex: source.textIndex,
      oldText: source.originalText,
      newText: text,
    });

    // When a primary segment changes, clear any extra segments that were merged
    // into the same paragraph during parsing (their text would be double-counted otherwise).
    if (extraSegmentsMap) {
      for (const extraId of extraSegmentsMap[segmentId] || []) {
        const extra = bySegmentId.get(extraId);
        if (!extra || extra.originalText === "") {
          continue;
        }
        edits.push({
          id: extra.segmentId,
          fileName: extra.fileName,
          textIndex: extra.textIndex,
          oldText: extra.originalText,
          newText: "",
        });
      }
    }
  });

  const tableWarnings = collectTablePatches(doc).warnings;
  return {
    edits,
    warnings: uniqueWarnings([...warnings, ...tableWarnings]),
  };
}

export async function applyProseMirrorDocToHwpx(
  fileBuffer: ArrayBuffer,
  doc: JSONContent,
  sourceSegments: EditorSegment[],
  extraSegmentsMap?: Record<string, string[]>,
): Promise<{ blob: Blob; edits: TextEdit[]; warnings: string[]; integrityIssues: string[] }> {
  const { edits, warnings: previewWarnings } = collectDocumentEdits(doc, sourceSegments, extraSegmentsMap);
  const { patches: tablePatches, warnings: tableWarnings } = collectTablePatches(doc);
  const { edits: letterSpacingEdits, warnings: letterSpacingWarnings } = collectLetterSpacingEdits(
    doc,
    sourceSegments,
    extraSegmentsMap,
  );

  if (!edits.length && !tablePatches.length && !letterSpacingEdits.length) {
    const blob = new Blob([fileBuffer], { type: "application/zip" });
    const integrityIssues = await validateHwpxArchive(fileBuffer);
    return {
      blob,
      edits,
      warnings: uniqueWarnings([...previewWarnings, ...tableWarnings, ...letterSpacingWarnings]),
      integrityIssues,
    };
  }

  let workingBuffer = fileBuffer;
  if (edits.length) {
    const editedBlob = await applyTextEdits(workingBuffer, edits);
    workingBuffer = await editedBlob.arrayBuffer();
  }

  let runtimeWarnings: string[] = [];
  if (tablePatches.length) {
    const patched = await applyTablePatches(workingBuffer, tablePatches);
    workingBuffer = patched.buffer;
    runtimeWarnings = patched.warnings;
  }

  if (letterSpacingEdits.length) {
    const patched = await applyLetterSpacingPatches(workingBuffer, letterSpacingEdits, sourceSegments);
    workingBuffer = patched.buffer;
    runtimeWarnings = [...runtimeWarnings, ...patched.warnings];
  }

  const integrityIssues = await validateHwpxArchive(workingBuffer);
  const blob = new Blob([workingBuffer], { type: "application/zip" });
  return {
    blob,
    edits,
    warnings: uniqueWarnings([...previewWarnings, ...tableWarnings, ...letterSpacingWarnings, ...runtimeWarnings]),
    integrityIssues,
  };
}
