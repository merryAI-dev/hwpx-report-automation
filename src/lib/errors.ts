/**
 * Typed error classes for the HWPX report automation app.
 *
 * Each error carries a machine-readable `code` and HTTP-friendly `statusCode`
 * so API routes can map errors to consistent JSON responses.
 */

export class AppError extends Error {
  /** Machine-readable error code, e.g. "VALIDATION_FAILED" */
  readonly code: string;
  /** Suggested HTTP status code */
  readonly statusCode: number;
  /** Optional structured context for logging */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = "APP_ERROR",
    statusCode: number = 500,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
  }
}

/** Request body validation failures (400) */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_FAILED", 400, context);
    this.name = "ValidationError";
  }
}

/** Missing or invalid API key / auth (401/500) */
export class ApiKeyError extends AppError {
  constructor(provider: string) {
    super(
      `${provider} API 키가 설정되지 않았습니다.`,
      "API_KEY_MISSING",
      500,
      { provider },
    );
    this.name = "ApiKeyError";
  }
}

/** Upstream API call failures (502) */
export class ApiError extends AppError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, "API_ERROR", 502, context);
    this.name = "ApiError";
  }
}

/** HWPX parsing failures */
export class HwpxParseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "HWPX_PARSE_ERROR", 422, context);
    this.name = "HwpxParseError";
  }
}

/** HWPX export / serialization failures */
export class ExportError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "EXPORT_ERROR", 500, context);
    this.name = "ExportError";
  }
}

/** Request timeout */
export class TimeoutError extends AppError {
  constructor(operation: string, limitMs: number) {
    super(
      `${operation} 작업이 시간 초과되었습니다 (${limitMs}ms).`,
      "TIMEOUT",
      504,
      { operation, limitMs },
    );
    this.name = "TimeoutError";
  }
}

// ── Utility ──

/** Extract a human-readable message from any thrown value. */
export function extractErrorMessage(error: unknown, fallback = "알 수 없는 오류"): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

/** Build a consistent JSON error response body. */
export function toErrorResponse(error: unknown): {
  body: { error: string; code?: string };
  status: number;
} {
  if (error instanceof AppError) {
    return {
      body: { error: error.message, code: error.code },
      status: error.statusCode,
    };
  }
  return {
    body: { error: extractErrorMessage(error) },
    status: 500,
  };
}
