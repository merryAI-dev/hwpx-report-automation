import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  readCookieValue,
  readSessionFromCookieHeader,
  validateAdminCredentials,
  verifySessionToken,
} from "@/lib/auth/session";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("auth session", () => {
  it("creates and verifies a valid signed session token", async () => {
    process.env.AUTH_SECRET = "test-secret";

    const token = await createSessionToken("admin@example.com", { nowMs: 1_700_000_000_000 });
    const session = await verifySessionToken(token, { nowMs: 1_700_000_100_000 });

    expect(session).toMatchObject({
      email: "admin@example.com",
      iat: 1_700_000_000,
    });
    expect(session?.exp).toBeGreaterThan(session?.iat ?? 0);
  });

  it("rejects tampered or expired tokens", async () => {
    process.env.AUTH_SECRET = "test-secret";

    const token = await createSessionToken("admin@example.com", {
      nowMs: 1_700_000_000_000,
      maxAgeSeconds: 1,
    });
    const [payload, signature] = token.split(".");
    const tampered = `${payload}.broken${signature}`;

    await expect(verifySessionToken(tampered, { nowMs: 1_700_000_000_500 })).resolves.toBeNull();
    await expect(verifySessionToken(token, { nowMs: 1_700_000_002_000 })).resolves.toBeNull();
  });

  it("reads a session from a cookie header", async () => {
    process.env.AUTH_SECRET = "test-secret";

    const token = await createSessionToken("admin@example.com");
    const cookieHeader = `foo=bar; ${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; baz=qux`;
    const session = await readSessionFromCookieHeader(cookieHeader);

    expect(readCookieValue(cookieHeader)).toBe(token);
    expect(session?.email).toBe("admin@example.com");
  });

  it("validates admin credentials against env", () => {
    process.env.ADMIN_EMAIL = "ops@example.com";
    process.env.ADMIN_PASSWORD = "super-secret";

    expect(validateAdminCredentials("ops@example.com", "super-secret")).toBe(true);
    expect(validateAdminCredentials("ops@example.com", "wrong")).toBe(false);
  });
});
