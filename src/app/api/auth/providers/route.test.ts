import { afterEach, describe, expect, it } from "vitest";
import { GET as listProviders } from "@/app/api/auth/providers/route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/auth/providers", () => {
  it("returns public provider metadata and tenant catalog", async () => {
    process.env.AUTH_IDENTITY_PROVIDERS_JSON = JSON.stringify([
      {
        id: "corp-oidc",
        type: "oidc",
        displayName: "Corp OIDC",
        clientId: "client-123",
        authorizationEndpoint: "https://id.example.com/authorize",
        tokenEndpoint: "https://id.example.com/oauth/token",
      },
    ]);
    process.env.AUTH_TENANT_SEED_JSON = JSON.stringify({
      tenants: [{ tenantId: "alpha", tenantName: "Alpha Workspace" }],
    });

    const response = await listProviders();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "corp-oidc", authorizationPath: "/api/auth/oidc/start/corp-oidc" }),
      ]),
    );
    expect(payload.tenantCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenantId: "alpha", tenantName: "Alpha Workspace" }),
      ]),
    );
  });
});
