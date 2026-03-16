import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/persistence/client";
import { computeReward, buildRewardSignals } from "@/lib/rlhf/reward-model";
import { applyQualityGate } from "@/lib/rlhf/quality-gates";
import type { ReportFamilyDraftEvaluation } from "@/lib/report-family-draft-generator";

/**
 * POST /api/rlhf/evaluate
 *
 * Compute reward score + quality gate disposition for a GenerationRun.
 * Optionally updates the run status based on gate result.
 *
 * Body:
 *   generationRunId  - ID of the GenerationRun to evaluate
 *   applyGate        - if true, update run.status based on gate disposition
 */
export const POST = withApiAuth(async (req) => {
  try {
    const body = (await req.json()) as {
      generationRunId?: string;
      applyGate?: boolean;
    };

    if (!body.generationRunId) {
      throw new ValidationError("generationRunId 필드가 필요합니다.");
    }

    const run = await prisma.generationRun.findUnique({
      where: { id: body.generationRunId },
      include: {
        feedbacks: {
          select: {
            feedbackType: true,
            diffJson: true,
            qualityScore: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json(
        { error: `GenerationRun '${body.generationRunId}'를 찾을 수 없습니다.` },
        { status: 404 },
      );
    }

    // Parse evaluation from stored draftJson
    const draft = JSON.parse(run.draftJson) as { evaluation?: ReportFamilyDraftEvaluation };
    const evaluation = draft.evaluation;

    if (!evaluation) {
      throw new ValidationError("draft에 evaluation 데이터가 없습니다.");
    }

    // Compute human signals from attached feedbacks
    const edits = run.feedbacks.filter((f) => f.feedbackType === "section_edit");
    const accepts = run.feedbacks.filter((f) => f.feedbackType === "section_accept");
    const totalFeedbacks = run.feedbacks.length;

    const acceptRate = totalFeedbacks > 0 ? accepts.length / totalFeedbacks : null;

    let avgEditDistance: number | null = null;
    if (edits.length > 0) {
      const magnitudes = edits
        .map((f) => {
          try {
            return (JSON.parse(f.diffJson ?? "{}") as { changeMagnitude?: number }).changeMagnitude ?? null;
          } catch {
            return null;
          }
        })
        .filter((m): m is number => m !== null);
      if (magnitudes.length > 0) {
        avgEditDistance = magnitudes.reduce((s, m) => s + m, 0) / magnitudes.length;
      }
    }

    const qualityScores = run.feedbacks
      .map((f) => f.qualityScore)
      .filter((s): s is number => s !== null);
    const avgQualityScore = qualityScores.length
      ? qualityScores.reduce((s, q) => s + q, 0) / qualityScores.length
      : null;

    const signals = buildRewardSignals(evaluation, {
      acceptRate,
      avgEditDistance,
      avgQualityScore,
    });

    const reward = computeReward(signals);
    const gate = applyQualityGate(reward);

    // Optionally update run status
    if (body.applyGate) {
      const newStatus =
        gate.disposition === "auto_accept"
          ? "accepted"
          : gate.disposition === "auto_reject"
            ? "rejected"
            : "pending_review";

      await prisma.generationRun.update({
        where: { id: run.id },
        data: {
          status: newStatus,
          evaluationJson: JSON.stringify({ reward, gate, signals }),
        },
      });
    }

    return NextResponse.json({
      generationRunId: run.id,
      reward,
      gate,
      signals: {
        acceptRate,
        avgEditDistance,
        avgQualityScore,
        feedbackCount: totalFeedbacks,
      },
    });
  } catch (err) {
    return handleApiError(err, "/api/rlhf/evaluate");
  }
});
