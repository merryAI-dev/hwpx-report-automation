import { NextResponse } from "next/server";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";
import { aggregateCosts } from "@/lib/ai-cost-tracker";

/** GET /api/dashboard/costs — AI cost summary for the week */
export async function GET(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const aiActions = ["ai-suggest", "ai-batch", "ai-chat", "ai-verify"];

    const [weekLogs, monthLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          action: { in: aiActions },
          createdAt: { gte: weekAgo },
        },
        select: { details: true, action: true, createdAt: true },
      }),
      prisma.auditLog.findMany({
        where: {
          action: { in: aiActions },
          createdAt: { gte: monthAgo },
        },
        select: { details: true, action: true, createdAt: true },
      }),
    ]);

    const weekCosts = aggregateCosts(weekLogs.map((l) => l.details));
    const monthCosts = aggregateCosts(monthLogs.map((l) => l.details));

    // Daily cost breakdown for the week
    const dailyCosts: Record<string, number> = {};
    for (const entry of weekLogs) {
      const day = entry.createdAt.toISOString().slice(0, 10);
      try {
        const parsed = JSON.parse(entry.details);
        if (typeof parsed.costUsd === "number") {
          dailyCosts[day] = (dailyCosts[day] ?? 0) + parsed.costUsd;
        }
      } catch {
        // skip
      }
    }

    return NextResponse.json({
      weekly: {
        totalCostUsd: weekCosts.totalCostUsd,
        totalInputTokens: weekCosts.totalInputTokens,
        totalOutputTokens: weekCosts.totalOutputTokens,
        byModel: weekCosts.byModel,
        callCount: weekLogs.length,
      },
      monthly: {
        totalCostUsd: monthCosts.totalCostUsd,
        callCount: monthLogs.length,
      },
      dailyCosts: Object.entries(dailyCosts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, costUsd]) => ({
          date,
          costUsd: Math.round(costUsd * 10000) / 10000,
        })),
    });
  } catch (err) {
    log.error("Cost summary query failed", err);
    return NextResponse.json({ error: "비용 요약 조회 실패" }, { status: 500 });
  }
}
