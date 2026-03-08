import { getConfiguredUsers, type SessionIdentityProvider, type SessionTenantMembership } from "@/lib/auth/session";

const DEFAULT_SCOPE = "openid profile email";
const FALLBACK_TENANT: SessionTenantMembership = {
  tenantId: "default",
  tenantName: "Default Workspace",
  role: "owner",
};

export type ConfiguredIdentityProvider = SessionIdentityProvider & {
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string | null;
  userInfoEndpoint?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  clientSecretEnv?: string | null;
  scope?: string | null;
  audience?: string | null;
  prompt?: string | null;
};

export type PublicIdentityProvider = SessionIdentityProvider & {
  authorizationPath: string | null;
};

type RawPrincipalSeed = {
  providerId?: string;
  subject?: string;
  email?: string;
  emailDomain?: string;
  displayName?: string;
  memberships?: unknown;
  defaultTenantId?: string;
};

type NormalizedPrincipalSeed = {
  providerId?: string;
  subject?: string;
  email?: string;
  emailDomain?: string;
  displayName?: string;
  memberships: SessionTenantMembership[];
  defaultTenantId: string | null;
};

type RawTenantSeedConfig = {
  tenants?: unknown;
  principals?: unknown;
  defaultMemberships?: unknown;
  defaultTenantId?: string;
};

export type TenantSeedConfig = {
  tenantCatalog: SessionTenantMembership[];
  principals: NormalizedPrincipalSeed[];
  defaultMemberships: SessionTenantMembership[];
  defaultTenantId: string | null;
};

export type ResolvedSeededIdentity = {
  displayName: string;
  memberships: SessionTenantMembership[];
  defaultTenantId: string;
};

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeProviderType(type: string | undefined): SessionIdentityProvider["type"] {
  return type === "oidc" || type === "saml" || type === "password" ? type : "password";
}

function normalizeSessionProvider(raw: Partial<ConfiguredIdentityProvider> | null | undefined): ConfiguredIdentityProvider {
  const type = normalizeProviderType(raw?.type);
  return {
    id: (raw?.id || "password").trim() || "password",
    type,
    displayName: (raw?.displayName || (type === "oidc" ? "OIDC" : "Password")).trim() || "Password",
    issuer: raw?.issuer?.trim() || null,
    authorizationEndpoint: raw?.authorizationEndpoint?.trim() || null,
    tokenEndpoint: raw?.tokenEndpoint?.trim() || null,
    userInfoEndpoint: raw?.userInfoEndpoint?.trim() || null,
    clientId: raw?.clientId?.trim() || null,
    clientSecret: raw?.clientSecret?.trim() || null,
    clientSecretEnv: raw?.clientSecretEnv?.trim() || null,
    scope: raw?.scope?.trim() || (type === "oidc" ? DEFAULT_SCOPE : null),
    audience: raw?.audience?.trim() || null,
    prompt: raw?.prompt?.trim() || null,
  };
}

function uniqueMemberships(memberships: SessionTenantMembership[]): SessionTenantMembership[] {
  const deduped = memberships.filter(
    (membership, index, all) => all.findIndex((item) => item.tenantId === membership.tenantId) === index,
  );
  return deduped.length ? deduped : [{ ...FALLBACK_TENANT }];
}

function normalizeMemberships(
  rawMemberships: unknown,
  tenantNameById: Map<string, string>,
  options?: { allowEmpty?: boolean },
): SessionTenantMembership[] {
  if (!Array.isArray(rawMemberships)) {
    return options?.allowEmpty ? [] : [{ ...FALLBACK_TENANT }];
  }

  const memberships = rawMemberships
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Partial<SessionTenantMembership>;
      const tenantId = (candidate.tenantId || "").trim();
      if (!tenantId) {
        return null;
      }
      const fallbackName = tenantNameById.get(tenantId) || tenantId;
      return {
        tenantId,
        tenantName: (candidate.tenantName || fallbackName).trim() || fallbackName,
        role: (candidate.role || "editor").trim() || "editor",
      } satisfies SessionTenantMembership;
    })
    .filter((entry): entry is SessionTenantMembership => !!entry);

  if (!memberships.length && options?.allowEmpty) {
    return [];
  }
  return uniqueMemberships(memberships);
}

function pickDefaultTenantId(
  memberships: SessionTenantMembership[],
  requestedTenantId?: string | null,
): string {
  const requested = requestedTenantId?.trim();
  if (requested && memberships.some((membership) => membership.tenantId === requested)) {
    return requested;
  }
  return memberships[0]?.tenantId || FALLBACK_TENANT.tenantId;
}

function getTenantCatalogMap(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const parsed = parseJson<RawTenantSeedConfig>(env.AUTH_TENANT_SEED_JSON);
  const map = new Map<string, string>();
  const rawTenants = Array.isArray(parsed?.tenants) ? parsed.tenants : [];
  for (const entry of rawTenants) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<SessionTenantMembership>;
    const tenantId = (candidate.tenantId || "").trim();
    if (!tenantId) {
      continue;
    }
    map.set(tenantId, (candidate.tenantName || tenantId).trim() || tenantId);
  }
  return map;
}

export function getConfiguredAuthProviders(env: NodeJS.ProcessEnv = process.env): ConfiguredIdentityProvider[] {
  const explicit = parseJson<Partial<ConfiguredIdentityProvider>[]>(env.AUTH_IDENTITY_PROVIDERS_JSON) || [];
  const providers = [
    ...explicit.map((provider) => normalizeSessionProvider(provider)),
    ...getConfiguredUsers(env).map((user) => normalizeSessionProvider(user.provider)),
  ];

  return providers.filter(
    (provider, index, all) => all.findIndex((item) => item.id === provider.id) === index,
  );
}

export function getConfiguredOidcProvider(
  providerId: string,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredIdentityProvider | null {
  const provider = getConfiguredAuthProviders(env).find(
    (entry) => entry.id === providerId && entry.type === "oidc",
  );
  if (!provider) {
    return null;
  }

  const clientSecret = provider.clientSecret
    || (provider.clientSecretEnv ? env[provider.clientSecretEnv]?.trim() || null : null);

  return {
    ...provider,
    clientSecret,
  };
}

export function getPublicAuthProviders(env: NodeJS.ProcessEnv = process.env): PublicIdentityProvider[] {
  return getConfiguredAuthProviders(env).map((provider) => ({
    id: provider.id,
    type: provider.type,
    displayName: provider.displayName,
    issuer: provider.issuer,
    authorizationPath:
      provider.type === "oidc" && provider.authorizationEndpoint && provider.tokenEndpoint && provider.clientId
        ? `/api/auth/oidc/start/${provider.id}`
        : null,
  }));
}

export function getTenantSeedConfig(env: NodeJS.ProcessEnv = process.env): TenantSeedConfig {
  const tenantNameById = getTenantCatalogMap(env);
  const parsed = parseJson<RawTenantSeedConfig>(env.AUTH_TENANT_SEED_JSON) || {};
  const tenantCatalog = [
    ...Array.from(tenantNameById.entries()).map(([tenantId, tenantName]) => ({
      tenantId,
      tenantName,
      role: "seed",
    })),
    ...getConfiguredUsers(env).flatMap((user) => user.memberships),
  ].filter(
    (membership, index, all) => all.findIndex((item) => item.tenantId === membership.tenantId) === index,
  );

  const principals = (Array.isArray(parsed.principals) ? parsed.principals : []).reduce<NormalizedPrincipalSeed[]>((acc, entry) => {
      if (!entry || typeof entry !== "object") {
        return acc;
      }
      const candidate = entry as RawPrincipalSeed;
      const memberships = normalizeMemberships(candidate.memberships, tenantNameById, { allowEmpty: true });
      if (!memberships.length) {
        return acc;
      }
      acc.push({
        providerId: candidate.providerId?.trim() || undefined,
        subject: candidate.subject?.trim() || undefined,
        email: candidate.email?.trim().toLowerCase() || undefined,
        emailDomain: candidate.emailDomain?.trim().toLowerCase() || undefined,
        displayName: candidate.displayName?.trim() || undefined,
        memberships,
        defaultTenantId: candidate.defaultTenantId?.trim() || null,
      });
      return acc;
    }, []);

  const defaultMemberships = normalizeMemberships(parsed.defaultMemberships, tenantNameById, { allowEmpty: true });

  return {
    tenantCatalog: tenantCatalog.length ? tenantCatalog : [{ ...FALLBACK_TENANT }],
    principals,
    defaultMemberships,
    defaultTenantId: parsed.defaultTenantId?.trim() || null,
  };
}

export function getTenantCatalog(env: NodeJS.ProcessEnv = process.env): SessionTenantMembership[] {
  return getTenantSeedConfig(env).tenantCatalog;
}

export function resolveSeededIdentity(
  input: {
    providerId: string;
    subject: string;
    email: string;
    displayName: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSeededIdentity {
  const configuredUser = getConfiguredUsers(env).find(
    (user) => user.email.toLowerCase() === input.email.trim().toLowerCase(),
  );
  if (configuredUser) {
    return {
      displayName: configuredUser.displayName || input.displayName,
      memberships: configuredUser.memberships,
      defaultTenantId: configuredUser.defaultTenantId,
    };
  }

  const seedConfig = getTenantSeedConfig(env);
  const email = input.email.trim().toLowerCase();
  const emailDomain = email.includes("@") ? email.split("@").at(-1) || "" : "";

  let bestRule: NormalizedPrincipalSeed | null = null;
  let bestScore = -1;
  for (const principal of seedConfig.principals) {
    let score = 0;

    if (principal.providerId) {
      if (principal.providerId !== input.providerId) {
        continue;
      }
      score += 4;
    }
    if (principal.subject) {
      if (principal.subject !== input.subject) {
        continue;
      }
      score += 4;
    }
    if (principal.email) {
      if (principal.email !== email) {
        continue;
      }
      score += 3;
    }
    if (principal.emailDomain) {
      if (principal.emailDomain !== emailDomain) {
        continue;
      }
      score += 1;
    }
    if (score > bestScore) {
      bestRule = principal;
      bestScore = score;
    }
  }

  if (bestRule) {
    return {
      displayName: bestRule.displayName || input.displayName,
      memberships: bestRule.memberships,
      defaultTenantId: pickDefaultTenantId(bestRule.memberships, bestRule.defaultTenantId),
    };
  }

  const fallbackMemberships = seedConfig.defaultMemberships.length
    ? seedConfig.defaultMemberships
    : seedConfig.tenantCatalog.length
      ? [
          {
            tenantId: seedConfig.tenantCatalog[0].tenantId,
            tenantName: seedConfig.tenantCatalog[0].tenantName,
            role: "viewer",
          },
        ]
      : [{ ...FALLBACK_TENANT }];

  return {
    displayName: input.displayName,
    memberships: fallbackMemberships,
    defaultTenantId: pickDefaultTenantId(fallbackMemberships, seedConfig.defaultTenantId),
  };
}
