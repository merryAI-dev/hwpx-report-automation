import fs from "node:fs/promises";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { JSDOM } from "jsdom";
import type { JSONContent } from "@tiptap/core";
import { inspectHwpx } from "../hwpx";
import { parseHwpxToProseMirror } from "../editor/hwpx-to-prosemirror";
import { applyProseMirrorDocToHwpx } from "../editor/prosemirror-to-hwpx";
import {
  buildFileCommand,
  formatHwpxValidationReport,
  type HwpxValidationReport,
  validateHwpxForNode,
} from "./hwpx-validator";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandExecutor = (command: string) => Promise<CommandResult>;
type OutputFileFactory = (params: {
  fileBuffer: ArrayBuffer;
  suggestedFileName: string;
  outputDir?: string;
}) => Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}>;

export type VerifyHwpxWithHancomOptions = {
  env?: NodeJS.ProcessEnv;
  commandTemplate?: string | null;
  commandExecutor?: CommandExecutor;
  outputDir?: string;
  outputFileFactory?: OutputFileFactory;
};

export type HancomVerificationReport = {
  issues: string[];
  warnings: string[];
  verifyConfigured: boolean;
  verifyExecuted: boolean;
  command?: string;
  outputFilePath?: string;
};

export type RunHancomRegressionOptions = VerifyHwpxWithHancomOptions & {
  markerText?: string;
};

export type HancomRegressionReport = {
  fixturePath: string;
  fixtureName: string;
  markerText?: string;
  editedSegmentId?: string;
  editedFileName?: string;
  editedTextIndex?: number;
  inputValidation: HwpxValidationReport;
  outputValidation: HwpxValidationReport;
  hancomVerification: HancomVerificationReport;
  warnings: string[];
  issues: string[];
};

let nodeDomInitialized = false;

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function ensureNodeDomGlobals() {
  if (
    nodeDomInitialized &&
    typeof DOMParser !== "undefined" &&
    typeof NodeFilter !== "undefined" &&
    typeof XMLSerializer !== "undefined"
  ) {
    return;
  }

  const dom = new JSDOM("");
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
  (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;
  (globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer =
    dom.window.XMLSerializer;
  nodeDomInitialized = true;
}

function buildInlineContent(text: string): JSONContent[] {
  const chunks = text.split(/\r\n|\r|\n/);
  const out: JSONContent[] = [];

  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) {
      out.push({ type: "hardBreak" });
    }
    if (!chunk.length) {
      continue;
    }
    out.push({ type: "text", text: chunk });
  }

  return out;
}

function replaceSegmentInDoc(doc: JSONContent, segmentId: string, nextText: string): JSONContent {
  const clone = JSON.parse(JSON.stringify(doc)) as JSONContent;

  const walk = (node: JSONContent): boolean => {
    if (node.type === "paragraph" || node.type === "heading") {
      const attrs = (node.attrs || {}) as { segmentId?: string };
      if (attrs.segmentId === segmentId) {
        node.content = buildInlineContent(nextText);
        return true;
      }
    }

    if (!node.content?.length) {
      return false;
    }

    for (const child of node.content) {
      if (walk(child)) {
        return true;
      }
    }

    return false;
  };

  walk(clone);
  return clone;
}

function defaultMarkerText(fixtureName: string, sourceText: string): string {
  const normalized = sourceText.replace(/\s+/g, " ").trim().slice(0, 24);
  const basename = path.parse(fixtureName).name;
  return normalized
    ? `[HANCOM-REGRESSION] ${basename} :: ${normalized}`
    : `[HANCOM-REGRESSION] ${basename}`;
}

function createEmptyValidationReport(): HwpxValidationReport {
  return {
    validator: "archive-only",
    archiveIssues: [],
    dvcIssues: [],
    issues: [],
    warnings: [],
    dvcConfigured: false,
    dvcExecuted: false,
  };
}

function prefixIssues(prefix: string, issues: string[]): string[] {
  return issues.map((issue) => `[${prefix}] ${issue}`);
}

export function resolveHancomVerifyCommandTemplate(
  env: NodeJS.ProcessEnv = process.env,
  override?: string | null,
): string | null {
  const candidate = override ?? env.HWPX_HANCOM_VERIFY_COMMAND ?? "";
  const normalized = candidate.trim();
  return normalized ? normalized : null;
}

async function executeShellCommand(command: string): Promise<CommandResult> {
  const shell = process.env.SHELL || "/bin/sh";

  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["-lc", command], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

async function createOutputFile({
  fileBuffer,
  suggestedFileName,
  outputDir,
}: {
  fileBuffer: ArrayBuffer;
  suggestedFileName: string;
  outputDir?: string;
}): Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, suggestedFileName);
    await writeFile(filePath, new Uint8Array(fileBuffer));
    return {
      filePath,
      cleanup: async () => undefined,
    };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "hancom-regression-"));
  const filePath = path.join(dir, suggestedFileName);
  await writeFile(filePath, new Uint8Array(fileBuffer));

  return {
    filePath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function normalizeHancomIssues(result: CommandResult): string[] {
  const lines = unique(
    `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/g)
      .map((line) => line.trim()),
  );

  if (!lines.length) {
    return [`[HANCOM-VERIFY-FAILED] Verification failed with exit code ${result.exitCode}.`];
  }

  return lines.map((line) => `[HANCOM-VERIFY] ${line}`);
}

export async function verifyHwpxWithHancom(
  fileBuffer: ArrayBuffer,
  fixtureName: string,
  options: VerifyHwpxWithHancomOptions = {},
): Promise<HancomVerificationReport> {
  const warnings: string[] = [];
  const commandTemplate = resolveHancomVerifyCommandTemplate(options.env, options.commandTemplate);
  const suggestedFileName = `${path.parse(fixtureName).name}.hancom-verify.hwpx`;

  if (!commandTemplate && !options.outputDir) {
    warnings.push("[HANCOM-VERIFY-SKIPPED] HWPX_HANCOM_VERIFY_COMMAND is not configured; skipping Hancom verification.");
    return {
      issues: [],
      warnings,
      verifyConfigured: false,
      verifyExecuted: false,
    };
  }

  const outputFileFactory = options.outputFileFactory ?? createOutputFile;
  const output = await outputFileFactory({
    fileBuffer,
    suggestedFileName,
    outputDir: options.outputDir,
  });

  if (!commandTemplate) {
    warnings.push("[HANCOM-VERIFY-SKIPPED] Persisted output without executing Hancom verification.");
    return {
      issues: [],
      warnings,
      verifyConfigured: false,
      verifyExecuted: false,
      outputFilePath: output.filePath,
    };
  }

  const execute = options.commandExecutor ?? executeShellCommand;
  const command = buildFileCommand(commandTemplate, output.filePath);

  try {
    const result = await execute(command);
    const issues = result.exitCode === 0 ? [] : normalizeHancomIssues(result);
    if (result.exitCode === 0 && result.stderr.trim()) {
      warnings.push(`[HANCOM-VERIFY-STDERR] ${result.stderr.trim()}`);
    }

    return {
      issues,
      warnings,
      verifyConfigured: true,
      verifyExecuted: true,
      command,
      outputFilePath: output.filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      issues: [`[HANCOM-VERIFY-EXEC-FAILED] ${message}`],
      warnings,
      verifyConfigured: true,
      verifyExecuted: false,
      command,
      outputFilePath: output.filePath,
    };
  } finally {
    if (!options.outputDir) {
      await output.cleanup();
    }
  }
}

export async function runHancomRegression(
  fixturePath: string,
  options: RunHancomRegressionOptions = {},
): Promise<HancomRegressionReport> {
  ensureNodeDomGlobals();

  const fixtureName = path.basename(fixturePath);
  const input = await fs.readFile(fixturePath);
  const inputBuffer = Uint8Array.from(input).buffer;
  const inputValidation = await validateHwpxForNode(inputBuffer, {
    env: options.env,
  });

  const roundTripIssues: string[] = [];
  let markerText: string | undefined;
  let editedSegmentId: string | undefined;
  let editedFileName: string | undefined;
  let editedTextIndex: number | undefined;
  let outputValidation = createEmptyValidationReport();
  let hancomVerification: HancomVerificationReport = {
    issues: [],
    warnings: [],
    verifyConfigured: false,
    verifyExecuted: false,
  };

  try {
    const parsed = await parseHwpxToProseMirror(inputBuffer);
    roundTripIssues.push(...prefixIssues("ROUNDTRIP-PARSE", parsed.integrityIssues));

    const target = parsed.segments.find((segment) => segment.text.trim().length > 0);
    if (!target) {
      roundTripIssues.push("[ROUNDTRIP-NO-TARGET] No editable text segment found.");
    } else {
      markerText = options.markerText ?? defaultMarkerText(fixtureName, target.text);
      editedSegmentId = target.segmentId;
      editedFileName = target.fileName;
      editedTextIndex = target.textIndex;

      const editedDoc = replaceSegmentInDoc(parsed.doc, target.segmentId, markerText);
      const result = await applyProseMirrorDocToHwpx(
        inputBuffer,
        editedDoc,
        parsed.segments,
        parsed.extraSegmentsMap,
        parsed.hwpxDocumentModel,
      );

      roundTripIssues.push(...prefixIssues("ROUNDTRIP-EXPORT", result.integrityIssues));

      const outputBuffer = await result.blob.arrayBuffer();
      const inspected = await inspectHwpx(outputBuffer);
      roundTripIssues.push(...prefixIssues("ROUNDTRIP-INSPECT", inspected.integrityIssues));

      const editedNode = inspected.textNodes.find(
        (node) => node.fileName === target.fileName && node.textIndex === target.textIndex,
      );
      if (editedNode?.text !== markerText) {
        roundTripIssues.push(
          `[ROUNDTRIP-MARKER-MISMATCH] Expected edited segment to equal \"${markerText}\" but received \"${editedNode?.text ?? ""}\".`,
        );
      }

      outputValidation = await validateHwpxForNode(outputBuffer, {
        env: options.env,
      });
      hancomVerification = await verifyHwpxWithHancom(outputBuffer, fixtureName, options);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    roundTripIssues.push(`[ROUNDTRIP-FAILED] ${message}`);
  }

  const warnings = unique([
    ...prefixIssues("INPUT-VALIDATION", inputValidation.warnings),
    ...prefixIssues("OUTPUT-VALIDATION", outputValidation.warnings),
    ...hancomVerification.warnings,
  ]);

  const issues = unique([
    ...prefixIssues("INPUT-VALIDATION", inputValidation.issues),
    ...roundTripIssues,
    ...prefixIssues("OUTPUT-VALIDATION", outputValidation.issues),
    ...hancomVerification.issues,
  ]);

  return {
    fixturePath,
    fixtureName,
    markerText,
    editedSegmentId,
    editedFileName,
    editedTextIndex,
    inputValidation,
    outputValidation,
    hancomVerification,
    warnings,
    issues,
  };
}

export function formatHancomRegressionReport(report: HancomRegressionReport): string {
  const lines = [
    `${report.fixtureName} Hancom regression`,
    `- fixture: ${report.fixturePath}`,
    `- editedSegment: ${report.editedFileName ?? "n/a"} :: ${report.editedTextIndex ?? "n/a"}`,
    `- marker: ${report.markerText ?? "n/a"}`,
    `- inputValidationIssues: ${report.inputValidation.issues.length}`,
    `- outputValidationIssues: ${report.outputValidation.issues.length}`,
    `- hancomVerifyConfigured: ${report.hancomVerification.verifyConfigured}`,
    `- hancomVerifyExecuted: ${report.hancomVerification.verifyExecuted}`,
    `- totalIssues: ${report.issues.length}`,
  ];

  if (report.hancomVerification.outputFilePath) {
    lines.push(`- outputFile: ${report.hancomVerification.outputFilePath}`);
  }
  if (report.hancomVerification.command) {
    lines.push(`- command: ${report.hancomVerification.command}`);
  }
  if (report.warnings.length) {
    lines.push(`- warnings: ${report.warnings.join(" | ")}`);
  }
  if (report.inputValidation.issues.length) {
    lines.push(formatHwpxValidationReport("input", report.inputValidation));
  }
  if (report.outputValidation.issues.length || report.outputValidation.warnings.length) {
    lines.push(formatHwpxValidationReport("output", report.outputValidation));
  }
  if (report.issues.length) {
    lines.push(`- issueDetails: ${report.issues.join(" | ")}`);
  }

  return lines.join("\n");
}
