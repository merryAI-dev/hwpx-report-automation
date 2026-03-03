/**
 * Audit logging — records API usage for observability and compliance.
 *
 * Writes are fire-and-forget so they never block the request path.
 */
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";

export type AuditAction =
  | "ai-suggest"
  | "ai-batch"
  | "ai-chat"
  | "ai-verify"
  | "analyze-document"
  | "document-create"
  | "document-update"
  | "document-delete"
  | "export-hwpx"
  | "export-docx"
  | "export-pdf"
  | "document-open"
  | "login"
  | "hwpx-render";

/**
 * Record an audit log entry. Never throws — errors are logged and swallowed.
 */
export function recordAudit(
  userEmail: string,
  action: AuditAction,
  endpoint: string,
  details?: Record<string, unknown>,
): void {
  prisma.auditLog
    .create({
      data: {
        userEmail,
        action,
        endpoint,
        details: details ? JSON.stringify(details) : "{}",
      },
    })
    .catch((err) => {
      log.warn("Audit log write failed", {
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Query recent audit log entries (for the dashboard).
 */
export async function getRecentAuditLogs(options?: {
  limit?: number;
  userEmail?: string;
  action?: AuditAction;
}): Promise<Array<{
  id: string;
  userEmail: string;
  action: string;
  endpoint: string;
  details: string;
  createdAt: string;
}>> {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(options?.userEmail ? { userEmail: options.userEmail } : {}),
      ...(options?.action ? { action: options.action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 100,
  });
  return rows.map((r) => ({
    id: r.id,
    userEmail: r.userEmail,
    action: r.action,
    endpoint: r.endpoint,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  }));
}
