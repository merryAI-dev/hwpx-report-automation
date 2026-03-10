import { describe, it, expect } from "vitest";
import {
  estimateCost,
  estimateTokenCount,
  buildCostDetailJson,
  parseCostDetail,
  aggregateCosts,
} from "./ai-cost-tracker";

describe("ai-cost-tracker", () => {
  describe("estimateCost", () => {
    it("estimates cost for known model", () => {
      const cost = estimateCost("gpt-4.1-mini", 1000, 500);
      expect(cost.model).toBe("gpt-4.1-mini");
      expect(cost.inputTokens).toBe(1000);
      expect(cost.outputTokens).toBe(500);
      // 1000/1M * 0.4 + 500/1M * 1.6 = 0.0004 + 0.0008 = 0.0012
      expect(cost.estimatedCostUsd).toBeCloseTo(0.0012, 4);
    });

    it("uses default pricing for unknown model", () => {
      const cost = estimateCost("unknown-model", 1000, 1000);
      expect(cost.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("handles zero tokens", () => {
      const cost = estimateCost("gpt-4.1-mini", 0, 0);
      expect(cost.estimatedCostUsd).toBe(0);
    });
  });

  describe("estimateTokenCount", () => {
    it("estimates tokens from Korean text", () => {
      const text = "한국어 텍스트 예시입니다"; // ~12 chars
      const tokens = estimateTokenCount(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length);
    });

    it("handles empty string", () => {
      expect(estimateTokenCount("")).toBe(0);
    });
  });

  describe("buildCostDetailJson / parseCostDetail", () => {
    it("round-trips cost detail", () => {
      const cost = estimateCost("gpt-4.1-mini", 500, 200);
      const json = buildCostDetailJson(cost);
      const parsed = parseCostDetail(json);
      expect(parsed).not.toBeNull();
      expect(parsed!.model).toBe("gpt-4.1-mini");
      expect(parsed!.costUsd).toBe(cost.estimatedCostUsd);
    });

    it("returns null for non-cost JSON", () => {
      expect(parseCostDetail('{"model":"gpt"}')).toBeNull();
      expect(parseCostDetail("not json")).toBeNull();
      expect(parseCostDetail("{}")).toBeNull();
    });
  });

  describe("aggregateCosts", () => {
    it("aggregates costs from multiple entries", () => {
      const details = [
        buildCostDetailJson(estimateCost("gpt-4.1-mini", 1000, 500)),
        buildCostDetailJson(estimateCost("gpt-4.1-mini", 2000, 1000)),
        '{"action":"other"}', // not a cost entry, should be skipped
      ];
      const agg = aggregateCosts(details);
      expect(agg.totalCostUsd).toBeGreaterThan(0);
      expect(agg.totalInputTokens).toBe(3000);
      expect(agg.totalOutputTokens).toBe(1500);
      expect(agg.byModel["gpt-4.1-mini"]).toBeGreaterThan(0);
    });

    it("handles empty array", () => {
      const agg = aggregateCosts([]);
      expect(agg.totalCostUsd).toBe(0);
      expect(agg.totalInputTokens).toBe(0);
    });
  });
});
