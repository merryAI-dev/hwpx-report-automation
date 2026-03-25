/**
 * API validation & rate-limiting utilities.
 *
 * Provides request-level guards (body size, message count, segment count,
 * rate limiting, abort controller) that API routes apply before executing
 * their core logic.
 */
import { NextResponse } from "next/server";
import { log } from "./logger";
import { prisma } from "@/lib/persistence/client";
import { aggregateCosts } from "@/lib/ai-cost-tracker";

// ── Constants ──

const DEFAULT_MAX_BODY_BYTES = 100 * 1024;  // 100 KB
const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_MAX_SEGMENTS = 5000;
const DEFAULT_MAX_PER_MINUTE = 20;
const DEFAULT_TIMEOUT_MS = 120_000;          // 120 seconds
const RATE_LIMIT_WINDOW_MS = 60_000;         // 1 minute

// ── Error responses ──

function errorResponse(
  message: string,
  code: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

// ── Body size validation ──

/**
 * Validate that a raw request body does not exceed the maximum allowed size.
 *
 * @returns `null` if valid, or a `NextResponse` with status 400 if the body
 *          exceeds `maxBytes`.
 */
export function validateBodySize(
  body: string,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): NextResponse | null {
  const size = new TextEncoder().encode(body).byteLength;
  if (size > maxBytes) {
    log.warn("Body size limit exceeded", { size, maxBytes });
    return errorResponse(
      `요청 본문이 너무 큽니다 (${size} bytes, 최대 ${maxBytes} bytes).`,
      "BODY_TOO_LARGE",
      400,
    );
  }
  return null;
}

// ── Message count validation ──

/**
 * Validate the number of messages in a chat request.
 *
 * @returns `null` if valid, or a `NextResponse` with status 400.
 */
export function validateMessageCount(
  messages: unknown[],
  maxCount: number = DEFAULT_MAX_MESSAGES,
): NextResponse | null {
  if (messages.length > maxCount) {
    log.warn("Message count limit exceeded", {
      count: messages.length,
      maxCount,
    });
    return errorResponse(
      `메시지 수가 너무 많습니다 (${messages.length}개, 최대 ${maxCount}개).`,
      "TOO_MANY_MESSAGES",
      400,
    );
  }
  return null;
}

// ── Segment count validation ──

/**
 * Validate the number of segments in a request.
 *
 * @returns `null` if valid, or a `NextResponse` with status 400.
 */
export function validateSegmentCount(
  segments: unknown[],
  maxCount: number = DEFAULT_MAX_SEGMENTS,
): NextResponse | null {
  if (segments.length > maxCount) {
    log.warn("Segment count limit exceeded", {
      count: segments.length,
      maxCount,
    });
    return errorResponse(
      `문단 수가 너무 많습니다 (${segments.length}개, 최대 ${maxCount}개).`,
      "TOO_MANY_SEGMENTS",
      400,
    );
  }
  return null;
}

// ── In-memory rate limiting ──

type RateLimitEntry = {
  timestamps: number[];
};

const rateLimitStore = new Map<string, RateLimitEntry>();

/** Periodically clean up stale entries to prevent memory leaks. */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      // Remove timestamps older than the window
      entry.timestamps = entry.timestamps.filter(
        (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
      );
      if (entry.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
    // Stop the timer if the store is empty
    if (rateLimitStore.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, RATE_LIMIT_WINDOW_MS);
  // Allow the process to exit even if the timer is running
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Check rate limit for a given IP address.
 *
 * @returns `null` if within limits, or a `NextResponse` with status 429.
 */
export function checkRateLimit(
  ip: string,
  maxPerMinute: number = DEFAULT_MAX_PER_MINUTE,
): NextResponse | null {
  ensureCleanupTimer();

  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { timestamps: [] };

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
  );

  if (entry.timestamps.length >= maxPerMinute) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - entry.timestamps[0]);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    log.warn("Rate limit exceeded", { ip, count: entry.timestamps.length, maxPerMinute });
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: `요청이 너무 많습니다. ${retryAfterSec}초 후에 다시 시도해주세요.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  entry.timestamps.push(now);
  rateLimitStore.set(ip, entry);
  return null;
}

// ── Abort controller with timeout ──

/**
 * Create an AbortController that automatically aborts after `timeoutMs`.
 *
 * The caller can use `controller.signal` to pass to fetch or other APIs,
 * and **must** call `clearTimeout` on the returned `timeoutId` when the
 * operation completes to prevent the timer from firing unnecessarily.
 *
 * @returns `{ controller, timeoutId }` so the caller can clean up.
 */
export function createAbortController(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return { controller, timeoutId };
}

// ── Convenience: extract client IP from request ──

/**
 * Best-effort extraction of the client IP from request headers.
 * Falls back to "unknown" if no header is present.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

// ── Monthly cost limit enforcement ──

const AI_ACTIONS = ["ai-suggest", "ai-batch", "ai-chat", "ai-verify"];

/**
 * Server-side monthly cost limit check.
 *
 * Queries the audit log for AI actions in the current month and compares
 * the total cost against the provided limit. If exceeded, returns a 429
 * response; otherwise returns `null` (allow the request).
 *
 * Fails open: if the DB query errors, the request is allowed.
 *
 * @param monthlyCostLimitUsd  The limit sent from the client (0 = no limit).
 */
export async function checkMonthlyCostLimit(
  monthlyCostLimitUsd: number,
): Promise<NextResponse | null> {
  if (!monthlyCostLimitUsd || monthlyCostLimitUsd <= 0) return null;

  try {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const monthLogs = await prisma.auditLog.findMany({
      where: {
        action: { in: AI_ACTIONS },
        createdAt: { gte: monthAgo },
      },
      select: { details: true },
    });

    const { totalCostUsd } = aggregateCosts(monthLogs.map((l) => l.details));

    if (totalCostUsd >= monthlyCostLimitUsd) {
      log.warn("Monthly cost limit exceeded", { totalCostUsd, monthlyCostLimitUsd });
      return errorResponse(
        `월간 비용 한도($${monthlyCostLimitUsd})를 초과했습니다. 현재: $${totalCostUsd.toFixed(4)}`,
        "MONTHLY_COST_LIMIT_EXCEEDED",
        429,
      );
    }
  } catch {
    // Fail open — allow the request if DB is unavailable
    log.warn("Monthly cost limit check failed, allowing request");
  }

  return null;
}
