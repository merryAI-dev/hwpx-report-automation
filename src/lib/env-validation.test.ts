import { describe, it, expect } from "vitest";
import { checkEnvironment } from "./env-validation";

function makeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    AUTH_SECRET: "strong-random-secret-value",
    ADMIN_EMAIL: "real-admin@company.com",
    ADMIN_PASSWORD: "super-secure-password-123",
    DATABASE_URL: "file:./prisma/prod.db",
    NEXTAUTH_URL: "https://app.company.com",
    ...overrides,
  };
}

describe("checkEnvironment", () => {
  it("returns no issues when all vars are properly set", () => {
    const issues = checkEnvironment(makeEnv(), "production");
    expect(issues).toEqual([]);
  });

  it("returns no issues in development with defaults", () => {
    const issues = checkEnvironment({}, "development");
    // Warnings are expected but no errors
    expect(issues.every((i) => i.severity === "warn")).toBe(true);
  });

  describe("AUTH_SECRET", () => {
    it("returns error in production when missing", () => {
      const issues = checkEnvironment(makeEnv({ AUTH_SECRET: "" }), "production");
      const authIssue = issues.find((i) => i.variable === "AUTH_SECRET");
      expect(authIssue).toBeDefined();
      expect(authIssue!.severity).toBe("error");
    });

    it("returns error in production when using default value", () => {
      const issues = checkEnvironment(makeEnv({ AUTH_SECRET: "hwpx-dev-secret" }), "production");
      const authIssue = issues.find((i) => i.variable === "AUTH_SECRET");
      expect(authIssue).toBeDefined();
      expect(authIssue!.severity).toBe("error");
    });

    it("returns warn in development when using default value", () => {
      const issues = checkEnvironment({ AUTH_SECRET: "hwpx-dev-secret" }, "development");
      const authIssue = issues.find((i) => i.variable === "AUTH_SECRET");
      expect(authIssue).toBeDefined();
      expect(authIssue!.severity).toBe("warn");
    });
  });

  describe("ADMIN_EMAIL", () => {
    it("returns error in production when using default", () => {
      const issues = checkEnvironment(makeEnv({ ADMIN_EMAIL: "admin@example.com" }), "production");
      const issue = issues.find((i) => i.variable === "ADMIN_EMAIL");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("error");
    });

    it("returns error in production when missing", () => {
      const env = makeEnv();
      delete (env as Record<string, string | undefined>).ADMIN_EMAIL;
      const issues = checkEnvironment(env, "production");
      const issue = issues.find((i) => i.variable === "ADMIN_EMAIL");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("error");
    });
  });

  describe("ADMIN_PASSWORD", () => {
    it("returns error in production when using default", () => {
      const issues = checkEnvironment(makeEnv({ ADMIN_PASSWORD: "changeme" }), "production");
      const issue = issues.find((i) => i.variable === "ADMIN_PASSWORD");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("error");
    });
  });

  describe("DATABASE_URL", () => {
    it("returns warn in production when missing", () => {
      const env = makeEnv();
      delete (env as Record<string, string | undefined>).DATABASE_URL;
      const issues = checkEnvironment(env, "production");
      const issue = issues.find((i) => i.variable === "DATABASE_URL");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("warn");
    });

    it("does not warn in development when missing", () => {
      const issues = checkEnvironment({}, "development");
      const issue = issues.find((i) => i.variable === "DATABASE_URL");
      expect(issue).toBeUndefined();
    });
  });

  describe("NEXTAUTH_URL", () => {
    it("returns warn in production when missing", () => {
      const env = makeEnv();
      delete (env as Record<string, string | undefined>).NEXTAUTH_URL;
      const issues = checkEnvironment(env, "production");
      const issue = issues.find((i) => i.variable === "NEXTAUTH_URL");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("warn");
    });
  });

  it("returns multiple issues when several vars are bad", () => {
    const issues = checkEnvironment({
      AUTH_SECRET: "hwpx-dev-secret",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "changeme",
    }, "production");
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
