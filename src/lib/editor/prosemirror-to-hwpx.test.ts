import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  applyProseMirrorDocToHwpx,
  collectDocumentEdits,
  collectExportCompatibilityWarnings,
} from "./prosemirror-to-hwpx";
import type { EditorSegment } from "./hwpx-to-prosemirror";
import { parseHwpxToProseMirror } from "./hwpx-to-prosemirror";
import { buildCompatibilityWarning } from "./hwpx-compatibility";

function makeDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: {
          segmentId: "seg-1",
          fileName: "Contents/section0.xml",
          textIndex: 1,
          originalText: "원문 A",
        },
        content: [{ type: "text", text: "수정 A" }],
      },
      {
        type: "table",
        attrs: {
          tableId: "Contents/section0.xml::tbl::0",
          sourceRowCount: 1,
          sourceColCount: 1,
        },
        content: [
          {
            type: "tableRow",
            attrs: {
              rowIndex: 0,
              sourceCellCount: 1,
            },
            content: [
              {
                type: "tableCell",
                attrs: {
                  sourceColspan: 1,
                  sourceRowspan: 1,
                  colspan: 1,
                  rowspan: 1,
                },
                content: [
                  {
                    type: "paragraph",
                    attrs: {
                      segmentId: "seg-2",
                      fileName: "Contents/section0.xml",
                      textIndex: 2,
                      originalText: "원문 B",
                    },
                    content: [{ type: "text", text: "원문 B" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        attrs: {
          segmentId: "seg-3",
          fileName: "Contents/section0.xml",
          textIndex: 3,
          originalText: "원문 C",
        },
        content: [{ type: "text", text: "첫 줄" }, { type: "hardBreak" }, { type: "text", text: "둘째 줄" }],
      },
    ],
  };
}

describe("collectDocumentEdits", () => {
  it("extracts changed text from metadata-bound nodes only", () => {
    const sourceSegments: EditorSegment[] = [
      {
        segmentId: "seg-1",
        fileName: "Contents/section0.xml",
        textIndex: 1,
        text: "원문 A",
        originalText: "원문 A",
        tag: "hp:t",
        styleHints: {},
      },
      {
        segmentId: "seg-2",
        fileName: "Contents/section0.xml",
        textIndex: 2,
        text: "원문 B",
        originalText: "원문 B",
        tag: "hp:t",
        styleHints: {},
      },
      {
        segmentId: "seg-3",
        fileName: "Contents/section0.xml",
        textIndex: 3,
        text: "원문 C",
        originalText: "원문 C",
        tag: "hp:t",
        styleHints: {},
      },
    ];

    const result = collectDocumentEdits(makeDoc(), sourceSegments);
    expect(result.edits).toHaveLength(2);
    expect(result.edits[0]).toMatchObject({
      fileName: "Contents/section0.xml",
      textIndex: 1,
      oldText: "원문 A",
      newText: "수정 A",
    });
    expect(result.edits[1]).toMatchObject({
      fileName: "Contents/section0.xml",
      textIndex: 3,
      oldText: "원문 C",
      newText: "첫 줄\n둘째 줄",
    });
    expect(result.warnings).toEqual([]);
  });

  it("emits clear edits for extra segments when primary segment changes", () => {
    // Simulates a paragraph where two <hp:t> runs were merged during parsing.
    // The ProseMirror doc has ONE paragraph with the merged text.
    const sourceSegments: EditorSegment[] = [
      {
        segmentId: "seg-primary",
        fileName: "Contents/section0.xml",
        textIndex: 1,
        text: "앞부분 뒷부분",        // merged originalText set during parseSectionNode
        originalText: "앞부분 뒷부분",
        tag: "hp:t",
        styleHints: {},
      },
      {
        segmentId: "seg-extra",
        fileName: "Contents/section0.xml",
        textIndex: 2,
        text: "뒷부분",              // original single-run text (unchanged)
        originalText: "뒷부분",
        tag: "hp:t",
        styleHints: {},
      },
    ];
    const extraSegmentsMap: Record<string, string[]> = {
      "seg-primary": ["seg-extra"],
    };
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            segmentId: "seg-primary",
            fileName: "Contents/section0.xml",
            textIndex: 1,
            originalText: "앞부분 뒷부분",
          },
          content: [{ type: "text", text: "수정된 내용" }],
        },
      ],
    };

    const result = collectDocumentEdits(doc, sourceSegments, extraSegmentsMap);
    expect(result.warnings).toEqual([]);
    expect(result.edits).toHaveLength(2);
    expect(result.edits[0]).toMatchObject({
      id: "seg-primary",
      textIndex: 1,
      oldText: "앞부분 뒷부분",
      newText: "수정된 내용",
    });
    expect(result.edits[1]).toMatchObject({
      id: "seg-extra",
      textIndex: 2,
      oldText: "뒷부분",
      newText: "",
    });
  });

  it("does not emit extra edits when merged paragraph is unchanged", () => {
    const sourceSegments: EditorSegment[] = [
      {
        segmentId: "seg-primary",
        fileName: "Contents/section0.xml",
        textIndex: 1,
        text: "앞부분 뒷부분",
        originalText: "앞부분 뒷부분",
        tag: "hp:t",
        styleHints: {},
      },
      {
        segmentId: "seg-extra",
        fileName: "Contents/section0.xml",
        textIndex: 2,
        text: "뒷부분",
        originalText: "뒷부분",
        tag: "hp:t",
        styleHints: {},
      },
    ];
    const extraSegmentsMap: Record<string, string[]> = {
      "seg-primary": ["seg-extra"],
    };
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            segmentId: "seg-primary",
            fileName: "Contents/section0.xml",
            textIndex: 1,
            originalText: "앞부분 뒷부분",
          },
          content: [{ type: "text", text: "앞부분 뒷부분" }],  // unchanged
        },
      ],
    };

    const result = collectDocumentEdits(doc, sourceSegments, extraSegmentsMap);
    expect(result.edits).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });

  it("does not warn when table structure/merge change is patchable", () => {
    const sourceSegments: EditorSegment[] = [
      {
        segmentId: "seg-10",
        fileName: "Contents/section0.xml",
        textIndex: 10,
        text: "셀 원문",
        originalText: "셀 원문",
        tag: "hp:t",
        styleHints: {},
      },
    ];
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: {
            tableId: "Contents/section0.xml::tbl::0",
            sourceRowCount: 1,
            sourceColCount: 2,
          },
          content: [
            {
              type: "tableRow",
              attrs: {
                rowIndex: 0,
                sourceCellCount: 2,
              },
              content: [
                {
                  type: "tableCell",
                  attrs: {
                    cellId: "Contents/section0.xml::tbl::0::r0c0",
                    sourceRowspan: 1,
                    sourceColspan: 2,
                    colspan: 1,
                  },
                  content: [
                    {
                      type: "paragraph",
                      attrs: {
                        segmentId: "seg-10",
                        fileName: "Contents/section0.xml",
                        textIndex: 10,
                        originalText: "셀 원문",
                      },
                      content: [{ type: "text", text: "셀 원문" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              attrs: {
                rowIndex: 1,
                sourceCellCount: 2,
              },
              content: [],
            },
          ],
        },
      ],
    };

    const result = collectDocumentEdits(doc, sourceSegments);
    expect(result.edits).toEqual([]);
    // Sprint 4.1: grid validation now detects the empty row and missing cell
    expect(result.warnings).toEqual([
      "표(Contents/section0.xml::tbl::0) 1번째 행의 논리 열 수(0)가 표 전체 열 수(1)와 일치하지 않습니다.",
      "표(Contents/section0.xml::tbl::0)의 논리 격자에 빈 셀이 있습니다: (1,0)",
    ]);
  });

  it("includes compatibility warnings for unsupported nodes/marks", () => {
    const sourceSegments: EditorSegment[] = [
      {
        segmentId: "seg-1",
        fileName: "Contents/section0.xml",
        textIndex: 1,
        text: "원문 A",
        originalText: "원문 A",
        tag: "hp:t",
        styleHints: {},
      },
    ];
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            segmentId: "seg-1",
            fileName: "Contents/section0.xml",
            textIndex: 1,
            originalText: "원문 A",
          },
          content: [
            {
              type: "text",
              text: "원문 A",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
        {
          type: "image",
          attrs: { src: "https://example.com/test.png" },
        },
      ],
    };
    const result = collectDocumentEdits(doc, sourceSegments);
    expect(
      result.warnings.some((warning) => warning.includes("개체(image)")),
    ).toBe(false);
    expect(
      result.warnings.some((warning) => warning.includes("표식(link)")),
    ).toBe(true);
  });
});

describe("collectExportCompatibilityWarnings", () => {
  it("detects unsupported object nodes and marks", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A", marks: [{ type: "code" }] },
            { type: "text", text: "B", marks: [{ type: "link", attrs: { href: "#" } }] },
          ],
        },
        { type: "image", attrs: { src: "x" } },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }] },
      ],
    };
    const warnings = collectExportCompatibilityWarnings(doc);
    expect(warnings.some((warning) => warning.includes("개체(image)"))).toBe(false);
    expect(warnings.some((warning) => warning.includes("개체(blockquote)"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("표식(code)"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("표식(link)"))).toBe(true);
  });

  it("maps metadata-less text to an explicit compatibility warning", () => {
    const result = collectDocumentEdits(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "새 문단" }],
          },
        ],
      },
      [],
    );

    expect(result.warnings).toEqual([
      buildCompatibilityWarning("text.new-block-without-metadata"),
    ]);
  });

  it("maps unknown segment ids to an explicit compatibility warning", () => {
    const result = collectDocumentEdits(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: {
              segmentId: "unknown-seg",
              fileName: "Contents/section0.xml",
              textIndex: 99,
              originalText: "",
            },
            content: [{ type: "text", text: "수정 내용" }],
          },
        ],
      },
      [],
    );

    expect(result.warnings).toEqual([
      buildCompatibilityWarning("text.unknown-segment-id", "unknown-seg"),
    ]);
  });

  it("maps new tables without a source table id to an explicit compatibility warning", () => {
    const result = collectDocumentEdits(
      {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      [],
    );

    expect(result.warnings).toEqual([
      buildCompatibilityWarning("table.new-table-without-id"),
    ]);
  });
});

async function makeTableFixtureHwpx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"></opf:package>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p>
    <hp:run>
      <hp:tbl rowCnt="1" colCnt="2">
        <hp:tr>
          <hp:tc>
            <hp:subList><hp:p><hp:run><hp:t>A</hp:t></hp:run></hp:p></hp:subList>
            <hp:cellAddr colAddr="0" rowAddr="0"/>
            <hp:cellSpan colSpan="1" rowSpan="1"/>
          </hp:tc>
          <hp:tc>
            <hp:subList><hp:p><hp:run><hp:t>B</hp:t></hp:run></hp:p></hp:subList>
            <hp:cellAddr colAddr="1" rowAddr="0"/>
            <hp:cellSpan colSpan="1" rowSpan="1"/>
          </hp:tc>
        </hp:tr>
      </hp:tbl>
    </hp:run>
  </hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeLetterSpacingFixtureHwpx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"></opf:package>`,
  );
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:charProperties itemCnt="2">
      <hh:charPr id="1">
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="2">
        <hh:spacing hangul="-5" latin="-5" hanja="-5" japanese="-5" other="-5" symbol="-5" user="-5"/>
      </hh:charPr>
    </hh:charProperties>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run charPrIDRef="1"><hp:t>자간 변경 테스트</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeFontStyleFixtureHwpx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"></opf:package>`,
  );
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces itemCnt="7">
      <hh:fontface lang="HANGUL" fontCnt="2">
        <hh:font id="0" face="돋움" type="TTF" isEmbedded="0"/>
        <hh:font id="1" face="바탕" type="TTF" isEmbedded="0"/>
      </hh:fontface>
      <hh:fontface lang="LATIN" fontCnt="2">
        <hh:font id="0" face="Arial" type="TTF" isEmbedded="0"/>
        <hh:font id="1" face="Times New Roman" type="TTF" isEmbedded="0"/>
      </hh:fontface>
      <hh:fontface lang="HANJA" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="JAPANESE" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="OTHER" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="SYMBOL" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="USER" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
    </hh:fontfaces>
    <hh:charProperties itemCnt="1">
      <hh:charPr id="1" height="1000" textColor="#000000">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
    </hh:charProperties>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run charPrIDRef="1"><hp:t>폰트 저장 테스트</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeHighlightedFontStyleFixtureHwpx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"></opf:package>`,
  );
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces itemCnt="7">
      <hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="LATIN" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="HANJA" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="JAPANESE" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="OTHER" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="SYMBOL" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="USER" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
    </hh:fontfaces>
    <hh:charProperties itemCnt="1">
      <hh:charPr id="1" height="1000" textColor="#000000" shadeColor="#FFF2CC">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
    </hh:charProperties>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run charPrIDRef="1"><hp:t>하이라이트 해제 테스트</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeColoredFontStyleFixtureHwpx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"></opf:package>`,
  );
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces itemCnt="7">
      <hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="LATIN" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="HANJA" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="JAPANESE" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="OTHER" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="SYMBOL" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
      <hh:fontface lang="USER" fontCnt="1"><hh:font id="0" face="바탕" type="TTF" isEmbedded="0"/></hh:fontface>
    </hh:fontfaces>
    <hh:charProperties itemCnt="1">
      <hh:charPr id="1" height="1000" textColor="#FF0000" shadeColor="none">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
    </hh:charProperties>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run charPrIDRef="1"><hp:t>글자색 해제 테스트</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeHeadingStyleFixtureHwpx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf"></opf:package>`,
  );
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:charProperties itemCnt="1">
      <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none"/>
    </hh:charProperties>
    <hh:paraProperties itemCnt="1">
      <hh:paraPr id="6"/>
    </hh:paraProperties>
    <hh:styles>
      <hh:style id="0" name="바탕글" engName="Normal" type="para" paraPrIDRef="6" charPrIDRef="0"/>
      <hh:style id="1" name="개요 1" engName="Outline 1" type="para" paraPrIDRef="6" charPrIDRef="0"/>
      <hh:style id="2" name="개요 2" engName="Outline 2" type="para" paraPrIDRef="6" charPrIDRef="0"/>
    </hh:styles>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1" paraPrIDRef="6" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:t>본문 문단</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeImageFixtureHwpx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf">
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
    <opf:item id="settings" href="settings.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="header" linear="yes"/>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>`,
  );
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:charProperties itemCnt="1">
      <hh:charPr id="1" height="1000" textColor="#000000"/>
    </hh:charProperties>
    <hh:paraProperties itemCnt="1">
      <hh:paraPr id="0"/>
    </hh:paraProperties>
    <hh:styles>
      <hh:style id="0" name="바탕글" engName="Normal" type="para" paraPrIDRef="0" charPrIDRef="1"/>
    </hh:styles>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="1"><hp:t>원문</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
</hp:sec>`,
  );
  zip.file("settings.xml", `<?xml version="1.0" encoding="UTF-8"?><settings/>`);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

describe("applyProseMirrorDocToHwpx table patch", () => {
  it("applies row/col/merge changes by patching table XML fragment", async () => {
    const input = await makeTableFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = parsed.doc as JSONContent;
    const content = doc.content || [];
    const tableNode = content.find((node) => node.type === "table");
    expect(tableNode).toBeTruthy();
    if (!tableNode) {
      return;
    }

    tableNode.content = [
      {
        type: "tableRow",
        attrs: { rowIndex: 0, sourceCellCount: 2 },
        content: [
          {
            type: "tableCell",
            attrs: { sourceColspan: 1, sourceRowspan: 1, colspan: 2, rowspan: 1 },
            content: [{ type: "paragraph", content: [{ type: "text", text: "TOP" }] }],
          },
        ],
      },
      {
        type: "tableRow",
        attrs: { rowIndex: 1, sourceCellCount: 2 },
        content: [
          {
            type: "tableCell",
            attrs: { sourceColspan: 1, sourceRowspan: 1, colspan: 1, rowspan: 1 },
            content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }],
          },
          {
            type: "tableCell",
            attrs: { sourceColspan: 1, sourceRowspan: 1, colspan: 1, rowspan: 1 },
            content: [{ type: "paragraph", content: [{ type: "text", text: "D" }] }],
          },
        ],
      },
    ];

    const result = await applyProseMirrorDocToHwpx(input, doc, parsed.segments);
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const outXml = await outZip.file("Contents/section0.xml")!.async("string");
    expect(outXml).toContain(`rowCnt="2"`);
    expect(outXml).toContain(`colCnt="2"`);
    expect(outXml).toContain(`<hp:cellSpan colSpan="2" rowSpan="1"/>`);
    expect(outXml).toContain("<hp:t>TOP</hp:t>");
    expect(outXml).toContain("<hp:t>C</hp:t>");
    expect(outXml).toContain("<hp:t>D</hp:t>");
  });
});

describe("applyProseMirrorDocToHwpx letter spacing patch", () => {
  it("creates/rewires charPr in header.xml and updates run charPrIDRef by textIndex", async () => {
    const input = await makeLetterSpacingFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = (doc.content || []).find((node) => node.type === "paragraph");
    if (!paragraph) {
      throw new Error("paragraph not found in fixture");
    }
    paragraph.attrs = {
      ...(paragraph.attrs || {}),
      letterSpacing: 12,
    };

    const result = await applyProseMirrorDocToHwpx(input, doc, parsed.segments, parsed.extraSegmentsMap);
    expect(result.integrityIssues).toEqual([]);
    expect(result.edits).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    const headerDoc = new DOMParser().parseFromString(headerXml, "application/xml");
    const charProperties = Array.from(headerDoc.getElementsByTagName("*")).find(
      (node) => node.localName === "charProperties",
    );
    expect(charProperties).toBeTruthy();
    if (!charProperties) {
      return;
    }

    const charPrNodes = Array.from(charProperties.children).filter((child) => child.localName === "charPr");
    expect(charPrNodes.length).toBe(3);
    expect(charProperties.getAttribute("itemCnt")).toBe("3");

    const spacing12CharPr = charPrNodes.find((charPr) => {
      const spacing = Array.from(charPr.children).find((child) => child.localName === "spacing");
      return spacing?.getAttribute("hangul") === "12";
    });
    expect(spacing12CharPr).toBeTruthy();
    if (!spacing12CharPr) {
      return;
    }

    const newCharPrId = spacing12CharPr.getAttribute("id");
    expect(newCharPrId).toBeTruthy();
    expect(sectionXml).toContain(`charPrIDRef="${newCharPrId}"`);
  });
});

describe("applyProseMirrorDocToHwpx font style patch", () => {
  it("creates charPr with font family/size and rewires run charPrIDRef", async () => {
    const input = await makeFontStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = (doc.content || []).find((node) => node.type === "paragraph");
    if (!paragraph?.content?.length) {
      throw new Error("paragraph not found in fixture");
    }
    const firstText = paragraph.content.find((node) => node.type === "text");
    if (!firstText) {
      throw new Error("text node not found");
    }
    firstText.marks = [
      { type: "textStyle", attrs: { fontFamily: "바탕", fontSize: "14pt", backgroundColor: "#FFF2CC" } },
      { type: "highlight", attrs: { color: "#FFF2CC" } },
      { type: "superscript" },
    ];

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);
    expect(result.edits).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const headerDoc = new DOMParser().parseFromString(headerXml, "application/xml");

    const charProperties = Array.from(headerDoc.getElementsByTagName("*")).find(
      (node) => node.localName === "charProperties",
    );
    expect(charProperties).toBeTruthy();
    if (!charProperties) {
      return;
    }

    const charPrNodes = Array.from(charProperties.children).filter((child) => child.localName === "charPr");
    const created = charPrNodes.find((charPr) => {
      if (charPr.getAttribute("height") !== "1400") {
        return false;
      }
      if ((charPr.getAttribute("shadeColor") || "").toUpperCase() !== "#FFF2CC") {
        return false;
      }
      const fontRef = Array.from(charPr.children).find((child) => child.localName === "fontRef");
      const hasSupscript = Array.from(charPr.children).some((child) => child.localName === "supscript");
      return !!fontRef?.getAttribute("hangul") && hasSupscript;
    });
    expect(created).toBeTruthy();
    if (!created) {
      return;
    }
    const newCharPrId = created.getAttribute("id");
    expect(newCharPrId).toBeTruthy();
    expect(sectionXml).toContain(`charPrIDRef="${newCharPrId}"`);
  });

  it("adds underline/strikeout elements when base charPr has none", async () => {
    const input = await makeFontStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = (doc.content || []).find((node) => node.type === "paragraph");
    const firstText = paragraph?.content?.find((node) => node.type === "text");
    if (!firstText) {
      throw new Error("text node not found");
    }
    firstText.marks = [{ type: "underline" }, { type: "strike" }];

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");
    const headerDoc = new DOMParser().parseFromString(headerXml, "application/xml");
    const charPrNodes = Array.from(headerDoc.getElementsByTagName("*")).filter(
      (node) => node.localName === "charPr",
    );
    const created = charPrNodes.find((charPr) => {
      const underline = Array.from(charPr.children).find((child) => child.localName === "underline");
      const strikeout = Array.from(charPr.children).find((child) => child.localName === "strikeout");
      return (
        underline?.getAttribute("type") === "SINGLE" &&
        strikeout?.getAttribute("shape") === "SOLID"
      );
    });
    expect(created).toBeTruthy();
  });

  it("does not create duplicate charPr when marks equal source charPr style", async () => {
    const input = await makeFontStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;

    // import 결과를 그대로 저장 (textStyle mark가 source charPr와 동일한 상태)
    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");
    const headerDoc = new DOMParser().parseFromString(headerXml, "application/xml");
    const charPrNodes = Array.from(headerDoc.getElementsByTagName("*")).filter(
      (node) => node.localName === "charPr",
    );

    // source fixture has one charPr(id=1). no-op save should not append new charPr.
    expect(charPrNodes.length).toBe(1);
    expect(charPrNodes[0].getAttribute("id")).toBe("1");
  });

  it("removes highlight by setting shadeColor to none", async () => {
    const input = await makeHighlightedFontStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = (doc.content || []).find((node) => node.type === "paragraph");
    const firstText = paragraph?.content?.find((node) => node.type === "text");
    if (!firstText) {
      throw new Error("text node not found");
    }
    // highlight/backgroundColor를 제거
    firstText.marks = [{ type: "textStyle", attrs: { fontFamily: "바탕", fontSize: "10pt" } }];

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const headerDoc = new DOMParser().parseFromString(headerXml, "application/xml");

    const charPrNodes = Array.from(headerDoc.getElementsByTagName("*")).filter(
      (node) => node.localName === "charPr",
    );
    const cleared = charPrNodes.find((charPr) => (charPr.getAttribute("shadeColor") ?? "").toUpperCase() === "NONE");
    expect(cleared).toBeTruthy();
    const newCharPrId = cleared?.getAttribute("id");
    expect(newCharPrId).toBeTruthy();
    expect(sectionXml).toContain(`charPrIDRef="${newCharPrId}"`);
  });

  it("removes text color by falling back to black", async () => {
    const input = await makeColoredFontStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = (doc.content || []).find((node) => node.type === "paragraph");
    const firstText = paragraph?.content?.find((node) => node.type === "text");
    if (!firstText) {
      throw new Error("text node not found");
    }
    firstText.marks = [{ type: "textStyle", attrs: { fontFamily: "바탕", fontSize: "10pt" } }];

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const headerDoc = new DOMParser().parseFromString(headerXml, "application/xml");
    const charPrNodes = Array.from(headerDoc.getElementsByTagName("*")).filter(
      (node) => node.localName === "charPr",
    );
    const black = charPrNodes.find((charPr) => (charPr.getAttribute("textColor") ?? "").toUpperCase() === "#000000");
    expect(black).toBeTruthy();
    const newCharPrId = black?.getAttribute("id");
    expect(newCharPrId).toBeTruthy();
    expect(sectionXml).toContain(`charPrIDRef="${newCharPrId}"`);
  });

  it("preserves hardBreak even when paragraph has marks", async () => {
    const input = await makeFontStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = (doc.content || []).find((node) => node.type === "paragraph");
    if (!paragraph) {
      throw new Error("paragraph not found");
    }
    paragraph.content = [
      { type: "text", text: "첫줄", marks: [{ type: "bold" }] },
      { type: "hardBreak" },
      { type: "text", text: "둘째줄", marks: [{ type: "bold" }] },
    ];

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const hasHardBreakInText =
      /<hp:t>[^<]*\n[^<]*<\/hp:t>/.test(sectionXml) || /<hp:t>\n<\/hp:t>/.test(sectionXml);
    expect(hasHardBreakInText).toBe(true);
  });
});

describe("applyProseMirrorDocToHwpx heading style sync", () => {
  it("maps paragraph -> heading level to outline styleIDRef", async () => {
    const input = await makeHeadingStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = doc.content?.find((node) => node.type === "paragraph");
    if (!paragraph) {
      throw new Error("paragraph not found");
    }
    paragraph.type = "heading";
    paragraph.attrs = { ...(paragraph.attrs || {}), level: 2 };

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    expect(sectionXml).toContain(`styleIDRef="2"`);
  });

  it("maps heading -> paragraph back to default paragraph styleIDRef", async () => {
    const input = await makeHeadingStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const paragraph = doc.content?.find((node) => node.type === "paragraph");
    if (!paragraph) {
      throw new Error("paragraph not found");
    }
    paragraph.type = "heading";
    paragraph.attrs = { ...(paragraph.attrs || {}), level: 1 };

    const firstSave = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(firstSave.integrityIssues).toEqual([]);

    const firstBuffer = await firstSave.blob.arrayBuffer();
    const reparsed = await parseHwpxToProseMirror(firstBuffer);
    const secondDoc = JSON.parse(JSON.stringify(reparsed.doc)) as JSONContent;
    const heading = secondDoc.content?.find((node) => node.type === "heading");
    if (!heading) {
      throw new Error("heading not found");
    }
    heading.type = "paragraph";
    heading.attrs = { ...(heading.attrs || {}) };
    delete (heading.attrs as { level?: number }).level;

    const secondSave = await applyProseMirrorDocToHwpx(
      firstBuffer,
      secondDoc,
      reparsed.segments,
      reparsed.extraSegmentsMap,
      reparsed.hwpxDocumentModel,
    );
    expect(secondSave.integrityIssues).toEqual([]);

    const outBuffer = await secondSave.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    expect(sectionXml).toContain(`styleIDRef="0"`);
  });

  it("assigns heading styleIDRef to new orphan heading paragraphs", async () => {
    const input = await makeHeadingStyleFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    doc.content = [
      ...(doc.content ?? []),
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "새 개요 단락" }],
      },
    ];

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const orphanHeadingMatch = sectionXml.match(
      /<hp:p\b[^>]*styleIDRef="1"[^>]*>[\s\S]*?<hp:t>새 개요 단락<\/hp:t>/,
    );
    expect(orphanHeadingMatch).toBeTruthy();
  });
});

describe("applyProseMirrorDocToHwpx image patch", () => {
  it("embeds base64 image into BinData and section pic xml", async () => {
    const input = await makeImageFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const imageDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y5bQAAAAASUVORK5CYII=";

    doc.content = [
      ...(doc.content ?? []),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "이미지:" },
          {
            type: "image",
            attrs: {
              src: imageDataUrl,
              width: 24,
              height: 24,
              fileName: "dot.png",
              mimeType: "image/png",
            },
          },
          { type: "text", text: "끝" },
        ],
      },
    ];

    const result = await applyProseMirrorDocToHwpx(
      input,
      doc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("개체(image)"))).toBe(false);

    const outBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuffer);
    const contentHpf = await outZip.file("Contents/content.hpf")!.async("string");
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const contentDoc = new DOMParser().parseFromString(contentHpf, "application/xml");
    const imageItem = Array.from(contentDoc.getElementsByTagName("*")).find((node) => {
      if (node.localName !== "item") {
        return false;
      }
      const href = node.getAttribute("href") ?? "";
      return href.startsWith("BinData/image") && (node.getAttribute("media-type") ?? "") === "image/png";
    });
    expect(imageItem).toBeTruthy();
    if (!imageItem) {
      return;
    }
    const imageId = imageItem.getAttribute("id");
    const imageHref = imageItem.getAttribute("href");
    expect(imageId).toBeTruthy();
    expect(imageHref).toBeTruthy();
    if (!imageId || !imageHref) {
      return;
    }

    expect(outZip.file(imageHref)).toBeTruthy();
    expect(sectionXml).toContain("<hp:pic");
    expect(sectionXml).toContain('xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"');
    expect(sectionXml).toContain(`binaryItemIDRef="${imageId}"`);
    expect(sectionXml).toContain("<hp:t>이미지:</hp:t>");
    expect(sectionXml).toContain("<hp:t>끝</hp:t>");
  });
});
