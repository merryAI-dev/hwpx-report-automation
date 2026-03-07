const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEV_AUTH_SECRET = "hwpx-dev-secret";

const keyCache = new Map<string, Promise<CryptoKey>>();

export const SESSION_COOKIE_NAME = "hwpx_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export type SessionPayload = {
  email: string;
  iat: number;
  exp: number;
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

function parsePayload(payloadSegment: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payloadSegment))) as Partial<SessionPayload>;
    if (typeof parsed.email !== "string" || !parsed.email.trim()) {
      return null;
    }
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") {
      return null;
    }
    return {
      email: parsed.email.trim(),
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
  return {
    email: (env.ADMIN_EMAIL || "admin@example.com").trim(),
    password: env.ADMIN_PASSWORD || "changeme",
  };
}

export function validateAdminCredentials(
  email: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = getAdminCredentials(env);
  return email.trim() === expected.email && password === expected.password;
}

export async function createSessionToken(
  email: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    nowMs?: number;
    maxAgeSeconds?: number;
  },
): Promise<string> {
  const secret = getAuthSecret(options?.env);
  const now = getNowSeconds(options?.nowMs);
  const payload: SessionPayload = {
    email: email.trim(),
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
