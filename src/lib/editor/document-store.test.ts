import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { buildDirtySummary, buildOutlineFromDoc } from "./document-store";

describe("buildOutlineFromDoc", () => {
  it("extracts headings in order", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "본문" }] },
        {
          type: "heading",
          attrs: { level: 2, segmentId: "seg-2" },
          content: [{ type: "text", text: "2. 구현 요약" }],
        },
        {
          type: "heading",
          attrs: { level: 3, segmentId: "seg-3" },
          content: [{ type: "text", text: "2.1 상세" }],
        },
      ],
    };

    const outline = buildOutlineFromDoc(doc);
    expect(outline).toEqual([
      { id: "outline-0", text: "2. 구현 요약", level: 2, segmentId: "seg-2" },
      { id: "outline-1", text: "2.1 상세", level: 3, segmentId: "seg-3" },
    ]);
  });
});

describe("buildDirtySummary", () => {
  it("builds file-level summary from edits", () => {
    const summary = buildDirtySummary([
      { fileName: "Contents/section0.xml", textIndex: 1, id: "a", oldText: "x", newText: "y" },
      { fileName: "Contents/section0.xml", textIndex: 2, id: "b", oldText: "x", newText: "z" },
      { fileName: "Contents/section1.xml", textIndex: 1, id: "c", oldText: "m", newText: "n" },
    ]);
    expect(summary.dirtyFileCount).toBe(2);
    expect(summary.totalEditCount).toBe(3);
    expect(summary.dirtyFiles).toEqual(["Contents/section0.xml", "Contents/section1.xml"]);
  });
});

