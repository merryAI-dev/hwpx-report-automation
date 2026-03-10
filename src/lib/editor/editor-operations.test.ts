import { describe, it, expect } from "vitest";
import {
  extractNodeText,
  applySearchReplace,
  createUniqueHwpxFileName,
} from "./editor-operations";
import type { JSONContent } from "@tiptap/core";

describe("extractNodeText", () => {
  it("extracts text from a simple text node", () => {
    expect(extractNodeText({ type: "text", text: "hello" })).toBe("hello");
  });

  it("returns empty string for text node without text", () => {
    expect(extractNodeText({ type: "text" })).toBe("");
  });

  it("converts hardBreak to newline", () => {
    expect(extractNodeText({ type: "hardBreak" })).toBe("\n");
  });

  it("extracts text from paragraph with mixed content", () => {
    const node: JSONContent = {
      type: "paragraph",
      content: [
        { type: "text", text: "첫째 줄" },
        { type: "hardBreak" },
        { type: "text", text: "둘째 줄" },
      ],
    };
    expect(extractNodeText(node)).toBe("첫째 줄\n둘째 줄");
  });

  it("extracts text from nested doc structure", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          content: [{ type: "text", text: "제목" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "본문" }],
        },
      ],
    };
    expect(extractNodeText(doc)).toBe("제목본문");
  });

  it("returns empty string for node without content", () => {
    expect(extractNodeText({ type: "paragraph" })).toBe("");
  });

  it("returns empty string for node with empty content array", () => {
    expect(extractNodeText({ type: "paragraph", content: [] })).toBe("");
  });
});

describe("applySearchReplace", () => {
  it("replaces all case-sensitive occurrences", () => {
    const result = applySearchReplace("AAA BBB AAA", "AAA", "CCC", true);
    expect(result.nextText).toBe("CCC BBB CCC");
    expect(result.replacements).toBe(2);
  });

  it("replaces case-insensitive occurrences", () => {
    const result = applySearchReplace("Hello hello HELLO", "hello", "world", false);
    expect(result.nextText).toBe("world world world");
    expect(result.replacements).toBe(3);
  });

  it("returns original text when search is empty", () => {
    const result = applySearchReplace("test", "", "x", true);
    expect(result.nextText).toBe("test");
    expect(result.replacements).toBe(0);
  });

  it("returns 0 replacements when no match found", () => {
    const result = applySearchReplace("hello world", "xyz", "abc", true);
    expect(result.nextText).toBe("hello world");
    expect(result.replacements).toBe(0);
  });

  it("handles regex special characters in search safely", () => {
    const result = applySearchReplace("1+2=3 and 1+2=3", "1+2=3", "X", false);
    expect(result.nextText).toBe("X and X");
    expect(result.replacements).toBe(2);
  });

  it("handles Korean text replacement", () => {
    const result = applySearchReplace("제안서를 작성합니다.", "제안서", "보고서", true);
    expect(result.nextText).toBe("보고서를 작성합니다.");
    expect(result.replacements).toBe(1);
  });

  it("replaces with empty string (deletion)", () => {
    const result = applySearchReplace("hello world", "world", "", true);
    expect(result.nextText).toBe("hello ");
    expect(result.replacements).toBe(1);
  });
});

describe("createUniqueHwpxFileName", () => {
  it("produces a .hwpx filename with stem and label", () => {
    const name = createUniqueHwpxFileName("report.hwpx", "save");
    expect(name).toMatch(/^report-save-\d{8}-\d{6}-\d{3}-\d{3}\.hwpx$/);
  });

  it("strips extension from original filename", () => {
    const name = createUniqueHwpxFileName("document.docx", "export");
    expect(name).toMatch(/^document-export-/);
    expect(name).toMatch(/\.hwpx$/);
  });

  it("uses 'document' when filename is empty", () => {
    const name = createUniqueHwpxFileName("", "test");
    expect(name).toMatch(/^document-test-/);
  });

  it("generates unique names on consecutive calls", () => {
    const a = createUniqueHwpxFileName("f.hwpx", "a");
    const b = createUniqueHwpxFileName("f.hwpx", "a");
    expect(a).not.toBe(b);
  });
});
