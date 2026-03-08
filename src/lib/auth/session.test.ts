import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  getActiveTenantMembership,
  getAuthSecret,
  getConfiguredIdentityProviders,
  getConfiguredUsers,
  readCookieValue,
  readSessionFromCookieHeader,
  switchSessionTenant,
  validateAdminCredentials,
  validateUserCredentials,
  verifySessionToken,
} from "@/lib/auth/session";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("auth session", () => {
  it("creates and verifies a tenant-aware signed session token", async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_USERS_JSON = JSON.stringify([
      {
        sub: "user-1",
        email: "ops@example.com",
        password: "super-secret",
        displayName: "Ops Lead",
        provider: {
          id: "corp-oidc",
          type: "oidc",
          displayName: "Corp OIDC",
          issuer: "https://sso.example.com",
        },
        memberships: [
          { tenantId: "alpha", tenantName: "Alpha", role: "owner" },
          { tenantId: "beta", tenantName: "Beta", role: "editor" },
        ],
        defaultTenantId: "beta",
      },
    ]);

    const token = await createSessionToken("ops@example.com", {
      nowMs: 1_700_000_000_000,
      activeTenantId: "alpha",
    });
    const session = await verifySessionToken(token, { nowMs: 1_700_000_100_000 });

    expect(session).toMatchObject({
      sub: "user-1",
      email: "ops@example.com",
      displayName: "Ops Lead",
      activeTenantId: "alpha",
      provider: {
        id: "corp-oidc",
        type: "oidc",
      },
    });
    expect(session?.memberships).toHaveLength(2);
    expect(getActiveTenantMembership(session!)).toEqual({
      tenantId: "alpha",
      tenantName: "Alpha",
      role: "owner",
    });
  });

  it("switches the active tenant when membership exists", async () => {
    process.env.AUTH_SECRET = "test-secret";

    const token = await createSessionToken({
      sub: "user-1",
      email: "ops@example.com",
      displayName: "Ops Lead",
      memberships: [
        { tenantId: "alpha", tenantName: "Alpha", role: "owner" },
        { tenantId: "beta", tenantName: "Beta", role: "editor" },
      ],
      activeTenantId: "alpha",
      provider: {
        id: "password",
        type: "password",
        displayName: "Password",
      },
    });
    const session = await verifySessionToken(token);
    const switchedToken = await switchSessionTenant(session!, "beta", { env: process.env });
    const switchedSession = await verifySessionToken(switchedToken);

    expect(switchedSession?.activeTenantId).toBe("beta");
    expect(getActiveTenantMembership(switchedSession!)).toMatchObject({ tenantId: "beta" });
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

  it("loads configured users and identity providers from env", () => {
    process.env.AUTH_USERS_JSON = JSON.stringify([
      {
        email: "ops@example.com",
        password: "super-secret",
        displayName: "Ops Lead",
        provider: {
          id: "corp-saml",
          type: "saml",
          displayName: "Corp SAML",
        },
        memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      },
    ]);

    expect(getConfiguredUsers()).toHaveLength(1);
    expect(getConfiguredIdentityProviders()).toEqual([
      {
        id: "corp-saml",
        type: "saml",
        displayName: "Corp SAML",
        issuer: null,
      },
    ]);
  });

  it("validates configured credentials", () => {
    process.env.AUTH_USERS_JSON = JSON.stringify([
      {
        email: "ops@example.com",
        password: "super-secret",
        displayName: "Ops Lead",
        memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      },
    ]);

    expect(validateAdminCredentials("ops@example.com", "super-secret")).toBe(true);
    expect(validateAdminCredentials("ops@example.com", "wrong")).toBe(false);
    expect(validateUserCredentials("ops@example.com", "super-secret")?.displayName).toBe("Ops Lead");
  });

  it("requires AUTH_SECRET in production", () => {
    expect(() => getAuthSecret({ NODE_ENV: "production" })).toThrow("AUTH_SECRET is required in production.");
  });
});
