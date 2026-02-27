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

export type XmlSegment = {
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

export function scanXmlTextSegments(xmlText: string): XmlSegment[] {
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

export function applyEditsToXmlText(xmlText: string, patchMap: Map<number, string>): string {
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

// ── In-memory document model support ────────────────────────────────────────

/**
 * 섹션 XML 루트의 직계 자식 요소 하나.
 * leadingWhitespace: 이전 블록 end ~ 이 블록 start 사이의 공백/줄바꿈 (포매팅 보존)
 */
export type TopLevelBlock = {
  localName: string; // namespace prefix 제거 후 tagName (e.g. "p", "tbl", "colDef")
  start: number; // xmlText에서 '<'의 char offset
  end: number; // 닫는 태그 '>' 다음 position (exclusive)
  xml: string; // xmlText.slice(start, end)
  leadingWhitespace: string;
};

export type ScanBlocksResult = {
  xmlPrefix: string; // XML 선언 + 루트 여는 태그
  blocks: TopLevelBlock[];
  xmlSuffix: string; // 루트 닫는 태그 + 이후 내용
};

/**
 * 섹션 XML을 스캔하여 루트 직계 자식 블록들을 추출한다.
 * findTblPositions를 일반화한 버전: <hp:p>, <hp:tbl>, <hp:colDef> 등 모두 처리.
 * depth 카운터로 중첩 요소를 처리하므로 테이블 셀 내부 <hp:p>는 별도 블록으로 추출되지 않음.
 */
export function scanTopLevelBlocks(xmlText: string): ScanBlocksResult {
  const len = xmlText.length;
  let i = 0;

  // Phase 1: XML prefix (처리 명령 + 루트 여는 태그) 추출
  // PIs/주석을 모두 skip하고 첫 실제 요소 여는 태그 끝을 찾는다.
  while (i < len) {
    // 공백 skip
    while (i < len && (xmlText[i] === " " || xmlText[i] === "\n" || xmlText[i] === "\r" || xmlText[i] === "\t")) {
      i++;
    }
    if (i >= len) break;
    if (xmlText[i] !== "<") {
      i++;
      continue;
    }
    // Processing instruction: <?...?>
    if (xmlText.startsWith("<?", i)) {
      const end = xmlText.indexOf("?>", i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    // Comment: <!--...-->
    if (xmlText.startsWith("<!--", i)) {
      const end = xmlText.indexOf("-->", i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    // 루트 요소 여는 태그 발견
    break;
  }

  // 루트 여는 태그 끝까지 스캔 (quoted attrs 내부 '>' 무시)
  i++; // '<' skip
  while (i < len) {
    const ch = xmlText[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < len && xmlText[i] !== q) i++;
      i++;
      continue;
    }
    if (ch === ">") {
      i++;
      break;
    }
    i++;
  }

  const xmlPrefix = xmlText.slice(0, i);
  let cursor = i;

  // Phase 2: 루트 직계 자식 블록 스캔
  const blocks: TopLevelBlock[] = [];
  let leadingBuf = "";

  while (cursor < len) {
    const ch = xmlText[cursor];

    // 공백 및 텍스트 노드 → leadingBuf 누적
    if (ch !== "<") {
      leadingBuf += ch;
      cursor++;
      continue;
    }

    // Comment → leadingBuf에 포함 (블록 사이 주석 보존)
    if (xmlText.startsWith("<!--", cursor)) {
      const end = xmlText.indexOf("-->", cursor + 4);
      const endPos = end === -1 ? len : end + 3;
      leadingBuf += xmlText.slice(cursor, endPos);
      cursor = endPos;
      continue;
    }

    // Processing instruction → leadingBuf
    if (xmlText.startsWith("<?", cursor)) {
      const end = xmlText.indexOf("?>", cursor + 2);
      const endPos = end === -1 ? len : end + 2;
      leadingBuf += xmlText.slice(cursor, endPos);
      cursor = endPos;
      continue;
    }

    // CDATA at top level → leadingBuf (비정상이지만 안전 처리)
    if (xmlText.startsWith("<![CDATA[", cursor)) {
      const end = xmlText.indexOf("]]>", cursor + 9);
      const endPos = end === -1 ? len : end + 3;
      leadingBuf += xmlText.slice(cursor, endPos);
      cursor = endPos;
      continue;
    }

    // 루트 닫는 태그 '</...' → xmlSuffix로 반환
    if (cursor + 1 < len && xmlText[cursor + 1] === "/") {
      const xmlSuffix = xmlText.slice(cursor);
      return { xmlPrefix, blocks, xmlSuffix };
    }

    // 여는 태그: 새 블록 시작
    const blockStart = cursor;

    // localName 추출: '<' 이후, 콜론 있으면 콜론 뒤부터
    const nameStart = cursor + 1;
    let nameEnd = nameStart;
    while (
      nameEnd < len &&
      xmlText[nameEnd] !== ":" &&
      xmlText[nameEnd] !== " " &&
      xmlText[nameEnd] !== ">" &&
      xmlText[nameEnd] !== "/" &&
      xmlText[nameEnd] !== "\n" &&
      xmlText[nameEnd] !== "\r" &&
      xmlText[nameEnd] !== "\t"
    ) {
      nameEnd++;
    }
    let localName: string;
    if (nameEnd < len && xmlText[nameEnd] === ":") {
      const localStart = nameEnd + 1;
      let localEnd = localStart;
      while (
        localEnd < len &&
        xmlText[localEnd] !== " " &&
        xmlText[localEnd] !== ">" &&
        xmlText[localEnd] !== "/" &&
        xmlText[localEnd] !== "\n" &&
        xmlText[localEnd] !== "\r" &&
        xmlText[localEnd] !== "\t"
      ) {
        localEnd++;
      }
      localName = xmlText.slice(localStart, localEnd);
    } else {
      localName = xmlText.slice(nameStart, nameEnd);
    }

    // depth-tracking으로 블록 끝 탐색
    let depth = 0;
    let blockEnd = -1;
    let j = cursor;

    scanBlock: while (j < len) {
      // Comment
      if (xmlText.startsWith("<!--", j)) {
        const end = xmlText.indexOf("-->", j + 4);
        j = end === -1 ? len : end + 3;
        continue;
      }
      // CDATA
      if (xmlText.startsWith("<![CDATA[", j)) {
        const end = xmlText.indexOf("]]>", j + 9);
        j = end === -1 ? len : end + 3;
        continue;
      }

      if (xmlText[j] !== "<") {
        j++;
        continue;
      }

      // Closing tag
      if (j + 1 < len && xmlText[j + 1] === "/") {
        j += 2; // skip '</'
        while (j < len && xmlText[j] !== ">") j++;
        j++; // skip '>'
        depth--;
        if (depth === 0) {
          blockEnd = j;
          break scanBlock;
        }
        continue;
      }

      // PI inside block
      if (xmlText.startsWith("<?", j)) {
        const end = xmlText.indexOf("?>", j + 2);
        j = end === -1 ? len : end + 2;
        continue;
      }

      // Opening tag
      j++; // skip '<'
      let selfClosing = false;
      while (j < len) {
        const c = xmlText[j];
        if (c === '"' || c === "'") {
          const q = c;
          j++;
          while (j < len && xmlText[j] !== q) j++;
          j++;
          continue;
        }
        if (c === "/" && j + 1 < len && xmlText[j + 1] === ">") {
          j += 2; // skip '/>'
          selfClosing = true;
          break;
        }
        if (c === ">") {
          j++;
          break;
        }
        j++;
      }

      if (selfClosing) {
        if (depth === 0) {
          // 최상위 자기닫힘 요소 = 단일 블록
          blockEnd = j;
          break scanBlock;
        }
        // depth > 0 자기닫힘 → depth 변화 없음
      } else {
        depth++;
      }
    }

    if (blockEnd === -1) blockEnd = len;

    blocks.push({
      localName,
      start: blockStart,
      end: blockEnd,
      xml: xmlText.slice(blockStart, blockEnd),
      leadingWhitespace: leadingBuf,
    });

    leadingBuf = "";
    cursor = blockEnd;
  }

  return { xmlPrefix, blocks, xmlSuffix: "" };
}

// ─────────────────────────────────────────────────────────────────────────────

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
