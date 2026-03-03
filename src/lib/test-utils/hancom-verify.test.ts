/**
 * 한컴오피스 HWPX 검증 테스트
 *
 * 이 테스트는 다음 조건이 모두 충족될 때만 실행됩니다:
 *   1. macOS에서 한컴오피스 HWP가 설치되어 있음
 *   2. HANCOM_VERIFY=1 환경변수가 설정됨
 *   3. 터미널에 Screen Recording 권한이 있음
 *
 * 실행 방법 (사용자 터미널에서):
 *   HANCOM_VERIFY=1 pnpm test:hancom
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  verifyInHancom,
  checkVerifyEnvironment,
} from "./hancom-verify";

const EXAMPLES_DIR = resolve(__dirname, "../../../../examples");
const HANCOM_AVAILABLE = existsSync("/Applications/Hancom Office HWP.app");
const HANCOM_VERIFY_ENABLED = process.env.HANCOM_VERIFY === "1";

const skipReason = !HANCOM_AVAILABLE
  ? "Hancom Office HWP not installed"
  : !HANCOM_VERIFY_ENABLED
    ? "Set HANCOM_VERIFY=1 to enable (requires Screen Recording permission)"
    : null;

describe("Hancom Office HWPX Verification", () => {
  it.skipIf(!!skipReason)(
    "opens input-sample.hwpx in Hancom Office and captures screenshot",
    async () => {
      const hwpxFile = resolve(EXAMPLES_DIR, "input-sample.hwpx");
      if (!existsSync(hwpxFile)) {
        console.warn("input-sample.hwpx not found, skipping");
        return;
      }

      const result = await verifyInHancom(hwpxFile, { timeoutSec: 45 });

      expect(result.error).toBeNull();
      expect(result.success).toBe(true);
      expect(result.screenshotPath).toBeTruthy();
      expect(result.screenshotSize).toBeGreaterThan(1000);

      console.log(`Screenshot: ${result.screenshotPath} (${result.screenshotSize} bytes, ${result.durationMs}ms)`);
    },
    60_000,
  );

  it.skipIf(!!skipReason)(
    "opens today-project-report.hwpx in Hancom Office",
    async () => {
      const hwpxFile = resolve(EXAMPLES_DIR, "today-project-report.hwpx");
      if (!existsSync(hwpxFile)) {
        console.warn("today-project-report.hwpx not found, skipping");
        return;
      }

      const result = await verifyInHancom(hwpxFile, { timeoutSec: 45 });

      expect(result.error).toBeNull();
      expect(result.success).toBe(true);

      console.log(`Screenshot: ${result.screenshotPath} (${result.screenshotSize} bytes, ${result.durationMs}ms)`);
    },
    60_000,
  );

  it("checkVerifyEnvironment returns expected structure", () => {
    const env = checkVerifyEnvironment();
    expect(env).toHaveProperty("ready");
    expect(env).toHaveProperty("issues");
    expect(Array.isArray(env.issues)).toBe(true);

    if (HANCOM_AVAILABLE) {
      // At minimum, the script and Hancom Office should be found
      const scriptMissing = env.issues.some((i) => i.includes("Verify script"));
      expect(scriptMissing).toBe(false);
    }
  });

  it("verifyInHancom returns error for nonexistent file", async () => {
    const result = await verifyInHancom("/tmp/nonexistent-file.hwpx");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
