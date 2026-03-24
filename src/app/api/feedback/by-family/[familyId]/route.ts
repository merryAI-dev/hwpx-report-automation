import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { prisma } from "@/lib/persistence/client";

type RouteContext = { params: Promise<{ familyId: string }> };

/**
 * GET /api/feedback/by-family/[familyId]
 *
 * Returns GenerationRuns and aggregated HumanFeedback stats for a family.
 * Query params:
 *   limit  - max runs to return (default: 20)
 *   status - filter by run status (optional)
 */
export const GET = withApiAuth<Request, RouteContext>(
  async (req, _session, context) => {
    try {
      const { familyId } = await (
        context?.params ?? Promise.resolve({ familyId: "" })
      );

      const { searchParams } = new URL(req.url);
      const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "20", 10));
      const status = searchParams.get("status") ?? undefined;

      const runs = await prisma.generationRun.findMany({
        where: {
          familyId,
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          _count: { select: { feedbacks: true } },
        },
      });

      // Aggregate correction pattern frequencies across all feedback for this family
      const allFeedbacks = await prisma.humanFeedback.findMany({
        where: {
          generationRun: { familyId },
        },
        select: { correctionPatternJson: true, feedbackType: true },
      });

      const patternFrequency: Record<string, number> = {};
      let totalEdits = 0;
      let totalAccepts = 0;

      for (const fb of allFeedbacks) {
        if (fb.feedbackType === "section_edit") totalEdits += 1;
        if (fb.feedbackType === "section_accept") totalAccepts += 1;

        const patterns = JSON.parse(fb.correctionPatternJson ?? "[]") as string[];
        for (const p of patterns) {
          patternFrequency[p] = (patternFrequency[p] ?? 0) + 1;
        }
      }

      const preferenceCount = await prisma.preferenceData.count({
        where: { familyId },
      });

      return NextResponse.json({
        runs,
        stats: {
          totalRuns: runs.length,
          totalFeedbacks: allFeedbacks.length,
          totalEdits,
          totalAccepts,
          acceptRate: allFeedbacks.length
            ? totalAccepts / allFeedbacks.length
            : null,
          patternFrequency,
          preferenceCount,
        },
      });
    } catch (err) {
      return handleApiError(err, "/api/feedback/by-family/[familyId]");
    }
  },
);
