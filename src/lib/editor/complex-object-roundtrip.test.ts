import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseHwpxToProseMirror } from "./hwpx-to-prosemirror";
import { applyProseMirrorDocToHwpx } from "./prosemirror-to-hwpx";

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
  <hp:p><hp:run><hp:t>원본문단</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:pic id="img-1"/><hp:t/></hp:run></hp:p>
  <hp:p>
    <hp:bookmarkStart id="bm-1" name="main"/>
    <hp:run><hp:t>북마크 문단</hp:t></hp:run>
  </hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

function replaceSegmentInDoc(doc: JSONContent, segmentId: string, nextText: string): JSONContent {
  const clone = JSON.parse(JSON.stringify(doc)) as JSONContent;

  const visit = (node: JSONContent): boolean => {
    if (node.type === "paragraph" || node.type === "heading") {
      const attrs = (node.attrs || {}) as { segmentId?: string };
      if (attrs.segmentId === segmentId) {
        node.content = [{ type: "text", text: nextText }];
        return true;
      }
    }

    for (const child of node.content ?? []) {
      if (visit(child)) {
        return true;
      }
    }
    return false;
  };

  visit(clone);
  return clone;
}

describe("complex object roundtrip", () => {
  it("preserves raw complex-object XML while editing adjacent text paragraphs", async () => {
    const dom = new JSDOM("");
    (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
    (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;
    (globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;

    const input = await makeComplexObjectFixtureHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const target = parsed.segments.find((segment) => segment.text === "원본문단");

    expect(target).toBeTruthy();
    if (!target) {
      return;
    }

    const editedDoc = replaceSegmentInDoc(parsed.doc, target.segmentId, "수정된 문단");
    const result = await applyProseMirrorDocToHwpx(
      input,
      editedDoc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );

    expect(result.integrityIssues).toEqual([]);

    const outputBuffer = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outputBuffer);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    expect(sectionXml).toContain("수정된 문단");
    expect(sectionXml).toContain('<hp:pic id="img-1"/>');
    expect(sectionXml).toContain('<hp:bookmarkStart id="bm-1" name="main"/>');
  });
});
