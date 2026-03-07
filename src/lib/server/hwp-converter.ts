import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectHwpUpload, type HwpIntakeReport } from "@/lib/hwp-intake";
import { validateHwpxArchive } from "@/lib/hwpx";

const DEFAULT_TIMEOUT_MS = 60_000;

export class HwpIntakeError extends Error {
  code: string;
  status: number;
  details: string[];

  constructor(message: string, options: { code: string; status: number; details?: string[]; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "HwpIntakeError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details ?? [];
  }
}

export type HwpConverterExecution = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
};

export type HwpConversionResult = {
  inspection: HwpIntakeReport;
  outputFileName: string;
  outputBuffer: ArrayBuffer;
  validationIssues: string[];
  execution: HwpConverterExecution;
};

function shellSplit(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new HwpIntakeError("HWP_CONVERTER_COMMAND에 닫히지 않은 따옴표가 있습니다.", {
      code: "converter_command_invalid",
      status: 500,
    });
  }

  if (escaped) {
    current += "\\";
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const bytes = Uint8Array.from(buffer);
  return bytes.buffer;
}

function sanitizeInputFileName(fileName: string): string {
  const base = path.basename(fileName).trim();
  if (!base) {
    return "input.hwp";
  }
  return base.toLowerCase().endsWith(".hwp") ? base : `${base}.hwp`;
}

async function ensureDomParser(): Promise<void> {
  if (typeof DOMParser !== "undefined") {
    return;
  }

  try {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("");
    (globalThis as typeof globalThis & { DOMParser?: typeof DOMParser }).DOMParser =
      dom.window.DOMParser as unknown as typeof DOMParser;
  } catch (error) {
    throw new HwpIntakeError("Node 런타임에서 XML 검증기를 초기화하지 못했습니다.", {
      code: "xml_validator_unavailable",
      status: 500,
      details: [error instanceof Error ? error.message : "jsdom import failed"],
      cause: error,
    });
  }
}

function parseCommandTemplate(rawTemplate: string): string[] {
  const trimmed = rawTemplate.trim();
  if (!trimmed) {
    throw new HwpIntakeError("HWP_CONVERTER_COMMAND가 비어 있습니다.", {
      code: "converter_not_configured",
      status: 503,
    });
  }

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new HwpIntakeError("HWP_CONVERTER_COMMAND JSON 배열을 파싱하지 못했습니다.", {
        code: "converter_command_invalid",
        status: 500,
        cause: error,
      });
    }

    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new HwpIntakeError("HWP_CONVERTER_COMMAND JSON 배열은 문자열 배열이어야 합니다.", {
        code: "converter_command_invalid",
        status: 500,
      });
    }

    return parsed;
  }

  return shellSplit(trimmed);
}

export function buildHwpConverterCommand(
  rawTemplate: string,
  inputPath: string,
  outputPath: string,
): { command: string; args: string[]; template: string[] } {
  const template = parseCommandTemplate(rawTemplate);
  if (!template.length) {
    throw new HwpIntakeError("HWP_CONVERTER_COMMAND가 비어 있습니다.", {
      code: "converter_not_configured",
      status: 503,
    });
  }

  const hasInput = template.some((entry) => entry.includes("{input}"));
  const hasOutput = template.some((entry) => entry.includes("{output}"));
  if (!hasInput || !hasOutput) {
    throw new HwpIntakeError("HWP_CONVERTER_COMMAND에는 `{input}`과 `{output}` 플레이스홀더가 모두 있어야 합니다.", {
      code: "converter_command_invalid",
      status: 500,
    });
  }

  const resolved = template.map((entry) => entry.replaceAll("{input}", inputPath).replaceAll("{output}", outputPath));
  const [command, ...args] = resolved;

  if (!command) {
    throw new HwpIntakeError("HWP_CONVERTER_COMMAND 실행 파일이 비어 있습니다.", {
      code: "converter_command_invalid",
      status: 500,
    });
  }

  return { command, args, template };
}

async function executeCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<HwpConverterExecution> {
  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onFailure = (error: HwpIntakeError) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      onFailure(
        new HwpIntakeError(`HWP 변환기가 ${timeoutMs}ms 안에 종료되지 않았습니다.`, {
          code: "converter_timeout",
          status: 504,
          details: [`command=${command}`, `args=${JSON.stringify(args)}`],
        }),
      );
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      onFailure(
        new HwpIntakeError(`HWP 변환기를 실행하지 못했습니다: ${error.message}`, {
          code: "converter_spawn_failed",
          status: 502,
          cause: error,
        }),
      );
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        command,
        args,
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export async function convertLegacyHwpBuffer(options: {
  fileName: string;
  inputBuffer: ArrayBuffer;
  commandTemplate?: string;
  timeoutMs?: number;
}): Promise<HwpConversionResult> {
  const inspection = inspectHwpUpload(options.fileName, options.inputBuffer);
  if (!inspection.canConvert) {
    throw new HwpIntakeError(inspection.summary, {
      code: "invalid_hwp_upload",
      status: 415,
      details: inspection.issues.length ? inspection.issues : [inspection.summary],
    });
  }

  const commandTemplate = options.commandTemplate ?? process.env.HWP_CONVERTER_COMMAND;
  if (!commandTemplate?.trim()) {
    throw new HwpIntakeError("HWP_CONVERTER_COMMAND가 설정되지 않았습니다.", {
      code: "converter_not_configured",
      status: 503,
      details: [
        "예: HWP_CONVERTER_COMMAND='[\"node\",\"scripts/mock-hwp-converter.mjs\",\"{input}\",\"{output}\"]'",
      ],
    });
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hwpx-hwp-intake-"));
  const inputFileName = sanitizeInputFileName(options.fileName);
  const outputFileName = path.basename(inspection.suggestedOutputFileName);
  const inputPath = path.join(tempDir, inputFileName);
  const outputPath = path.join(tempDir, outputFileName);

  try {
    await writeFile(inputPath, Buffer.from(options.inputBuffer));
    const command = buildHwpConverterCommand(commandTemplate, inputPath, outputPath);
    const execution = await executeCommand(command.command, command.args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    if (execution.exitCode !== 0) {
      throw new HwpIntakeError(`HWP 변환기가 비정상 종료했습니다 (exit=${execution.exitCode ?? "null"}).`, {
        code: "converter_failed",
        status: 502,
        details: [execution.stderr.trim(), execution.stdout.trim()].filter(Boolean),
      });
    }

    let outputStats;
    try {
      outputStats = await stat(outputPath);
    } catch (error) {
      throw new HwpIntakeError("변환기가 HWPX 출력 파일을 생성하지 않았습니다.", {
        code: "converter_no_output",
        status: 502,
        details: [outputPath],
        cause: error,
      });
    }

    if (!outputStats.isFile() || outputStats.size <= 0) {
      throw new HwpIntakeError("변환 결과 HWPX 파일이 비어 있습니다.", {
        code: "converter_empty_output",
        status: 502,
        details: [outputPath],
      });
    }

    const outputFile = await readFile(outputPath);
    const outputBuffer = toArrayBuffer(outputFile);
    let validationIssues: string[];
    try {
      await ensureDomParser();
      validationIssues = await validateHwpxArchive(outputBuffer);
    } catch (error) {
      if (error instanceof HwpIntakeError) {
        throw error;
      }
      throw new HwpIntakeError("변환 결과 HWPX를 읽지 못했습니다.", {
        code: "invalid_hwpx_output",
        status: 502,
        details: [error instanceof Error ? error.message : "HWPX 검증 실패"],
        cause: error,
      });
    }
    if (validationIssues.length) {
      throw new HwpIntakeError("변환 결과 HWPX가 유효하지 않습니다.", {
        code: "invalid_hwpx_output",
        status: 502,
        details: validationIssues,
      });
    }

    return {
      inspection,
      outputFileName,
      outputBuffer,
      validationIssues,
      execution,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function convertLegacyHwpFile(
  file: Pick<File, "name" | "arrayBuffer">,
  options?: { commandTemplate?: string; timeoutMs?: number },
): Promise<HwpConversionResult> {
  const inputBuffer = await file.arrayBuffer();
  return await convertLegacyHwpBuffer({
    fileName: file.name,
    inputBuffer,
    commandTemplate: options?.commandTemplate,
    timeoutMs: options?.timeoutMs,
  });
}
