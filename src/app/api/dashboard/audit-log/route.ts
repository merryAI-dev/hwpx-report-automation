import { NextResponse } from "next/server";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";
import { recordAudit, type AuditAction } from "@/lib/audit";

const CLIENT_ACTIONS = new Set<AuditAction>([
  "export-hwpx",
  "export-docx",
  "export-pdf",
  "document-open",
]);

/** POST /api/dashboard/audit-log — record a client-side audit event */
export async function POST(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as {
      action?: string;
      details?: Record<string, unknown>;
    };
    const action = body.action as AuditAction;
    if (!action || !CLIENT_ACTIONS.has(action)) {
      return NextResponse.json({ error: "허용되지 않는 액션입니다." }, { status: 400 });
    }
    recordAudit("system", action, "/api/dashboard/audit-log", body.details);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("Audit log POST failed", err);
    return NextResponse.json({ error: "감사 로그 기록 실패" }, { status: 500 });
  }
}

/** GET /api/dashboard/audit-log — paginated audit log entries */
export async function GET(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  const action = url.searchParams.get("action") || undefined;

  const where = action ? { action } : {};

  try {
    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          userEmail: true,
          action: true,
          endpoint: true,
          details: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      entries: entries.map((e: typeof entries[number]) => ({
        id: e.id,
        userEmail: e.userEmail,
        action: e.action,
        endpoint: e.endpoint,
        details: e.details,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    log.error("Audit log query failed", err);
    return NextResponse.json({ error: "감사 로그 조회 실패" }, { status: 500 });
  }
}
