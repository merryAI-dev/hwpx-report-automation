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

function extractNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text || "";
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

export function buildOutlineFromDoc(doc: JSONContent | null): OutlineItem[] {
  if (!doc) {
    return [];
  }
  const rows: OutlineItem[] = [];
  walk(doc, (node) => {
    if (node.type !== "heading") {
      return;
    }
    const text = extractNodeText(node).trim();
    if (!text) {
      return;
    }
    const attrs = (node.attrs || {}) as MetadataAttrs;
    rows.push({
      id: `outline-${rows.length}`,
      text,
      level: Number(attrs.level || 2),
      segmentId: attrs.segmentId,
    });
  });
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

