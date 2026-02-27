import type { JSONContent } from "@tiptap/core";

type SegmentAttrs = {
  segmentId?: string;
};

export type BatchSuggestionInput = {
  id: string;
  text: string;
  styleHints: Record<string, string>;
};

export type BatchSuggestionResult = {
  id: string;
  suggestion: string;
};

export type BatchApplyPlanItem = {
  id: string;
  originalText: string;
  suggestion: string;
  changed: boolean;
};

type BatchSegment = {
  segmentId: string;
  text: string;
  nodeType: "heading" | "paragraph";
  sectionId: number;
  sectionTitle: string;
};

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

function collectBatchSegments(doc: JSONContent): BatchSegment[] {
  const segments: BatchSegment[] = [];
  let sectionId = 0;
  let sectionTitle = "문서 시작";

  walk(doc, (node) => {
    if (node.type !== "heading" && node.type !== "paragraph") {
      return;
    }
    const attrs = (node.attrs || {}) as SegmentAttrs;
    if (!attrs.segmentId) {
      return;
    }
    const text = extractNodeText(node).trim();
    if (!text) {
      return;
    }
    if (node.type === "heading") {
      sectionId += 1;
      sectionTitle = text;
    }
    segments.push({
      segmentId: attrs.segmentId,
      text,
      nodeType: node.type,
      sectionId,
      sectionTitle,
    });
  });

  return segments;
}

export function collectSectionBatchItems(
  doc: JSONContent | null,
  selectedSegmentId: string | null,
): BatchSuggestionInput[] {
  if (!doc) {
    return [];
  }
  const segments = collectBatchSegments(doc);
  if (!segments.length) {
    return [];
  }

  let targetSectionId: number | null = null;
  if (selectedSegmentId) {
    const selected = segments.find((segment) => segment.segmentId === selectedSegmentId);
    if (selected) {
      targetSectionId = selected.sectionId;
    }
  }

  return segments
    .filter((segment) => targetSectionId === null || segment.sectionId === targetSectionId)
    .map((segment) => ({
      id: segment.segmentId,
      text: segment.text,
      styleHints: {
        sectionTitle: segment.sectionTitle,
        nodeType: segment.nodeType,
      },
    }));
}

export function buildBatchApplyPlan(
  items: BatchSuggestionInput[],
  results: BatchSuggestionResult[],
): BatchApplyPlanItem[] {
  const resultMap = new Map<string, string>();
  for (const row of results) {
    const id = String(row.id || "").trim();
    const suggestion = String(row.suggestion || "").trim();
    if (!id || !suggestion) {
      continue;
    }
    resultMap.set(id, suggestion);
  }

  return items.map((item) => {
    const suggestion = resultMap.get(item.id) || item.text;
    return {
      id: item.id,
      originalText: item.text,
      suggestion,
      changed: suggestion !== item.text,
    };
  });
}
