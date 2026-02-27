import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { applyTextEdits, inspectHwpx, validateHwpxArchive } from "./hwpx";

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
  <hp:p paraPrIDRef="2"><hp:run><hp:t>제1장 개요</hp:t></hp:run></hp:p>
  <hp:p paraPrIDRef="11"><hp:run><hp:t>원문 텍스트</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

describe("hwpx integrity", () => {
  it("keeps archive valid after text edit", async () => {
    const input = await makeFixtureHwpx();
    const inspected = await inspectHwpx(input);
    expect(inspected.integrityIssues).toEqual([]);

    const target = inspected.textNodes.find((node) => node.text.includes("원문 텍스트"));
    expect(target).toBeTruthy();

    const blob = await applyTextEdits(input, [
      {
        id: target!.id,
        fileName: target!.fileName,
        textIndex: target!.textIndex,
        oldText: target!.text,
        newText: "수정 완료 텍스트",
      },
    ]);

    const outBuffer = await blob.arrayBuffer();
    const outIssues = await validateHwpxArchive(outBuffer);
    expect(outIssues).toEqual([]);

    const outZip = await JSZip.loadAsync(outBuffer);
    const outXml = await outZip.file("Contents/section0.xml")!.async("string");
    expect(outXml).toContain("수정 완료 텍스트");
    expect(outXml).toContain(`<hp:p paraPrIDRef="2">`);
    expect(outXml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
  });

  it("reports required entry issues", async () => {
    const zip = new JSZip();
    zip.file("Contents/section0.xml", "<sec><p>text</p></sec>");
    const broken = await zip.generateAsync({ type: "arraybuffer" });
    const issues = await validateHwpxArchive(broken);
    expect(issues.some((issue) => issue.includes("mimetype"))).toBe(true);
    expect(issues.some((issue) => issue.includes("version.xml"))).toBe(true);
  });
});
