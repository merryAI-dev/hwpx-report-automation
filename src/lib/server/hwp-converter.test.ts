// @vitest-environment node

import JSZip from "jszip";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSyntheticLegacyHwpBuffer } from "@/lib/hwp-intake";
import {
  buildHwpConverterCommand,
  convertLegacyHwpBuffer,
  HwpIntakeError,
} from "./hwp-converter";

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
  <hp:p paraPrIDRef="11"><hp:run><hp:t>변환 결과</hp:t></hp:run></hp:p>
</hp:sec>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

const tempDirs: string[] = [];

async function createMockConverterFiles() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hwpx-converter-test-"));
  tempDirs.push(tempDir);

  const fixturePath = path.join(tempDir, "fixture.hwpx");
  await writeFile(fixturePath, Buffer.from(await makeFixtureHwpx()));

  const invalidFixturePath = path.join(tempDir, "invalid.hwpx");
  await writeFile(invalidFixturePath, Buffer.from("not-a-zip"));

  const scriptPath = path.join(tempDir, "mock-converter.mjs");
  await writeFile(
    scriptPath,
    `import { copyFile } from "node:fs/promises";\nconst [, , inputPath, outputPath, fixturePath] = process.argv;\nawait copyFile(fixturePath || inputPath, outputPath);\n`,
  );

  return { tempDir, fixturePath, invalidFixturePath, scriptPath };
}

afterEach(async () => {
  while (tempDirs.length) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe("buildHwpConverterCommand", () => {
  it("supports JSON-array templates without hardcoded paths", () => {
    const command = buildHwpConverterCommand(
      '["node","scripts/mock-hwp-converter.mjs","{input}","{output}"]',
      "/tmp/input.hwp",
      "/tmp/output.hwpx",
    );

    expect(command.command).toBe("node");
    expect(command.args).toEqual(["scripts/mock-hwp-converter.mjs", "/tmp/input.hwp", "/tmp/output.hwpx"]);
  });

  it("rejects command templates that omit placeholders", () => {
    expect(() => buildHwpConverterCommand('["node","scripts/mock-hwp-converter.mjs"]', "/tmp/a", "/tmp/b")).toThrow(
      HwpIntakeError,
    );
  });
});

describe("convertLegacyHwpBuffer", () => {
  it("runs an external converter and validates the generated HWPX", async () => {
    const { fixturePath, scriptPath } = await createMockConverterFiles();
    const commandTemplate = JSON.stringify(["node", scriptPath, "{input}", "{output}", fixturePath]);

    const result = await convertLegacyHwpBuffer({
      fileName: "legacy-input.hwp",
      inputBuffer: createSyntheticLegacyHwpBuffer("integration"),
      commandTemplate,
    });

    expect(result.outputFileName).toBe("legacy-input.hwpx");
    expect(result.validationIssues).toEqual([]);
    expect(result.execution.exitCode).toBe(0);
    const outputBytes = Buffer.from(result.outputBuffer);
    const writtenBytes = await readFile(fixturePath);
    expect(outputBytes.equals(writtenBytes)).toBe(true);
  }, 15000);

  it("rejects invalid HWPX output from the converter", async () => {
    const { invalidFixturePath, scriptPath } = await createMockConverterFiles();
    const commandTemplate = JSON.stringify(["node", scriptPath, "{input}", "{output}", invalidFixturePath]);

    await expect(
      convertLegacyHwpBuffer({
        fileName: "legacy-input.hwp",
        inputBuffer: createSyntheticLegacyHwpBuffer("invalid"),
        commandTemplate,
      }),
    ).rejects.toMatchObject({ code: "invalid_hwpx_output" });
  }, 15000);
});
