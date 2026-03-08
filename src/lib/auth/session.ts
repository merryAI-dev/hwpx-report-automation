const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEV_AUTH_SECRET = "hwpx-dev-secret";
const DEFAULT_PROVIDER = {
  id: "password",
  type: "password",
  displayName: "Password",
} as const;
const DEFAULT_TENANT = {
  tenantId: "default",
  tenantName: "Default Workspace",
  role: "owner",
} as const;

const keyCache = new Map<string, Promise<CryptoKey>>();

export const SESSION_COOKIE_NAME = "hwpx_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export type IdentityProviderType = "password" | "oidc" | "saml";

export type SessionTenantMembership = {
  tenantId: string;
  tenantName: string;
  role: string;
};

export type SessionIdentityProvider = {
  id: string;
  type: IdentityProviderType;
  displayName: string;
  issuer?: string | null;
};

export type SessionPayload = {
  sub: string;
  email: string;
  displayName: string;
  provider: SessionIdentityProvider;
  memberships: SessionTenantMembership[];
  activeTenantId: string;
  iat: number;
  exp: number;
};

export type ConfiguredUserRecord = {
  sub: string;
  email: string;
  password: string;
  displayName: string;
  provider: SessionIdentityProvider;
  memberships: SessionTenantMembership[];
  defaultTenantId: string;
};

type CreateSessionOptions = {
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  maxAgeSeconds?: number;
  activeTenantId?: string;
};

type SessionSeed = string | {
  sub?: string;
  email: string;
  displayName?: string;
  provider?: Partial<SessionIdentityProvider>;
  memberships?: SessionTenantMembership[];
  activeTenantId?: string;
};

function getWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is not available.");
  }
  return globalThis.crypto;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) {
    return cached;
  }

  const promise = getWebCrypto().subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  keyCache.set(secret, promise);
  return promise;
}

function getNowSeconds(nowMs?: number): number {
  const ts = typeof nowMs === "number" ? nowMs : Date.now();
  return Math.floor(ts / 1000);
}

function normalizeProvider(
  raw: Partial<SessionIdentityProvider> | null | undefined,
  fallbackType: IdentityProviderType = DEFAULT_PROVIDER.type,
): SessionIdentityProvider {
  return {
    id: (raw?.id || DEFAULT_PROVIDER.id).trim() || DEFAULT_PROVIDER.id,
    type: raw?.type === "oidc" || raw?.type === "saml" || raw?.type === "password"
      ? raw.type
      : fallbackType,
    displayName: (raw?.displayName || DEFAULT_PROVIDER.displayName).trim() || DEFAULT_PROVIDER.displayName,
    issuer: raw?.issuer?.trim() || null,
  };
}

function normalizeMemberships(rawMemberships: unknown): SessionTenantMembership[] {
  if (!Array.isArray(rawMemberships)) {
    return [{ ...DEFAULT_TENANT }];
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
      return {
        tenantId,
        tenantName: (candidate.tenantName || tenantId).trim() || tenantId,
        role: (candidate.role || "editor").trim() || "editor",
      };
    })
    .filter((entry): entry is SessionTenantMembership => !!entry);

  if (!memberships.length) {
    return [{ ...DEFAULT_TENANT }];
  }

  return memberships.filter(
    (membership, index, all) => all.findIndex((item) => item.tenantId === membership.tenantId) === index,
  );
}

function getDefaultTenantId(
  memberships: SessionTenantMembership[],
  requestedTenantId?: string | null,
  configuredDefaultTenantId?: string | null,
): string {
  const requested = requestedTenantId?.trim();
  if (requested && memberships.some((membership) => membership.tenantId === requested)) {
    return requested;
  }

  const configured = configuredDefaultTenantId?.trim();
  if (configured && memberships.some((membership) => membership.tenantId === configured)) {
    return configured;
  }

  return memberships[0]?.tenantId || DEFAULT_TENANT.tenantId;
}

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

function buildFallbackUser(env: NodeJS.ProcessEnv = process.env): ConfiguredUserRecord {
  const email = (env.ADMIN_EMAIL || "admin@example.com").trim();
  const password = env.ADMIN_PASSWORD || "changeme";
  const tenantName = (env.DEFAULT_TENANT_NAME || DEFAULT_TENANT.tenantName).trim() || DEFAULT_TENANT.tenantName;
  const tenantId = (env.DEFAULT_TENANT_ID || DEFAULT_TENANT.tenantId).trim() || DEFAULT_TENANT.tenantId;

  return {
    sub: `dev:${email}`,
    email,
    password,
    displayName: (env.ADMIN_DISPLAY_NAME || email.split("@")[0] || email).trim(),
    provider: normalizeProvider(
      parseJson<Partial<SessionIdentityProvider>>(env.AUTH_DEFAULT_PROVIDER_JSON) ?? DEFAULT_PROVIDER,
    ),
    memberships: [{
      tenantId,
      tenantName,
      role: (env.DEFAULT_TENANT_ROLE || DEFAULT_TENANT.role).trim() || DEFAULT_TENANT.role,
    }],
    defaultTenantId: tenantId,
  };
}

export function getConfiguredUsers(env: NodeJS.ProcessEnv = process.env): ConfiguredUserRecord[] {
  const parsed = parseJson<unknown[]>(env.AUTH_USERS_JSON);
  if (!Array.isArray(parsed) || !parsed.length) {
    return [buildFallbackUser(env)];
  }

  const users = parsed
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as {
        sub?: string;
        email?: string;
        password?: string;
        displayName?: string;
        provider?: Partial<SessionIdentityProvider>;
        memberships?: unknown;
        defaultTenantId?: string;
      };
      const email = (candidate.email || "").trim();
      const password = candidate.password || "";
      if (!email || !password) {
        return null;
      }
      const memberships = normalizeMemberships(candidate.memberships);
      return {
        sub: (candidate.sub || `user-${index + 1}:${email}`).trim(),
        email,
        password,
        displayName: (candidate.displayName || email.split("@")[0] || email).trim(),
        provider: normalizeProvider(candidate.provider, candidate.provider?.type || DEFAULT_PROVIDER.type),
        memberships,
        defaultTenantId: getDefaultTenantId(memberships, null, candidate.defaultTenantId),
      } satisfies ConfiguredUserRecord;
    })
    .filter((entry): entry is ConfiguredUserRecord => !!entry);

  return users.length ? users : [buildFallbackUser(env)];
}

export function getConfiguredIdentityProviders(env: NodeJS.ProcessEnv = process.env): SessionIdentityProvider[] {
  const fromUsers = getConfiguredUsers(env).map((user) => user.provider);
  const fromEnv = parseJson<Partial<SessionIdentityProvider>[]>(env.AUTH_IDENTITY_PROVIDERS_JSON) || [];
  const merged = [
    ...fromEnv.map((provider) => normalizeProvider(provider)),
    ...fromUsers,
  ];

  return merged.filter(
    (provider, index, all) => all.findIndex((item) => item.id === provider.id) === index,
  );
}

export function getAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.AUTH_SECRET?.trim();
  if (secret) {
    return secret;
  }
  if ((env.NODE_ENV ?? "development") !== "production") {
    return DEV_AUTH_SECRET;
  }
  throw new Error("AUTH_SECRET is required in production.");
}

export function getAdminCredentials(env: NodeJS.ProcessEnv = process.env): {
  email: string;
  password: string;
} {
  const fallback = buildFallbackUser(env);
  return {
    email: fallback.email,
    password: fallback.password,
  };
}

export function findConfiguredUserByEmail(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredUserRecord | null {
  const normalized = email.trim().toLowerCase();
  return getConfiguredUsers(env).find((user) => user.email.toLowerCase() === normalized) || null;
}

export function validateUserCredentials(
  email: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredUserRecord | null {
  const user = findConfiguredUserByEmail(email, env);
  if (!user) {
    return null;
  }
  return user.password === password ? user : null;
}

export function validateAdminCredentials(
  email: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !!validateUserCredentials(email, password, env);
}

function createSessionShape(
  input: SessionSeed,
  env: NodeJS.ProcessEnv,
  requestedTenantId?: string | null,
): Omit<SessionPayload, "iat" | "exp"> {
  if (typeof input === "string") {
    const configuredUser = findConfiguredUserByEmail(input, env);
    const memberships = configuredUser?.memberships ?? [{ ...DEFAULT_TENANT }];
    return {
      sub: configuredUser?.sub || `session:${input.trim()}`,
      email: input.trim(),
      displayName: configuredUser?.displayName || input.trim(),
      provider: configuredUser?.provider || normalizeProvider(DEFAULT_PROVIDER),
      memberships,
      activeTenantId: getDefaultTenantId(
        memberships,
        requestedTenantId,
        configuredUser?.defaultTenantId || memberships[0]?.tenantId,
      ),
    };
  }

  const memberships = normalizeMemberships(input.memberships);
  return {
    sub: (input.sub || `session:${input.email}`).trim(),
    email: input.email.trim(),
    displayName: (input.displayName || input.email).trim(),
    provider: normalizeProvider(input.provider, input.provider?.type || DEFAULT_PROVIDER.type),
    memberships,
    activeTenantId: getDefaultTenantId(
      memberships,
      input.activeTenantId || requestedTenantId,
      memberships[0]?.tenantId,
    ),
  };
}

function parsePayload(payloadSegment: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payloadSegment))) as Partial<SessionPayload>;
    if (typeof parsed.email !== "string" || !parsed.email.trim()) {
      return null;
    }
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") {
      return null;
    }

    if (!Array.isArray(parsed.memberships) || !parsed.memberships.length || !parsed.provider || !parsed.activeTenantId) {
      return {
        sub: parsed.sub?.trim() || `session:${parsed.email.trim()}`,
        email: parsed.email.trim(),
        displayName: parsed.displayName?.trim() || parsed.email.trim(),
        provider: normalizeProvider(DEFAULT_PROVIDER),
        memberships: [{ ...DEFAULT_TENANT }],
        activeTenantId: DEFAULT_TENANT.tenantId,
        iat: parsed.iat,
        exp: parsed.exp,
      };
    }

    const memberships = normalizeMemberships(parsed.memberships);
    return {
      sub: (parsed.sub || `session:${parsed.email}`).trim(),
      email: parsed.email.trim(),
      displayName: (parsed.displayName || parsed.email).trim(),
      provider: normalizeProvider(parsed.provider, parsed.provider?.type || DEFAULT_PROVIDER.type),
      memberships,
      activeTenantId: getDefaultTenantId(memberships, parsed.activeTenantId, memberships[0]?.tenantId),
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

async function signPayloadSegment(payloadSegment: string, secret: string): Promise<string> {
  const crypto = getWebCrypto();
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadSegment));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSessionToken(
  seed: SessionSeed,
  options?: CreateSessionOptions,
): Promise<string> {
  const env = options?.env ?? process.env;
  const secret = getAuthSecret(env);
  const now = getNowSeconds(options?.nowMs);
  const base = createSessionShape(seed, env, options?.activeTenantId);
  const payload: SessionPayload = {
    ...base,
    iat: now,
    exp: now + (options?.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS),
  };
  const payloadSegment = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signatureSegment = await signPayloadSegment(payloadSegment, secret);
  return `${payloadSegment}.${signatureSegment}`;
}

export async function verifySessionToken(
  token: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    nowMs?: number;
  },
): Promise<SessionPayload | null> {
  const [payloadSegment, signatureSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment) {
    return null;
  }

  const payload = parsePayload(payloadSegment);
  if (!payload) {
    return null;
  }

  const secret = getAuthSecret(options?.env);
  const crypto = getWebCrypto();
  const key = await getKey(secret);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToBytes(signatureSegment);
  } catch {
    return null;
  }

  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as unknown as BufferSource,
    encoder.encode(payloadSegment),
  );

  if (!verified) {
    return null;
  }

  if (payload.exp <= getNowSeconds(options?.nowMs)) {
    return null;
  }

  return payload;
}

export function getActiveTenantMembership(
  session: SessionPayload,
  tenantId: string | null | undefined = session.activeTenantId,
): SessionTenantMembership | null {
  const normalized = tenantId?.trim();
  if (!normalized) {
    return null;
  }
  return session.memberships.find((membership) => membership.tenantId === normalized) || null;
}

export function sessionHasTenant(
  session: SessionPayload,
  tenantId: string,
): boolean {
  return !!getActiveTenantMembership(session, tenantId);
}

export async function switchSessionTenant(
  session: SessionPayload,
  tenantId: string,
  options?: CreateSessionOptions,
): Promise<string> {
  if (!sessionHasTenant(session, tenantId)) {
    throw new Error("Tenant membership not found.");
  }

  return createSessionToken(
    {
      sub: session.sub,
      email: session.email,
      displayName: session.displayName,
      provider: session.provider,
      memberships: session.memberships,
      activeTenantId: tenantId,
    },
    options,
  );
}

export function getSessionCookieOptions(env: NodeJS.ProcessEnv = process.env): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: (env.NODE_ENV ?? "development") === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function getClearedSessionCookieOptions(env: NodeJS.ProcessEnv = process.env): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    ...getSessionCookieOptions(env),
    maxAge: 0,
  };
}

export function readCookieValue(
  cookieHeader: string | null,
  cookieName: string = SESSION_COOKIE_NAME,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    if (key !== cookieName) {
      continue;
    }
    return decodeURIComponent(part.slice(eqIndex + 1));
  }

  return null;
}

export async function readSessionFromCookieHeader(
  cookieHeader: string | null,
  options?: {
    env?: NodeJS.ProcessEnv;
    nowMs?: number;
  },
): Promise<SessionPayload | null> {
  const token = readCookieValue(cookieHeader);
  if (!token) {
    return null;
  }
  return verifySessionToken(token, options);
}

export async function readSessionFromRequest(
  request: Request,
  options?: {
    env?: NodeJS.ProcessEnv;
    nowMs?: number;
  },
): Promise<SessionPayload | null> {
  return readSessionFromCookieHeader(request.headers.get("cookie"), options);
}
