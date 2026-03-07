import { afterEach, describe, expect, it } from "vitest";
import { GET as startOidc } from "@/app/api/auth/oidc/start/[providerId]/route";
import { OIDC_FLOW_COOKIE_NAME } from "@/lib/auth/oidc-flow";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/auth/oidc/start/[providerId]", () => {
  it("redirects to the configured authorization endpoint and seeds a flow cookie", async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_IDENTITY_PROVIDERS_JSON = JSON.stringify([
      {
        id: "corp-oidc",
        type: "oidc",
        displayName: "Corp OIDC",
        clientId: "client-123",
        authorizationEndpoint: "https://id.example.com/authorize",
        tokenEndpoint: "https://id.example.com/oauth/token",
        scope: "openid profile email",
      },
    ]);

    const response = await startOidc(
      new Request("http://localhost/api/auth/oidc/start/corp-oidc?next=%2Fpilot&tenantId=alpha"),
      { params: Promise.resolve({ providerId: "corp-oidc" }) },
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location") || "";
    expect(location).toContain("https://id.example.com/authorize");
    expect(location).toContain("client_id=client-123");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%2Fapi%2Fauth%2Foidc%2Fcallback%2Fcorp-oidc");
    expect(location).toContain("code_challenge=");
    expect(response.headers.get("set-cookie")).toContain(OIDC_FLOW_COOKIE_NAME);
  });
});
