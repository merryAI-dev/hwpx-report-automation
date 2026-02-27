import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { buildBatchApplyPlan, collectSectionBatchItems } from "./batch-ai";

function makeDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { segmentId: "h1" },
        content: [{ type: "text", text: "1. 개요" }],
      },
      {
        type: "paragraph",
        attrs: { segmentId: "p1" },
        content: [{ type: "text", text: "첫 문단" }],
      },
      {
        type: "heading",
        attrs: { segmentId: "h2" },
        content: [{ type: "text", text: "2. 상세" }],
      },
      {
        type: "paragraph",
        attrs: { segmentId: "p2" },
        content: [{ type: "text", text: "둘째 줄" }, { type: "hardBreak" }, { type: "text", text: "셋째 줄" }],
      },
    ],
  };
}

describe("collectSectionBatchItems", () => {
  it("returns all segment items when no selection exists", () => {
    const items = collectSectionBatchItems(makeDoc(), null);
    expect(items.map((item) => item.id)).toEqual(["h1", "p1", "h2", "p2"]);
    expect(items.find((item) => item.id === "p2")?.text).toBe("둘째 줄\n셋째 줄");
  });

  it("returns only current section items when segment is selected", () => {
    const items = collectSectionBatchItems(makeDoc(), "p2");
    expect(items.map((item) => item.id)).toEqual(["h2", "p2"]);
    expect(items.every((item) => item.styleHints.sectionTitle === "2. 상세")).toBe(true);
  });
});

describe("buildBatchApplyPlan", () => {
  it("falls back to original text when suggestion is missing", () => {
    const plan = buildBatchApplyPlan(
      [
        { id: "a", text: "원문 A", styleHints: {} },
        { id: "b", text: "원문 B", styleHints: {} },
      ],
      [{ id: "a", suggestion: "수정 A" }],
    );

    expect(plan).toEqual([
      { id: "a", originalText: "원문 A", suggestion: "수정 A", changed: true },
      { id: "b", originalText: "원문 B", suggestion: "원문 B", changed: false },
    ]);
  });
});
