import { describe, it, expect } from "vitest";
import { markFingerprint, ensureCharPrForMarks, applyMarksToCharPrElement } from "./marks-to-charpr";

describe("markFingerprint", () => {
  it('returns "base" for undefined marks', () => {
    expect(markFingerprint(undefined)).toBe("base");
  });

  it('returns "base" for empty marks array', () => {
    expect(markFingerprint([])).toBe("base");
  });

  it("returns mark type for simple marks", () => {
    expect(markFingerprint([{ type: "bold" }])).toBe("bold");
  });

  it("sorts multiple marks deterministically", () => {
    const fp1 = markFingerprint([{ type: "bold" }, { type: "italic" }]);
    const fp2 = markFingerprint([{ type: "italic" }, { type: "bold" }]);
    expect(fp1).toBe(fp2);
    expect(fp1).toContain("bold");
    expect(fp1).toContain("italic");
  });

  it("includes textStyle attributes in fingerprint", () => {
    const fp = markFingerprint([
      { type: "textStyle", attrs: { color: "#FF0000", fontSize: "12pt" } },
    ]);
    expect(fp).toContain("color:#FF0000");
    expect(fp).toContain("fontSize:12");
  });

  it("includes fontFamily in fingerprint", () => {
    const fp = markFingerprint([
      { type: "textStyle", attrs: { fontFamily: "맑은 고딕" } },
    ]);
    expect(fp).toContain("fontFamily:맑은 고딕");
  });

  it("includes highlight color in fingerprint", () => {
    const fp = markFingerprint([
      { type: "highlight", attrs: { color: "#FFFF00" } },
    ]);
    expect(fp).toContain("highlight,color:#FFFF00");
  });

  it('returns "base" for textStyle with no meaningful attrs', () => {
    const fp = markFingerprint([{ type: "textStyle", attrs: {} }]);
    expect(fp).toBe("base");
  });
});

describe("ensureCharPrForMarks", () => {
  function createHeaderDoc(): Document {
    const xml = `<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
      <hh:refList>
        <hh:fontfaces itemCnt="1">
          <hh:fontface lang="HANGUL"><hh:font id="0" face="맑은 고딕"/></hh:fontface>
        </hh:fontfaces>
        <hh:charProperties itemCnt="1">
          <hh:charPr id="0" height="1000" textColor="#000000">
            <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
          </hh:charPr>
        </hh:charProperties>
      </hh:refList>
    </hh:head>`;
    return new DOMParser().parseFromString(xml, "application/xml");
  }

  function setup() {
    const headerDoc = createHeaderDoc();
    const charPropertiesEl = Array.from(headerDoc.getElementsByTagName("*")).find(
      (el) => el.localName === "charProperties",
    )!;
    const charPrById = new Map<string, Element>();
    for (const el of Array.from(charPropertiesEl.children)) {
      if (el.localName === "charPr") {
        const id = el.getAttribute("id");
        if (id) charPrById.set(id, el);
      }
    }
    return {
      charPropertiesEl,
      charPrById,
      charPrCache: new Map<string, string>(),
      nextCharPrId: { value: 1 },
      headerDoc,
    };
  }

  it("returns baseCharPrId when marks are empty", () => {
    const ctx = setup();
    const result = ensureCharPrForMarks({
      ...ctx,
      baseCharPrId: "0",
      marks: [],
    });
    expect(result).toBe("0");
  });

  it("returns baseCharPrId when marks are undefined", () => {
    const ctx = setup();
    const result = ensureCharPrForMarks({
      ...ctx,
      baseCharPrId: "0",
      marks: undefined,
    });
    expect(result).toBe("0");
  });

  it("creates new charPr for bold mark", () => {
    const ctx = setup();
    const result = ensureCharPrForMarks({
      ...ctx,
      baseCharPrId: "0",
      marks: [{ type: "bold" }],
    });
    expect(result).not.toBe("0");
    expect(ctx.charPrById.has(result)).toBe(true);
    // Check the new charPr has a bold child
    const newEl = ctx.charPrById.get(result)!;
    const hasBold = Array.from(newEl.children).some((c) => c.localName === "bold");
    expect(hasBold).toBe(true);
  });

  it("caches identical mark combinations", () => {
    const ctx = setup();
    const r1 = ensureCharPrForMarks({
      ...ctx,
      baseCharPrId: "0",
      marks: [{ type: "bold" }],
    });
    const r2 = ensureCharPrForMarks({
      ...ctx,
      baseCharPrId: "0",
      marks: [{ type: "bold" }],
    });
    expect(r1).toBe(r2);
  });

  it("returns baseCharPrId when source not found", () => {
    const ctx = setup();
    const result = ensureCharPrForMarks({
      ...ctx,
      baseCharPrId: "999",
      marks: [{ type: "bold" }],
    });
    expect(result).toBe("999");
  });
});

describe("applyMarksToCharPrElement", () => {
  function createCharPr(): { el: Element; doc: Document } {
    const xml = `<hh:charPr xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" id="0" height="1000"/>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return { el: doc.documentElement, doc };
  }

  it("adds bold element when bold mark present", () => {
    const { el, doc } = createCharPr();
    applyMarksToCharPrElement(el, [{ type: "bold" }], doc);
    const hasBold = Array.from(el.children).some((c) => c.localName === "bold");
    expect(hasBold).toBe(true);
  });

  it("adds italic element when italic mark present", () => {
    const { el, doc } = createCharPr();
    applyMarksToCharPrElement(el, [{ type: "italic" }], doc);
    const hasItalic = Array.from(el.children).some((c) => c.localName === "italic");
    expect(hasItalic).toBe(true);
  });

  it("adds underline element when underline mark present", () => {
    const { el, doc } = createCharPr();
    applyMarksToCharPrElement(el, [{ type: "underline" }], doc);
    const underline = Array.from(el.children).find((c) => c.localName === "underline");
    expect(underline).toBeDefined();
    expect(underline?.getAttribute("type")).toBe("SINGLE");
  });

  it("adds strikeout element when strike mark present", () => {
    const { el, doc } = createCharPr();
    applyMarksToCharPrElement(el, [{ type: "strike" }], doc);
    const strikeout = Array.from(el.children).find((c) => c.localName === "strikeout");
    expect(strikeout).toBeDefined();
    expect(strikeout?.getAttribute("shape")).toBe("SOLID");
  });
});
