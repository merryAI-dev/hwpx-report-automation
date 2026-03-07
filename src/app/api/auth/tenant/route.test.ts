import { afterEach, describe, expect, it } from "vitest";
import { POST as switchTenant } from "@/app/api/auth/tenant/route";
import { SESSION_COOKIE_NAME, createSessionToken, verifySessionToken } from "@/lib/auth/session";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/auth/tenant", () => {
  it("switches the active tenant and refreshes the cookie", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken({
      sub: "user-1",
      email: "admin@example.com",
      displayName: "Admin User",
      provider: {
        id: "corp-oidc",
        type: "oidc",
        displayName: "Corp OIDC",
      },
      memberships: [
        { tenantId: "alpha", tenantName: "Alpha", role: "owner" },
        { tenantId: "beta", tenantName: "Beta", role: "editor" },
      ],
      activeTenantId: "alpha",
    });

    const request = new Request("http://localhost/api/auth/tenant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({ tenantId: "beta" }),
    });

    const response = await switchTenant(request);
    const payload = await response.json();
    const setCookie = response.headers.get("set-cookie") || "";
    const nextToken = decodeURIComponent(setCookie.split(";")[0].split("=").slice(1).join("="));
    const nextSession = await verifySessionToken(nextToken, { env: process.env });

    expect(response.status).toBe(200);
    expect(payload.activeTenant).toMatchObject({ tenantId: "beta" });
    expect(nextSession?.activeTenantId).toBe("beta");
  });

  it("rejects unknown tenant membership", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");

    const request = new Request("http://localhost/api/auth/tenant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({ tenantId: "forbidden" }),
    });

    const response = await switchTenant(request);
    expect(response.status).toBe(403);
  });
});
