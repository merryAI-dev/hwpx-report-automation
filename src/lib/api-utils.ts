/**
 * Shared utilities for API route handlers.
 *
 * Provides consistent request parsing, validation, timeout handling,
 * and error response formatting for all /api/* routes.
 */
import { NextResponse } from "next/server";
import { AppError, ValidationError, ApiKeyError, toErrorResponse } from "./errors";
import { log } from "./logger";
import { getApiKey, type ApiProvider } from "./api-keys";

/** Parse and validate a JSON request body. Throws ValidationError on malformed JSON. */
export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("요청 본문이 올바른 JSON이 아닙니다.");
  }
}

/** Require a non-empty string field. */
export function requireString(
  value: unknown,
  fieldName: string,
): string {
  const str = typeof value === "string" ? value.trim() : "";
  if (!str) {
    throw new ValidationError(`${fieldName} 필드가 필요합니다.`);
  }
  return str;
}

/** Extract API key from request header (X-Anthropic-Api-Key / X-OpenAI-Api-Key). */
export function getApiKeyFromRequest(request: Request, provider: ApiProvider): string | undefined {
  const headerName = provider === "anthropic" ? "x-anthropic-api-key" : "x-openai-api-key";
  return request.headers.get(headerName) ?? undefined;
}

/** Require an API key — checks request header first, then env var. */
export function requireApiKey(envVar: string, providerLabel: string, request?: Request): string {
  if (request) {
    const provider: ApiProvider = envVar.includes("ANTHROPIC") ? "anthropic" : "openai";
    const headerKey = getApiKeyFromRequest(request, provider);
    if (headerKey) return headerKey;
  }
  const key = process.env[envVar];
  if (!key) throw new ApiKeyError(providerLabel);
  return key;
}

/**
 * BYOK: 요청 헤더 → 사용자 DB 키 → env 폴백 순서로 조회.
 */
export async function requireUserApiKey(provider: ApiProvider, request?: Request): Promise<{ apiKey: string; userEmail: string }> {
  // 1. Request header (client-side localStorage key)
  if (request) {
    const headerKey = getApiKeyFromRequest(request, provider);
    if (headerKey) return { apiKey: headerKey, userEmail: "guest" };
  }
  // 2. DB key (per-user, encrypted)
  const { auth } = await import("./auth");
  const session = await auth();
  const userEmail = session?.user?.email ?? null;
  const key = await getApiKey(userEmail, provider);
  if (key) return { apiKey: key, userEmail: userEmail ?? "anonymous" };
  // 3. Error
  const label = provider === "anthropic" ? "Anthropic" : "OpenAI";
  throw new ApiKeyError(
    `${label} API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.`,
  );
}

/** Wrap a promise with an AbortController timeout. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string = "API call",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError(
        `${label} 시간 초과 (${ms}ms)`,
        "TIMEOUT",
        504,
        { label, ms },
      ));
    }, ms);

    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Standard error → NextResponse handler for API routes.
 * Logs the error and returns a consistent JSON response.
 */
export function handleApiError(error: unknown, route: string): NextResponse {
  const { body, status } = toErrorResponse(error);
  log.error(`API ${route} error`, error, { route, status, code: body.code });
  return NextResponse.json(body, { status });
}

/** Default API timeout in milliseconds. */
export const DEFAULT_API_TIMEOUT_MS = 120_000;
