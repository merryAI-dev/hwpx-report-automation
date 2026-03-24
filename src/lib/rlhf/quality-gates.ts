/**
 * quality-gates.ts
 *
 * Threshold-based quality gate for AI-generated drafts.
 * Maps a composite reward score to a disposition:
 *
 *   score > 0.85  → auto_accept   (no human review needed)
 *   0.50–0.85     → review        (send to human reviewer)
 *   score < 0.50  → auto_reject   (retry generation or use fallback)
 *
 * Cold-start mode (no human data): thresholds are relaxed since we can only
 * use benchmark signals. The gate defaults to "review" unless benchmark is very low.
 */

import type { RewardScore } from "./reward-model";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QualityGateDisposition =
  | "auto_accept"
  | "review"
  | "auto_reject";

export type QualityGateResult = {
  disposition: QualityGateDisposition;
  score: number;
  reason: string;
  /** Suggested action for auto_reject cases */
  retryAction?: "retry_with_memory" | "retry_with_fallback" | "escalate";
};

export type QualityGateThresholds = {
  autoAccept: number;
  autoReject: number;
  coldStartAutoAccept: number;
  coldStartAutoReject: number;
};

const DEFAULT_THRESHOLDS: QualityGateThresholds = {
  autoAccept: 0.85,
  autoReject: 0.50,
  coldStartAutoAccept: 0.90,  // Higher bar with no human validation
  coldStartAutoReject: 0.35,
};

// ─── Core Gate Logic ──────────────────────────────────────────────────────────

export function applyQualityGate(
  reward: RewardScore,
  thresholds: QualityGateThresholds = DEFAULT_THRESHOLDS,
): QualityGateResult {
  const { score, coldStart } = reward;

  const acceptThreshold = coldStart
    ? thresholds.coldStartAutoAccept
    : thresholds.autoAccept;
  const rejectThreshold = coldStart
    ? thresholds.coldStartAutoReject
    : thresholds.autoReject;

  if (score >= acceptThreshold) {
    return {
      disposition: "auto_accept",
      score,
      reason: coldStart
        ? `벤치마크 점수 ${(score * 100).toFixed(1)}% — 자동 승인 기준 초과 (cold start)`
        : `복합 리워드 ${(score * 100).toFixed(1)}% — 자동 승인 기준 초과`,
    };
  }

  if (score < rejectThreshold) {
    const retryAction = cold_start_retry_action(reward);
    return {
      disposition: "auto_reject",
      score,
      reason: `복합 리워드 ${(score * 100).toFixed(1)}% — 자동 거절 기준 미달`,
      retryAction,
    };
  }

  return {
    disposition: "review",
    score,
    reason: `복합 리워드 ${(score * 100).toFixed(1)}% — 검토자 확인 필요`,
  };
}

function cold_start_retry_action(
  reward: RewardScore,
): QualityGateResult["retryAction"] {
  const { breakdown } = reward;

  // If benchmark is the only signal and it's low, try retrying with memory first
  if (reward.coldStart) {
    return "retry_with_memory";
  }

  // Human accept rate is very low → likely systematic prompt issue
  if (breakdown.humanAcceptScore !== null && breakdown.humanAcceptScore < 0.2) {
    return "retry_with_memory";
  }

  // Edit distance is very high → content is being fully replaced
  if (breakdown.editDistanceScore !== null && breakdown.editDistanceScore < 0.15) {
    return "escalate";
  }

  return "retry_with_fallback";
}

/**
 * Batch evaluation: apply gate to multiple reward scores and return summary.
 */
export function evaluateBatch(
  rewards: Array<{ id: string; reward: RewardScore }>,
  thresholds?: QualityGateThresholds,
): {
  results: Array<{ id: string; gateResult: QualityGateResult }>;
  summary: {
    autoAccept: number;
    review: number;
    autoReject: number;
    avgScore: number;
  };
} {
  const results = rewards.map(({ id, reward }) => ({
    id,
    gateResult: applyQualityGate(reward, thresholds),
  }));

  const counts = { autoAccept: 0, review: 0, autoReject: 0 };
  let totalScore = 0;
  for (const { gateResult } of results) {
    counts[
      gateResult.disposition === "auto_accept"
        ? "autoAccept"
        : gateResult.disposition === "review"
          ? "review"
          : "autoReject"
    ] += 1;
    totalScore += gateResult.score;
  }

  return {
    results,
    summary: {
      ...counts,
      avgScore: results.length ? totalScore / results.length : 0,
    },
  };
}
