import { describe, expect, it } from "vitest";
import {
  buildDvcCommand,
  formatHwpxValidationReport,
  validateHwpxForNode,
} from "./hwpx-validator";

describe("hwpx validator", () => {
  it("falls back to archive validation when no DVC command is configured", async () => {
    const report = await validateHwpxForNode(new ArrayBuffer(8), {
      archiveValidator: async () => ["archive issue"],
      commandTemplate: null,
    });

    expect(report.validator).toBe("archive-only");
    expect(report.issues).toEqual(["archive issue"]);
    expect(report.warnings).toEqual([
      "[HWPX-DVC-SKIPPED] HWPX_DVC_COMMAND is not configured; skipping DVC validation.",
    ]);
    expect(report.dvcExecuted).toBe(false);
  });

  it("injects the file path into the configured DVC command", () => {
    const command = buildDvcCommand("java -jar tools/dvc.jar {file}", "/tmp/my file.hwpx");
    expect(command).toContain("java -jar tools/dvc.jar");
    expect(command).toContain("'/tmp/my file.hwpx'");
  });

  it("merges DVC issues when the command exits with a non-zero code", async () => {
    const commands: string[] = [];
    const report = await validateHwpxForNode(new ArrayBuffer(8), {
      archiveValidator: async () => [],
      commandTemplate: "fake-dvc {file}",
      tempFileFactory: async () => ({
        filePath: "/tmp/sample.hwpx",
        cleanup: async () => undefined,
      }),
      commandExecutor: async (command) => {
        commands.push(command);
        return {
          exitCode: 2,
          stdout: "validation failed",
          stderr: "missing field",
        };
      },
    });

    expect(commands[0]).toBe("fake-dvc '/tmp/sample.hwpx'");
    expect(report.validator).toBe("archive+dvc");
    expect(report.dvcExecuted).toBe(true);
    expect(report.issues).toEqual([
      "[HWPX-DVC] validation failed",
      "[HWPX-DVC] missing field",
    ]);
  });

  it("formats a readable validation report summary", () => {
    const output = formatHwpxValidationReport("output", {
      validator: "archive+dvc",
      archiveIssues: ["archive issue"],
      dvcIssues: ["dvc issue"],
      issues: ["archive issue", "dvc issue"],
      warnings: ["warn"],
      dvcConfigured: true,
      dvcExecuted: true,
      command: "fake-dvc '/tmp/sample.hwpx'",
    });

    expect(output).toContain("output validation");
    expect(output).toContain("validator: archive+dvc");
    expect(output).toContain("issueDetails: archive issue | dvc issue");
  });
});
