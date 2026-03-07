import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as oidcCallback } from "@/app/api/auth/oidc/callback/[providerId]/route";
import { OIDC_FLOW_COOKIE_NAME, createOidcFlowToken } from "@/lib/auth/oidc-flow";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("GET /api/auth/oidc/callback/[providerId]", () => {
  it("exchanges the code, resolves tenant seed memberships, and creates a session", async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_IDENTITY_PROVIDERS_JSON = JSON.stringify([
      {
        id: "corp-oidc",
        type: "oidc",
        displayName: "Corp OIDC",
        issuer: "https://id.example.com",
        clientId: "client-123",
        clientSecret: "secret-456",
        authorizationEndpoint: "https://id.example.com/authorize",
        tokenEndpoint: "https://id.example.com/oauth/token",
        userInfoEndpoint: "https://id.example.com/userinfo",
      },
    ]);
    process.env.AUTH_TENANT_SEED_JSON = JSON.stringify({
      tenants: [
        { tenantId: "alpha", tenantName: "Alpha Workspace" },
        { tenantId: "beta", tenantName: "Beta Workspace" },
      ],
      principals: [
        {
          providerId: "corp-oidc",
          email: "admin@corp.example.com",
          memberships: [
            { tenantId: "alpha", role: "owner" },
            { tenantId: "beta", role: "reviewer" },
          ],
          defaultTenantId: "beta",
        },
      ],
    });

    const flowToken = await createOidcFlowToken({
      providerId: "corp-oidc",
      state: "state-123",
      codeVerifier: "verifier-123",
      nextPath: "/pilot",
      requestedTenantId: "alpha",
    }, { env: process.env });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "access-123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            sub: "oidc-user-1",
            email: "admin@corp.example.com",
            name: "Admin User",
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    const response = await oidcCallback(
      new Request("http://localhost/api/auth/oidc/callback/corp-oidc?code=code-123&state=state-123", {
        headers: {
          cookie: `${OIDC_FLOW_COOKIE_NAME}=${encodeURIComponent(flowToken)}`,
        },
      }),
      { params: Promise.resolve({ providerId: "corp-oidc" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/pilot");
    const setCookie = response.headers.getSetCookie();
    const sessionCookie = setCookie.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toBeTruthy();
    const token = decodeURIComponent(sessionCookie!.split(";")[0].split("=")[1]);
    const session = await verifySessionToken(token, { env: process.env });
    expect(session).toMatchObject({
      email: "admin@corp.example.com",
      activeTenantId: "alpha",
      provider: {
        id: "corp-oidc",
        type: "oidc",
      },
    });
    expect(session?.memberships).toEqual([
      { tenantId: "alpha", tenantName: "Alpha Workspace", role: "owner" },
      { tenantId: "beta", tenantName: "Beta Workspace", role: "reviewer" },
    ]);
  });
});
