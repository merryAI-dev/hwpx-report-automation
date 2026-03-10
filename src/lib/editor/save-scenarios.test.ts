/**
 * save-scenarios.test.ts
 *
 * RALPH 루프용 저장 시나리오 테스트.
 * 각 케이스는 실제 사용자가 겪을 수 있는 저장 경로를 검증.
 *
 * 실행: npx vitest --watch src/lib/editor/save-scenarios.test.ts
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseHwpxToProseMirror } from "./hwpx-to-prosemirror";
import { applyProseMirrorDocToHwpx } from "./prosemirror-to-hwpx";
import { buildHwpxModelFromDoc } from "./hwpx-template-synthesizer";

// ─── 픽스처 헬퍼 ────────────────────────────────────────────────────────────

const NS = {
  hs: "http://www.hancom.co.kr/hwpml/2011/section",
  hp: "http://www.hancom.co.kr/hwpml/2011/paragraph",
  hh: "http://www.hancom.co.kr/hwpml/2011/head",
  opf: "http://www.idpf.org/2007/opf",
};

function baseZip(): JSZip {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="${NS.opf}"></opf:package>`,
  );
  return zip;
}

/** 단일 단락 HWPX (charPr 없음, 마크 없음) */
async function makeSingleParaHwpx(text: string, paraId = "1"): Promise<ArrayBuffer> {
  const zip = baseZip();
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}">
  <hp:p id="${paraId}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
</hs:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

/** charPr 5(비볼드) + charPr 6(볼드)를 가진 mixed 단락 HWPX */
async function makeBoldNonBoldParaHwpx(): Promise<ArrayBuffer> {
  const zip = baseZip();
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="${NS.hh}">
  <hh:refList>
    <hh:charProperties itemCnt="2">
      <hh:charPr id="5" height="1000" textColor="#000000" shadeColor="none"
        useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:underline type="NONE" shape="SOLID" color="#000000"/>
        <hh:strikeout shape="NONE" color="#000000"/>
        <hh:outline type="NONE"/>
        <hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>
      </hh:charPr>
      <hh:charPr id="6" height="1000" textColor="#000000" shadeColor="none"
        useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:bold/>
        <hh:underline type="NONE" shape="SOLID" color="#000000"/>
        <hh:strikeout shape="NONE" color="#000000"/>
        <hh:outline type="NONE"/>
        <hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>
      </hh:charPr>
    </hh:charProperties>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}">
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="6"><hp:t>금융위원장 김주현</hp:t></hp:run>
    <hp:run charPrIDRef="5"><hp:t>입니다.</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
</hs:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

/** charPr 교차 단락 HWPX (볼드↔비볼드 여러 번) */
async function makeAlternatingBoldHwpx(): Promise<ArrayBuffer> {
  const zip = baseZip();
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="${NS.hh}">
  <hh:refList>
    <hh:charProperties itemCnt="2">
      <hh:charPr id="10" height="1000" textColor="#000000" shadeColor="none"
        useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:underline type="NONE" shape="SOLID" color="#000000"/>
        <hh:strikeout shape="NONE" color="#000000"/>
        <hh:outline type="NONE"/>
        <hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>
      </hh:charPr>
      <hh:charPr id="11" height="1000" textColor="#000000" shadeColor="none"
        useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:bold/>
        <hh:underline type="NONE" shape="SOLID" color="#000000"/>
        <hh:strikeout shape="NONE" color="#000000"/>
        <hh:outline type="NONE"/>
        <hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>
      </hh:charPr>
    </hh:charProperties>
  </hh:refList>
</hh:head>`,
  );
  // 볼드(11) → 비볼드(10) → 볼드(11) → 비볼드(10) 교차
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}">
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="11"><hp:t>A</hp:t></hp:run>
    <hp:run charPrIDRef="10"><hp:t>B</hp:t></hp:run>
    <hp:run charPrIDRef="11"><hp:t>C</hp:t></hp:run>
    <hp:run charPrIDRef="10"><hp:t>D</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
</hs:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

/** 두 단락 HWPX */
async function makeTwoParaHwpx(): Promise<ArrayBuffer> {
  const zip = baseZip();
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}">
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:t>첫 번째 단락</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
  <hp:p id="2" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:t>두 번째 단락</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
</hs:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

// ─── 헬퍼: 저장 후 section0.xml 텍스트 반환 ─────────────────────────────────

async function getOutputSectionXml(
  input: ArrayBuffer,
  doc: JSONContent,
  parsed: Awaited<ReturnType<typeof parseHwpxToProseMirror>>,
): Promise<string> {
  const result = await applyProseMirrorDocToHwpx(
    input,
    doc,
    parsed.segments,
    parsed.extraSegmentsMap,
    parsed.hwpxDocumentModel,
  );
  expect(result.integrityIssues).toEqual([]);
  const outBuf = await result.blob.arrayBuffer();
  const outZip = await JSZip.loadAsync(outBuf);
  return outZip.file("Contents/section0.xml")!.async("string");
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
    .length;
}

function hasParagraphWithIdAndText(sectionXml: string, text: string): boolean {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<hp:p\\b[^>]*\\bid="\\d+"[^>]*>[\\s\\S]*?<hp:t>${escaped}</hp:t>`);
  return re.test(sectionXml);
}

// ─── 볼드 마크 단위 테스트 ───────────────────────────────────────────────────

describe("시나리오 1: 기존 텍스트 수정 저장", () => {
  it("기존 단락 텍스트 수정이 저장된다", async () => {
    const input = await makeSingleParaHwpx("원본 텍스트");
    const parsed = await parseHwpxToProseMirror(input);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    // 첫 번째 단락 텍스트 수정
    const para = doc.content!.find((n: JSONContent) => n.type === "paragraph");
    if (para?.content) para.content = [{ type: "text", text: "수정된 텍스트" }];

    const xml = await getOutputSectionXml(input, doc, parsed);
    expect(xml).toContain("수정된 텍스트");
    expect(xml).not.toContain("원본 텍스트");
  });
});

describe("시나리오 2: 새 단락 추가 저장", () => {
  it("기존 문서에 새 단락을 추가하면 저장에 반영된다", async () => {
    const input = await makeTwoParaHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    // paraId 없는 새 단락 추가 (사용자가 직접 타이핑한 상황)
    doc.content!.push({
      type: "paragraph",
      content: [{ type: "text", text: "사용자가 추가한 새 단락" }],
    });

    const xml = await getOutputSectionXml(input, doc, parsed);
    expect(xml).toContain("첫 번째 단락");
    expect(xml).toContain("두 번째 단락");
    expect(xml).toContain("사용자가 추가한 새 단락"); // ← 현재 실패 예상
    expect(hasParagraphWithIdAndText(xml, "사용자가 추가한 새 단락")).toBe(true);
  });

  it("기존 단락 사이에 새 단락을 삽입하면 저장에 반영된다", async () => {
    const input = await makeTwoParaHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    // 두 단락 사이에 새 단락 삽입
    doc.content!.splice(1, 0, {
      type: "paragraph",
      content: [{ type: "text", text: "중간에 삽입된 단락" }],
    });

    const xml = await getOutputSectionXml(input, doc, parsed);
    expect(xml).toContain("중간에 삽입된 단락"); // ← 현재 실패 예상
    // 순서도 맞아야 한다
    const pos1 = xml.indexOf("첫 번째 단락");
    const posNew = xml.indexOf("중간에 삽입된 단락");
    const pos2 = xml.indexOf("두 번째 단락");
    expect(pos1).toBeLessThan(posNew);
    expect(posNew).toBeLessThan(pos2);
  });

  it("모델에 없는 paraId를 가진 새 단락도 orphan 처리되어 저장된다", async () => {
    const input = await makeTwoParaHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    doc.content!.push({
      type: "paragraph",
      attrs: { paraId: "dangling-para-id" },
      content: [{ type: "text", text: "모델 불일치 신규 단락" }],
    });

    const xml = await getOutputSectionXml(input, doc, parsed);
    expect(xml).toContain("모델 불일치 신규 단락");
    expect(hasParagraphWithIdAndText(xml, "모델 불일치 신규 단락")).toBe(true);
  });
});

describe("시나리오 3: 단락 삭제 저장", () => {
  it("단락을 삭제하면 저장된 XML에서도 제거된다", async () => {
    const input = await makeTwoParaHwpx();
    const parsed = await parseHwpxToProseMirror(input);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    // 두 번째 단락 삭제
    doc.content = doc.content!.filter(
      (n: JSONContent) => !JSON.stringify(n).includes("두 번째 단락"),
    );

    const xml = await getOutputSectionXml(input, doc, parsed);
    expect(xml).toContain("첫 번째 단락");
    expect(xml).not.toContain("두 번째 단락");
  });
});

describe("시나리오 4: 볼드 마크 저장 (핵심 버그)", () => {
  it("볼드 첫 런 다음에 오는 비볼드 런이 비볼드로 저장된다", async () => {
    // 재현: charPrIDRef=6(볼드)→charPrIDRef=5(비볼드) 단락에서
    // "입니다."가 볼드로 잘못 저장되는 버그
    const input = await makeBoldNonBoldParaHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    expect(parsed.integrityIssues).toEqual([]);

    // ProseMirror 파싱 결과 확인: "금융위원장 김주현"=bold, "입니다."=normal
    const para = parsed.doc.content!.find((n: JSONContent) => n.type === "paragraph");
    expect(para).toBeTruthy();
    const boldNode = para!.content!.find(
      (n: JSONContent) => n.type === "text" && n.marks?.some((m) => m.type === "bold"),
    );
    const plainNode = para!.content!.find(
      (n: JSONContent) => n.type === "text" && !n.marks?.some((m) => m.type === "bold"),
    );
    expect(boldNode?.text).toBe("금융위원장 김주현");
    expect(plainNode?.text).toBe("입니다.");

    // 저장 후 header.xml에서 charPr 볼드 여부 확인
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");

    // section.xml에서 각 run의 charPrIDRef 추출
    const runMatch = [...sectionXml.matchAll(/<hp:run charPrIDRef="(\d+)"><hp:t>([^<]*)<\/hp:t><\/hp:run>/g)];
    const boldRun = runMatch.find(m => m[2] === "금융위원장 김주현");
    const plainRun = runMatch.find(m => m[2] === "입니다.");

    expect(boldRun).toBeTruthy();
    expect(plainRun).toBeTruthy();

    // header.xml에서 해당 charPr의 bold 여부 확인
    const boldCharPrId = boldRun![1];
    const plainCharPrId = plainRun![1];

    const hasBold = (id: string) => {
      const re = new RegExp(`charPr id="${id}"[^]*?</hh:charPr>`);
      const match = headerXml.match(re);
      return match ? match[0].includes("<hh:bold") : false;
    };

    expect(hasBold(boldCharPrId)).toBe(true);   // "금융위원장 김주현" → bold ✓
    expect(hasBold(plainCharPrId)).toBe(false);  // "입니다." → non-bold ✓ (현재 실패)
  });

  it("볼드↔비볼드 교차 단락에서 각 런의 볼드 상태가 정확히 보존된다", async () => {
    const input = await makeAlternatingBoldHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    expect(parsed.integrityIssues).toEqual([]);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    const headerXml = await outZip.file("Contents/header.xml")!.async("string");

    const runMatch = [...sectionXml.matchAll(/<hp:run charPrIDRef="(\d+)"><hp:t>([^<]*)<\/hp:t><\/hp:run>/g)];
    const getCharPrId = (text: string) => runMatch.find(m => m[2] === text)?.[1];

    const hasBold = (id: string | undefined) => {
      if (!id) return null;
      const re = new RegExp(`charPr id="${id}"[^]*?</hh:charPr>`);
      const match = headerXml.match(re);
      return match ? match[0].includes("<hh:bold") : false;
    };

    // A, C = 볼드 / B, D = 비볼드
    expect(hasBold(getCharPrId("A"))).toBe(true);   // ← 현재 실패 가능
    expect(hasBold(getCharPrId("B"))).toBe(false);  // ← 현재 실패 가능
    expect(hasBold(getCharPrId("C"))).toBe(true);
    expect(hasBold(getCharPrId("D"))).toBe(false);
  });
});

// ─── PPTX/DOCX 변환 시뮬레이션 헬퍼 ──────────────────────────────────────────

/**
 * buildHwpxModelFromDoc()에 필요한 최소한의 HWPX 템플릿 버퍼.
 * parseStyleMap()이 읽을 수 있는 <hh:style> 원소 포함.
 */
async function makeMinimalHwpxTemplate(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?><version app="test"/>`);
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="${NS.opf}"></opf:package>`,
  );
  zip.file(
    "Contents/header.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="${NS.hh}">
  <hh:refList>
    <hh:charProperties itemCnt="1">
      <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none"
        useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:underline type="NONE" shape="SOLID" color="#000000"/>
        <hh:strikeout shape="NONE" color="#000000"/>
        <hh:outline type="NONE"/>
        <hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>
      </hh:charPr>
    </hh:charProperties>
    <hh:paraProperties itemCnt="1">
      <hh:paraPr id="6" tabStop="1000" condense="0" fontLineHeight="0" snapToGrid="1"
        suppressOverlap="0" checked="1">
        <hh:lineSpacing type="percent" value="160"/>
      </hh:paraPr>
    </hh:paraProperties>
    <hh:styles>
      <hh:style id="0" name="바탕글" engName="Normal" type="para"
        nextStyleIDRef="0" langID="1042" lockForm="0"
        paraPrIDRef="6" charPrIDRef="0"/>
      <hh:style id="1" name="개요 1" engName="Outline 1" type="para"
        nextStyleIDRef="0" langID="1042" lockForm="0"
        paraPrIDRef="6" charPrIDRef="0"/>
      <hh:style id="2" name="개요 2" engName="Outline 2" type="para"
        nextStyleIDRef="0" langID="1042" lockForm="0"
        paraPrIDRef="6" charPrIDRef="0"/>
    </hh:styles>
  </hh:refList>
</hh:head>`,
  );
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}">
</hs:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

/**
 * PPTX → HWPX 변환 흐름 시뮬레이션:
 * 1. 텍스트 내용이 있는 doc 생성 (segmentId는 있지만 paraId 없음)
 * 2. buildHwpxModelFromDoc으로 paraId 주입 + HwpxDocumentModel 생성
 * 3. {doc, hwpxDocumentModel, templateBuffer} 반환
 */
async function simulatePptxLoad(texts: string[]): Promise<{
  doc: JSONContent;
  hwpxDocumentModel: Awaited<ReturnType<typeof buildHwpxModelFromDoc>>;
  templateBuffer: ArrayBuffer;
}> {
  const templateBuffer = await makeMinimalHwpxTemplate();
  const doc: JSONContent = {
    type: "doc",
    content: texts.map((text, i) => ({
      type: "paragraph",
      attrs: { segmentId: `pptx::${i}`, originalText: text },
      content: [{ type: "text", text }],
    })),
  };
  const hwpxDocumentModel = await buildHwpxModelFromDoc(templateBuffer, doc);
  return { doc, hwpxDocumentModel, templateBuffer };
}

describe("시나리오 6: PPTX 변환 후 저장 (HWPX 경로)", () => {
  it("새 단락을 HwpxParaAutoAssign으로 합성한 뒤 타이핑한 텍스트가 저장된다 (핵심 버그)", async () => {
    // 재현: synthesizeParaNode가 만드는 blank XML의 <hp:t></hp:t>는
    // scanXmlTextSegments에서 whitespace로 처리 → applyLocalTextPatch가 segments.length===0 보고 반환
    const { doc, hwpxDocumentModel, templateBuffer } = await simulatePptxLoad(["기존 내용"]);

    // 실제 HwpxParaAutoAssign 동작 시뮬레이션:
    // 1. 새 단락이 생성되고 synthesizeParaNode로 paraNode 합성
    // 2. 해당 단락에 사용자가 텍스트 입력
    const { synthesizeParaNode } = await import("./para-synthesizer");
    const existingPara = doc.content![0]!;
    const existingParaId = (existingPara.attrs as Record<string, string>).paraId;
    const siblingPara = hwpxDocumentModel.paraStore.get(existingParaId);

    const newParaId = "test-para-uuid-1234";
    const newPara = synthesizeParaNode(siblingPara ?? null, newParaId, "Contents/section0.xml");
    hwpxDocumentModel.paraStore.set(newParaId, newPara);
    hwpxDocumentModel.sections[0].blocks.push({
      type: "para",
      paraId: newParaId,
      leadingWhitespace: "\n  ",
    });

    // 사용자가 새 단락에 "챱추 챱추추" 타이핑
    doc.content!.push({
      type: "paragraph",
      attrs: { paraId: newParaId, fileName: "Contents/section0.xml" },
      content: [{ type: "text", text: "챱추 챱추추" }],
    });

    const result = await applyProseMirrorDocToHwpx(
      templateBuffer, doc, [], {}, hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    expect(sectionXml).toContain("기존 내용");
    expect(sectionXml).toContain("챱추 챱추추"); // ← 이게 버그 포인트
  });

  it("PPTX에서 변환된 문서의 텍스트 수정이 저장된다", async () => {
    const { doc, hwpxDocumentModel, templateBuffer } = await simulatePptxLoad([
      "슬라이드 제목",
      "본문 내용입니다",
    ]);

    // 두 번째 단락 텍스트 수정
    const para = doc.content!.find(
      (n: JSONContent) => n.content?.[0]?.text === "본문 내용입니다",
    );
    if (para?.content) para.content = [{ type: "text", text: "수정된 본문" }];

    const result = await applyProseMirrorDocToHwpx(
      templateBuffer, doc, [], {}, hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    expect(sectionXml).toContain("슬라이드 제목");
    expect(sectionXml).toContain("수정된 본문");
    expect(sectionXml).not.toContain("본문 내용입니다");
  });

  it("PPTX 변환 문서에 새 단락을 추가하면 저장에 반영된다", async () => {
    const { doc, hwpxDocumentModel, templateBuffer } = await simulatePptxLoad([
      "슬라이드 제목",
      "기존 본문",
    ]);

    // 새 단락 추가 (paraId 없음)
    doc.content!.push({
      type: "paragraph",
      content: [{ type: "text", text: "사용자가 추가한 내용" }],
    });

    const result = await applyProseMirrorDocToHwpx(
      templateBuffer, doc, [], {}, hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    expect(sectionXml).toContain("슬라이드 제목");
    expect(sectionXml).toContain("기존 본문");
    expect(sectionXml).toContain("사용자가 추가한 내용");
    expect(hasParagraphWithIdAndText(sectionXml, "사용자가 추가한 내용")).toBe(true);
  });
});

describe("시나리오 5: 라운드트립 재파싱", () => {
  it("저장 후 다시 파싱해도 볼드 구조가 유지된다", async () => {
    const input = await makeBoldNonBoldParaHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;

    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );
    const outBuf = await result.blob.arrayBuffer();

    // 저장된 파일을 다시 파싱
    const reparsed = await parseHwpxToProseMirror(outBuf);
    expect(reparsed.integrityIssues).toEqual([]);

    const para = reparsed.doc.content!.find((n: JSONContent) => n.type === "paragraph");
    const boldNode = para?.content?.find(
      (n: JSONContent) => n.type === "text" && n.marks?.some((m) => m.type === "bold"),
    );
    const plainNode = para?.content?.find(
      (n: JSONContent) => n.type === "text" && !n.marks?.some((m) => m.type === "bold"),
    );

    // 재파싱 후에도 볼드/비볼드 구분이 유지되어야 한다
    expect(boldNode?.text).toBe("금융위원장 김주현"); // ← 현재 실패 가능
    expect(plainNode?.text).toBe("입니다.");          // ← 현재 실패 가능
  });
});

// ─── 표 저장 테스트 ───────────────────────────────────────────────────────────

/**
 * 2×2 표가 들어있는 HWPX 픽스처.
 * 첫 번째 행: 헤더1 | 헤더2
 * 두 번째 행: 값1   | 값2
 */
async function makeTableHwpx(): Promise<ArrayBuffer> {
  const zip = baseZip();
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}">
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:tbl id="0" rowCnt="2" colCnt="2" cellSpacing="0" borderFillIDRef="1" noAdjust="0">
      <hp:tr>
        <hp:tc>
          <hp:subList>
            <hp:p id="10" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
              <hp:run charPrIDRef="0"><hp:t>헤더1</hp:t></hp:run>
              <hp:linesegarray/>
            </hp:p>
          </hp:subList>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
        <hp:tc>
          <hp:subList>
            <hp:p id="11" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
              <hp:run charPrIDRef="0"><hp:t>헤더2</hp:t></hp:run>
              <hp:linesegarray/>
            </hp:p>
          </hp:subList>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc>
          <hp:subList>
            <hp:p id="12" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
              <hp:run charPrIDRef="0"><hp:t>값1</hp:t></hp:run>
              <hp:linesegarray/>
            </hp:p>
          </hp:subList>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
        <hp:tc>
          <hp:subList>
            <hp:p id="13" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
              <hp:run charPrIDRef="0"><hp:t>값2</hp:t></hp:run>
              <hp:linesegarray/>
            </hp:p>
          </hp:subList>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
      </hp:tr>
    </hp:tbl>
    <hp:linesegarray/>
  </hp:p>
</hs:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

/**
 * 표 + 일반 단락이 섞인 HWPX 픽스처.
 */
async function makeTableWithParasHwpx(): Promise<ArrayBuffer> {
  const zip = baseZip();
  zip.file(
    "Contents/section0.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}">
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:t>표 앞 단락</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
  <hp:p id="2" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:tbl id="0" rowCnt="1" colCnt="2" cellSpacing="0" borderFillIDRef="1" noAdjust="0">
      <hp:tr>
        <hp:tc>
          <hp:subList>
            <hp:p id="20" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
              <hp:run charPrIDRef="0"><hp:t>A열</hp:t></hp:run>
              <hp:linesegarray/>
            </hp:p>
          </hp:subList>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
        <hp:tc>
          <hp:subList>
            <hp:p id="21" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
              <hp:run charPrIDRef="0"><hp:t>B열</hp:t></hp:run>
              <hp:linesegarray/>
            </hp:p>
          </hp:subList>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
      </hp:tr>
    </hp:tbl>
    <hp:linesegarray/>
  </hp:p>
  <hp:p id="3" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run charPrIDRef="0"><hp:t>표 뒤 단락</hp:t></hp:run>
    <hp:linesegarray/>
  </hp:p>
</hs:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("시나리오 7: 표 저장", () => {
  it("표 셀 텍스트 수정이 저장된다", async () => {
    const input = await makeTableHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    expect(parsed.integrityIssues).toEqual([]);

    // table 노드가 파싱됐는지 확인
    const tableNode = parsed.doc.content!.find((n: JSONContent) => n.type === "table");
    expect(tableNode).toBeTruthy();
    expect(tableNode!.attrs?.tableId).toContain("::tbl::");

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;

    // 두 번째 행 첫 번째 셀(값1 → 수정값) 수정
    const tbl = doc.content!.find((n: JSONContent) => n.type === "table")!;
    const row1 = tbl.content![1]; // 두 번째 행
    const cell0 = row1.content![0]; // 첫 번째 셀
    const cellPara = cell0.content![0]; // 셀 내 단락
    if (cellPara?.content) cellPara.content = [{ type: "text", text: "수정된값" }];

    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    expect(sectionXml).toContain("헤더1");
    expect(sectionXml).toContain("헤더2");
    expect(sectionXml).toContain("수정된값");
    expect(sectionXml).toContain("값2");
    expect(sectionXml).not.toContain("값1");
  });

  it("표와 단락이 함께 있을 때 단락 수정 + 표 셀 수정이 모두 저장된다", async () => {
    const input = await makeTableWithParasHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    expect(parsed.integrityIssues).toEqual([]);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;

    // 첫 번째 단락 텍스트 수정
    const firstPara = doc.content!.find((n: JSONContent) => n.type === "paragraph");
    if (firstPara?.content) firstPara.content = [{ type: "text", text: "수정된 앞 단락" }];

    // 표 A열 → 수정A
    const tbl = doc.content!.find((n: JSONContent) => n.type === "table")!;
    const cellA = tbl.content![0].content![0]; // row0, cell0
    const paraA = cellA.content![0];
    if (paraA?.content) paraA.content = [{ type: "text", text: "수정A" }];

    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    expect(sectionXml).toContain("수정된 앞 단락");
    expect(sectionXml).not.toContain("표 앞 단락");
    expect(sectionXml).toContain("수정A");
    expect(sectionXml).not.toContain("A열");
    expect(sectionXml).toContain("B열");
    expect(sectionXml).toContain("표 뒤 단락");
  });

  it("새로 추가된 표(tableId 없음)가 HWPX에 삽입된다", async () => {
    const input = await makeSingleParaHwpx("기존 내용");
    const parsed = await parseHwpxToProseMirror(input);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    // tableId 없이 새 표 추가
    doc.content!.push({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "새 표 내용" }] }],
            },
          ],
        },
      ],
    });

    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );

    // 기존 내용은 유지
    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");
    expect(sectionXml).toContain("기존 내용");
    // 새 표의 내용이 section XML에 포함됨
    expect(sectionXml).toContain("새 표 내용");
    // tbl 태그가 있어야 함
    expect(sectionXml).toContain("tbl");
  });

  it("표가 있는 문서에서 새 단락을 추가해도 표 셀 텍스트가 top-level로 중복 주입되지 않는다", async () => {
    const input = await makeTableWithParasHwpx();
    const parsed = await parseHwpxToProseMirror(input);
    expect(parsed.integrityIssues).toEqual([]);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    doc.content!.push({
      type: "paragraph",
      content: [{ type: "text", text: "표 뒤에 추가한 신규 단락" }],
    });

    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    expect(countOccurrences(sectionXml, "A열")).toBe(1);
    expect(countOccurrences(sectionXml, "B열")).toBe(1);
    expect(countOccurrences(sectionXml, "표 뒤에 추가한 신규 단락")).toBe(1);
  });
});

// ── Q1 회귀 테스트: 복합 편집 라운드트립 ──────────────────────────────────────

describe("Q1 regression: complex roundtrip", () => {
  it("텍스트 편집 + 새 단락 추가 + 새 표 추가가 모두 보존된다", async () => {
    const input = await makeSingleParaHwpx("원본 텍스트");
    const parsed = await parseHwpxToProseMirror(input);
    expect(parsed.integrityIssues).toEqual([]);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;

    // 1. 기존 텍스트 수정
    const para = doc.content![0];
    if (para.content?.[0]) {
      para.content[0] = { type: "text", text: "수정된 텍스트" };
    }

    // 2. 새 단락 추가
    doc.content!.push({
      type: "paragraph",
      content: [{ type: "text", text: "추가된 새 단락" }],
    });

    // 3. 새 표 추가 (tableId 없음)
    doc.content!.push({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "셀A" }] }],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "셀B" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "셀C" }] }],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "셀D" }] }],
            },
          ],
        },
      ],
    });

    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuf = await result.blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(outBuf);
    const sectionXml = await outZip.file("Contents/section0.xml")!.async("string");

    // 기존 텍스트가 수정됨
    expect(sectionXml).toContain("수정된 텍스트");
    expect(sectionXml).not.toContain("원본 텍스트");

    // 새 단락이 존재
    expect(sectionXml).toContain("추가된 새 단락");

    // 새 표의 모든 셀 내용이 존재
    expect(sectionXml).toContain("셀A");
    expect(sectionXml).toContain("셀B");
    expect(sectionXml).toContain("셀C");
    expect(sectionXml).toContain("셀D");

    // 아카이브가 올바른 ZIP
    expect(outBuf.byteLength).toBeGreaterThan(0);
  });

  it("라운드트립 후 재파싱이 정상 동작한다", async () => {
    const input = await makeSingleParaHwpx("라운드트립 테스트");
    const parsed = await parseHwpxToProseMirror(input);

    const doc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const para = doc.content![0];
    if (para.content?.[0]) {
      para.content[0] = { type: "text", text: "수정 후 텍스트" };
    }

    const result = await applyProseMirrorDocToHwpx(
      input, doc, parsed.segments, parsed.extraSegmentsMap, parsed.hwpxDocumentModel,
    );

    // 출력 파일을 다시 파싱
    const outBuf = await result.blob.arrayBuffer();
    const reparsed = await parseHwpxToProseMirror(outBuf);
    expect(reparsed.integrityIssues).toEqual([]);

    // 수정된 텍스트가 세그먼트에 존재
    const seg = reparsed.segments.find((s) => s.text.includes("수정 후 텍스트"));
    expect(seg).toBeTruthy();

    // 다시 저장하면 정상 동작
    const result2 = await applyProseMirrorDocToHwpx(
      outBuf, reparsed.doc, reparsed.segments, reparsed.extraSegmentsMap, reparsed.hwpxDocumentModel,
    );
    expect(result2.integrityIssues).toEqual([]);
  });
});
