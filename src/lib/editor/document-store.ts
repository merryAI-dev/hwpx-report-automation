import type { JSONContent } from "@tiptap/core";
import type { TextEdit } from "../hwpx";

export type OutlineItem = {
  id: string;
  text: string;
  level: number;
  segmentId?: string;
};

type MetadataAttrs = {
  segmentId?: string;
  level?: number;
};

function parseNumberingHeadingLevel(text: string): number | null {
  const chapter = text.match(/^제\s*(\d+)\s*(장|절|항)\b/);
  if (chapter) {
    const unit = chapter[2];
    if (unit === "장") return 1;
    if (unit === "절") return 2;
    return 3;
  }

  const decimal = text.match(/^(\d+(?:\.\d+){0,4})\s*[\.\)]\s+/);
  if (decimal) {
    const depth = decimal[1].split(".").length;
    return Math.min(6, 1 + depth);
  }

  if (/^([IVXLC]+|[A-Za-z가-힣])[\.\)]\s+/.test(text)) {
    return 2;
  }
  return null;
}

function extractParagraphStyleHints(node: JSONContent): { boldRatio: number; maxFontSizePt: number } {
  const textNodes: JSONContent[] = [];
  walk(node, (child) => {
    if (child.type === "text" && (child.text || "").length > 0) {
      textNodes.push(child);
    }
  });

  if (textNodes.length === 0) {
    return { boldRatio: 0, maxFontSizePt: 0 };
  }

  let totalLength = 0;
  let boldLength = 0;
  let maxFontSizePt = 0;

  for (const textNode of textNodes) {
    const text = textNode.text || "";
    const len = text.length;
    totalLength += len;

    const marks = textNode.marks || [];
    if (marks.some((mark) => mark.type === "bold")) {
      boldLength += len;
    }

    const textStyle = marks.find((mark) => mark.type === "textStyle");
    const rawSize = (textStyle?.attrs as Record<string, unknown> | undefined)?.fontSize;
    if (typeof rawSize === "string" || typeof rawSize === "number") {
      const match = String(rawSize).match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:pt|px)?\s*$/i);
      if (match) {
        const parsed = Number.parseFloat(match[1]);
        if (Number.isFinite(parsed) && parsed > maxFontSizePt) {
          maxFontSizePt = parsed;
        }
      }
    }
  }

  const boldRatio = totalLength > 0 ? boldLength / totalLength : 0;
  return { boldRatio, maxFontSizePt };
}

function inferOutlineLevelForParagraph(node: JSONContent, text: string): number | null {
  const numberingLevel = parseNumberingHeadingLevel(text);
  if (numberingLevel !== null) {
    return numberingLevel;
  }

  const normalized = text.trim();
  if (!normalized || normalized.length > 60) {
    return null;
  }

  const { boldRatio, maxFontSizePt } = extractParagraphStyleHints(node);
  if (boldRatio >= 0.6 || maxFontSizePt >= 13) {
    return 2;
  }
  return null;
}

function extractNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text || "";
  }
  if (!node.content?.length) {
    return "";
  }
  return node.content.map((child) => extractNodeText(child)).join("");
}

function walk(node: JSONContent, visitor: (node: JSONContent, ancestors: string[]) => void, ancestors: string[] = []): void {
  visitor(node, ancestors);
  if (!node.content?.length) {
    return;
  }
  for (const child of node.content) {
    walk(child, visitor, [...ancestors, node.type || ""]);
  }
}

// ── Outline caching ──
// Only recalculate when heading content actually changes.
let cachedOutlineKey = "";
let cachedOutlineResult: OutlineItem[] = [];

function computeOutlineKey(doc: JSONContent): string {
  // Build a lightweight fingerprint from headings + heading-like paragraphs
  const parts: string[] = [];
  walk(doc, (node, ancestors) => {
    if (ancestors.includes("table")) return;
    if (node.type === "heading") {
      const attrs = (node.attrs || {}) as MetadataAttrs;
      parts.push(`h:${attrs.level ?? 2}:${attrs.segmentId ?? ""}:${extractNodeText(node).trim()}`);
    } else if (node.type === "paragraph") {
      const text = extractNodeText(node).trim();
      if (text && inferOutlineLevelForParagraph(node, text) !== null) {
        const attrs = (node.attrs || {}) as MetadataAttrs;
        parts.push(`p:${attrs.segmentId ?? ""}:${text}`);
      }
    }
  });
  return parts.join("|");
}

export function buildOutlineFromDoc(doc: JSONContent | null): OutlineItem[] {
  if (!doc) {
    return [];
  }

  // Check cache
  const key = computeOutlineKey(doc);
  if (key === cachedOutlineKey && cachedOutlineResult.length > 0) {
    return cachedOutlineResult;
  }

  const rows: OutlineItem[] = [];
  walk(doc, (node, ancestors) => {
    if (ancestors.includes("table") || ancestors.includes("tableRow") || ancestors.includes("tableCell")) {
      return;
    }
    const text = extractNodeText(node).trim();
    if (!text) {
      return;
    }
    const attrs = (node.attrs || {}) as MetadataAttrs;
    if (node.type === "heading") {
      rows.push({
        id: `outline-${rows.length}`,
        text,
        level: Number(attrs.level || 2),
        segmentId: attrs.segmentId,
      });
      return;
    }
    if (node.type !== "paragraph") {
      return;
    }
    const inferredLevel = inferOutlineLevelForParagraph(node, text);
    if (inferredLevel === null) {
      return;
    }
    rows.push({
      id: `outline-${rows.length}`,
      text,
      level: inferredLevel,
      segmentId: attrs.segmentId,
    });
  });

  cachedOutlineKey = key;
  cachedOutlineResult = rows;
  return rows;
}

export function buildDirtySummary(edits: TextEdit[]): {
  dirtyFileCount: number;
  totalEditCount: number;
  dirtyFiles: string[];
} {
  const dirtyFiles = Array.from(new Set(edits.map((edit) => edit.fileName))).sort();
  return {
    dirtyFileCount: dirtyFiles.length,
    totalEditCount: edits.length,
    dirtyFiles,
  };
}
