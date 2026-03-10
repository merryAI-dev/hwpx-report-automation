import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { HWPX_COVERAGE_MATRIX, analyzeHwpxCoverage } from "./hwpx-coverage";

describe("HWPX_COVERAGE_MATRIX", () => {
  it("has at least 10 entries", () => {
    expect(HWPX_COVERAGE_MATRIX.length).toBeGreaterThanOrEqual(10);
  });

  it("all entries have required fields", () => {
    for (const feature of HWPX_COVERAGE_MATRIX) {
      expect(typeof feature.id).toBe("string");
      expect(feature.id.length).toBeGreaterThan(0);
      expect(typeof feature.xmlElement).toBe("string");
      expect(typeof feature.description).toBe("string");
      expect(["supported", "partial", "unsupported", "ignored"]).toContain(feature.status);
    }
  });

  it("includes supported, partial, unsupported, and ignored entries", () => {
    const statuses = new Set(HWPX_COVERAGE_MATRIX.map((f) => f.status));
    expect(statuses.has("supported")).toBe(true);
    expect(statuses.has("partial")).toBe(true);
    expect(statuses.has("unsupported")).toBe(true);
    expect(statuses.has("ignored")).toBe(true);
  });
});

async function makeSyntheticHwpxBuffer(sectionXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("version.xml", '<?xml version="1.0"?><version>1.0</version>');
  zip.file("Contents/content.hpf", '<?xml version="1.0"?><hpf></hpf>');
  zip.file("Contents/section0.xml", sectionXml);
  const blob = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  return blob;
}

describe("analyzeHwpxCoverage", () => {
  it("returns a valid report structure for a synthetic HWPX", async () => {
    const sectionXml = `<?xml version="1.0"?>
<hp:sec xmlns:hp="urn:schemas-microsoft-com:office:hwpx">
  <hp:p><hp:run><hp:t>Hello</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>World</hp:t></hp:run></hp:p>
  <hp:tbl><hp:tr><hp:tc><hp:p><hp:run><hp:t>Cell</hp:t></hp:run></hp:p></hp:tc></hp:tr></hp:tbl>
</hp:sec>`;

    const buffer = await makeSyntheticHwpxBuffer(sectionXml);
    const report = await analyzeHwpxCoverage(buffer, "test.hwpx");

    expect(report.fileName).toBe("test.hwpx");
    expect(typeof report.totalElements).toBe("number");
    expect(typeof report.coverageScore).toBe("number");
    expect(report.coverageScore).toBeGreaterThanOrEqual(0);
    expect(report.coverageScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(report.features)).toBe(true);
    expect(Array.isArray(report.unknownElements)).toBe(true);
    expect(Array.isArray(report.warnings)).toBe(true);
  });

  it("counts hp:p, hp:run, hp:t, hp:tbl elements correctly", async () => {
    const sectionXml = `<?xml version="1.0"?>
<hp:sec xmlns:hp="urn:schemas-microsoft-com:office:hwpx">
  <hp:p><hp:run><hp:t>A</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>B</hp:t></hp:run></hp:p>
  <hp:tbl><hp:tr><hp:tc><hp:p><hp:t>C</hp:t></hp:p></hp:tc></hp:tr></hp:tbl>
</hp:sec>`;

    const buffer = await makeSyntheticHwpxBuffer(sectionXml);
    const report = await analyzeHwpxCoverage(buffer, "test.hwpx");

    const paraFeature = report.features.find((f) => f.xmlElement === "hp:p");
    expect(paraFeature).toBeDefined();
    expect(paraFeature?.count).toBeGreaterThanOrEqual(3);

    const tblFeature = report.features.find((f) => f.xmlElement === "hp:tbl");
    expect(tblFeature).toBeDefined();
    expect(tblFeature?.count).toBe(1);
  });

  it("returns warnings when no section XML files found", async () => {
    // Create a minimal ZIP with no section files
    const zip = new JSZip();
    zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
    zip.file("version.xml", '<?xml version="1.0"?><version>1.0</version>');
    zip.file("Contents/content.hpf", '<?xml version="1.0"?><hpf></hpf>');
    const buffer = await zip.generateAsync({ type: "arraybuffer" });

    const report = await analyzeHwpxCoverage(buffer, "no-sections.hwpx");
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toContain("섹션");
  });

  it("returns error warning for invalid ZIP data", async () => {
    const fakeBuffer = new TextEncoder().encode("not a zip file").buffer;
    const report = await analyzeHwpxCoverage(fakeBuffer, "bad.hwpx");
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toContain("ZIP");
  });

  it("coverageScore is 100 when all found elements are supported", async () => {
    // A section with only hp:sec (which matches "section" = supported)
    const sectionXml = `<?xml version="1.0"?>
<hp:sec xmlns:hp="urn:schemas-microsoft-com:office:hwpx">
</hp:sec>`;

    const buffer = await makeSyntheticHwpxBuffer(sectionXml);
    const report = await analyzeHwpxCoverage(buffer, "empty.hwpx");
    expect(report.coverageScore).toBe(100);
    // hp:sec is counted as 1 element (supported)
    expect(report.totalElements).toBeGreaterThanOrEqual(0);
  });

  it("reports unsupported elements in features list", async () => {
    const sectionXml = `<?xml version="1.0"?>
<hp:sec xmlns:hp="urn:schemas-microsoft-com:office:hwpx">
  <hp:p><hp:run><hp:t>text</hp:t></hp:run></hp:p>
  <hp:macro>alert("macro")</hp:macro>
  <hp:ole>ole-data</hp:ole>
</hp:sec>`;

    const buffer = await makeSyntheticHwpxBuffer(sectionXml);
    const report = await analyzeHwpxCoverage(buffer, "unsupported.hwpx");

    const macroFeature = report.features.find((f) => f.xmlElement === "hp:macro");
    expect(macroFeature).toBeDefined();
    expect(macroFeature?.status).toBe("unsupported");

    const oleFeature = report.features.find((f) => f.xmlElement === "hp:ole");
    expect(oleFeature).toBeDefined();
    expect(oleFeature?.status).toBe("unsupported");

    // Coverage score should be less than 100 due to unsupported elements
    expect(report.coverageScore).toBeLessThan(100);
  });
});
