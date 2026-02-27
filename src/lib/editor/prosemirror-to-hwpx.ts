import JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import { applyTextEdits, applyEditsToXmlText, scanXmlTextSegments, validateHwpxArchive } from "../hwpx";
import type { TextEdit } from "../hwpx";
import type { EditorSegment } from "./hwpx-to-prosemirror";
import type { HwpxDocumentModel, HwpxRun } from "../../types/hwpx-model";
import { markFingerprint, ensureCharPrForMarks } from "./marks-to-charpr";

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

type ParaPrAttrs = {
  hwpxParaPrId?: string | null;
  hwpxLineSpacing?: number | null;
  hwpxAlign?: string | null;
  hwpxLeftIndent?: number | null;
  hwpxRightIndent?: number | null;
  hwpxFirstLineIndent?: number | null;
  hwpxSpaceBefore?: number | null;
  hwpxSpaceAfter?: number | null;
};

type CollectLetterSpacingResult = {
  edits: LetterSpacingEdit[];
  warnings: string[];
};

type HeadingStyleContext = {
  headingLevelByStyleId: Map<string, number>;
  styleIdByHeadingLevel: Map<number, string>;
  defaultParagraphStyleId: string;
};

const HEADER_FILE = "Contents/header.xml";
const CONTENT_HPF_FILE = "Contents/content.hpf";

type NodeLikeAttrs = Record<string, unknown>;

type ImageManifestItem = {
  id: string;
  href: string;
  mediaType: string;
};

type ImageResourceRef = {
  id: string;
  href: string;
  mediaType: string;
};

type ImageExportContext = {
  zip: JSZip;
  warnings: string[];
  manifestDoc: Document | null;
  manifestElement: Element | null;
  manifestPrefix: string;
  manifestNamespaceUri: string;
  manifestDirty: boolean;
  manifestItemsByHref: Map<string, ImageManifestItem>;
  existingManifestIds: Set<string>;
  imageBySource: Map<string, ImageResourceRef>;
  nextImageNumber: number;
  nextPicId: number;
  nextInstId: number;
};

type CorePrefix = "hc" | "hp";

type RunContentPiece =
  | {
      kind: "text";
      text: string;
      marks: JSONContent["marks"];
    }
  | {
      kind: "image";
      attrs: NodeLikeAttrs;
    };

function clampHeadingLevel(raw: number): 1 | 2 | 3 | 4 | 5 {
  const n = Math.max(1, Math.min(5, raw));
  return n as 1 | 2 | 3 | 4 | 5;
}

function parseHeadingLevelFromStyleNames(name: string, engName: string): number | null {
  const normalizedName = name.trim();
  const normalizedEngName = engName.trim();
  const patterns = [
    normalizedName.match(/개요\s*([1-9]\d*)/),
    normalizedEngName.match(/outline\s*([1-9]\d*)/i),
    normalizedName.match(/제목\s*([1-9]\d*)/),
    normalizedEngName.match(/heading\s*([1-9]\d*)/i),
  ];
  for (const match of patterns) {
    if (!match) {
      continue;
    }
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return clampHeadingLevel(parsed);
    }
  }
  if (/(^|\s)(제목|표제)(\s|$)/.test(normalizedName) || /(^|\s)heading(\s|$)/i.test(normalizedEngName)) {
    return 1;
  }
  return null;
}

function extractHeadingStyleContext(headerDoc: Document | null): HeadingStyleContext {
  const defaultContext: HeadingStyleContext = {
    headingLevelByStyleId: new Map(),
    styleIdByHeadingLevel: new Map(),
    defaultParagraphStyleId: "0",
  };
  if (!headerDoc) {
    return defaultContext;
  }

  const headingLevelByStyleId = new Map<string, number>();
  const styleIdByHeadingLevel = new Map<number, string>();
  let defaultParagraphStyleId = "0";
  let firstParaStyleId: string | null = null;

  for (const el of Array.from(headerDoc.getElementsByTagName("*"))) {
    if (el.localName !== "style") {
      continue;
    }
    const id = el.getAttribute("id");
    if (!id) {
      continue;
    }
    const type = (el.getAttribute("type") ?? "").toUpperCase();
    if (type && type !== "PARA") {
      continue;
    }
    if (firstParaStyleId === null) {
      firstParaStyleId = id;
    }
    const name = el.getAttribute("name") ?? "";
    const engName = el.getAttribute("engName") ?? "";
    if (name === "바탕글" || /^normal$/i.test(engName)) {
      defaultParagraphStyleId = id;
    } else if (defaultParagraphStyleId === "0" && id === "0") {
      defaultParagraphStyleId = id;
    }
    const level = parseHeadingLevelFromStyleNames(name, engName);
    if (level !== null) {
      headingLevelByStyleId.set(id, level);
      if (!styleIdByHeadingLevel.has(level)) {
        styleIdByHeadingLevel.set(level, id);
      }
    }
  }

  if (defaultParagraphStyleId === "0" && firstParaStyleId) {
    defaultParagraphStyleId = firstParaStyleId;
  }

  return {
    headingLevelByStyleId,
    styleIdByHeadingLevel,
    defaultParagraphStyleId,
  };
}

function resolveStyleIDRefForNode(
  node: JSONContent,
  currentStyleIDRef: string | null,
  styleContext: HeadingStyleContext,
): string {
  if (node.type === "heading") {
    const rawLevel = asInt((node.attrs as { level?: unknown } | undefined)?.level) ?? 1;
    const level = clampHeadingLevel(rawLevel);
    return (
      styleContext.styleIdByHeadingLevel.get(level) ??
      currentStyleIDRef ??
      styleContext.defaultParagraphStyleId
    );
  }

  if (node.type === "paragraph") {
    if (currentStyleIDRef && !styleContext.headingLevelByStyleId.has(currentStyleIDRef)) {
      return currentStyleIDRef;
    }
    return styleContext.defaultParagraphStyleId;
  }

  return currentStyleIDRef ?? styleContext.defaultParagraphStyleId;
}

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

function getTopLevelTextBlocks(doc: JSONContent): JSONContent[] {
  return (doc.content ?? []).filter((node) => isTextBlockNode(node));
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

function asNonEmptyString(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

function normalizeImageMimeType(input: unknown): string {
  const raw = asNonEmptyString(input);
  if (!raw) {
    return "image/png";
  }
  return raw.toLowerCase();
}

function extensionFromFileName(fileName: string | null): string | null {
  if (!fileName) {
    return null;
  }
  const match = fileName.trim().match(/\.([a-zA-Z0-9]+)$/);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase();
}

function resolveImageExtension(mediaType: string, fileName: string | null): string {
  return (
    IMAGE_EXTENSION_BY_MIME[mediaType] ??
    extensionFromFileName(fileName) ??
    "bin"
  );
}

function parseBase64DataUrl(src: string): { mediaType: string; base64: string } | null {
  if (!src.startsWith("data:")) {
    return null;
  }
  const comma = src.indexOf(",");
  if (comma <= 5) {
    return null;
  }
  const header = src.slice(5, comma);
  const body = src.slice(comma + 1);
  const parts = header.split(";").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const mediaType = parts.find((part) => part.includes("/")) ?? "image/png";
  const isBase64 = parts.includes("base64");
  if (!isBase64) {
    return null;
  }
  return { mediaType, base64: body.replace(/\s+/g, "") };
}

function normalizeBase64ForDecode(base64: string): string {
  const cleaned = base64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const mod = cleaned.length % 4;
  if (mod === 0) {
    return cleaned;
  }
  return cleaned + "=".repeat(4 - mod);
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = normalizeBase64ForDecode(base64);
  if (typeof globalThis.atob === "function") {
    try {
      const binary = globalThis.atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      // Fallback below.
    }
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(normalized, "base64"));
  }
  throw new Error("atob/Buffer is not available in this runtime");
}

function pixelToHwpUnit(raw: unknown, fallbackPx: number): number {
  const px = asPositiveInt(raw) ?? fallbackPx;
  // 1px @ 96DPI ~= 0.75pt, and 1pt = 100 HWPUNIT.
  const value = Math.round(px * 75);
  return Math.max(1, value);
}

function ensureCoreNamespaceOnSectionPrefix(sectionPrefixXml: string): {
  sectionPrefixXml: string;
  corePrefix: CorePrefix;
} {
  if (/\sxmlns:hc\s*=/.test(sectionPrefixXml)) {
    return { sectionPrefixXml, corePrefix: "hc" };
  }
  const updated = sectionPrefixXml.replace(
    /<([A-Za-z0-9]+):sec\b/,
    `<$1:sec xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"`,
  );
  return { sectionPrefixXml: updated, corePrefix: "hc" };
}

function collectGraphicObjectMaxValues(sectionXml: string): { maxObjectId: number; maxInstId: number } {
  let maxObjectId = 0;
  let maxInstId = 0;
  const objectMatches = sectionXml.matchAll(
    /<[^>]*:(?:pic|tbl|ole|container|line|rect|ellipse|arc|polygon|curve|connectLine)\b[^>]*>/g,
  );
  for (const match of objectMatches) {
    const tag = match[0];
    const objectId = tag.match(/\bid="(\d+)"/)?.[1];
    const instId = tag.match(/\binstid="(\d+)"/)?.[1];
    const parsedPic = asInt(objectId);
    const parsedInst = asInt(instId);
    if (parsedPic !== null) {
      maxObjectId = Math.max(maxObjectId, parsedPic);
    }
    if (parsedInst !== null) {
      maxInstId = Math.max(maxInstId, parsedInst);
    }
  }
  return { maxObjectId, maxInstId };
}

async function createImageExportContext(zip: JSZip, warnings: string[]): Promise<ImageExportContext> {
  const contentFile = zip.files[CONTENT_HPF_FILE];
  let manifestDoc: Document | null = null;
  let manifestElement: Element | null = null;
  let manifestPrefix = "opf";
  let manifestNamespaceUri = "http://www.idpf.org/2007/opf";
  const manifestItemsByHref = new Map<string, ImageManifestItem>();
  const existingManifestIds = new Set<string>();

  if (!contentFile || contentFile.dir) {
    warnings.push("Contents/content.hpf가 없어 이미지 리소스 등록을 건너뜁니다.");
  } else {
    const contentXml = await contentFile.async("string");
    const parsed = new DOMParser().parseFromString(contentXml, "application/xml");
    if (parsed.querySelector("parsererror")) {
      warnings.push("content.hpf 파싱 실패로 이미지 리소스 등록을 건너뜁니다.");
    } else {
      manifestDoc = parsed;
      const packageEl = parsed.documentElement;
      if (packageEl.prefix) {
        manifestPrefix = packageEl.prefix;
      }
      if (packageEl.namespaceURI) {
        manifestNamespaceUri = packageEl.namespaceURI;
      }
      manifestElement =
        Array.from(parsed.getElementsByTagName("*")).find((node) => node.localName === "manifest") ?? null;
      if (!manifestElement) {
        warnings.push("content.hpf에 manifest가 없어 이미지 리소스 등록을 건너뜁니다.");
      } else {
        for (const item of Array.from(manifestElement.children).filter((node) => node.localName === "item")) {
          const id = item.getAttribute("id");
          const href = item.getAttribute("href");
          const mediaType = item.getAttribute("media-type");
          if (id) {
            existingManifestIds.add(id);
          }
          if (id && href && mediaType) {
            manifestItemsByHref.set(href, { id, href, mediaType });
          }
        }
      }
    }
  }

  let nextImageNumber = 1;
  for (const id of existingManifestIds) {
    const match = id.match(/^image(\d+)$/i);
    if (!match) {
      continue;
    }
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed >= nextImageNumber) {
      nextImageNumber = parsed + 1;
    }
  }
  for (const fileName of Object.keys(zip.files)) {
    const match = fileName.match(/^BinData\/image(\d+)\.[a-zA-Z0-9]+$/);
    if (!match) {
      continue;
    }
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed >= nextImageNumber) {
      nextImageNumber = parsed + 1;
    }
  }

  let maxObjectId = 0;
  let maxInstId = 0;
  const sectionNames = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/.test(name));
  for (const sectionName of sectionNames) {
    const file = zip.files[sectionName];
    if (!file || file.dir) {
      continue;
    }
    const xml = await file.async("string");
    const sectionMax = collectGraphicObjectMaxValues(xml);
    maxObjectId = Math.max(maxObjectId, sectionMax.maxObjectId);
    maxInstId = Math.max(maxInstId, sectionMax.maxInstId);
  }

  return {
    zip,
    warnings,
    manifestDoc,
    manifestElement,
    manifestPrefix,
    manifestNamespaceUri,
    manifestDirty: false,
    manifestItemsByHref,
    existingManifestIds,
    imageBySource: new Map(),
    nextImageNumber,
    nextPicId: Math.max(maxObjectId + 1, 1),
    nextInstId: Math.max(maxInstId + 1, 1),
  };
}

function createManifestItemElement(context: ImageExportContext, item: ImageManifestItem): Element {
  const qualifiedName = context.manifestPrefix ? `${context.manifestPrefix}:item` : "item";
  const el = context.manifestDoc!.createElementNS(context.manifestNamespaceUri, qualifiedName);
  el.setAttribute("id", item.id);
  el.setAttribute("href", item.href);
  el.setAttribute("media-type", item.mediaType);
  el.setAttribute("isEmbeded", "1");
  return el;
}

function ensureManifestItem(context: ImageExportContext, item: ImageManifestItem): void {
  if (!context.manifestDoc || !context.manifestElement) {
    return;
  }
  if (context.manifestItemsByHref.has(item.href)) {
    return;
  }
  context.manifestElement.appendChild(createManifestItemElement(context, item));
  context.manifestItemsByHref.set(item.href, item);
  context.existingManifestIds.add(item.id);
  context.manifestDirty = true;
}

function nextAvailableImageId(context: ImageExportContext): string {
  while (context.existingManifestIds.has(`image${context.nextImageNumber}`)) {
    context.nextImageNumber += 1;
  }
  const id = `image${context.nextImageNumber}`;
  context.nextImageNumber += 1;
  return id;
}

function ensureImageResourceForAttrs(
  attrs: NodeLikeAttrs,
  context: ImageExportContext,
): ImageResourceRef | null {
  const src = asNonEmptyString(attrs.src);
  if (!src) {
    context.warnings.push("이미지 src가 없어 HWPX 반영을 건너뜁니다.");
    return null;
  }
  const cached = context.imageBySource.get(src);
  if (cached) {
    return cached;
  }

  const parsedData = parseBase64DataUrl(src);
  if (!parsedData) {
    context.warnings.push("data URL(base64) 형식이 아닌 이미지는 HWPX 내보내기에서 건너뜁니다.");
    return null;
  }

  const mediaType = normalizeImageMimeType(attrs.mimeType ?? parsedData.mediaType);
  const fileName = asNonEmptyString(attrs.fileName);
  const extension = resolveImageExtension(mediaType, fileName);
  const id = nextAvailableImageId(context);
  const href = `BinData/${id}.${extension}`;

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64ToBytes(parsedData.base64);
  } catch (error) {
    context.warnings.push(`이미지 base64 디코딩 실패로 반영을 건너뜁니다: ${String(error)}`);
    return null;
  }

  context.zip.file(href, bytes);
  const resource: ImageResourceRef = {
    id,
    href,
    mediaType,
  };
  context.imageBySource.set(src, resource);
  ensureManifestItem(context, { id, href, mediaType });
  return resource;
}

function buildPicXml(
  attrs: NodeLikeAttrs,
  context: ImageExportContext,
  corePrefix: CorePrefix,
): string | null {
  const resource = ensureImageResourceForAttrs(attrs, context);
  if (!resource) {
    return null;
  }

  const width = pixelToHwpUnit(attrs.width, 320);
  const height = pixelToHwpUnit(attrs.height, 180);
  const centerX = Math.max(1, Math.floor(width / 2));
  const centerY = Math.max(1, Math.floor(height / 2));
  const picId = context.nextPicId++;
  const instId = context.nextInstId++;
  const commentRaw =
    asNonEmptyString(attrs.fileName) ??
    asNonEmptyString(attrs.alt) ??
    asNonEmptyString(attrs.title);
  const shapeComment = commentRaw ? `<hp:shapeComment>${escapeXml(commentRaw)}</hp:shapeComment>` : "";

  return (
    `<hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="SQUARE" textFlow="BOTH_SIDES" lock="0" ` +
    `dropcapstyle="None" href="" groupLevel="0" instid="${instId}" reverse="0">` +
    `<hp:offset x="0" y="0"/>` +
    `<hp:orgSz width="${width}" height="${height}"/>` +
    `<hp:curSz width="${width}" height="${height}"/>` +
    `<hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="${centerX}" centerY="${centerY}" rotateimage="1"/>` +
    `<hp:renderingInfo>` +
    `<${corePrefix}:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `<${corePrefix}:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `<${corePrefix}:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `</hp:renderingInfo>` +
    `<hp:imgRect>` +
    `<${corePrefix}:pt0 x="0" y="0"/>` +
    `<${corePrefix}:pt1 x="${width}" y="0"/>` +
    `<${corePrefix}:pt2 x="${width}" y="${height}"/>` +
    `<${corePrefix}:pt3 x="0" y="${height}"/>` +
    `</hp:imgRect>` +
    `<hp:imgClip left="0" right="${width}" top="0" bottom="${height}"/>` +
    `<hp:effects/>` +
    `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:imgDim dimwidth="${width}" dimheight="${height}"/>` +
    `<${corePrefix}:img binaryItemIDRef="${resource.id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
    `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    shapeComment +
    `</hp:pic>`
  );
}

function saveImageManifest(context: ImageExportContext): void {
  if (!context.manifestDirty || !context.manifestDoc) {
    return;
  }
  context.zip.file(CONTENT_HPF_FILE, new XMLSerializer().serializeToString(context.manifestDoc));
}

function uniqueWarnings(items: string[]): string[] {
  return Array.from(new Set(items));
}

const SUPPORTED_EXPORT_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "hardBreak",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

const SUPPORTED_EXPORT_MARK_TYPES = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "highlight",
  "textStyle",
  "superscript",
  "subscript",
]);

export function collectExportCompatibilityWarnings(doc: JSONContent): string[] {
  const unsupportedNodeCounts = new Map<string, number>();
  const unsupportedMarkCounts = new Map<string, number>();

  walk(doc, (node) => {
    if (!SUPPORTED_EXPORT_NODE_TYPES.has(node.type)) {
      unsupportedNodeCounts.set(node.type, (unsupportedNodeCounts.get(node.type) ?? 0) + 1);
    }
    if (node.marks?.length) {
      for (const mark of node.marks) {
        const markType = mark.type || "unknown";
        if (!SUPPORTED_EXPORT_MARK_TYPES.has(markType)) {
          unsupportedMarkCounts.set(markType, (unsupportedMarkCounts.get(markType) ?? 0) + 1);
        }
      }
    }
  });

  const warnings: string[] = [];
  for (const [nodeType, count] of unsupportedNodeCounts.entries()) {
    warnings.push(
      `지원되지 않는 객체 노드(${nodeType}) ${count}개는 HWPX 내보내기에서 보존되지 않을 수 있습니다.`,
    );
  }
  for (const [markType, count] of unsupportedMarkCounts.entries()) {
    warnings.push(
      `지원되지 않는 글자 표식(${markType}) ${count}개는 HWPX 서식으로 변환되지 않을 수 있습니다.`,
    );
  }
  return uniqueWarnings(warnings);
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
  return (rowNode.content || []).filter(
    (child) => child.type === "tableCell" || child.type === "tableHeader",
  );
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

    // tableId가 있는 표는 내용 변경(fill_table_rows 등)도 반영해야 하므로 항상 패치 생성.
    // structureChanged는 경고 목적으로만 유지.
    void structureChanged;

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

/** Read paraPr values from a <hh:paraPr> element. */
function readParaPrValues(paraPrEl: Element): Required<Omit<ParaPrAttrs, "hwpxParaPrId">> {
  const descendants = Array.from(paraPrEl.getElementsByTagName("*"));

  const alignEl = descendants.find((c) => c.localName === "align");
  const hwpxAlign = (alignEl?.getAttribute("horizontal") ?? "JUSTIFY").toUpperCase();

  const lsEl = descendants.find((c) => c.localName === "lineSpacing");
  let hwpxLineSpacing = 160;
  if (lsEl) {
    const type = (lsEl.getAttribute("type") ?? "").toUpperCase();
    if (type === "PERCENT") {
      const val = Number.parseInt(lsEl.getAttribute("value") ?? "160", 10);
      if (Number.isFinite(val) && val > 0) hwpxLineSpacing = val;
    }
  }

  const marginEl = descendants.find((c) => c.localName === "margin");
  let hwpxLeftIndent = 0;
  let hwpxRightIndent = 0;
  let hwpxFirstLineIndent = 0;
  let hwpxSpaceBefore = 0;
  let hwpxSpaceAfter = 0;
  if (marginEl) {
    for (const child of Array.from(marginEl.children)) {
      const val = Number.parseInt(child.getAttribute("value") ?? "0", 10);
      if (!Number.isFinite(val)) continue;
      switch (child.localName) {
        case "left":   hwpxLeftIndent = val;      break;
        case "right":  hwpxRightIndent = val;     break;
        case "intent":
        case "indent": hwpxFirstLineIndent = val; break;
        case "prev":   hwpxSpaceBefore = val;     break;
        case "next":   hwpxSpaceAfter = val;      break;
      }
    }
  }

  return { hwpxAlign, hwpxLineSpacing, hwpxLeftIndent, hwpxRightIndent, hwpxFirstLineIndent, hwpxSpaceBefore, hwpxSpaceAfter };
}

/** Update paraPr fields in a cloned <hh:paraPr> element. */
function updateParaPrElement(paraPrEl: Element, attrs: ParaPrAttrs): void {
  const descendants = Array.from(paraPrEl.getElementsByTagName("*"));

  if (attrs.hwpxAlign != null) {
    const alignEl = descendants.find((c) => c.localName === "align");
    if (alignEl) alignEl.setAttribute("horizontal", attrs.hwpxAlign);
  }

  if (attrs.hwpxLineSpacing != null) {
    const lsEl = descendants.find((c) => c.localName === "lineSpacing");
    if (lsEl) lsEl.setAttribute("value", String(attrs.hwpxLineSpacing));
  }

  const marginEl = descendants.find((c) => c.localName === "margin");
  if (marginEl) {
    for (const child of Array.from(marginEl.children)) {
      switch (child.localName) {
        case "left":   if (attrs.hwpxLeftIndent != null) child.setAttribute("value", String(attrs.hwpxLeftIndent)); break;
        case "right":  if (attrs.hwpxRightIndent != null) child.setAttribute("value", String(attrs.hwpxRightIndent)); break;
        case "intent":
        case "indent": if (attrs.hwpxFirstLineIndent != null) child.setAttribute("value", String(attrs.hwpxFirstLineIndent)); break;
        case "prev":   if (attrs.hwpxSpaceBefore != null) child.setAttribute("value", String(attrs.hwpxSpaceBefore)); break;
        case "next":   if (attrs.hwpxSpaceAfter != null) child.setAttribute("value", String(attrs.hwpxSpaceAfter)); break;
      }
    }
  }
}

/**
 * Ensure a paraPr element exists for the given attrs.
 * If the desired values match the original paraPr, returns the original ID.
 * Otherwise clones the original, updates it, appends it to container, returns new ID.
 */
function ensureParaPrForAttrs(params: {
  paraPrContainer: Element;
  paraPrById: Map<string, Element>;
  paraPrCache: Map<string, string>;
  nextParaPrId: { value: number };
  sourceParaPrId: string;
  attrs: ParaPrAttrs;
}): string {
  const { paraPrContainer, paraPrById, paraPrCache, nextParaPrId, sourceParaPrId, attrs } = params;

  const sourceEl = paraPrById.get(sourceParaPrId);
  if (!sourceEl) return sourceParaPrId;

  const original = readParaPrValues(sourceEl);

  // Resolve desired values (fall back to original if attr is null/undefined)
  const desired: Required<Omit<ParaPrAttrs, "hwpxParaPrId">> = {
    hwpxAlign:          attrs.hwpxAlign          ?? original.hwpxAlign,
    hwpxLineSpacing:    attrs.hwpxLineSpacing     ?? original.hwpxLineSpacing,
    hwpxLeftIndent:     attrs.hwpxLeftIndent      ?? original.hwpxLeftIndent,
    hwpxRightIndent:    attrs.hwpxRightIndent     ?? original.hwpxRightIndent,
    hwpxFirstLineIndent: attrs.hwpxFirstLineIndent ?? original.hwpxFirstLineIndent,
    hwpxSpaceBefore:    attrs.hwpxSpaceBefore     ?? original.hwpxSpaceBefore,
    hwpxSpaceAfter:     attrs.hwpxSpaceAfter      ?? original.hwpxSpaceAfter,
  };

  // Check if anything changed
  const changed =
    desired.hwpxAlign          !== original.hwpxAlign          ||
    desired.hwpxLineSpacing    !== original.hwpxLineSpacing     ||
    desired.hwpxLeftIndent     !== original.hwpxLeftIndent      ||
    desired.hwpxRightIndent    !== original.hwpxRightIndent     ||
    desired.hwpxFirstLineIndent !== original.hwpxFirstLineIndent ||
    desired.hwpxSpaceBefore    !== original.hwpxSpaceBefore     ||
    desired.hwpxSpaceAfter     !== original.hwpxSpaceAfter;

  if (!changed) return sourceParaPrId;

  const cacheKey = `${sourceParaPrId}::${desired.hwpxAlign}::${desired.hwpxLineSpacing}::${desired.hwpxLeftIndent}::${desired.hwpxRightIndent}::${desired.hwpxFirstLineIndent}::${desired.hwpxSpaceBefore}::${desired.hwpxSpaceAfter}`;
  if (paraPrCache.has(cacheKey)) return paraPrCache.get(cacheKey)!;

  const cloned = sourceEl.cloneNode(true) as Element;
  const newId = String(nextParaPrId.value++);
  cloned.setAttribute("id", newId);
  updateParaPrElement(cloned, desired);
  paraPrContainer.appendChild(cloned);
  paraPrById.set(newId, cloned);
  paraPrCache.set(cacheKey, newId);
  return newId;
}

/** Patch paraPrIDRef attribute in a paraXml string. */
function patchParaPrIDRef(paraXml: string, newParaPrIDRef: string): string {
  return paraXml.replace(/\bparaPrIDRef="[^"]*"/, `paraPrIDRef="${newParaPrIDRef}"`);
}

/** Patch styleIDRef attribute in a paraXml string. */
function patchStyleIDRef(paraXml: string, newStyleIDRef: string): string {
  return paraXml.replace(/\bstyleIDRef="[^"]*"/, `styleIDRef="${newStyleIDRef}"`);
}

function readParaStyleIDRef(paraXml: string): string | null {
  const match = paraXml.match(/\bstyleIDRef="([^"]+)"/);
  return match?.[1] ?? null;
}

function patchParaRefs(
  paraXml: string,
  refs: { paraPrIDRef?: string; styleIDRef?: string },
): string {
  let next = paraXml;
  if (refs.paraPrIDRef) {
    next = patchParaPrIDRef(next, refs.paraPrIDRef);
  }
  if (refs.styleIDRef) {
    next = patchStyleIDRef(next, refs.styleIDRef);
  }
  return next;
}

function readParaXmlId(paraXml: string): string | null {
  const match = paraXml.match(/<\s*(?:[A-Za-z0-9]+:)?p\b[^>]*\sid="([^"]+)"/);
  return match?.[1] ?? null;
}

function patchParaXmlId(paraXml: string, paraXmlId: string): string {
  if (/<\s*(?:[A-Za-z0-9]+:)?p\b[^>]*\sid="[^"]+"/.test(paraXml)) {
    return paraXml.replace(
      /(<\s*(?:[A-Za-z0-9]+:)?p\b[^>]*?)\sid="[^"]+"/,
      `$1 id="${paraXmlId}"`,
    );
  }
  return paraXml.replace(
    /<\s*((?:[A-Za-z0-9]+:)?p)\b/,
    `<$1 id="${paraXmlId}"`,
  );
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

// ── Para-snapshot round-trip helpers ─────────────────────────────────────────

/**
 * paraId → ProseMirror JSONContent 노드 맵 (marks 정보 포함).
 */
function buildParaIdNodeMap(doc: JSONContent): Map<string, JSONContent> {
  const result = new Map<string, JSONContent>();
  for (const node of getTopLevelTextBlocks(doc)) {
    const paraId = ((node.attrs || {}) as { paraId?: string }).paraId;
    if (paraId) {
      result.set(paraId, node);
    }
  }
  return result;
}

/**
 * ProseMirror doc의 모든 텍스트 블록을 문서 순서대로 반환.
 * paraId가 없는 (사용자가 새로 추가한) 블록은 paraId: null로 반환.
 */
function buildOrderedDocNodes(
  doc: JSONContent,
): Array<{ paraId: string | null; node: JSONContent }> {
  const result: Array<{ paraId: string | null; node: JSONContent }> = [];
  for (const node of getTopLevelTextBlocks(doc)) {
    const paraId = ((node.attrs || {}) as { paraId?: string }).paraId ?? null;
    result.push({ paraId, node });
  }
  return result;
}

/**
 * paraId가 없는 (새로 추가된) 단락에서 최소한의 <hp:p> XML을 생성.
 * marks가 있으면 ensureCharPrForMarks로 charPr 동적 생성.
 */
function buildOrphanParaXml(
  node: JSONContent,
  paraXmlId: string,
  defaultParaPrIDRef: string,
  styleIDRef: string,
  defaultCharPrIDRef: string,
  charPropertiesEl: Element | null,
  charPrById: Map<string, Element>,
  charPrCache: Map<string, string>,
  nextCharPrId: { value: number },
  headerDoc: Document | null,
  imageContext: ImageExportContext | null,
  corePrefix: CorePrefix,
): string {
  const nodeAttrs = (node.attrs ?? {}) as ParaPrAttrs;
  const paraPrIDRef = nodeAttrs.hwpxParaPrId ?? defaultParaPrIDRef;
  const pieces = splitRunContentPieces(node.content ?? []);
  const runXmls = buildRunXmlsFromContentPieces({
    pieces,
    baseCharPrId: defaultCharPrIDRef,
    charPropertiesEl,
    charPrById,
    charPrCache,
    nextCharPrId,
    headerDoc,
    imageContext,
    corePrefix,
  });

  return (
    `<hp:p id="${paraXmlId}" paraPrIDRef="${paraPrIDRef}" styleIDRef="${styleIDRef}" pageBreak="0" columnBreak="0" merged="0">` +
    runXmls.join("") +
    `<hp:linesegarray/>` +
    `</hp:p>`
  );
}

function splitRunContentPieces(content: JSONContent[]): RunContentPiece[] {
  const pieces: RunContentPiece[] = [];
  let currentText: { text: string; marks: JSONContent["marks"] } | null = null;
  let currentFingerprint: string | null = null;

  const flushText = () => {
    if (!currentText || !currentText.text) {
      return;
    }
    pieces.push({
      kind: "text",
      text: currentText.text,
      marks: currentText.marks,
    });
    currentText = null;
    currentFingerprint = null;
  };

  for (const node of content) {
    if (node.type === "image") {
      flushText();
      pieces.push({
        kind: "image",
        attrs: (node.attrs ?? {}) as NodeLikeAttrs,
      });
      continue;
    }

    let text = "";
    if (node.type === "text") {
      text = node.text ?? "";
    } else if (node.type === "hardBreak") {
      text = "\n";
    } else {
      continue;
    }
    if (!text) {
      continue;
    }

    const fp = markFingerprint(node.marks);
    if (currentText && currentFingerprint === fp) {
      currentText.text += text;
      continue;
    }
    flushText();
    currentText = { text, marks: node.marks };
    currentFingerprint = fp;
  }

  flushText();
  return pieces;
}

function buildRunXmlsFromContentPieces(params: {
  pieces: RunContentPiece[];
  baseCharPrId: string;
  charPropertiesEl: Element | null;
  charPrById: Map<string, Element>;
  charPrCache: Map<string, string>;
  nextCharPrId: { value: number };
  headerDoc: Document | null;
  imageContext: ImageExportContext | null;
  corePrefix: CorePrefix;
}): string[] {
  const {
    pieces,
    baseCharPrId,
    charPropertiesEl,
    charPrById,
    charPrCache,
    nextCharPrId,
    headerDoc,
    imageContext,
    corePrefix,
  } = params;

  const runXmls: string[] = [];
  for (const piece of pieces) {
    if (piece.kind === "image") {
      if (!imageContext) {
        continue;
      }
      const picXml = buildPicXml(piece.attrs, imageContext, corePrefix);
      if (!picXml) {
        continue;
      }
      runXmls.push(`<hp:run charPrIDRef="${baseCharPrId}">${picXml}</hp:run>`);
      continue;
    }

    let charPrId = baseCharPrId;
    if (charPropertiesEl && headerDoc && piece.marks?.length) {
      charPrId = ensureCharPrForMarks({
        charPropertiesEl,
        charPrById,
        charPrCache,
        nextCharPrId,
        baseCharPrId,
        marks: piece.marks,
        headerDoc,
      });
    }
    runXmls.push(`<hp:run charPrIDRef="${charPrId}"><hp:t>${escapeXml(piece.text)}</hp:t></hp:run>`);
  }

  if (!runXmls.length) {
    runXmls.push(`<hp:run charPrIDRef="${baseCharPrId}"><hp:t></hp:t></hp:run>`);
  }
  return runXmls;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * raw paraXml 문자열에서 linesegarray 요소를 그대로 추출.
 * XMLSerializer 경유 시 namespace prefix가 변환되는 문제를 방지.
 */
function extractLinesegXmlFromRaw(paraXml: string): string {
  const openIdx = paraXml.search(/<[a-zA-Z0-9]*:?linesegarray[\s>\/]/);
  if (openIdx === -1) return "<hp:linesegarray/>";
  const tagNameMatch = paraXml.slice(openIdx + 1).match(/^([a-zA-Z0-9]*:?linesegarray)/);
  if (!tagNameMatch) return "<hp:linesegarray/>";
  const tagName = tagNameMatch[1];
  // self-closing?
  const afterOpen = paraXml.indexOf(">", openIdx);
  if (afterOpen !== -1 && paraXml[afterOpen - 1] === "/") {
    return paraXml.slice(openIdx, afterOpen + 1);
  }
  const closeTag = `</${tagName}>`;
  const closeIdx = paraXml.indexOf(closeTag, openIdx);
  if (closeIdx === -1) return "<hp:linesegarray/>";
  return paraXml.slice(openIdx, closeIdx + closeTag.length);
}

/**
 * para.paraXml 구조를 보존하며 멀티런 <hp:p>를 재생성.
 *   - paraPrIDRef, styleIDRef, linesegarray 등 구조 요소 원본 보존
 *   - ProseMirror content의 mark 조합별로 <hp:run> 분리
 *   - 각 run의 charPrIDRef는 ensureCharPrForMarks로 동적 조회/생성
 */
function rebuildParaXmlWithMarks(
  para: { paraXml: string; runs: HwpxRun[] },
  node: JSONContent,
  charPropertiesEl: Element | null,
  charPrById: Map<string, Element>,
  charPrCache: Map<string, string>,
  nextCharPrId: { value: number },
  headerDoc: Document | null,
  imageContext: ImageExportContext | null,
  corePrefix: CorePrefix,
  newParaPrIDRef?: string,
  newStyleIDRef?: string,
): string {
  // 기준 charPrId: 볼드/이탤릭이 없는 run의 charPrId를 우선 사용.
  // runs[0]이 bold인 경우, 마크가 없는 텍스트 청크에 bold charPr가 잘못 적용되는 것을 방지.
  const baseCharPrId = (() => {
    for (const run of para.runs) {
      const el = charPrById.get(run.charPrIDRef);
      if (el) {
        const hasBold = Array.from(el.children).some((c) => c.localName === "bold");
        const hasItalic = Array.from(el.children).some((c) => c.localName === "italic");
        if (!hasBold && !hasItalic) return run.charPrIDRef;
      }
    }
    return para.runs[0]?.charPrIDRef ?? "0";
  })();
  const pieces = splitRunContentPieces(node.content ?? []);

  // 기존 paraXml에서 구조 속성 추출 (DOMParser)
  const paraDoc = new DOMParser().parseFromString(para.paraXml, "text/xml");
  const paraEl = paraDoc.documentElement;
  const paraPrIDRef = newParaPrIDRef ?? paraEl.getAttribute("paraPrIDRef") ?? "0";
  const styleIDRef = newStyleIDRef ?? paraEl.getAttribute("styleIDRef") ?? "0";
  const pageBreak = paraEl.getAttribute("pageBreak") ?? "0";
  const columnBreak = paraEl.getAttribute("columnBreak") ?? "0";
  const merged = paraEl.getAttribute("merged") ?? "0";

  // linesegarray: DOM 왕복 없이 raw 문자열에서 직접 추출
  // (XMLSerializer가 hp: prefix를 ns1: 등으로 바꿔 XML이 깨지는 문제 방지)
  const linesegXml = extractLinesegXmlFromRaw(para.paraXml);

  const runXmls = buildRunXmlsFromContentPieces({
    pieces,
    baseCharPrId,
    charPropertiesEl,
    charPrById,
    charPrCache,
    nextCharPrId,
    headerDoc,
    imageContext,
    corePrefix,
  });

  // id 속성: 원본에서 보존, 합성 문단(없는 경우)은 생략
  const originalId = paraEl.getAttribute("id");
  const idAttr = originalId ? ` id="${originalId}"` : "";

  return (
    `<hp:p${idAttr} paraPrIDRef="${paraPrIDRef}" styleIDRef="${styleIDRef}" ` +
    `pageBreak="${pageBreak}" columnBreak="${columnBreak}" merged="${merged}">` +
    runXmls.join("") +
    linesegXml +
    `</hp:p>`
  );
}

/**
 * HwpxDocumentModel에 존재하지만 현재 doc에 없는 hasContent=true 문단 paraId Set.
 * "삭제됨" 기준: 파싱 시 존재했던 non-empty 문단이 doc에서 사라진 경우.
 */
function buildDeletedParaIds(doc: JSONContent, model: HwpxDocumentModel): Set<string> {
  const presentParaIds = new Set<string>();
  for (const node of getTopLevelTextBlocks(doc)) {
    const paraId = ((node.attrs || {}) as { paraId?: string }).paraId;
    if (paraId) {
      presentParaIds.add(paraId);
    }
  }
  const deleted = new Set<string>();
  for (const section of model.sections) {
    for (const block of section.blocks) {
      if (block.type !== "para") continue;
      const para = model.paraStore.get(block.paraId);
      if (para?.hasContent && !presentParaIds.has(block.paraId)) {
        deleted.add(block.paraId);
      }
    }
  }
  return deleted;
}

/**
 * 다중 런 문단에서 편집된 텍스트를 원래 런 경계로 분배.
 *
 * 각 런의 원본 텍스트가 currentText 안에 순서대로 나타나면 런 경계 유지.
 * 그렇지 않으면(크게 달라진 경우) 런[0]에 전체 텍스트, 나머지 공백화.
 *
 * 예시: runs=["Hello ", "World", " bye"], currentText="Hello World there"
 *   → "Hello " 발견(pos 0), "World" 발견(pos 6), 마지막 런=" there" → 유지
 */
function distributeTextAcrossRuns(currentText: string, runs: HwpxRun[]): Map<number, string> {
  const result = new Map<number, string>();
  if (runs.length === 1) {
    result.set(0, currentText);
    return result;
  }

  let cursor = 0;
  const distribution: string[] = [];
  let valid = true;

  for (let i = 0; i < runs.length; i++) {
    if (i === runs.length - 1) {
      // 마지막 런: 나머지 전체
      distribution.push(currentText.slice(cursor));
      break;
    }
    const runText = runs[i].text;
    if (!runText) {
      // 빈 런은 그대로 빈 문자열
      distribution.push("");
      continue;
    }
    const idx = currentText.indexOf(runText, cursor);
    if (idx === -1) {
      valid = false;
      break;
    }
    distribution.push(runText);
    cursor = idx + runText.length;
  }

  if (!valid) {
    // 폴백: 런[0]에 전체, 나머지 공백화
    result.set(0, currentText);
    for (let i = 1; i < runs.length; i++) result.set(i, "");
    return result;
  }

  for (let i = 0; i < distribution.length; i++) result.set(i, distribution[i]);
  return result;
}

/**
 * 하나의 paraXml 안의 텍스트 노드들을 현재 텍스트로 교체.
 * 다중 런이면 distributeTextAcrossRuns로 원래 런 경계 유지 시도.
 */
function applyLocalTextPatch(
  paraXml: string,
  runs: HwpxRun[],
  currentText: string,
): string {
  const segments = scanXmlTextSegments(paraXml);
  if (segments.length === 0) return paraXml;

  const patchMap = new Map<number, string>();

  if (runs.length > 1 && segments.length === runs.length) {
    // 다중 런 — 런 경계 유지 시도
    const distribution = distributeTextAcrossRuns(currentText, runs);
    for (const [localIdx, text] of distribution) {
      if (localIdx < segments.length) {
        patchMap.set(segments[localIdx].textIndex, text);
      }
    }
  } else {
    // 단일 런 또는 세그먼트 수 불일치 → 런[0]에 전체
    patchMap.set(segments[0].textIndex, currentText);
    for (let i = 1; i < segments.length; i++) {
      patchMap.set(segments[i].textIndex, "");
    }
  }

  return applyEditsToXmlText(paraXml, patchMap);
}

// ─────────────────────────────────────────────────────────────────────────────

export function collectDocumentEdits(
  doc: JSONContent,
  sourceSegments: EditorSegment[],
  extraSegmentsMap?: Record<string, string[]>,
): CollectEditsResult {
  const bySegmentId = new Map(sourceSegments.map((segment) => [segment.segmentId, segment]));
  const edits: TextEdit[] = [];
  const warnings: string[] = collectExportCompatibilityWarnings(doc);

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
  hwpxDocumentModel?: HwpxDocumentModel | null,
): Promise<{ blob: Blob; edits: TextEdit[]; warnings: string[]; integrityIssues: string[] }> {
  // ── 새 para-snapshot 조립 경로 (hwpxDocumentModel 있을 때) ────────────────
  if (hwpxDocumentModel) {
    const paraNodeIndex = buildParaIdNodeMap(doc);
    const deletedParaIds = buildDeletedParaIds(doc, hwpxDocumentModel);
    const warnings: string[] = collectExportCompatibilityWarnings(doc);

    // baseBuffer: HWPX 원본 또는 템플릿 ZIP (DOCX/PPTX 변환 시 base.hwpx)
    const zip = await JSZip.loadAsync(hwpxDocumentModel.baseBuffer);
    const imageContext = await createImageExportContext(zip, warnings);

    // ── marks 지원을 위한 header.xml charPr 동적 관리 준비 ──
    const headerFile = zip.files[HEADER_FILE];
    let charPropertiesEl: Element | null = null;
    const charPrById: Map<string, Element> = new Map();
    const charPrCache: Map<string, string> = new Map();
    let nextCharPrId = { value: 41 }; // base.hwpx 기준 maxId(40) + 1
    let headerDoc: Document | null = null;
    let headingStyleContext: HeadingStyleContext = {
      headingLevelByStyleId: new Map(),
      styleIdByHeadingLevel: new Map(),
      defaultParagraphStyleId: "0",
    };
    // paraPr 동적 관리
    let paraPrContainer: Element | null = null;
    const paraPrById: Map<string, Element> = new Map();
    const paraPrCache: Map<string, string> = new Map();
    let nextParaPrId = { value: 1 };

    if (headerFile && !headerFile.dir) {
      const rawHeaderXml = await headerFile.async("string");
      const parsed = new DOMParser().parseFromString(rawHeaderXml, "application/xml");
      if (!parsed.querySelector("parsererror")) {
        headerDoc = parsed;
        headingStyleContext = extractHeadingStyleContext(headerDoc);
        charPropertiesEl =
          Array.from(headerDoc.getElementsByTagName("*")).find(
            (n) => n.localName === "charProperties",
          ) ?? null;
        if (charPropertiesEl) {
          let maxId = 0;
          for (const cp of Array.from(charPropertiesEl.children).filter(
            (c) => c.localName === "charPr",
          )) {
            const id = cp.getAttribute("id");
            if (!id) continue;
            charPrById.set(id, cp);
            const parsed2 = asInt(id);
            if (parsed2 !== null) maxId = Math.max(maxId, parsed2);
          }
          nextCharPrId = { value: maxId + 1 };
        }
        // paraPr 컨테이너 및 맵 초기화
        const firstParaPr = Array.from(headerDoc.getElementsByTagName("*")).find(
          (n) => n.localName === "paraPr",
        );
        paraPrContainer = firstParaPr?.parentElement ?? null;
        if (paraPrContainer) {
          let maxParaPrId = 0;
          for (const pp of Array.from(paraPrContainer.children).filter(
            (c) => c.localName === "paraPr",
          )) {
            const id = pp.getAttribute("id");
            if (!id) continue;
            paraPrById.set(id, pp);
            const parsed3 = asInt(id);
            if (parsed3 !== null) maxParaPrId = Math.max(maxParaPrId, parsed3);
          }
          nextParaPrId = { value: maxParaPrId + 1 };
        }
      }
    }

    // 새로 추가된 (orphan) 단락 주입을 위한 준비
    // orphan = paraId가 없는 ProseMirror 노드 (사용자가 직접 입력한 새 문단)
    const defaultOrphanCharPrIDRef =
      charPrById.size > 0
        ? [...charPrById.keys()].sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0))[0]
        : "0";
    const knownParaIds = new Set<string>();
    for (const section of hwpxDocumentModel.sections) {
      for (const block of section.blocks) {
        if (block.type === "para") {
          knownParaIds.add(block.paraId);
        }
      }
    }
    const orderedDocNodes = buildOrderedDocNodes(doc).map(({ paraId, node }) => ({
      // 모델에 존재하지 않는 paraId는 orphan으로 강등해 저장 누락을 방지한다.
      paraId: paraId && knownParaIds.has(paraId) ? paraId : null,
      node,
    }));
    const paraIdToDocIdx = new Map<string, number>();
    for (let i = 0; i < orderedDocNodes.length; i++) {
      const { paraId } = orderedDocNodes[i];
      if (paraId !== null) paraIdToDocIdx.set(paraId, i);
    }

    for (const section of hwpxDocumentModel.sections) {
      const sectionNs = ensureCoreNamespaceOnSectionPrefix(section.xmlPrefix);
      const sectionCorePrefix = sectionNs.corePrefix;
      let sectionXml = sectionNs.sectionPrefixXml;
      let lastDocIdx = -1; // 마지막으로 처리된 doc 노드 인덱스
      const usedParaXmlIds = new Set<number>();
      for (const block of section.blocks) {
        if (block.type !== "para") continue;
        const para = hwpxDocumentModel.paraStore.get(block.paraId);
        if (!para) continue;
        const paraXmlId = readParaXmlId(para.paraXml);
        const parsed = asInt(paraXmlId);
        if (parsed !== null && parsed >= 0) {
          usedParaXmlIds.add(parsed);
        }
      }
      let nextParaXmlId = usedParaXmlIds.size > 0 ? Math.max(...usedParaXmlIds) + 1 : 1;
      const allocateParaXmlId = (): string => {
        while (usedParaXmlIds.has(nextParaXmlId)) {
          nextParaXmlId += 1;
        }
        const chosen = nextParaXmlId;
        usedParaXmlIds.add(chosen);
        nextParaXmlId += 1;
        return String(chosen);
      };

      for (const block of section.blocks) {
        sectionXml += block.leadingWhitespace;

        if (block.type === "raw") {
          sectionXml += block.xml;
          continue;
        }

        const currDocIdx = paraIdToDocIdx.get(block.paraId) ?? -1;

        // 이 block 이전에 위치하는 orphan 단락들 주입 (사용자가 새로 추가한 문단)
        if (currDocIdx > lastDocIdx) {
          for (let j = lastDocIdx + 1; j < currDocIdx; j++) {
            const { paraId: oId, node: oNode } = orderedDocNodes[j];
            if (oId !== null) continue;
            const orphanStyleIDRef = resolveStyleIDRefForNode(oNode, null, headingStyleContext);
            sectionXml += buildOrphanParaXml(
              oNode, allocateParaXmlId(), "0", orphanStyleIDRef, defaultOrphanCharPrIDRef,
              charPropertiesEl, charPrById, charPrCache, nextCharPrId, headerDoc, imageContext, sectionCorePrefix,
            );
          }
          lastDocIdx = currDocIdx;
        }

        const para = hwpxDocumentModel.paraStore.get(block.paraId);
        if (!para) {
          warnings.push(`paraId ${block.paraId}의 XML을 찾지 못해 건너뜁니다.`);
          continue;
        }

        // 빈 구조 문단 (원본 소스, 내용 없음 = 테이블 래퍼 등) → 항상 verbatim
        if (!para.hasContent && !para.isSynthesized) {
          sectionXml += para.paraXml;
          continue;
        }

        // 삭제된 문단 → 출력 생략
        if (deletedParaIds.has(block.paraId)) {
          continue;
        }

        const currentNode = paraNodeIndex.get(block.paraId);
        if (currentNode === undefined) {
          // doc에 없는 문단 → 삭제로 처리
          continue;
        }

        // paraPr 변경 여부 확인 및 새 paraPrIDRef 결정
        let newParaPrIDRef: string | undefined;
        if (headerDoc && paraPrContainer) {
          const nodeAttrs = (currentNode.attrs ?? {}) as ParaPrAttrs;
          const sourceParaPrId = nodeAttrs.hwpxParaPrId;
          if (sourceParaPrId && paraPrById.has(sourceParaPrId)) {
            newParaPrIDRef = ensureParaPrForAttrs({
              paraPrContainer,
              paraPrById,
              paraPrCache,
              nextParaPrId,
              sourceParaPrId,
              attrs: nodeAttrs,
            });
          }
        }
        const currentStyleIDRef = readParaStyleIDRef(para.paraXml);
        const newStyleIDRef = resolveStyleIDRefForNode(
          currentNode,
          currentStyleIDRef,
          headingStyleContext,
        );
        const styleChanged = newStyleIDRef !== (currentStyleIDRef ?? "0");

        // marks가 있으면 멀티런 재생성, 없으면 기존 텍스트 패치 경로
        const hasMarks = (currentNode.content ?? []).some(
          (n) => n.marks && n.marks.length > 0,
        );
        const hasImage = (currentNode.content ?? []).some((n) => n.type === "image");

        if ((hasMarks && charPropertiesEl && headerDoc) || hasImage) {
          let rebuilt = rebuildParaXmlWithMarks(
            para,
            currentNode,
            charPropertiesEl,
            charPrById,
            charPrCache,
            nextCharPrId,
            headerDoc,
            imageContext,
            sectionCorePrefix,
            newParaPrIDRef,
            newStyleIDRef,
          );
          if (para.isSynthesized || !readParaXmlId(rebuilt)) {
            rebuilt = patchParaXmlId(rebuilt, allocateParaXmlId());
          }
          sectionXml += rebuilt;
        } else {
          const currentText = extractNodeText(currentNode);
          const originalText = para.runs.map((r) => r.text).join("");
          if (currentText === originalText && !para.isSynthesized && !newParaPrIDRef && !styleChanged) {
            sectionXml += para.paraXml;
          } else if (currentText === originalText && !para.isSynthesized) {
            sectionXml += patchParaRefs(para.paraXml, {
              paraPrIDRef: newParaPrIDRef,
              styleIDRef: styleChanged ? newStyleIDRef : undefined,
            });
          } else if (para.isSynthesized) {
            // 합성 문단은 <hp:t></hp:t> (빈 텍스트)를 가져 scanXmlTextSegments가 0을 반환하므로
            // applyLocalTextPatch가 무효화됨 → buildOrphanParaXml로 직접 XML 재생성
            const paraPrIDRef = para.paraXml.match(/paraPrIDRef="([^"]+)"/)?.[1] ?? "0";
            const charPrIDRef = para.runs[0]?.charPrIDRef ?? "0";
            const built = buildOrphanParaXml(
              currentNode, allocateParaXmlId(), paraPrIDRef, newStyleIDRef, charPrIDRef,
              charPropertiesEl, charPrById, charPrCache, nextCharPrId, headerDoc, imageContext, sectionCorePrefix,
            );
            sectionXml += patchParaRefs(built, {
              paraPrIDRef: newParaPrIDRef,
              styleIDRef: styleChanged ? newStyleIDRef : undefined,
            });
          } else {
            const patched = applyLocalTextPatch(para.paraXml, para.runs, currentText);
            sectionXml += patchParaRefs(patched, {
              paraPrIDRef: newParaPrIDRef,
              styleIDRef: styleChanged ? newStyleIDRef : undefined,
            });
          }
        }
      }

      // 마지막 block 이후에 위치하는 orphan 단락들 주입 (문서 끝에 추가된 문단)
      for (let j = lastDocIdx + 1; j < orderedDocNodes.length; j++) {
        const { paraId: oId, node: oNode } = orderedDocNodes[j];
        if (oId !== null) continue;
        const orphanStyleIDRef = resolveStyleIDRefForNode(oNode, null, headingStyleContext);
        sectionXml += buildOrphanParaXml(
          oNode, allocateParaXmlId(), "0", orphanStyleIDRef, defaultOrphanCharPrIDRef,
          charPropertiesEl, charPrById, charPrCache, nextCharPrId, headerDoc, imageContext, sectionCorePrefix,
        );
      }

      sectionXml += section.xmlSuffix;
      zip.file(section.fileName, sectionXml);
    }

    // mark / paraPr로 인해 새 요소가 추가된 경우 header.xml 업데이트
    const headerNeedsUpdate =
      (charPropertiesEl && charPrCache.size > 0) ||
      (paraPrContainer && paraPrCache.size > 0);
    if (headerDoc && headerNeedsUpdate) {
      if (charPropertiesEl && charPrCache.size > 0) {
        const newCount = Array.from(charPropertiesEl.children).filter(
          (c) => c.localName === "charPr",
        ).length;
        charPropertiesEl.setAttribute("itemCnt", String(newCount));
      }
      if (paraPrContainer && paraPrCache.size > 0) {
        const newCount = Array.from(paraPrContainer.children).filter(
          (c) => c.localName === "paraPr",
        ).length;
        paraPrContainer.setAttribute("itemCnt", String(newCount));
      }
      zip.file(HEADER_FILE, new XMLSerializer().serializeToString(headerDoc));
    }
    saveImageManifest(imageContext);

    let workingBuffer = await zip.generateAsync({ type: "arraybuffer" });

    // Phase 2: 테이블 구조 패치 (기존 경로 유지)
    const { patches: tablePatches, warnings: tableWarnings } = collectTablePatches(doc);
    warnings.push(...tableWarnings);
    if (tablePatches.length) {
      const patched = await applyTablePatches(workingBuffer, tablePatches);
      workingBuffer = patched.buffer;
      warnings.push(...patched.warnings);
    }

    // Phase 3: 자간 패치 (HWPX 원본 세그먼트가 있을 때만 — DOCX/PPTX 변환 시 base.hwpx에 charPr 없음)
    const hasHwpxSegments = sourceSegments.some(
      (s) => !s.segmentId.startsWith("pptx::") && !s.segmentId.startsWith("docx::"),
    );
    if (hasHwpxSegments) {
      const { edits: lsEdits, warnings: lsWarnings } = collectLetterSpacingEdits(doc, sourceSegments, extraSegmentsMap);
      warnings.push(...lsWarnings);
      if (lsEdits.length) {
        const patched = await applyLetterSpacingPatches(workingBuffer, lsEdits, sourceSegments);
        workingBuffer = patched.buffer;
        warnings.push(...patched.warnings);
      }
    }

    const integrityIssues = await validateHwpxArchive(workingBuffer);
    return {
      blob: new Blob([workingBuffer], { type: "application/zip" }),
      edits: [], // para-snapshot 경로에서는 TextEdit 대신 파라 스냅숏 사용
      warnings: uniqueWarnings(warnings),
      integrityIssues,
    };
  }

  // ── 기존 byte-offset 패치 경로 (hwpxDocumentModel 없을 때 폴백) ────────────
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
