/**
 * Hancom Office HWP 검증 헬퍼
 *
 * HWPX 파일을 한컴오피스에서 열고 스크린샷을 캡처하는 유틸리티.
 * 주의: macOS Screen Recording 권한이 있는 터미널에서만 동작합니다.
 *
 * 사용법 (vitest에서):
 *   import { verifyInHancom, verifyAllExamples } from "@/lib/test-utils/hancom-verify";
 *
 *   // 단일 파일 검증
 *   const result = await verifyInHancom("/path/to/file.hwpx");
 *   expect(result.success).toBe(true);
 *
 *   // examples/ 전체 검증
 *   const results = await verifyAllExamples();
 *   for (const r of results) expect(r.success).toBe(true);
 */
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPTS_DIR = resolve(__dirname, "../../../../scripts/hancom-verify");
const VERIFY_SCRIPT = join(SCRIPTS_DIR, "verify-hwpx.sh");
const VERIFY_ALL_SCRIPT = join(SCRIPTS_DIR, "verify-all.sh");
const DEFAULT_SCREENSHOTS_DIR = resolve(__dirname, "../../../../screenshots");
const DEFAULT_EXAMPLES_DIR = resolve(__dirname, "../../../../examples");

export type VerifyResult = {
  success: boolean;
  filePath: string;
  screenshotPath: string | null;
  screenshotSize: number;
  error: string | null;
  durationMs: number;
};

export type VerifyOptions = {
  /** Screenshot output directory (default: <project>/screenshots/) */
  outputDir?: string;
  /** Max seconds to wait for the entire verification (default: 30) */
  timeoutSec?: number;
};

/**
 * Open a single HWPX file in Hancom Office and capture a screenshot.
 */
export async function verifyInHancom(
  hwpxFilePath: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const absPath = resolve(hwpxFilePath);
  const outputDir = options.outputDir || DEFAULT_SCREENSHOTS_DIR;
  const timeoutMs = (options.timeoutSec || 30) * 1000;
  const start = Date.now();

  if (!existsSync(absPath)) {
    return {
      success: false,
      filePath: absPath,
      screenshotPath: null,
      screenshotSize: 0,
      error: `File not found: ${absPath}`,
      durationMs: Date.now() - start,
    };
  }

  if (!existsSync(VERIFY_SCRIPT)) {
    return {
      success: false,
      filePath: absPath,
      screenshotPath: null,
      screenshotSize: 0,
      error: `Verify script not found: ${VERIFY_SCRIPT}. Run from project root.`,
      durationMs: Date.now() - start,
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [VERIFY_SCRIPT, absPath, outputDir],
      { timeout: timeoutMs },
    );

    // The script outputs the screenshot path as the last line
    const lines = stdout.trim().split("\n");
    const lastLine = lines[lines.length - 1]?.trim() || "";
    const screenshotPath = lastLine.endsWith(".png") ? lastLine : null;

    if (screenshotPath && existsSync(screenshotPath)) {
      const size = statSync(screenshotPath).size;
      return {
        success: size > 1000, // >1KB means a real image
        filePath: absPath,
        screenshotPath,
        screenshotSize: size,
        error: size <= 1000 ? "Screenshot too small — may be blank" : null,
        durationMs: Date.now() - start,
      };
    }

    return {
      success: false,
      filePath: absPath,
      screenshotPath: null,
      screenshotSize: 0,
      error: stderr.trim() || "Screenshot not produced",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      filePath: absPath,
      screenshotPath: null,
      screenshotSize: 0,
      error: message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Verify all HWPX files in the examples directory.
 */
export async function verifyAllExamples(
  options: VerifyOptions & { examplesDir?: string } = {},
): Promise<VerifyResult[]> {
  const examplesDir = options.examplesDir || DEFAULT_EXAMPLES_DIR;
  const outputDir = options.outputDir || DEFAULT_SCREENSHOTS_DIR;

  const { readdirSync } = await import("node:fs");
  const files = readdirSync(examplesDir)
    .filter((f) => f.endsWith(".hwpx"))
    .map((f) => join(examplesDir, f));

  const results: VerifyResult[] = [];
  for (const file of files) {
    const result = await verifyInHancom(file, { ...options, outputDir });
    results.push(result);
  }
  return results;
}

/**
 * Verify an in-memory HWPX buffer by writing to a temp file and opening in Hancom.
 */
export async function verifyHwpxBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string = "test-output.hwpx",
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const tempDir = mkdtempSync(join(tmpdir(), "hwpx-verify-"));
  const tempFile = join(tempDir, basename(fileName));
  writeFileSync(tempFile, new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer));

  return verifyInHancom(tempFile, options);
}

/**
 * Check if the verification environment is available.
 * Returns a human-readable status message.
 */
export function checkVerifyEnvironment(): {
  ready: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!existsSync(VERIFY_SCRIPT)) {
    issues.push(`Verify script missing: ${VERIFY_SCRIPT}`);
  }

  if (!existsSync("/Applications/Hancom Office HWP.app")) {
    issues.push("Hancom Office HWP not installed at /Applications/Hancom Office HWP.app");
  }

  // Check if Swift compiler is available (needed to build window ID helper)
  // Use `which` instead of running swiftc (which is slow to start)
  try {
    const { execFileSync } = require("node:child_process");
    execFileSync("which", ["swiftc"], { timeout: 3000 });
  } catch {
    issues.push("swiftc (Swift compiler) not available in PATH");
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}
