/**
 * Shared utilities for API route handlers.
 *
 * Provides consistent request parsing, validation, timeout handling,
 * and error response formatting for all /api/* routes.
 */
import { NextResponse } from "next/server";
import { AppError, ValidationError, ApiKeyError, toErrorResponse } from "./errors";
import { log } from "./logger";

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

/** Require an environment-variable API key. */
export function requireApiKey(envVar: string, providerLabel: string): string {
  const key = process.env[envVar];
  if (!key) throw new ApiKeyError(providerLabel);
  return key;
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
