import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/public/health
 *
 * Simple liveness probe for the public API.
 *
 * @example
 *   curl https://YOUR_DOMAIN/api/public/health
 *   # {"status":"ok","ts":"2026-03-24T07:00:00.000Z"}
 */
export async function GET() {
  return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
}
