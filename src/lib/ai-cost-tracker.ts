/**
 * AI API cost estimation and tracking.
 *
 * Estimates costs based on token counts and model pricing.
 * Tracks costs via the audit log details field.
 */

import { log } from "@/lib/logger";

// Pricing per 1M tokens (USD) — approximations as of early 2026
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-20250414": { input: 0.8, output: 4.0 },
  // OpenAI
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
};

const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export type CostEstimate = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

/** Estimate cost for an AI API call based on token counts. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const costUsd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return {
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000, // 6 decimal places
  };
}

/** Rough token count estimate from string length (1 token ~ 3.5 Korean chars). */
export function estimateTokenCount(text: string): number {
  // Korean uses ~3.5 chars per token on average
  return Math.ceil(text.length / 3.5);
}

/** Build cost detail JSON string for the audit log. */
export function buildCostDetailJson(cost: CostEstimate): string {
  return JSON.stringify({
    model: cost.model,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    costUsd: cost.estimatedCostUsd,
  });
}

/** Parse cost detail from an audit log details JSON string. */
export function parseCostDetail(
  details: string,
): { model: string; inputTokens: number; outputTokens: number; costUsd: number } | null {
  try {
    const parsed = JSON.parse(details);
    if (typeof parsed.costUsd === "number") {
      return parsed;
    }
  } catch {
    // not a cost detail
  }
  return null;
}

/** Aggregate costs from a list of audit log details. */
export function aggregateCosts(
  detailStrings: string[],
): { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; byModel: Record<string, number> } {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const byModel: Record<string, number> = {};

  for (const d of detailStrings) {
    const cost = parseCostDetail(d);
    if (!cost) continue;
    totalCostUsd += cost.costUsd;
    totalInputTokens += cost.inputTokens;
    totalOutputTokens += cost.outputTokens;
    byModel[cost.model] = (byModel[cost.model] ?? 0) + cost.costUsd;
  }

  return {
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    totalInputTokens,
    totalOutputTokens,
    byModel,
  };
}

/** Log a warning if weekly cost exceeds threshold. */
export function checkCostThreshold(
  weeklyCostUsd: number,
  thresholdUsd: number = 50,
): void {
  if (weeklyCostUsd > thresholdUsd) {
    log.warn("Weekly AI cost threshold exceeded", {
      weeklyCostUsd,
      thresholdUsd,
    });
  }
}
