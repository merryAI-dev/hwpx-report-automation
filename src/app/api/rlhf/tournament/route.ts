import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/persistence/client";
import {
  generateTournamentVariants,
  runTournament,
  promoteWinner,
} from "@/lib/rlhf/prompt-tournament";

/**
 * POST /api/rlhf/tournament
 *
 * Run a prompt tournament for a family + sectionType.
 *
 * Since live generation per variant is expensive, this endpoint scores
 * variants against pre-collected GenerationRun evaluations from the DB.
 * The winning variant's PromptMemory entries get priority boost.
 *
 * Body:
 *   familyId       - ReportFamily ID
 *   sectionType    - section type to optimize (or "all" for all types)
 *   promoteWinner  - if true, update PromptMemory priorities
 */
export const POST = withApiAuth(async (req, { email }) => {
  try {
    const body = (await req.json()) as {
      familyId?: string;
      sectionType?: string;
      promoteWinner?: boolean;
    };

    if (!body.familyId) {
      throw new ValidationError("familyId 필드가 필요합니다.");
    }
    if (!body.sectionType) {
      throw new ValidationError("sectionType 필드가 필요합니다.");
    }

    const family = await prisma.reportFamily.findUnique({
      where: { id: body.familyId },
    });
    if (!family) {
      throw new ValidationError(`ReportFamily '${body.familyId}'를 찾을 수 없습니다.`);
    }

    // Generate variants from current PromptMemory
    const variants = await generateTournamentVariants({
      familyId: body.familyId,
      sectionType: body.sectionType,
    });

    if (variants.length < 2) {
      return NextResponse.json({
        message: "프롬프트 메모리가 부족하여 토너먼트를 실행할 수 없습니다. 피드백을 더 수집하세요.",
        variantCount: variants.length,
        run: null,
      });
    }

    // Collect GenerationRun evaluations for this family to score against
    const recentRuns = await prisma.generationRun.findMany({
      where: { familyId: body.familyId, status: { not: "superseded" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        feedbacks: {
          select: { feedbackType: true, diffJson: true, qualityScore: true },
        },
      },
    });

    if (recentRuns.length === 0) {
      return NextResponse.json({
        message: "평가할 GenerationRun이 없습니다. 먼저 초안을 생성하고 피드백을 수집하세요.",
        variantCount: variants.length,
        run: null,
      });
    }

    // Aggregate human signals from recent runs
    const allFeedbacks = recentRuns.flatMap((r) => r.feedbacks);
    const accepts = allFeedbacks.filter((f) => f.feedbackType === "section_accept");
    const edits = allFeedbacks.filter((f) => f.feedbackType === "section_edit");
    const acceptRate = allFeedbacks.length > 0 ? accepts.length / allFeedbacks.length : null;

    const magnitudes = edits
      .map((f) => {
        try {
          return (JSON.parse(f.diffJson ?? "{}") as { changeMagnitude?: number }).changeMagnitude ?? null;
        } catch { return null; }
      })
      .filter((m): m is number => m !== null);
    const avgEditDistance = magnitudes.length > 0
      ? magnitudes.reduce((s, m) => s + m, 0) / magnitudes.length
      : null;

    const qualityScores = allFeedbacks
      .map((f) => f.qualityScore)
      .filter((s): s is number => s !== null);
    const avgQualityScore = qualityScores.length > 0
      ? qualityScores.reduce((s, q) => s + q, 0) / qualityScores.length
      : null;

    // Use the most recent run's evaluation as the shared benchmark
    const latestRun = recentRuns[0];
    const latestDraft = JSON.parse(latestRun.draftJson) as { evaluation?: Record<string, number> };
    const eval_ = latestDraft.evaluation;

    if (!eval_) {
      return NextResponse.json({
        message: "최근 GenerationRun에 evaluation 데이터가 없습니다.",
        variantCount: variants.length,
        run: null,
      });
    }

    // Score each variant against the same evaluation baseline
    // (in production, each variant would generate its own draft)
    const variantEvaluations = variants.map((v) => ({
      variantId: v.variantId,
      evaluation: {
        sectionCoverage: eval_.sectionCoverage ?? 0,
        typeAlignment: eval_.typeAlignment ?? 0,
        slideGroundingCoverage: eval_.slideGroundingCoverage ?? 0,
        appendixEvidenceReadiness: eval_.appendixEvidenceReadiness ?? 0,
        entityFocusCoverage: eval_.entityFocusCoverage ?? 0,
      },
      humanData: { acceptRate, avgEditDistance, avgQualityScore },
    }));

    const tournamentRun = runTournament({
      familyId: body.familyId,
      sectionType: body.sectionType,
      variants,
      variantEvaluations,
    });

    // Promote winner if requested and an improvement was found
    let promotionResult = { promoted: 0, deprecated: 0 };
    if (body.promoteWinner && tournamentRun.improved) {
      promotionResult = await promoteWinner(tournamentRun);
    }

    log.info("RLHF tournament complete", {
      familyId: body.familyId,
      sectionType: body.sectionType,
      variantCount: variants.length,
      winnerId: tournamentRun.winnerId,
      improved: tournamentRun.improved,
      ...promotionResult,
      email,
    });

    return NextResponse.json({
      tournamentRun,
      promotion: body.promoteWinner ? promotionResult : null,
    });
  } catch (err) {
    return handleApiError(err, "/api/rlhf/tournament");
  }
});
