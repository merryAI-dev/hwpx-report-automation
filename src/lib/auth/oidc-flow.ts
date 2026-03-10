import { getAuthSecret } from "@/lib/auth/session";
import type { ConfiguredIdentityProvider } from "@/lib/auth/provider-config";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

export const OIDC_FLOW_COOKIE_NAME = "hwpx_oidc_flow";
export const OIDC_FLOW_MAX_AGE_SECONDS = 60 * 10;

export type OidcFlowPayload = {
  providerId: string;
  state: string;
  codeVerifier: string;
  nextPath: string;
  requestedTenantId?: string | null;
  iat: number;
  exp: number;
};

export type OidcUserProfile = {
  sub: string;
  email: string;
  displayName: string;
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
  return Math.floor((typeof nowMs === "number" ? nowMs : Date.now()) / 1000);
}

async function signPayloadSegment(payloadSegment: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const signature = await getWebCrypto().subtle.sign("HMAC", key, encoder.encode(payloadSegment));
  return bytesToBase64Url(new Uint8Array(signature));
}

function parseFlowPayload(payloadSegment: string): OidcFlowPayload | null {
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payloadSegment))) as Partial<OidcFlowPayload>;
    if (
      typeof parsed.providerId !== "string"
      || typeof parsed.state !== "string"
      || typeof parsed.codeVerifier !== "string"
      || typeof parsed.nextPath !== "string"
      || typeof parsed.iat !== "number"
      || typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return {
      providerId: parsed.providerId,
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      nextPath: parsed.nextPath,
      requestedTenantId: parsed.requestedTenantId?.trim() || null,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function normalizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function createRandomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  getWebCrypto().getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = createRandomBase64Url(48);
  const digest = await getWebCrypto().subtle.digest("SHA-256", encoder.encode(codeVerifier));
  return {
    codeVerifier,
    codeChallenge: bytesToBase64Url(new Uint8Array(digest)),
  };
}

export async function createOidcFlowToken(
  payload: Omit<OidcFlowPayload, "iat" | "exp">,
  options?: { env?: NodeJS.ProcessEnv; nowMs?: number; maxAgeSeconds?: number },
): Promise<string> {
  const now = getNowSeconds(options?.nowMs);
  const secret = getAuthSecret(options?.env);
  const fullPayload: OidcFlowPayload = {
    ...payload,
    iat: now,
    exp: now + (options?.maxAgeSeconds ?? OIDC_FLOW_MAX_AGE_SECONDS),
  };
  const payloadSegment = bytesToBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const signatureSegment = await signPayloadSegment(payloadSegment, secret);
  return `${payloadSegment}.${signatureSegment}`;
}

export async function verifyOidcFlowToken(
  token: string,
  options?: { env?: NodeJS.ProcessEnv; nowMs?: number },
): Promise<OidcFlowPayload | null> {
  const [payloadSegment, signatureSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment) {
    return null;
  }
  const payload = parseFlowPayload(payloadSegment);
  if (!payload) {
    return null;
  }

  const key = await getKey(getAuthSecret(options?.env));
  let signatureBytes;
  try {
    signatureBytes = base64UrlToBytes(signatureSegment);
  } catch {
    return null;
  }

  const verified = await getWebCrypto().subtle.verify(
    "HMAC",
    key,
    signatureBytes as unknown as BufferSource,
    encoder.encode(payloadSegment),
  );
  if (!verified || payload.exp <= getNowSeconds(options?.nowMs)) {
    return null;
  }
  return payload;
}

export function getOidcFlowCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: (env.NODE_ENV ?? "development") === "production",
    path: "/",
    maxAge: OIDC_FLOW_MAX_AGE_SECONDS,
  };
}

export function getClearedOidcFlowCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...getOidcFlowCookieOptions(env),
    maxAge: 0,
  };
}

export function buildOidcAuthorizationUrl(
  provider: ConfiguredIdentityProvider,
  requestUrl: string,
  options: {
    state: string;
    codeChallenge: string;
    nextPath: string;
  },
): URL {
  if (!provider.authorizationEndpoint || !provider.clientId) {
    throw new Error("OIDC provider is missing authorizationEndpoint or clientId.");
  }

  const redirectUri = new URL(`/api/auth/oidc/callback/${provider.id}`, requestUrl).toString();
  const authorizationUrl = new URL(provider.authorizationEndpoint);
  authorizationUrl.searchParams.set("client_id", provider.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", provider.scope || "openid profile email");
  authorizationUrl.searchParams.set("state", options.state);
  authorizationUrl.searchParams.set("code_challenge", options.codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  if (provider.audience) {
    authorizationUrl.searchParams.set("audience", provider.audience);
  }
  if (provider.prompt) {
    authorizationUrl.searchParams.set("prompt", provider.prompt);
  }
  return authorizationUrl;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payloadSegment] = token.split(".");
  if (!payloadSegment) {
    throw new Error("Invalid JWT token.");
  }
  return JSON.parse(decoder.decode(base64UrlToBytes(payloadSegment))) as Record<string, unknown>;
}

function normalizeOidcProfile(raw: Record<string, unknown>): OidcUserProfile {
  const sub = typeof raw.sub === "string" ? raw.sub.trim() : "";
  const email = typeof raw.email === "string"
    ? raw.email.trim().toLowerCase()
    : typeof raw.preferred_username === "string"
      ? raw.preferred_username.trim().toLowerCase()
      : "";
  const displayName = typeof raw.name === "string"
    ? raw.name.trim()
    : typeof raw.preferred_username === "string"
      ? raw.preferred_username.trim()
      : email;

  if (!sub || !email) {
    throw new Error("OIDC profile is missing sub or email.");
  }

  return {
    sub,
    email,
    displayName: displayName || email,
  };
}

export async function exchangeOidcCodeForProfile(
  provider: ConfiguredIdentityProvider,
  requestUrl: string,
  code: string,
  codeVerifier: string,
): Promise<OidcUserProfile> {
  if (!provider.tokenEndpoint || !provider.clientId) {
    throw new Error("OIDC provider is missing tokenEndpoint or clientId.");
  }

  const redirectUri = new URL(`/api/auth/oidc/callback/${provider.id}`, requestUrl).toString();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId,
    code_verifier: codeVerifier,
  });
  if (provider.clientSecret) {
    body.set("client_secret", provider.clientSecret);
  }

  const tokenResponse = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    id_token?: string;
    error?: string;
  };
  if (!tokenResponse.ok) {
    throw new Error(tokenPayload.error || `OIDC token exchange failed (${tokenResponse.status}).`);
  }

  if (provider.userInfoEndpoint && tokenPayload.access_token) {
    const profileResponse = await fetch(provider.userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        Accept: "application/json",
      },
    });
    const profilePayload = (await profileResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!profileResponse.ok) {
      throw new Error(`OIDC userinfo fetch failed (${profileResponse.status}).`);
    }
    return normalizeOidcProfile(profilePayload);
  }

  if (!tokenPayload.id_token) {
    throw new Error("OIDC response is missing both userinfo data and id_token.");
  }
  return normalizeOidcProfile(decodeJwtPayload(tokenPayload.id_token));
}
