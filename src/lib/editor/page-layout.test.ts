import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { extractPagePr, injectPageSeparators, type PagePrValues } from "./page-layout";

function paragraph(text: string, attrs?: Record<string, unknown>): JSONContent {
  return {
    type: "paragraph",
    attrs,
    content: [{ type: "text", text }],
  };
}

const COMPACT_PAGE: PagePrValues = {
  width: 10000,
  height: 4000,
  marginLeft: 0,
  marginRight: 0,
  marginTop: 0,
  marginBottom: 0,
  headerHeight: 0,
  footerHeight: 0,
};

describe("extractPagePr", () => {
  it("falls back to A4 defaults when section XML has no pagePr", () => {
    const result = extractPagePr(`<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"/>`);

    expect(result).toEqual({
      width: 59528,
      height: 84188,
      marginLeft: 7087,
      marginRight: 7087,
      marginTop: 4252,
      marginBottom: 2835,
      headerHeight: 2835,
      footerHeight: 2835,
    });
  });

  it("reads pagePr and margin attributes from section XML", () => {
    const result = extractPagePr(`
      <hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <hp:pagePr width="60000" height="90000">
          <hp:margin left="1000" right="2000" top="3000" bottom="4000" header="500" footer="600"/>
        </hp:pagePr>
      </hp:sec>
    `);

    expect(result).toEqual({
      width: 60000,
      height: 90000,
      marginLeft: 1000,
      marginRight: 2000,
      marginTop: 3000,
      marginBottom: 4000,
      headerHeight: 500,
      footerHeight: 600,
    });
  });
});

describe("injectPageSeparators", () => {
  it("inserts an explicit separator before nodes with hwpxPageBreak", () => {
    const result = injectPageSeparators(
      [
        paragraph("first"),
        paragraph("second", { hwpxPageBreak: true }),
        paragraph("third"),
      ],
      COMPACT_PAGE,
    );

    expect(result).toEqual([
      paragraph("first"),
      { type: "pageSeparator", attrs: { pageNumber: 2, isExplicit: true } },
      paragraph("second", { hwpxPageBreak: true }),
      paragraph("third"),
    ]);
  });

  it("inserts a natural separator when usable height is exceeded", () => {
    const result = injectPageSeparators(
      [
        paragraph("one"),
        paragraph("two"),
        paragraph("three"),
      ],
      COMPACT_PAGE,
    );

    expect(result).toEqual([
      paragraph("one"),
      paragraph("two"),
      { type: "pageSeparator", attrs: { pageNumber: 2, isExplicit: false } },
      paragraph("three", { hwpxPageBreak: true }),
    ]);
  });

  it("is idempotent when separators are re-injected on existing output", () => {
    const firstPass = injectPageSeparators(
      [
        paragraph("one"),
        paragraph("two"),
        paragraph("three"),
      ],
      COMPACT_PAGE,
    );

    const secondPass = injectPageSeparators(firstPass, COMPACT_PAGE);

    expect(secondPass).toEqual(firstPass);
    expect(secondPass.filter((node) => node.type === "pageSeparator")).toHaveLength(1);
  });
});
