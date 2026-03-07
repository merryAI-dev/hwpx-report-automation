import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  createSyntheticLegacyHwpBuffer,
  detectBinarySignature,
  inspectHwpUpload,
} from "./hwp-intake";

describe("hwp intake inspection", () => {
  it("accepts a legacy HWP-like compound file with .hwp extension", () => {
    const buffer = createSyntheticLegacyHwpBuffer();
    const report = inspectHwpUpload("legacy-sample.hwp", buffer);

    expect(detectBinarySignature(buffer)).toBe("compound-file");
    expect(report.canConvert).toBe(true);
    expect(report.disposition).toBe("convertible-hwp");
    expect(report.suggestedOutputFileName).toBe("legacy-sample.hwpx");
    expect(report.issues).toEqual([]);
  });

  it("rejects zip content disguised as .hwp", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const report = inspectHwpUpload("renamed.hwp", buffer);

    expect(detectBinarySignature(buffer)).toBe("zip");
    expect(report.canConvert).toBe(false);
    expect(report.disposition).toBe("zip-disguised-as-hwp");
    expect(report.issues[0]).toContain("ZIP 시그니처");
  });

  it("rejects non-.hwp files even if the binary signature matches", () => {
    const buffer = createSyntheticLegacyHwpBuffer();
    const report = inspectHwpUpload("legacy.doc", buffer);

    expect(report.canConvert).toBe(false);
    expect(report.issues[0]).toContain("`.hwp`");
  });
});
