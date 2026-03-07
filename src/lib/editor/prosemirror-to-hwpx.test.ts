import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { applyProseMirrorDocToHwpx, collectDocumentEdits } from "./prosemirror-to-hwpx";
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
    expect(result.warnings).toEqual([]);
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
