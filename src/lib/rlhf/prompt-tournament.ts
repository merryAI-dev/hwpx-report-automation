/**
 * prompt-tournament.ts
 *
 * autoresearch-macos pattern applied to prompt optimization.
 *
 * Karpathy's autoresearch loop:
 *   train.py 수정 → 5분 훈련 → val_bpb 평가 → keep/discard → 반복
 *
 * Our adaptation:
 *   prompt variant 생성 → section 생성 → reward 평가 → keep/discard → 반복
 *
 * Tournament process:
 *   1. Start with current best PromptMemory config for a sectionType
 *   2. Generate N variants by permuting instruction_rule priority and few_shot selection
 *   3. For each variant, generate a section draft (uses existing draft infra)
 *   4. Score with reward model
 *   5. If variant beats current best → promote to PromptMemory, deprecate loser
 *   6. Log result to TournamentRun (in-memory; persisted to GenerationRun evaluation)
 */

import { prisma } from "@/lib/persistence/client";
import { computeReward, buildRewardSignals } from "./reward-model";
import { applyQualityGate } from "./quality-gates";
import type { RewardScore } from "./reward-model";
import type { QualityGateResult } from "./quality-gates";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TournamentVariant = {
  variantId: string;
  /** IDs of PromptMemory entries used in this variant */
  memoryIds: string[];
  /** Formatted prompt context string for this variant */
  promptContext: string;
  /** Description of what was changed vs baseline */
  changeDescription: string;
};

export type TournamentResult = {
  variantId: string;
  reward: RewardScore;
  gate: QualityGateResult;
  isWinner: boolean;
};

export type TournamentRun = {
  familyId: string;
  sectionType: string;
  baselineVariantId: string;
  variants: TournamentVariant[];
  results: TournamentResult[];
  winnerId: string | null;
  /** Was the baseline beaten? */
  improved: boolean;
};

// ─── Variant Generation ───────────────────────────────────────────────────────

/**
 * Generate tournament variants from current PromptMemory entries.
 *
 * Strategy (content-agnostic permutations):
 *   - baseline: current active memories in priority order
 *   - variant_rules_only: only instruction_rule entries
 *   - variant_examples_only: only few_shot/negative entries
 *   - variant_top2: top 2 by priority
 *   - variant_no_negatives: remove negative_example entries
 */
export async function generateTournamentVariants(params: {
  familyId: string;
  sectionType: string;
}): Promise<TournamentVariant[]> {
  const memories = await prisma.promptMemory.findMany({
    where: {
      OR: [
        { familyId: params.familyId, sectionType: params.sectionType, status: "active" },
        { familyId: null, sectionType: params.sectionType, status: "active" },
      ],
    },
    orderBy: { priority: "desc" },
  });

  if (memories.length === 0) return [];

  function formatContext(mems: typeof memories): string {
    if (mems.length === 0) return "";
    const lines = ["[검토자 피드백 기반 작성 지침]"];
    for (const m of mems) {
      const content = JSON.parse(m.contentJson) as Record<string, string>;
      if (m.memoryType === "instruction_rule") lines.push(`• 규칙: ${content.rule}`);
      else if (m.memoryType === "negative_example") lines.push(`• 금지: ${content.avoidPattern}`);
      else if (m.memoryType === "few_shot_example") {
        lines.push(
          `• 참고 예시: ${(content.rejectedParagraphs as unknown as string[] | undefined)?.[0]?.slice(0, 80) ?? ""}... → ${(content.chosenParagraphs as unknown as string[] | undefined)?.[0]?.slice(0, 80) ?? ""}...`,
        );
      }
    }
    return lines.join("\n");
  }

  const variants: TournamentVariant[] = [];

  // Baseline: all active memories
  variants.push({
    variantId: "baseline",
    memoryIds: memories.map((m) => m.id),
    promptContext: formatContext(memories),
    changeDescription: "현재 활성 메모리 전체 (baseline)",
  });

  const rules = memories.filter((m) => m.memoryType === "instruction_rule");
  const examples = memories.filter(
    (m) => m.memoryType === "few_shot_example" || m.memoryType === "negative_example",
  );
  const noNegatives = memories.filter((m) => m.memoryType !== "negative_example");

  if (rules.length > 0 && rules.length < memories.length) {
    variants.push({
      variantId: "rules_only",
      memoryIds: rules.map((m) => m.id),
      promptContext: formatContext(rules),
      changeDescription: "instruction_rule만 사용",
    });
  }

  if (examples.length > 0 && examples.length < memories.length) {
    variants.push({
      variantId: "examples_only",
      memoryIds: examples.map((m) => m.id),
      promptContext: formatContext(examples),
      changeDescription: "few_shot/negative_example만 사용",
    });
  }

  if (memories.length > 2) {
    const top2 = memories.slice(0, 2);
    variants.push({
      variantId: "top2",
      memoryIds: top2.map((m) => m.id),
      promptContext: formatContext(top2),
      changeDescription: "상위 2개 메모리만 사용",
    });
  }

  if (
    noNegatives.length > 0 &&
    noNegatives.length < memories.length
  ) {
    variants.push({
      variantId: "no_negatives",
      memoryIds: noNegatives.map((m) => m.id),
      promptContext: formatContext(noNegatives),
      changeDescription: "negative_example 제외",
    });
  }

  return variants;
}

// ─── Tournament Evaluation ────────────────────────────────────────────────────

/**
 * Score a set of pre-generated draft evaluations against variants.
 *
 * Since we don't run live generation in this module (that would require an
 * OpenAI call per variant), the caller passes in per-variant draft evaluations.
 * The tournament simply scores them and picks a winner.
 */
export function runTournament(params: {
  familyId: string;
  sectionType: string;
  variants: TournamentVariant[];
  variantEvaluations: Array<{
    variantId: string;
    evaluation: {
      sectionCoverage: number;
      typeAlignment: number;
      slideGroundingCoverage: number;
      appendixEvidenceReadiness: number;
      entityFocusCoverage: number;
    };
    humanData?: {
      acceptRate?: number | null;
      avgEditDistance?: number | null;
      avgQualityScore?: number | null;
    };
  }>;
}): TournamentRun {
  const results: TournamentResult[] = [];

  for (const variantEval of params.variantEvaluations) {
    const signals = buildRewardSignals(
      {
        sectionCoverage: variantEval.evaluation.sectionCoverage,
        typeAlignment: variantEval.evaluation.typeAlignment,
        slideGroundingCoverage: variantEval.evaluation.slideGroundingCoverage,
        appendixEvidenceReadiness: variantEval.evaluation.appendixEvidenceReadiness,
        entityFocusCoverage: variantEval.evaluation.entityFocusCoverage,
        // Required by type but not used in scoring
        status: "pass",
        totalSections: 1,
        completedSections: 1,
        failedSections: [],
        retryReasons: [],
      },
      variantEval.humanData,
    );

    const reward = computeReward(signals);
    const gate = applyQualityGate(reward);

    results.push({
      variantId: variantEval.variantId,
      reward,
      gate,
      isWinner: false,
    });
  }

  // Find winner: highest reward score
  const baseline = results.find((r) => r.variantId === "baseline");
  let winner = baseline;
  for (const result of results) {
    if (!winner || result.reward.score > winner.reward.score + 0.02) {
      winner = result;
    }
  }

  // Mark winner
  if (winner) {
    winner.isWinner = true;
  }

  const improved = winner?.variantId !== "baseline" &&
    (winner?.reward.score ?? 0) > (baseline?.reward.score ?? 0) + 0.02;

  return {
    familyId: params.familyId,
    sectionType: params.sectionType,
    baselineVariantId: "baseline",
    variants: params.variants,
    results,
    winnerId: winner?.variantId ?? null,
    improved,
  };
}

/**
 * Promote winning variant's memory configuration.
 * Updates priority of winning memories and deprecates displaced ones.
 */
export async function promoteWinner(
  run: TournamentRun,
): Promise<{ promoted: number; deprecated: number }> {
  if (!run.improved || !run.winnerId) return { promoted: 0, deprecated: 0 };

  const winner = run.variants.find((v) => v.variantId === run.winnerId);
  const baseline = run.variants.find((v) => v.variantId === "baseline");
  if (!winner || !baseline) return { promoted: 0, deprecated: 0 };

  // Boost priority of winning memories
  await prisma.promptMemory.updateMany({
    where: { id: { in: winner.memoryIds } },
    data: { priority: { increment: 2 } },
  });

  // Reduce priority of memories not in winner
  const losingIds = baseline.memoryIds.filter(
    (id) => !winner.memoryIds.includes(id),
  );
  if (losingIds.length > 0) {
    await prisma.promptMemory.updateMany({
      where: { id: { in: losingIds } },
      data: { priority: { decrement: 1 } },
    });
  }

  return { promoted: winner.memoryIds.length, deprecated: losingIds.length };
}
