import { NextResponse } from "next/server";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

export async function GET(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Parallel queries
    const [
      totalDocuments,
      totalVersions,
      todayAuditLogs,
      weekAuditLogs,
      recentLogs,
    ] = await Promise.all([
      prisma.document.count(),
      prisma.documentVersion.count(),
      prisma.auditLog.count({
        where: { createdAt: { gte: todayStart } },
      }),
      prisma.auditLog.findMany({
        where: { createdAt: { gte: weekAgo } },
        select: { action: true, userEmail: true, createdAt: true },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          userEmail: true,
          action: true,
          endpoint: true,
          createdAt: true,
        },
      }),
    ]);

    // Compute stats from week's logs
    const actionCounts: Record<string, number> = {};
    const uniqueUsers = new Set<string>();
    const dailyCounts: Record<string, number> = {};

    for (const entry of weekAuditLogs) {
      // Action breakdown
      actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;

      // Unique users
      if (entry.userEmail && entry.userEmail !== "system") {
        uniqueUsers.add(entry.userEmail);
      }

      // Daily throughput
      const day = entry.createdAt.toISOString().slice(0, 10);
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    }

    // AI acceptance rate (approximate from action counts)
    const aiActions = (actionCounts["ai-suggest"] || 0) +
      (actionCounts["ai-batch"] || 0) +
      (actionCounts["ai-chat"] || 0);
    const verifyActions = actionCounts["ai-verify"] || 0;

    return NextResponse.json({
      totalDocuments,
      totalVersions,
      todayApiCalls: todayAuditLogs,
      weeklyActiveUsers: uniqueUsers.size,
      aiCallsThisWeek: aiActions,
      verifyCallsThisWeek: verifyActions,
      actionBreakdown: actionCounts,
      dailyThroughput: Object.entries(dailyCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
      recentActivity: recentLogs.map((r) => ({
        id: r.id,
        userEmail: r.userEmail,
        action: r.action,
        endpoint: r.endpoint,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error("Dashboard stats query failed", err);
    return NextResponse.json({ error: "통계 조회 실패" }, { status: 500 });
  }
}
