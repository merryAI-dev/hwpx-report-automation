/**
 * Environment variable validation for production safety.
 *
 * Validates that critical configuration is properly set before
 * the application starts serving requests. Fails fast in production
 * when security-sensitive defaults are detected.
 */
import { log } from "@/lib/logger";

export type EnvIssue = {
  variable: string;
  message: string;
  severity: "error" | "warn";
};

/**
 * Checks all critical environment variables and returns a list of issues.
 * In production, any "error" severity issue should prevent startup.
 */
export function checkEnvironment(
  env: Record<string, string | undefined> = process.env,
  nodeEnv: string = env.NODE_ENV ?? "development",
): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const isProduction = nodeEnv === "production";

  // AUTH_SECRET — encryption key for API keys and JWT sessions
  const authSecret = env.AUTH_SECRET;
  if (!authSecret || authSecret === "hwpx-dev-secret") {
    issues.push({
      variable: "AUTH_SECRET",
      message: "AUTH_SECRET이 설정되지 않았거나 기본값을 사용 중입니다. 프로덕션에서는 강력한 랜덤 값을 설정하세요.",
      severity: isProduction ? "error" : "warn",
    });
  }

  // ADMIN_EMAIL — default admin account
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail || adminEmail === "admin@example.com") {
    issues.push({
      variable: "ADMIN_EMAIL",
      message: "ADMIN_EMAIL이 기본값(admin@example.com)입니다. 프로덕션에서는 실제 이메일을 설정하세요.",
      severity: isProduction ? "error" : "warn",
    });
  }

  // ADMIN_PASSWORD — default admin password
  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword === "changeme") {
    issues.push({
      variable: "ADMIN_PASSWORD",
      message: "ADMIN_PASSWORD가 기본값(changeme)입니다. 프로덕션에서는 강력한 비밀번호를 설정하세요.",
      severity: isProduction ? "error" : "warn",
    });
  }

  // DATABASE_URL — database connection
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl && isProduction) {
    issues.push({
      variable: "DATABASE_URL",
      message: "DATABASE_URL이 설정되지 않았습니다. 로컬 SQLite 파일이 사용됩니다.",
      severity: "warn",
    });
  }

  // NEXTAUTH_URL — required for NextAuth in production
  const nextAuthUrl = env.NEXTAUTH_URL;
  if (!nextAuthUrl && isProduction) {
    issues.push({
      variable: "NEXTAUTH_URL",
      message: "NEXTAUTH_URL이 설정되지 않았습니다. 인증 콜백이 올바르게 동작하지 않을 수 있습니다.",
      severity: "warn",
    });
  }

  return issues;
}

/**
 * Run environment validation and log/throw based on severity.
 * Call this at application startup (e.g., instrumentation.ts or layout.tsx).
 */
export function validateEnvironment(): void {
  const issues = checkEnvironment();

  if (issues.length === 0) return;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warn");

  for (const w of warnings) {
    log.warn(`[env] ${w.variable}: ${w.message}`);
  }

  if (errors.length > 0) {
    const summary = errors
      .map((e) => `  - ${e.variable}: ${e.message}`)
      .join("\n");
    throw new Error(
      `프로덕션 환경 변수 검증 실패:\n${summary}\n\n필수 환경 변수를 설정한 후 다시 시작하세요.`,
    );
  }
}
