// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticLegacyHwpBuffer } from "@/lib/hwp-intake";
import { HwpIntakeError } from "@/lib/server/hwp-converter";

const { convertLegacyHwpFile } = vi.hoisted(() => ({
  convertLegacyHwpFile: vi.fn(),
}));

vi.mock("@/lib/server/hwp-converter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/hwp-converter")>("@/lib/server/hwp-converter");
  return {
    ...actual,
    convertLegacyHwpFile,
  };
});

import { POST } from "./route";

afterEach(() => {
  convertLegacyHwpFile.mockReset();
});

describe("POST /api/hwp-intake", () => {
  it("returns a converted HWPX attachment on success", async () => {
    const converted = new TextEncoder().encode("hwpx-bytes");
    convertLegacyHwpFile.mockResolvedValue({
      outputFileName: "legacy-input.hwpx",
      outputBuffer: converted.buffer,
      validationIssues: [],
      inspection: {
        fileName: "legacy-input.hwp",
        extension: "hwp",
        detectedSignature: "compound-file",
        signatureHex: "d0 cf 11 e0 a1 b1 1a e1",
        disposition: "convertible-hwp",
        canConvert: true,
        suggestedOutputFileName: "legacy-input.hwpx",
        issues: [],
        summary: "ok",
      },
      execution: {
        command: "node",
        args: [],
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
      },
    });

    const formData = new FormData();
    formData.append("file", new File([createSyntheticLegacyHwpBuffer()], "legacy-input.hwp"));
    const response = await POST(new Request("http://localhost/api/hwp-intake", { method: "POST", body: formData }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-converted-file-name")).toBe("legacy-input.hwpx");
    expect(response.headers.get("x-hwp-intake-source")).toBe("legacy-hwp");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(converted);
  });

  it("returns structured JSON when conversion fails", async () => {
    convertLegacyHwpFile.mockRejectedValue(
      new HwpIntakeError("변환기 미설정", {
        code: "converter_not_configured",
        status: 503,
        details: ["HWP_CONVERTER_COMMAND를 설정하세요."],
      }),
    );

    const formData = new FormData();
    formData.append("file", new File([createSyntheticLegacyHwpBuffer()], "legacy-input.hwp"));
    const response = await POST(new Request("http://localhost/api/hwp-intake", { method: "POST", body: formData }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "변환기 미설정",
      code: "converter_not_configured",
      details: ["HWP_CONVERTER_COMMAND를 설정하세요."],
    });
  });
});
