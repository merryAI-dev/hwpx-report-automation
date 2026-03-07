import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { validateHwpxArchive } from "../hwpx";

export type HwpxValidationReport = {
  validator: "archive-only" | "archive+dvc";
  archiveIssues: string[];
  dvcIssues: string[];
  issues: string[];
  warnings: string[];
  dvcConfigured: boolean;
  dvcExecuted: boolean;
  command?: string;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandExecutor = (command: string) => Promise<CommandResult>;
type ArchiveValidator = (fileBuffer: ArrayBuffer) => Promise<string[]>;
type TempFileFactory = (fileBuffer: ArrayBuffer) => Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}>;

export type ValidateHwpxForNodeOptions = {
  env?: NodeJS.ProcessEnv;
  commandTemplate?: string | null;
  commandExecutor?: CommandExecutor;
  archiveValidator?: ArchiveValidator;
  tempFileFactory?: TempFileFactory;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function resolveDvcCommandTemplate(
  env: NodeJS.ProcessEnv = process.env,
  override?: string | null,
): string | null {
  const candidate = override ?? env.HWPX_DVC_COMMAND ?? "";
  const normalized = candidate.trim();
  return normalized ? normalized : null;
}

export function buildDvcCommand(commandTemplate: string, filePath: string): string {
  const quotedFilePath = quoteForShell(filePath);
  if (commandTemplate.includes("{file}")) {
    return commandTemplate.split("{file}").join(quotedFilePath);
  }
  return `${commandTemplate} ${quotedFilePath}`;
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

async function writeTempHwpxFile(fileBuffer: ArrayBuffer): Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "hwpx-dvc-"));
  const filePath = path.join(dir, "input.hwpx");
  await writeFile(filePath, new Uint8Array(fileBuffer));

  return {
    filePath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function normalizeDvcIssues(result: CommandResult): string[] {
  const lines = unique(
    `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/g)
      .map((line) => line.trim()),
  );

  if (!lines.length) {
    return [`[HWPX-DVC-FAILED] DVC validation failed with exit code ${result.exitCode}.`];
  }

  return lines.map((line) => `[HWPX-DVC] ${line}`);
}

export async function validateHwpxForNode(
  fileBuffer: ArrayBuffer,
  options: ValidateHwpxForNodeOptions = {},
): Promise<HwpxValidationReport> {
  const archiveValidator = options.archiveValidator ?? validateHwpxArchive;
  const archiveIssues = unique(await archiveValidator(fileBuffer));
  const warnings: string[] = [];

  const commandTemplate = resolveDvcCommandTemplate(options.env, options.commandTemplate);
  if (!commandTemplate) {
    warnings.push("[HWPX-DVC-SKIPPED] HWPX_DVC_COMMAND is not configured; skipping DVC validation.");
    return {
      validator: "archive-only",
      archiveIssues,
      dvcIssues: [],
      issues: archiveIssues,
      warnings,
      dvcConfigured: false,
      dvcExecuted: false,
    };
  }

  const tempFileFactory = options.tempFileFactory ?? writeTempHwpxFile;
  const execute = options.commandExecutor ?? executeShellCommand;
  const temp = await tempFileFactory(fileBuffer);
  const command = buildDvcCommand(commandTemplate, temp.filePath);

  try {
    const result = await execute(command);
    const dvcIssues = result.exitCode === 0 ? [] : normalizeDvcIssues(result);
    if (result.exitCode === 0 && result.stderr.trim()) {
      warnings.push(`[HWPX-DVC-STDERR] ${result.stderr.trim()}`);
    }

    return {
      validator: "archive+dvc",
      archiveIssues,
      dvcIssues,
      issues: unique([...archiveIssues, ...dvcIssues]),
      warnings,
      dvcConfigured: true,
      dvcExecuted: true,
      command,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const dvcIssues = [`[HWPX-DVC-EXEC-FAILED] ${message}`];
    return {
      validator: "archive+dvc",
      archiveIssues,
      dvcIssues,
      issues: unique([...archiveIssues, ...dvcIssues]),
      warnings,
      dvcConfigured: true,
      dvcExecuted: false,
      command,
    };
  } finally {
    await temp.cleanup();
  }
}

export function formatHwpxValidationReport(
  label: string,
  report: HwpxValidationReport,
): string {
  const lines = [
    `${label} validation`,
    `- validator: ${report.validator}`,
    `- dvcConfigured: ${report.dvcConfigured}`,
    `- dvcExecuted: ${report.dvcExecuted}`,
    `- issues: ${report.issues.length}`,
  ];

  if (report.command) {
    lines.push(`- command: ${report.command}`);
  }
  if (report.warnings.length) {
    lines.push(`- warnings: ${report.warnings.join(" | ")}`);
  }
  if (report.issues.length) {
    lines.push(`- issueDetails: ${report.issues.join(" | ")}`);
  }

  return lines.join("\n");
}
