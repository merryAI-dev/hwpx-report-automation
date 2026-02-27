import type { JSONContent } from "@tiptap/core";

/**
 * mark 조합의 고유 정렬 키.
 * mark 없음 → "base" (원본 charPrIDRef 그대로 사용)
 */
export function markFingerprint(marks: JSONContent["marks"]): string {
  if (!marks || marks.length === 0) return "base";
  return marks
    .map((m) => {
      if (m.type === "textStyle" && m.attrs) {
        const attrs = m.attrs as Record<string, unknown>;
        const parts: string[] = [m.type];
        if (attrs.color) parts.push(`color:${attrs.color}`);
        return parts.join(",");
      }
      return m.type;
    })
    .sort()
    .join("|");
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

  // Underline: <hh:underline type="SINGLE|NONE" .../>
  const underlineEl = Array.from(cloned.children).find((c) => c.localName === "underline");
  if (underlineEl) {
    if (markTypes.has("underline")) {
      underlineEl.setAttribute("type", "SINGLE");
      underlineEl.setAttribute("shape", "SOLID");
    } else {
      underlineEl.setAttribute("type", "NONE");
    }
  }
  // underline 자식이 없는 charPr에 대해서는 추가하지 않음

  // Strike: <hh:strikeout shape="SOLID|NONE" .../>
  const strikeoutEl = Array.from(cloned.children).find((c) => c.localName === "strikeout");
  if (strikeoutEl) {
    strikeoutEl.setAttribute("shape", markTypes.has("strike") ? "SOLID" : "NONE");
  }
  // strikeout 자식이 없는 charPr에 대해서는 추가하지 않음

  // Superscript: <hh:superscript/> 자식 요소 존재 여부
  const hasSuperscript = Array.from(cloned.children).some((c) => c.localName === "superscript");
  if (markTypes.has("superscript") && !hasSuperscript) {
    cloned.appendChild(headerDoc.createElementNS(ns, `${prefix}:superscript`));
  } else if (!markTypes.has("superscript") && hasSuperscript) {
    const el = Array.from(cloned.children).find((c) => c.localName === "superscript");
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
  const newId = String(nextCharPrId.value++);
  cloned.setAttribute("id", newId);
  applyMarksToCharPrElement(cloned, marks, headerDoc);

  // Apply textColor from textStyle mark
  const textStyleMark = (marks ?? []).find((m) => m.type === "textStyle");
  const textColor = (textStyleMark?.attrs as Record<string, unknown> | undefined)?.color as string | undefined;
  if (textColor) {
    cloned.setAttribute("textColor", textColor);
  }

  charPropertiesEl.appendChild(cloned);
  charPrById.set(newId, cloned);
  charPrCache.set(cacheKey, newId);
  return newId;
}
