import { afterEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("auth routes", () => {
  it("creates a session cookie on successful login", async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_USERS_JSON = JSON.stringify([
      {
        sub: "user-1",
        email: "admin@example.com",
        password: "letmein",
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
        defaultTenantId: "beta",
      },
    ]);

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        password: "letmein",
        tenantId: "alpha",
      }),
    });

    const response = await login(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      user: {
        email: "admin@example.com",
        displayName: "Admin User",
      },
      provider: {
        id: "corp-oidc",
        type: "oidc",
      },
      activeTenant: {
        tenantId: "alpha",
      },
    });
    expect(response.headers.get("set-cookie")).toContain(SESSION_COOKIE_NAME);
  });

  it("rejects invalid credentials", async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_USERS_JSON = JSON.stringify([
      {
        email: "admin@example.com",
        password: "letmein",
        memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      },
    ]);

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        password: "wrong",
      }),
    });

    const response = await login(request);
    expect(response.status).toBe(401);
  });

  it("returns the current session when a valid cookie is present", async () => {
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
      memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      activeTenantId: "alpha",
    });

    const request = new Request("http://localhost/api/auth/session", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
    });

    const response = await session(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.authenticated).toBe(true);
    expect(payload.user.email).toBe("admin@example.com");
    expect(payload.activeTenant.tenantId).toBe("alpha");
    expect(payload.provider.type).toBe("oidc");
  });

  it("clears the session cookie on logout", async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
