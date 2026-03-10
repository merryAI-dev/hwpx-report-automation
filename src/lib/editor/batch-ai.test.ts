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

describe("collectSectionBatchItems — edge cases", () => {
  it("returns empty array for null doc", () => {
    expect(collectSectionBatchItems(null, null)).toEqual([]);
  });

  it("returns empty array for doc without segments", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "no segmentId" }] },
      ],
    };
    expect(collectSectionBatchItems(doc, null)).toEqual([]);
  });

  it("skips empty-text segments", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { segmentId: "empty" }, content: [{ type: "text", text: "   " }] },
        { type: "paragraph", attrs: { segmentId: "real" }, content: [{ type: "text", text: "content" }] },
      ],
    };
    const items = collectSectionBatchItems(doc, null);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("real");
  });

  it("provides prevText and nextText for context", () => {
    const items = collectSectionBatchItems(makeDoc(), null);
    const p1 = items.find((i) => i.id === "p1")!;
    expect(p1.prevText).toBe("1. 개요");
    expect(p1.nextText).toBe("2. 상세");
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

  it("marks unchanged when suggestion equals original", () => {
    const plan = buildBatchApplyPlan(
      [{ id: "a", text: "동일", styleHints: {} }],
      [{ id: "a", suggestion: "동일" }],
    );
    expect(plan[0].changed).toBe(false);
  });

  it("handles empty results array", () => {
    const plan = buildBatchApplyPlan(
      [{ id: "a", text: "원문", styleHints: {} }],
      [],
    );
    expect(plan[0].suggestion).toBe("원문");
    expect(plan[0].changed).toBe(false);
  });

  it("ignores results with empty id or suggestion", () => {
    const plan = buildBatchApplyPlan(
      [{ id: "a", text: "원문", styleHints: {} }],
      [
        { id: "", suggestion: "무시" },
        { id: "a", suggestion: "" },
      ],
    );
    expect(plan[0].suggestion).toBe("원문");
    expect(plan[0].changed).toBe(false);
  });
});
