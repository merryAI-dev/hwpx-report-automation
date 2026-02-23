import JSZip from "jszip";

export type TextNodeRecord = {
  id: string;
  fileName: string;
  textIndex: number;
  text: string;
  tag: string;
  styleHints: Record<string, string>;
};

export type StyleCatalog = Record<string, Record<string, number>>;

export type TextEdit = {
  id: string;
  fileName: string;
  textIndex: number;
  oldText: string;
  newText: string;
};

type XmlSegment = {
  textIndex: number;
  start: number;
  end: number;
  isCdata: boolean;
  text: string;
};

const STYLE_KEYS = ["style", "pridref", "idref", "font", "face", "align"];
const REQUIRED_ENTRIES = ["mimetype", "version.xml", "Contents/content.hpf"];

function getStyleHints(element: Element | null): Record<string, string> {
  if (!element) {
    return {};
  }
  const hints: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    const lower = attr.name.toLowerCase();
    if (STYLE_KEYS.some((token) => lower.includes(token))) {
      hints[attr.name] = attr.value;
    }
  }
  return hints;
}

function isXmlName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".xml");
}

function isWhitespace(value: string): boolean {
  return value.trim().length === 0;
}

function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    const lower = String(entity).toLowerCase();
    if (lower === "amp") {
      return "&";
    }
    if (lower === "lt") {
      return "<";
    }
    if (lower === "gt") {
      return ">";
    }
    if (lower === "quot") {
      return '"';
    }
    if (lower === "apos") {
      return "'";
    }
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sanitizeCdata(value: string): string {
  return value.replaceAll("]]>", "]]]]><![CDATA[>");
}

function scanXmlTextSegments(xmlText: string): XmlSegment[] {
  const segments: XmlSegment[] = [];
  const len = xmlText.length;
  let i = 0;
  let textIndex = 0;

  while (i < len) {
    if (xmlText[i] === "<") {
      if (xmlText.startsWith("<!--", i)) {
        const end = xmlText.indexOf("-->", i + 4);
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (xmlText.startsWith("<![CDATA[", i)) {
        const start = i + 9;
        const endCdata = xmlText.indexOf("]]>", start);
        const end = endCdata === -1 ? len : endCdata;
        const raw = xmlText.slice(start, end);
        if (!isWhitespace(raw)) {
          segments.push({
            textIndex,
            start,
            end,
            isCdata: true,
            text: raw,
          });
        }
        textIndex += 1;
        i = endCdata === -1 ? len : endCdata + 3;
        continue;
      }

      i += 1;
      while (i < len) {
        const ch = xmlText[i];
        if (ch === '"' || ch === "'") {
          const quote = ch;
          i += 1;
          while (i < len && xmlText[i] !== quote) {
            i += 1;
          }
          i += 1;
          continue;
        }
        if (ch === ">") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    const start = i;
    while (i < len && xmlText[i] !== "<") {
      i += 1;
    }
    const end = i;
    const raw = xmlText.slice(start, end);
    const decoded = decodeXmlEntities(raw);
    if (!isWhitespace(decoded)) {
      segments.push({
        textIndex,
        start,
        end,
        isCdata: false,
        text: decoded,
      });
    }
    textIndex += 1;
  }

  return segments;
}

function parseXml(xmlText: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(parseError.textContent || "Invalid XML");
  }
  return doc;
}

function collectStyleHintsByTextIndex(xmlText: string): Map<number, { tag: string; styleHints: Record<string, string> }> {
  const map = new Map<number, { tag: string; styleHints: Record<string, string> }>();
  let doc: Document;
  try {
    doc = parseXml(xmlText);
  } catch {
    return map;
  }

  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  let textIndex = 0;
  while (true) {
    const next = walker.nextNode();
    if (!next) {
      break;
    }
    const textNode = next as Text;
    const value = textNode.nodeValue || "";
    if (!isWhitespace(value)) {
      map.set(textIndex, {
        tag: textNode.parentElement?.tagName || "",
        styleHints: getStyleHints(textNode.parentElement),
      });
    }
    textIndex += 1;
  }
  return map;
}

function applyEditsToXmlText(xmlText: string, patchMap: Map<number, string>): string {
  if (!patchMap.size) {
    return xmlText;
  }
  const segments = scanXmlTextSegments(xmlText);
  if (!segments.length) {
    return xmlText;
  }

  let cursor = 0;
  let out = "";
  let changed = false;
  for (const seg of segments) {
    if (!patchMap.has(seg.textIndex)) {
      continue;
    }
    const value = patchMap.get(seg.textIndex) || "";
    const replacement = seg.isCdata ? sanitizeCdata(value) : escapeXml(value);
    out += xmlText.slice(cursor, seg.start);
    out += replacement;
    cursor = seg.end;
    changed = true;
  }
  if (!changed) {
    return xmlText;
  }
  out += xmlText.slice(cursor);
  return out;
}

type RepackItem = {
  fileName: string;
  data: string | Uint8Array;
};

async function repackHwpx(entries: RepackItem[]): Promise<Blob> {
  const out = new JSZip();
  const map = new Map(entries.map((entry) => [entry.fileName, entry]));
  const ordered: RepackItem[] = [];

  if (map.has("mimetype")) {
    ordered.push(map.get("mimetype")!);
    map.delete("mimetype");
  }
  for (const entry of entries) {
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
  return out.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/zip",
  });
}

export async function validateHwpxArchive(fileBuffer: ArrayBuffer): Promise<string[]> {
  const issues: string[] = [];
  const zip = await JSZip.loadAsync(fileBuffer);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  for (const required of REQUIRED_ENTRIES) {
    if (!zip.files[required]) {
      issues.push(`필수 엔트리 누락: ${required}`);
    }
  }

  const firstEntry = names[0] || "";
  if (firstEntry && firstEntry !== "mimetype") {
    issues.push(`첫 엔트리가 mimetype이 아님: ${firstEntry}`);
  }
  if (zip.files["mimetype"]) {
    const mime = (await zip.files["mimetype"].async("string")).trim();
    if (!mime) {
      issues.push("mimetype 파일이 비어 있음");
    }
  }

  let xmlCount = 0;
  for (const name of names) {
    if (!isXmlName(name)) {
      continue;
    }
    xmlCount += 1;
    const xmlText = await zip.files[name].async("string");
    try {
      parseXml(xmlText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "파싱 실패";
      issues.push(`XML 파싱 실패: ${name} (${message})`);
    }
  }
  if (xmlCount === 0) {
    issues.push("XML 엔트리가 없음");
  }
  return issues;
}

export async function inspectHwpx(
  fileBuffer: ArrayBuffer,
): Promise<{ textNodes: TextNodeRecord[]; styleCatalog: StyleCatalog; integrityIssues: string[] }> {
  const zip = await JSZip.loadAsync(fileBuffer);
  const textNodes: TextNodeRecord[] = [];
  const styleCatalog: StyleCatalog = {};

  for (const fileName of Object.keys(zip.files)) {
    const item = zip.files[fileName];
    if (item.dir || !isXmlName(fileName)) {
      continue;
    }
    const xmlText = await item.async("string");
    const segments = scanXmlTextSegments(xmlText);
    const styleMap = collectStyleHintsByTextIndex(xmlText);

    for (const seg of segments) {
      const style = styleMap.get(seg.textIndex);
      textNodes.push({
        id: `${fileName}::${seg.textIndex}`,
        fileName,
        textIndex: seg.textIndex,
        text: seg.text,
        tag: style?.tag || "",
        styleHints: style?.styleHints || {},
      });
    }

    try {
      const doc = parseXml(xmlText);
      for (const elem of Array.from(doc.getElementsByTagName("*"))) {
        for (const attr of Array.from(elem.attributes)) {
          const lower = attr.name.toLowerCase();
          if (!STYLE_KEYS.some((token) => lower.includes(token))) {
            continue;
          }
          if (!styleCatalog[attr.name]) {
            styleCatalog[attr.name] = {};
          }
          styleCatalog[attr.name][attr.value] = (styleCatalog[attr.name][attr.value] || 0) + 1;
        }
      }
    } catch {
      continue;
    }
  }

  const integrityIssues = await validateHwpxArchive(fileBuffer);
  return { textNodes, styleCatalog, integrityIssues };
}

export async function applyTextEdits(fileBuffer: ArrayBuffer, edits: TextEdit[]): Promise<Blob> {
  const zip = await JSZip.loadAsync(fileBuffer);
  const names = Object.keys(zip.files);
  const grouped = new Map<string, Map<number, string>>();

  for (const edit of edits) {
    if (!grouped.has(edit.fileName)) {
      grouped.set(edit.fileName, new Map<number, string>());
    }
    grouped.get(edit.fileName)!.set(edit.textIndex, edit.newText);
  }

  const outEntries: RepackItem[] = [];
  for (const fileName of names) {
    const item = zip.files[fileName];
    if (item.dir) {
      continue;
    }
    if (!grouped.has(fileName) || !isXmlName(fileName)) {
      outEntries.push({ fileName, data: await item.async("uint8array") });
      continue;
    }
    const xmlText = await item.async("string");
    const patched = applyEditsToXmlText(xmlText, grouped.get(fileName)!);
    outEntries.push({ fileName, data: patched });
  }

  return repackHwpx(outEntries);
}

export async function applyPlaceholders(
  fileBuffer: ArrayBuffer,
  placeholders: Record<string, string>,
): Promise<Blob> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(placeholders)) {
    normalized[key.trim().toUpperCase()] = String(value);
  }

  const zip = await JSZip.loadAsync(fileBuffer);
  const names = Object.keys(zip.files);
  const outEntries: RepackItem[] = [];
  for (const fileName of names) {
    const item = zip.files[fileName];
    if (item.dir) {
      continue;
    }
    if (!isXmlName(fileName)) {
      outEntries.push({ fileName, data: await item.async("uint8array") });
      continue;
    }
    let xmlText = await item.async("string");
    xmlText = xmlText.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, token) => {
      if (!(token in normalized)) {
        return full;
      }
      return escapeXml(normalized[token]);
    });
    outEntries.push({ fileName, data: xmlText });
  }

  return repackHwpx(outEntries);
}
