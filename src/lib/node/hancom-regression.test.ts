import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatHancomRegressionReport,
  resolveHancomVerifyCommandTemplate,
  runHancomRegression,
  verifyHwpxWithHancom,
} from "./hancom-regression";

const REAL_FIXTURE_PATH = path.resolve(process.cwd(), "../examples/input-sample.hwpx");
const integrationTest = fs.existsSync(REAL_FIXTURE_PATH) ? it : it.skip;

describe("hancom regression", () => {
  it("uses the Hancom verification env var when configured", () => {
    expect(
      resolveHancomVerifyCommandTemplate(
        { HWPX_HANCOM_VERIFY_COMMAND: "verify-hwpx {file}" } as unknown as NodeJS.ProcessEnv,
      ),
    ).toBe("verify-hwpx {file}");
  });

  it("skips external verification when no command or output directory is configured", async () => {
    const report = await verifyHwpxWithHancom(new ArrayBuffer(8), "sample.hwpx", {
      commandTemplate: null,
    });

    expect(report.verifyConfigured).toBe(false);
    expect(report.verifyExecuted).toBe(false);
    expect(report.issues).toEqual([]);
    expect(report.warnings).toEqual([
      "[HANCOM-VERIFY-SKIPPED] HWPX_HANCOM_VERIFY_COMMAND is not configured; skipping Hancom verification.",
    ]);
  });

  it("captures Hancom verification failures from stdout and stderr", async () => {
    const commands: string[] = [];
    const report = await verifyHwpxWithHancom(new ArrayBuffer(8), "sample.hwpx", {
      commandTemplate: "verify-hwpx {file}",
      outputFileFactory: async () => ({
        filePath: "/tmp/sample.hwpx",
        cleanup: async () => undefined,
      }),
      commandExecutor: async (command) => {
        commands.push(command);
        return {
          exitCode: 2,
          stdout: "failed to open",
          stderr: "invalid section",
        };
      },
    });

    expect(commands[0]).toBe("verify-hwpx '/tmp/sample.hwpx'");
    expect(report.verifyConfigured).toBe(true);
    expect(report.verifyExecuted).toBe(true);
    expect(report.issues).toEqual([
      "[HANCOM-VERIFY] failed to open",
      "[HANCOM-VERIFY] invalid section",
    ]);
  });

  integrationTest("runs the sample fixture through the regression harness", async () => {
    const report = await runHancomRegression(REAL_FIXTURE_PATH, {
      commandTemplate: null,
    });

    expect(report.fixturePath).toBe(REAL_FIXTURE_PATH);
    expect(report.inputValidation.issues).toEqual([]);
    expect(report.outputValidation.issues).toEqual([]);
    expect(report.issues).toEqual([]);
    expect(report.warnings).toContain(
      "[INPUT-VALIDATION] [HWPX-DVC-SKIPPED] HWPX_DVC_COMMAND is not configured; skipping DVC validation.",
    );
    expect(report.warnings).toContain(
      "[OUTPUT-VALIDATION] [HWPX-DVC-SKIPPED] HWPX_DVC_COMMAND is not configured; skipping DVC validation.",
    );
    expect(report.warnings).toContain(
      "[HANCOM-VERIFY-SKIPPED] HWPX_HANCOM_VERIFY_COMMAND is not configured; skipping Hancom verification.",
    );
  }, 30000);

  it("formats a readable regression summary", () => {
    const output = formatHancomRegressionReport({
      fixturePath: "/tmp/sample.hwpx",
      fixtureName: "sample.hwpx",
      markerText: "marker",
      editedSegmentId: "segment-1",
      editedFileName: "Contents/section0.xml",
      editedTextIndex: 4,
      inputValidation: {
        validator: "archive-only",
        archiveIssues: [],
        dvcIssues: [],
        issues: [],
        warnings: [],
        dvcConfigured: false,
        dvcExecuted: false,
      },
      outputValidation: {
        validator: "archive-only",
        archiveIssues: [],
        dvcIssues: [],
        issues: [],
        warnings: [],
        dvcConfigured: false,
        dvcExecuted: false,
      },
      hancomVerification: {
        issues: [],
        warnings: [],
        verifyConfigured: true,
        verifyExecuted: true,
        command: "verify-hwpx '/tmp/sample.hwpx'",
        outputFilePath: "/tmp/sample.hwpx",
      },
      warnings: [],
      issues: [],
    });

    expect(output).toContain("sample.hwpx Hancom regression");
    expect(output).toContain("hancomVerifyExecuted: true");
    expect(output).toContain("outputFile: /tmp/sample.hwpx");
  });
});
