import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseHwpxToProseMirror } from "./hwpx-to-prosemirror";
import {
  applyProseMirrorDocToHwpx,
} from "./prosemirror-to-hwpx";

// ── Helpers ──

/** Create a minimal 1x1 red PNG as base64 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

/**
 * Build a minimal HWPX ZIP with one section containing text and optionally an image.
 */
async function buildMinimalHwpxWithImage(options?: {
  includeImage?: boolean;
  imageId?: string;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const imageId = options?.imageId ?? "image1";
  const includeImage = options?.includeImage ?? true;

  // version.xml
  zip.file(
    "version.xml",
    '<?xml version="1.0" encoding="UTF-8"?><ha:HWPVersionXML xmlns:ha="urn:hancom:hwp:hidden:2011" version="5.1.1.0"/>',
  );

  // Contents/content.hpf — manifest with optional image item
  let manifestItems = `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>`;

  if (includeImage) {
    manifestItems += `\n    <opf:item id="${imageId}" href="BinData/${imageId}.png" media-type="image/png"/>`;
  }

  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf">
  <opf:manifest>
    ${manifestItems}
  </opf:manifest>
</opf:package>`,
  );

  // Contents/header.xml — minimal
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<ha:head xmlns:ha="urn:hancom:hwp:hidden:2011" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <ha:mappingTable>
    <ha:charProperties>
      <hp:charPr id="0"><hp:fontRef hangul="0" latin="0"/></hp:charPr>
    </ha:charProperties>
    <ha:paraProperties>
      <hp:paraPr id="0"><hp:align horizontal="JUSTIFY"/></hp:paraPr>
    </ha:paraProperties>
    <ha:borderFills/>
    <ha:styles>
      <hp:style id="0" name="바탕글" engName="Normal" type="PARAGRAPH" paraPrIDRef="0" charPrIDRef="0"/>
    </ha:styles>
  </ha:mappingTable>
</ha:head>`,
  );

  // Section XML — paragraph with text + optional image
  let sectionContent = `<hp:p paraPrIDRef="0" styleIDRef="0">
      <hp:run charPrIDRef="0"><hp:t>테스트 문단입니다.</hp:t></hp:run>
    </hp:p>`;

  if (includeImage) {
    sectionContent += `
    <hp:p paraPrIDRef="0" styleIDRef="0">
      <hp:run charPrIDRef="0">
        <hp:pic id="1" zOrder="0" numberingType="PICTURE" textWrap="SQUARE" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="1" reverse="0">
          <hp:offset x="0" y="0"/>
          <hp:orgSz width="24000" height="18000"/>
          <hp:curSz width="24000" height="18000"/>
          <hp:flip horizontal="0" vertical="0"/>
          <hp:rotationInfo angle="0" centerX="12000" centerY="9000" rotateimage="1"/>
          <hp:renderingInfo>
            <hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>
            <hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>
            <hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>
          </hp:renderingInfo>
          <hp:imgRect>
            <hc:pt0 x="0" y="0"/>
            <hc:pt1 x="24000" y="0"/>
            <hc:pt2 x="24000" y="18000"/>
            <hc:pt3 x="0" y="18000"/>
          </hp:imgRect>
          <hp:imgClip left="0" right="24000" top="0" bottom="18000"/>
          <hp:effects/>
          <hp:inMargin left="0" right="0" top="0" bottom="0"/>
          <hp:imgDim dimwidth="24000" dimheight="18000"/>
          <hc:img binaryItemIDRef="${imageId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>
          <hp:sz width="24000" widthRelTo="ABSOLUTE" height="18000" heightRelTo="ABSOLUTE" protect="0"/>
          <hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>
          <hp:outMargin left="0" right="0" top="0" bottom="0"/>
          <hp:shapeComment>test-image.png</hp:shapeComment>
        </hp:pic>
      </hp:run>
    </hp:p>`;

    // Add binary data
    const binaryData = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
    zip.file(`BinData/${imageId}.png`, binaryData);
  }

  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
    ${sectionContent}
</hp:sec>`,
  );

  return zip.generateAsync({ type: "arraybuffer" });
}

// ── Tests ──

describe("HWPX Image Roundtrip", () => {
  it("parses HWPX with image and creates image node in ProseMirror doc", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: true });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    // Should have both a paragraph and an image node
    const imageNodes = (parsed.doc.content ?? []).filter(
      (n: JSONContent) => n.type === "image",
    );
    expect(imageNodes.length).toBeGreaterThanOrEqual(1);

    const imgNode = imageNodes[0];
    expect(imgNode.attrs?.src).toContain("data:image/png;base64,");
    expect(imgNode.attrs?.binItemId).toBe("image1");
    expect(imgNode.attrs?.mimeType).toBe("image/png");
    expect(imgNode.attrs?.hwpunitWidth).toBe(24000);
    expect(imgNode.attrs?.hwpunitHeight).toBe(18000);
  });

  it("parses HWPX without images and produces no image nodes", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: false });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    const imageNodes = (parsed.doc.content ?? []).filter(
      (n: JSONContent) => n.type === "image",
    );
    expect(imageNodes).toHaveLength(0);
  });

  it("exports ProseMirror doc with image to HWPX with BinData entry", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: false });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    // Inject an image node into the doc
    const docWithImage: JSONContent = {
      ...parsed.doc,
      content: [
        ...(parsed.doc.content ?? []),
        {
          type: "image",
          attrs: {
            src: TINY_PNG_DATA_URL,
            alt: "test",
            width: 320,
            height: 240,
            mimeType: "image/png",
            fileName: "test.png",
          },
        },
      ],
    };

    const result = await applyProseMirrorDocToHwpx(
      hwpxBuffer,
      docWithImage,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );

    // Verify BinData entry exists in the output ZIP (exclude directory entries)
    const outputZip = await JSZip.loadAsync(result.blob);
    const binDataFiles = Object.keys(outputZip.files).filter(
      (f) => f.startsWith("BinData/") && !outputZip.files[f].dir,
    );
    expect(binDataFiles.length).toBeGreaterThanOrEqual(1);

    // Verify the image file contains actual data
    const imgFile = outputZip.files[binDataFiles[0]];
    expect(imgFile).toBeDefined();
    const imgData = await imgFile.async("uint8array");
    expect(imgData.length).toBeGreaterThan(10);
  });

  it("preserves existing images when only editing text", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: true });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    // Verify we got the image
    const imageNodes = (parsed.doc.content ?? []).filter(
      (n: JSONContent) => n.type === "image",
    );
    expect(imageNodes.length).toBeGreaterThanOrEqual(1);

    // Edit only the text paragraph (leave image untouched)
    const modifiedDoc: JSONContent = {
      ...parsed.doc,
      content: (parsed.doc.content ?? []).map((n: JSONContent) => {
        if (n.type === "paragraph" && n.content?.[0]?.text) {
          return {
            ...n,
            content: [{ type: "text", text: "수정된 문단입니다." }],
          };
        }
        return n;
      }),
    };

    const result = await applyProseMirrorDocToHwpx(
      hwpxBuffer,
      modifiedDoc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );

    // Original BinData should still be present
    const outputZip = await JSZip.loadAsync(result.blob);
    expect(outputZip.files["BinData/image1.png"]).toBeDefined();

    const imgData = await outputZip.files["BinData/image1.png"].async("uint8array");
    expect(imgData.length).toBeGreaterThan(10);
  });

  it("export includes image reference in section XML", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: false });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    const docWithImage: JSONContent = {
      ...parsed.doc,
      content: [
        ...(parsed.doc.content ?? []),
        {
          type: "image",
          attrs: {
            src: TINY_PNG_DATA_URL,
            alt: "test-export",
            width: 200,
            height: 150,
            mimeType: "image/png",
          },
        },
      ],
    };

    const result = await applyProseMirrorDocToHwpx(
      hwpxBuffer,
      docWithImage,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );

    // Check section XML contains hp:pic
    const outputZip = await JSZip.loadAsync(result.blob);
    const sectionFile = outputZip.files["Contents/section0.xml"];
    expect(sectionFile).toBeDefined();
    const sectionXml = await sectionFile.async("string");
    expect(sectionXml).toContain("hp:pic");
    expect(sectionXml).toContain("binaryItemIDRef");
  });

  it("export manifest includes image item", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: false });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    const docWithImage: JSONContent = {
      ...parsed.doc,
      content: [
        ...(parsed.doc.content ?? []),
        {
          type: "image",
          attrs: {
            src: TINY_PNG_DATA_URL,
            width: 100,
            height: 100,
            mimeType: "image/png",
          },
        },
      ],
    };

    const result = await applyProseMirrorDocToHwpx(
      hwpxBuffer,
      docWithImage,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );

    const outputZip = await JSZip.loadAsync(result.blob);
    const hpfFile = outputZip.files["Contents/content.hpf"];
    expect(hpfFile).toBeDefined();
    const hpfXml = await hpfFile.async("string");
    expect(hpfXml).toContain("image/png");
    expect(hpfXml).toContain("BinData/");
  });

  it("calculates pixel dimensions from HWPUNIT on import", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: true });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    const imageNode = (parsed.doc.content ?? []).find(
      (n: JSONContent) => n.type === "image",
    );
    expect(imageNode).toBeDefined();

    // 24000 HWPUNIT / 75 = 320px, 18000 / 75 = 240px
    expect(imageNode!.attrs!.width).toBe(320);
    expect(imageNode!.attrs!.height).toBe(240);
  });

  it("extracts shapeComment as alt text on import", async () => {
    const hwpxBuffer = await buildMinimalHwpxWithImage({ includeImage: true });
    const parsed = await parseHwpxToProseMirror(hwpxBuffer);

    const imageNode = (parsed.doc.content ?? []).find(
      (n: JSONContent) => n.type === "image",
    );
    expect(imageNode).toBeDefined();
    expect(imageNode!.attrs!.alt).toBe("test-image.png");
  });

  it("handles multiple images in sequence", async () => {
    // Build HWPX with two images manually
    const zip = new JSZip();
    zip.file("version.xml", '<?xml version="1.0"?><ha:HWPVersionXML xmlns:ha="urn:hancom:hwp:hidden:2011" version="5.1.1.0"/>');
    zip.file("Contents/header.xml", '<?xml version="1.0"?><ha:head xmlns:ha="urn:hancom:hwp:hidden:2011" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><ha:mappingTable><ha:charProperties><hp:charPr id="0"><hp:fontRef hangul="0" latin="0"/></hp:charPr></ha:charProperties><ha:paraProperties><hp:paraPr id="0"><hp:align horizontal="JUSTIFY"/></hp:paraPr></ha:paraProperties><ha:borderFills/><ha:styles><hp:style id="0" name="바탕글" engName="Normal" type="PARAGRAPH" paraPrIDRef="0" charPrIDRef="0"/></ha:styles></ha:mappingTable></ha:head>');

    const binaryData = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
    zip.file("BinData/img1.png", binaryData);
    zip.file("BinData/img2.png", binaryData);

    zip.file("Contents/content.hpf", `<?xml version="1.0"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>
  <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
  <opf:item id="img1" href="BinData/img1.png" media-type="image/png"/>
  <opf:item id="img2" href="BinData/img2.png" media-type="image/png"/>
</opf:manifest></opf:package>`);

    const picXml = (id: string, instid: string) => `<hp:pic id="${id}" zOrder="0" numberingType="PICTURE" textWrap="SQUARE" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instid}" reverse="0"><hp:orgSz width="7500" height="7500"/><hp:curSz width="7500" height="7500"/><hc:img binaryItemIDRef="${id === "10" ? "img1" : "img2"}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:sz width="7500" widthRelTo="ABSOLUTE" height="7500" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1"/></hp:pic>`;

    zip.file("Contents/section0.xml", `<?xml version="1.0"?><hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
  <hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">${picXml("10", "10")}</hp:run></hp:p>
  <hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">${picXml("11", "11")}</hp:run></hp:p>
</hp:sec>`);

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const parsed = await parseHwpxToProseMirror(buffer);

    const imageNodes = (parsed.doc.content ?? []).filter(
      (n: JSONContent) => n.type === "image",
    );
    expect(imageNodes.length).toBe(2);
    expect(imageNodes[0].attrs?.binItemId).toBe("img1");
    expect(imageNodes[1].attrs?.binItemId).toBe("img2");
  });
});
