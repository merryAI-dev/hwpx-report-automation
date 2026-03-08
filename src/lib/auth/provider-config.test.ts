import { afterEach, describe, expect, it } from "vitest";
import {
  getPublicAuthProviders,
  getTenantCatalog,
  resolveSeededIdentity,
} from "@/lib/auth/provider-config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("provider config", () => {
  it("exposes public providers and tenant catalog from env", () => {
    process.env.AUTH_USERS_JSON = JSON.stringify([]);
    process.env.AUTH_IDENTITY_PROVIDERS_JSON = JSON.stringify([
      {
        id: "corp-oidc",
        type: "oidc",
        displayName: "Corp OIDC",
        issuer: "https://id.example.com",
        clientId: "client-123",
        authorizationEndpoint: "https://id.example.com/authorize",
        tokenEndpoint: "https://id.example.com/oauth/token",
      },
    ]);
    process.env.AUTH_TENANT_SEED_JSON = JSON.stringify({
      tenants: [
        { tenantId: "alpha", tenantName: "Alpha Workspace" },
        { tenantId: "beta", tenantName: "Beta Workspace" },
      ],
    });

    expect(getPublicAuthProviders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "corp-oidc",
          type: "oidc",
          authorizationPath: "/api/auth/oidc/start/corp-oidc",
        }),
      ]),
    );
    expect(getTenantCatalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenantId: "alpha", tenantName: "Alpha Workspace" }),
        expect.objectContaining({ tenantId: "beta", tenantName: "Beta Workspace" }),
      ]),
    );
  });

  it("resolves seeded tenant memberships with exact-email rules before domain rules", () => {
    process.env.AUTH_TENANT_SEED_JSON = JSON.stringify({
      tenants: [
        { tenantId: "alpha", tenantName: "Alpha Workspace" },
        { tenantId: "beta", tenantName: "Beta Workspace" },
      ],
      principals: [
        {
          providerId: "corp-oidc",
          emailDomain: "corp.example.com",
          memberships: [{ tenantId: "alpha", role: "editor" }],
        },
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

    const resolved = resolveSeededIdentity({
      providerId: "corp-oidc",
      subject: "user-1",
      email: "admin@corp.example.com",
      displayName: "Admin User",
    });

    expect(resolved.defaultTenantId).toBe("beta");
    expect(resolved.memberships).toEqual([
      { tenantId: "alpha", tenantName: "Alpha Workspace", role: "owner" },
      { tenantId: "beta", tenantName: "Beta Workspace", role: "reviewer" },
    ]);
  });
});
