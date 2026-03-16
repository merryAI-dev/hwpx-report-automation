/**
 * reward-model.ts
 *
 * Composite reward scoring for RLHF.
 * Combines four signals into a [0, 1] normalized reward:
 *
 *   1. Benchmark score     — existing 14-metric evaluation (sectionCoverage, typeAlignment, ...)
 *   2. Human preference    — PreferenceData accept rate for this family
 *   3. Edit distance       — average changeMagnitude from HumanFeedback diffs
 *   4. Quality rating      — average qualityScore (1-5) normalized to [0, 1]
 *
 * Weights are configurable; defaults reflect our current confidence in each signal.
 * Phase 2/3 data required for signals 2-4; falls back gracefully when unavailable.
 */

import type { ReportFamilyDraftEvaluation } from "@/lib/report-family-draft-generator";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RewardSignals = {
  /** From ReportFamilyDraftEvaluation — range [0, 1] each */
  benchmarkSignals: {
    sectionCoverage: number;
    typeAlignment: number;
    slideGroundingCoverage: number;
    appendixEvidenceReadiness: number;
    entityFocusCoverage: number;
  };
  /** Fraction of sections accepted without edits [0, 1] or null if no data */
  humanAcceptRate: number | null;
  /** Average changeMagnitude from reviewer diffs (0=unchanged, 1=full replace) */
  avgEditDistance: number | null;
  /** Average quality score 1-5 normalized to [0, 1], or null */
  avgQualityScore: number | null;
};

export type RewardWeights = {
  benchmark: number;
  humanAccept: number;
  editDistance: number;
  quality: number;
};

export type RewardScore = {
  /** Composite reward [0, 1] */
  score: number;
  /** Per-signal breakdown */
  breakdown: {
    benchmarkScore: number;
    humanAcceptScore: number | null;
    editDistanceScore: number | null;
    qualityScore: number | null;
  };
  /** How many signals contributed (1-4) */
  signalCount: number;
  /** true if reward is based only on benchmark (no human data yet) */
  coldStart: boolean;
};

const DEFAULT_WEIGHTS: RewardWeights = {
  benchmark: 0.4,
  humanAccept: 0.25,
  editDistance: 0.2,
  quality: 0.15,
};

// ─── Core Scoring ─────────────────────────────────────────────────────────────

/**
 * Compute a composite reward score from available signals.
 * Missing signals (null) are excluded and weights redistributed.
 */
export function computeReward(
  signals: RewardSignals,
  weights: RewardWeights = DEFAULT_WEIGHTS,
): RewardScore {
  // Benchmark sub-score: weighted average of 5 metrics
  const { benchmarkSignals: b } = signals;
  const benchmarkScore =
    b.sectionCoverage * 0.3 +
    b.typeAlignment * 0.25 +
    b.slideGroundingCoverage * 0.2 +
    b.appendixEvidenceReadiness * 0.15 +
    b.entityFocusCoverage * 0.1;

  // Human accept score: accept rate directly maps to [0, 1]
  const humanAcceptScore = signals.humanAcceptRate;

  // Edit distance → reward: low edit = high reward (1 - avgEditDistance)
  const editDistanceScore =
    signals.avgEditDistance !== null
      ? Math.max(0, 1 - signals.avgEditDistance)
      : null;

  // Quality score: (avgQualityScore - 1) / 4 maps [1,5] → [0,1]
  const qualityScore =
    signals.avgQualityScore !== null
      ? Math.min(1, Math.max(0, (signals.avgQualityScore - 1) / 4))
      : null;

  // Gather available signals with their weights
  const available: Array<{ value: number; weight: number }> = [
    { value: benchmarkScore, weight: weights.benchmark },
  ];
  if (humanAcceptScore !== null) {
    available.push({ value: humanAcceptScore, weight: weights.humanAccept });
  }
  if (editDistanceScore !== null) {
    available.push({ value: editDistanceScore, weight: weights.editDistance });
  }
  if (qualityScore !== null) {
    available.push({ value: qualityScore, weight: weights.quality });
  }

  // Normalize weights to sum to 1
  const totalWeight = available.reduce((s, a) => s + a.weight, 0);
  const score = available.reduce(
    (sum, a) => sum + (a.value * a.weight) / totalWeight,
    0,
  );

  return {
    score: Math.min(1, Math.max(0, score)),
    breakdown: {
      benchmarkScore,
      humanAcceptScore,
      editDistanceScore,
      qualityScore,
    },
    signalCount: available.length,
    coldStart: available.length === 1,
  };
}

/**
 * Build RewardSignals from a ReportFamilyDraftEvaluation + optional human data.
 */
export function buildRewardSignals(
  evaluation: ReportFamilyDraftEvaluation,
  humanData?: {
    acceptRate?: number | null;
    avgEditDistance?: number | null;
    avgQualityScore?: number | null;
  },
): RewardSignals {
  return {
    benchmarkSignals: {
      sectionCoverage: evaluation.sectionCoverage,
      typeAlignment: evaluation.typeAlignment,
      slideGroundingCoverage: evaluation.slideGroundingCoverage,
      appendixEvidenceReadiness: evaluation.appendixEvidenceReadiness,
      entityFocusCoverage: evaluation.entityFocusCoverage,
    },
    humanAcceptRate: humanData?.acceptRate ?? null,
    avgEditDistance: humanData?.avgEditDistance ?? null,
    avgQualityScore: humanData?.avgQualityScore ?? null,
  };
}
