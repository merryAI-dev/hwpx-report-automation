import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseHwpxToProseMirror } from "./hwpx-to-prosemirror";

async function makeMultiRunFixtureHwpx(): Promise<ArrayBuffer> {
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
    <hp:run><hp:t>앞부분 </hp:t></hp:run>
    <hp:run><hp:t>뒷부분</hp:t></hp:run>
  </hp:p>
  <hp:p>
    <hp:run>
      <hp:tbl rowCnt="1" colCnt="1">
        <hp:tr>
          <hp:tc>
            <hp:subList>
              <hp:p>
                <hp:run><hp:t>셀앞 </hp:t></hp:run>
                <hp:run><hp:t>셀뒤</hp:t></hp:run>
              </hp:p>
            </hp:subList>
          </hp:tc>
        </hp:tr>
      </hp:tbl>
    </hp:run>
  </hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeFixtureHwpx(): Promise<ArrayBuffer> {
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
  <hp:p><hp:run><hp:t>제1장 개요</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>본문 텍스트</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>첫 줄&#10;둘째 줄</hp:t></hp:run></hp:p>
  <hp:p>
    <hp:run>
      <hp:tbl rowCnt="1" colCnt="2">
        <hp:tr>
          <hp:tc colSpan="2">
            <hp:subList>
              <hp:p><hp:run><hp:t>셀A</hp:t></hp:run></hp:p>
            </hp:subList>
          </hp:tc>
          <hp:tc>
            <hp:subList>
              <hp:p><hp:run><hp:t>셀B</hp:t></hp:run></hp:p>
            </hp:subList>
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
        <hh:spacing hangul="-10" latin="-10" hanja="-10" japanese="-10" other="-10" symbol="-10" user="-10"/>
      </hh:charPr>
    </hh:charProperties>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run charPrIDRef="2"><hp:t>자간 테스트</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

async function makeComplexObjectFixtureHwpx(): Promise<ArrayBuffer> {
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
  <hp:p><hp:run><hp:t>본문</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:pic id="img-1"/><hp:t/></hp:run></hp:p>
  <hp:p><hp:run><hp:ctrl><hp:pageNum pos="BOTTOM_CENTER"/></hp:ctrl><hp:t/></hp:run></hp:p>
  <hp:p>
    <hp:bookmarkStart id="bm-1" name="main"/>
    <hp:run><hp:fieldBegin id="field-1"/><hp:t>필드 텍스트</hp:t></hp:run>
  </hp:p>
</hp:sec>`,
  );
  zip.file(
    "Contents/section1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t>두번째 섹션</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

describe("parseHwpxToProseMirror – multi-run merging", () => {
  it("merges multiple <hp:t> runs in the same <hp:p> into one paragraph", async () => {
    const dom = new JSDOM("");
    (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
    (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

    const input = await makeMultiRunFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    // 4 raw text nodes from inspectHwpx: "앞부분 ", "뒷부분", "셀앞 ", "셀뒤"
    // All 4 are in usedSegments (extra segments included)
    expect(parsed.segments).toHaveLength(4);

    // Outer paragraph: "앞부분 " + "뒷부분" → merged "앞부분 뒷부분"
    const outerSeg = parsed.segments[0];
    expect(outerSeg.text).toBe("앞부분 뒷부분");
    expect(outerSeg.originalText).toBe("앞부분 뒷부분");

    // extraSegmentsMap records "뒷부분" segment as extra for the outer paragraph
    const extraIds = parsed.extraSegmentsMap[outerSeg.segmentId];
    expect(extraIds).toHaveLength(1);
    expect(extraIds[0]).toBe(parsed.segments[1].segmentId);

    // The ProseMirror doc should have exactly ONE paragraph (not two)
    const content = parsed.doc.content || [];
    const paragraphs = content.filter((n) => n.type === "paragraph");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].content).toEqual([{ type: "text", text: "앞부분 뒷부분" }]);

    // Cell: "셀앞 " + "셀뒤" → merged "셀앞 셀뒤", one paragraph inside the cell
    const cellSeg = parsed.segments[2];
    expect(cellSeg.text).toBe("셀앞 셀뒤");
    const cellExtraIds = parsed.extraSegmentsMap[cellSeg.segmentId];
    expect(cellExtraIds).toHaveLength(1);

    const table = content.find((n) => n.type === "table");
    const cellNode = table?.content?.[0]?.content?.[0];
    expect(cellNode?.content).toHaveLength(1);
    expect(cellNode?.content?.[0]?.content).toEqual([{ type: "text", text: "셀앞 셀뒤" }]);
  });
});

describe("parseHwpxToProseMirror", () => {
  it("converts paragraphs/table while preserving segment metadata", async () => {
    const dom = new JSDOM("");
    (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
    (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

    const input = await makeFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    expect(parsed.integrityIssues).toEqual([]);
    expect(parsed.segments).toHaveLength(5);
    expect(parsed.segments.map((segment) => segment.text)).toEqual([
      "제1장 개요",
      "본문 텍스트",
      "첫 줄\n둘째 줄",
      "셀A",
      "셀B",
    ]);

    const content = parsed.doc.content || [];
    expect(content.some((node) => node.type === "heading")).toBe(true);
    expect(content.some((node) => node.type === "table")).toBe(true);
    const table = content.find((node) => node.type === "table");
    const tableAttrs = (table?.attrs || {}) as { tableId?: string; sourceRowCount?: number; sourceColCount?: number };
    expect(tableAttrs.tableId).toContain("Contents/section0.xml::tbl::");
    expect(tableAttrs.sourceRowCount).toBe(1);
    expect(tableAttrs.sourceColCount).toBe(2);
    const firstCell = table?.content?.[0]?.content?.[0];
    const cellAttrs = (firstCell?.attrs || {}) as { sourceColspan?: number; colspan?: number };
    expect(cellAttrs.sourceColspan).toBe(2);
    expect(cellAttrs.colspan).toBe(2);

    const multilineSegment = parsed.segments.find((segment) => segment.text.includes("\n"));
    expect(multilineSegment).toBeTruthy();
    const multilineNode = content.find((node) => {
      if (node.type !== "paragraph") {
        return false;
      }
      const attrs = (node.attrs || {}) as { segmentId?: string };
      return attrs.segmentId === multilineSegment?.segmentId;
    });
    expect(multilineNode?.content).toEqual([
      { type: "text", text: "첫 줄" },
      { type: "hardBreak" },
      { type: "text", text: "둘째 줄" },
    ]);
  });

  it("reads run charPr spacing from header.xml into paragraph letterSpacing attrs", async () => {
    const dom = new JSDOM("");
    (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
    (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

    const input = await makeLetterSpacingFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0].styleHints.charPrIDRef).toBe("2");
    expect(parsed.segments[0].styleHints.hwpxCharSpacing).toBe("-10");

    const paragraph = (parsed.doc.content || []).find((node) => node.type === "paragraph");
    expect((paragraph?.attrs || {}) as { letterSpacing?: number }).toMatchObject({ letterSpacing: -10 });
  });

  it("reports complex objects and multi-section documents for compatibility warnings", async () => {
    const dom = new JSDOM("");
    (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
    (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

    const input = await makeComplexObjectFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    expect(parsed.complexObjectReport.sectionCount).toBe(2);
    expect(parsed.complexObjectReport.counts.image).toBe(1);
    expect(parsed.complexObjectReport.counts.bookmark).toBe(1);
    expect(parsed.complexObjectReport.counts.field).toBe(1);
    expect(parsed.complexObjectReport.counts.pageControl).toBe(1);
    expect(parsed.complexObjectReport.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("멀티 섹션 문서"),
        expect.stringContaining("이미지 1건"),
        expect.stringContaining("북마크 1건"),
        expect.stringContaining("필드 1건"),
        expect.stringContaining("페이지 제어 1건"),
      ]),
    );
  });
});
