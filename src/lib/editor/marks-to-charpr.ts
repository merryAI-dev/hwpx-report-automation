import type { JSONContent } from "@tiptap/core";

const FONT_REF_KEYS = ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"] as const;
type FontRefKey = (typeof FONT_REF_KEYS)[number];
const FONTFACE_LANG_BY_KEY: Record<FontRefKey, string> = {
  hangul: "HANGUL",
  latin: "LATIN",
  hanja: "HANJA",
  japanese: "JAPANESE",
  other: "OTHER",
  symbol: "SYMBOL",
  user: "USER",
};

type TextStyleAttrs = {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSizePt?: number;
  hwpxUnderlineType?: string;
  hwpxStrikeShape?: string;
};

function normalizeColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTextStyleAttrs(marks: JSONContent["marks"]): TextStyleAttrs {
  const textStyleMark = (marks ?? []).find((m) => m.type === "textStyle");
  const attrs = (textStyleMark?.attrs ?? {}) as Record<string, unknown>;

  const color = normalizeColor(attrs.color);
  const backgroundColor = normalizeColor(attrs.backgroundColor);
  const fontFamily =
    typeof attrs.fontFamily === "string" && attrs.fontFamily.trim() ? attrs.fontFamily.trim() : undefined;

  let fontSizePt: number | undefined;
  if (typeof attrs.fontSize === "string" || typeof attrs.fontSize === "number") {
    const raw = String(attrs.fontSize).trim();
    const match = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:pt|px)?\s*$/i);
    if (match) {
      const parsed = Number.parseFloat(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        fontSizePt = parsed;
      }
    }
  }

  const hwpxUnderlineType =
    typeof attrs.hwpxUnderlineType === "string" && attrs.hwpxUnderlineType.trim()
      ? attrs.hwpxUnderlineType.trim()
      : undefined;
  const hwpxStrikeShape =
    typeof attrs.hwpxStrikeShape === "string" && attrs.hwpxStrikeShape.trim()
      ? attrs.hwpxStrikeShape.trim()
      : undefined;

  return { color, backgroundColor, fontFamily, fontSizePt, hwpxUnderlineType, hwpxStrikeShape };
}

function hasTextStyleMark(marks: JSONContent["marks"]): boolean {
  return (marks ?? []).some((mark) => mark.type === "textStyle");
}

function readHighlightColor(marks: JSONContent["marks"]): string | undefined {
  const highlight = (marks ?? []).find((m) => m.type === "highlight");
  const attrs = (highlight?.attrs ?? {}) as Record<string, unknown>;
  return normalizeColor(attrs.color);
}

function readShadeColor(marks: JSONContent["marks"]): string | undefined {
  const textStyle = readTextStyleAttrs(marks);
  return textStyle.backgroundColor ?? readHighlightColor(marks);
}

function canonicalizeFontSizePt(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * mark 조합의 고유 정렬 키.
 * mark 없음 → "base" (원본 charPrIDRef 그대로 사용)
 */
export function markFingerprint(marks: JSONContent["marks"]): string {
  if (!marks || marks.length === 0) return "base";
  const parts = marks
    .map((m) => {
      if (m.type === "textStyle" && m.attrs) {
        const textStyle = readTextStyleAttrs([m]);
        const tokens: string[] = [];
        if (textStyle.color) tokens.push(`color:${textStyle.color}`);
        if (textStyle.backgroundColor) tokens.push(`backgroundColor:${textStyle.backgroundColor}`);
        if (textStyle.fontFamily) tokens.push(`fontFamily:${textStyle.fontFamily}`);
        if (textStyle.fontSizePt !== undefined) {
          tokens.push(`fontSize:${canonicalizeFontSizePt(textStyle.fontSizePt)}`);
        }
        if (textStyle.hwpxUnderlineType) tokens.push(`ulType:${textStyle.hwpxUnderlineType}`);
        if (textStyle.hwpxStrikeShape) tokens.push(`stShape:${textStyle.hwpxStrikeShape}`);
        return tokens.length > 0 ? `${m.type},${tokens.join(",")}` : "";
      }
      if (m.type === "highlight" && m.attrs) {
        const color = normalizeColor((m.attrs as Record<string, unknown>).color) ?? "default";
        return `highlight,color:${color}`;
      }
      return m.type;
    })
    .filter((part) => part.length > 0)
    .sort()
    .join("|");
  return parts.length > 0 ? parts : "base";
}

function findChildByLocalName(parent: Element, localName: string): Element | null {
  return Array.from(parent.children).find((child) => child.localName === localName) ?? null;
}

function findChildByLocalNames(parent: Element, localNames: string[]): Element | null {
  const set = new Set(localNames);
  return Array.from(parent.children).find((child) => set.has(child.localName)) ?? null;
}

function findOrCreateRefList(headerDoc: Document): Element {
  const existing = Array.from(headerDoc.getElementsByTagName("*")).find((el) => el.localName === "refList");
  if (existing) {
    return existing;
  }
  const root = headerDoc.documentElement;
  const ns = root.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/head";
  const prefix = root.prefix || "hh";
  const created = headerDoc.createElementNS(ns, `${prefix}:refList`);
  root.appendChild(created);
  return created;
}

function findOrCreateFontfaces(headerDoc: Document): Element {
  const refList = findOrCreateRefList(headerDoc);
  const existing = findChildByLocalName(refList, "fontfaces");
  if (existing) {
    return existing;
  }
  const ns = refList.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/head";
  const prefix = refList.prefix || "hh";
  const created = headerDoc.createElementNS(ns, `${prefix}:fontfaces`);
  created.setAttribute("itemCnt", "0");
  refList.appendChild(created);
  return created;
}

// fontface lang → Element 인덱스: O(n) 선형 탐색 → O(1) 조회
const fontfaceLangIndex = new WeakMap<Element, Map<string, Element>>();

function findOrCreateFontfaceByLang(
  headerDoc: Document,
  fontfacesEl: Element,
  lang: string,
): Element {
  let langMap = fontfaceLangIndex.get(fontfacesEl);
  if (!langMap) {
    langMap = new Map();
    for (const child of Array.from(fontfacesEl.children)) {
      if (child.localName === "fontface") {
        const l = (child.getAttribute("lang") ?? "").toUpperCase();
        if (l) langMap.set(l, child);
      }
    }
    fontfaceLangIndex.set(fontfacesEl, langMap);
  }
  const existing = langMap.get(lang);
  if (existing) {
    return existing;
  }
  const ns = fontfacesEl.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/head";
  const prefix = fontfacesEl.prefix || "hh";
  const created = headerDoc.createElementNS(ns, `${prefix}:fontface`);
  created.setAttribute("lang", lang);
  created.setAttribute("fontCnt", "0");
  fontfacesEl.appendChild(created);
  langMap.set(lang, created); // 인덱스에도 추가
  return created;
}

// fontface → (face lowercase → {id, element}) 인덱스
const fontIdIndex = new WeakMap<Element, Map<string, string>>();

function ensureFontIdInFontface(
  headerDoc: Document,
  fontfaceEl: Element,
  fontFamily: string,
): string {
  let faceMap = fontIdIndex.get(fontfaceEl);
  if (!faceMap) {
    faceMap = new Map();
    for (const child of Array.from(fontfaceEl.children)) {
      if (child.localName === "font") {
        const face = (child.getAttribute("face") ?? "").trim().toLowerCase();
        const id = child.getAttribute("id");
        if (face && id) faceMap.set(face, id);
      }
    }
    fontIdIndex.set(fontfaceEl, faceMap);
  }
  const key = fontFamily.trim().toLowerCase();
  const existingId = faceMap.get(key);
  if (existingId) return existingId;

  // 새 font ID: 현재 인덱스에서 최대 ID + 1
  let maxId = -1;
  for (const id of faceMap.values()) {
    const n = Number.parseInt(id, 10);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }
  const newId = String(maxId + 1);

  const ns = fontfaceEl.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/head";
  const prefix = fontfaceEl.prefix || "hh";
  const fontEl = headerDoc.createElementNS(ns, `${prefix}:font`);
  fontEl.setAttribute("id", newId);
  fontEl.setAttribute("face", fontFamily);
  fontEl.setAttribute("type", "TTF");
  fontEl.setAttribute("isEmbedded", "0");
  fontfaceEl.appendChild(fontEl);
  faceMap.set(key, newId); // 인덱스에 새 font 추가
  fontfaceEl.setAttribute("fontCnt", String(faceMap.size));
  return newId;
}

function ensureFontRefElement(cloned: Element, headerDoc: Document): Element {
  const existing = findChildByLocalName(cloned, "fontRef");
  if (existing) {
    return existing;
  }
  const ns = cloned.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/head";
  const prefix = cloned.prefix || "hh";
  const created = headerDoc.createElementNS(ns, `${prefix}:fontRef`);
  for (const key of FONT_REF_KEYS) {
    created.setAttribute(key, "0");
  }
  cloned.insertBefore(created, cloned.firstChild ?? null);
  return created;
}

function applyTextStyleToCharPr(cloned: Element, marks: JSONContent["marks"], headerDoc: Document): void {
  const textStyle = readTextStyleAttrs(marks);
  const shadeColor = readShadeColor(marks);
  if (textStyle.color) {
    cloned.setAttribute("textColor", textStyle.color);
  } else if (hasTextStyleMark(marks)) {
    // textStyle mark가 존재하는데 color가 없으면 기본 검정으로 명시해 색상 해제를 반영한다.
    cloned.setAttribute("textColor", "#000000");
  }
  cloned.setAttribute("shadeColor", shadeColor ?? "none");
  if (textStyle.fontSizePt !== undefined) {
    cloned.setAttribute("height", String(Math.round(textStyle.fontSizePt * 100)));
  }
  if (textStyle.fontFamily) {
    // 현재 charPr의 hangul fontRef가 동일한 폰트를 가리키면 fontRef 변경 스킵
    // (import 시 다국어 폰트 슬롯 구조를 보존)
    const existingFontRef = findChildByLocalName(cloned, "fontRef");
    let hangulAlreadyMatches = false;
    if (existingFontRef) {
      const hangulId = existingFontRef.getAttribute("hangul");
      if (hangulId) {
        const fontfacesEl = findOrCreateFontfaces(headerDoc);
        const hangulFontface = findOrCreateFontfaceByLang(headerDoc, fontfacesEl, "HANGUL");
        const existingHangulFont = Array.from(hangulFontface.children).find(
          (c) => c.localName === "font" && c.getAttribute("id") === hangulId,
        );
        if (existingHangulFont?.getAttribute("face")?.trim().toLowerCase() === textStyle.fontFamily.trim().toLowerCase()) {
          hangulAlreadyMatches = true;
        }
      }
    }

    if (!hangulAlreadyMatches) {
      const fontfacesEl = findOrCreateFontfaces(headerDoc);
      const ids = {} as Record<FontRefKey, string>;
      for (const key of FONT_REF_KEYS) {
        const lang = FONTFACE_LANG_BY_KEY[key];
        const fontface = findOrCreateFontfaceByLang(headerDoc, fontfacesEl, lang);
        ids[key] = ensureFontIdInFontface(headerDoc, fontface, textStyle.fontFamily);
      }
      const fontfaceCount = Array.from(fontfacesEl.children).filter((child) => child.localName === "fontface").length;
      fontfacesEl.setAttribute("itemCnt", String(fontfaceCount));

      const fontRef = ensureFontRefElement(cloned, headerDoc);
      for (const key of FONT_REF_KEYS) {
        fontRef.setAttribute(key, ids[key]);
      }
    }
  }
}

function normalizeCharPrForCompare(el: Element): string {
  const cloned = el.cloneNode(true) as Element;
  cloned.removeAttribute("id");
  const shade = (cloned.getAttribute("shadeColor") ?? "").trim().toUpperCase();
  if (shade === "NONE" || shade === "#FFFFFF" || shade === "#FFFFFFFF") {
    cloned.removeAttribute("shadeColor");
  }
  return new XMLSerializer().serializeToString(cloned);
}

/**
 * 클론된 charPr Element에 marks를 적용 (in-place).
 *
 * 지원하는 mark:
 *   - bold      → <hh:bold/> 자식 요소 존재 여부
 *   - italic    → <hh:italic/> 자식 요소 존재 여부
 *   - underline → <hh:underline type="SINGLE|NONE" .../>
 *   - strike    → <hh:strikeout shape="SOLID|NONE" .../>
 */
export function applyMarksToCharPrElement(
  cloned: Element,
  marks: JSONContent["marks"],
  headerDoc: Document,
): void {
  const ns = cloned.namespaceURI || "http://www.hancom.co.kr/hwpml/2011/head";
  const prefix = cloned.prefix || "hh";
  const markTypes = new Set((marks ?? []).map((m) => m.type));

  // Bold: <hh:bold/> 존재 여부로 표현
  const hasBold = Array.from(cloned.children).some((c) => c.localName === "bold");
  if (markTypes.has("bold") && !hasBold) {
    cloned.appendChild(headerDoc.createElementNS(ns, `${prefix}:bold`));
  } else if (!markTypes.has("bold") && hasBold) {
    const boldEl = Array.from(cloned.children).find((c) => c.localName === "bold");
    if (boldEl) cloned.removeChild(boldEl);
  }

  // Italic: <hh:italic/> 존재 여부로 표현 (bold와 동일한 패턴)
  const hasItalic = Array.from(cloned.children).some((c) => c.localName === "italic");
  if (markTypes.has("italic") && !hasItalic) {
    cloned.appendChild(headerDoc.createElementNS(ns, `${prefix}:italic`));
  } else if (!markTypes.has("italic") && hasItalic) {
    const italicEl = Array.from(cloned.children).find((c) => c.localName === "italic");
    if (italicEl) cloned.removeChild(italicEl);
  }

  // Underline: <hh:underline type="SINGLE|DOUBLE|DOTTED|...|NONE" .../>
  // textStyle.hwpxUnderlineType으로 원본 변형 보존 (없으면 SINGLE)
  const textStyleForDecoration = readTextStyleAttrs(marks);
  let underlineEl = Array.from(cloned.children).find((c) => c.localName === "underline");
  if (markTypes.has("underline") && !underlineEl) {
    underlineEl = headerDoc.createElementNS(ns, `${prefix}:underline`);
    underlineEl.setAttribute("color", "#000000");
    cloned.appendChild(underlineEl);
  }
  if (underlineEl) {
    const ulType = markTypes.has("underline")
      ? (textStyleForDecoration.hwpxUnderlineType || "SINGLE")
      : "NONE";
    underlineEl.setAttribute("type", ulType);
    underlineEl.setAttribute("shape", "SOLID");
  }

  // Strike: <hh:strikeout shape="SOLID|DOUBLE|...|NONE" .../>
  let strikeoutEl = Array.from(cloned.children).find((c) => c.localName === "strikeout");
  if (markTypes.has("strike") && !strikeoutEl) {
    strikeoutEl = headerDoc.createElementNS(ns, `${prefix}:strikeout`);
    strikeoutEl.setAttribute("color", "#000000");
    cloned.appendChild(strikeoutEl);
  }
  if (strikeoutEl) {
    const stShape = markTypes.has("strike")
      ? (textStyleForDecoration.hwpxStrikeShape || "SOLID")
      : "NONE";
    strikeoutEl.setAttribute("shape", stShape);
  }

  // Superscript: HWPX uses <hh:supscript/> in real files, but support both spellings.
  const hasSuperscript = Array.from(cloned.children).some(
    (c) => c.localName === "supscript" || c.localName === "superscript",
  );
  if (markTypes.has("superscript") && !hasSuperscript) {
    cloned.appendChild(headerDoc.createElementNS(ns, `${prefix}:supscript`));
  } else if (!markTypes.has("superscript") && hasSuperscript) {
    const el = findChildByLocalNames(cloned, ["supscript", "superscript"]);
    if (el) cloned.removeChild(el);
  }

  // Subscript: <hh:subscript/> 자식 요소 존재 여부
  const hasSubscript = Array.from(cloned.children).some((c) => c.localName === "subscript");
  if (markTypes.has("subscript") && !hasSubscript) {
    cloned.appendChild(headerDoc.createElementNS(ns, `${prefix}:subscript`));
  } else if (!markTypes.has("subscript") && hasSubscript) {
    const el = Array.from(cloned.children).find((c) => c.localName === "subscript");
    if (el) cloned.removeChild(el);
  }
}

/**
 * 주어진 marks에 맞는 charPrId를 반환.
 * 이미 생성된 적 있으면 캐시에서 반환, 없으면 클론+수정+추가.
 *
 * @param charPropertiesEl  header.xml의 <hh:charProperties> 요소
 * @param charPrById        id → charPr Element 맵 (mutable)
 * @param charPrCache       "baseId::fingerprint" → charPrId 캐시 (mutable)
 * @param nextCharPrId      { value: number } mutable 카운터 (maxId + 1에서 시작)
 * @param baseCharPrId      기준 charPr ID (스타일 기본값)
 * @param marks             TipTap mark 배열
 * @param headerDoc         DOMParser로 파싱된 header.xml Document
 */
// source charPr의 normalized 문자열 캐시 — 같은 baseCharPrId에 대해 1회만 직렬화
const sourceNormalizedCache = new Map<string, string>();

export function ensureCharPrForMarks(params: {
  charPropertiesEl: Element;
  charPrById: Map<string, Element>;
  charPrCache: Map<string, string>;
  nextCharPrId: { value: number };
  baseCharPrId: string;
  marks: JSONContent["marks"];
  headerDoc: Document;
}): string {
  const { charPropertiesEl, charPrById, charPrCache, nextCharPrId, baseCharPrId, marks, headerDoc } =
    params;

  const fp = markFingerprint(marks);
  if (fp === "base") return baseCharPrId;

  const cacheKey = `${baseCharPrId}::${fp}`;
  const cached = charPrCache.get(cacheKey);
  if (cached) return cached;

  const sourceCharPr = charPrById.get(baseCharPrId);
  if (!sourceCharPr) return baseCharPrId; // 소스 없으면 기본값 유지

  const cloned = sourceCharPr.cloneNode(true) as Element;
  applyMarksToCharPrElement(cloned, marks, headerDoc);
  applyTextStyleToCharPr(cloned, marks, headerDoc);

  // marks 적용 결과가 source와 동일하면 새 charPr를 만들지 않고 base를 재사용한다.
  // sourceCharPr normalized 문자열은 캐시하여 반복 직렬화 제거
  let sourceNormalized = sourceNormalizedCache.get(baseCharPrId);
  if (sourceNormalized === undefined) {
    sourceNormalized = normalizeCharPrForCompare(sourceCharPr);
    sourceNormalizedCache.set(baseCharPrId, sourceNormalized);
  }
  if (normalizeCharPrForCompare(cloned) === sourceNormalized) {
    charPrCache.set(cacheKey, baseCharPrId);
    return baseCharPrId;
  }

  const newId = String(nextCharPrId.value++);
  cloned.setAttribute("id", newId);

  charPropertiesEl.appendChild(cloned);
  charPrById.set(newId, cloned);
  charPrCache.set(cacheKey, newId);
  return newId;
}

/** export/import 사이클 사이에 sourceNormalized 캐시를 리셋 */
export function clearCharPrCaches(): void {
  sourceNormalizedCache.clear();
}
