import { describe, expect, it } from "vitest";
import {
  evaluateReportFamilyBenchmark,
  type ReportFamilyBenchmarkRun,
} from "./report-template-benchmark";

function makeRun(overrides: Partial<ReportFamilyBenchmarkRun> = {}): ReportFamilyBenchmarkRun {
  return {
    familyId: "mysc-final-report",
    sampleCount: 3,
    tocExtractionAccuracy: 0.9,
    sectionCoverage: 0.9,
    slideGroundingCoverage: 0.85,
    documentMaskingCoverage: 0.95,
    maskedSourceLeakageRate: 0.02,
    layoutSimilarity: 0.85,
    tableStructureAccuracy: 0.85,
    promptIterationWinRate: 0.6,
    reviewerEditRate: 0.2,
    criticalHallucinationRate: 0.01,
    manualCorrectionMinutes: 40,
    ...overrides,
  };
}

describe("evaluateReportFamilyBenchmark", () => {
  it("returns insufficient_evidence when the benchmark packet is too small", () => {
    const evaluation = evaluateReportFamilyBenchmark(makeRun({ sampleCount: 1 }));

    expect(evaluation.status).toBe("insufficient_evidence");
    expect(evaluation.passed).toBe(false);
    expect(evaluation.shouldRetry).toBe(false);
    expect(evaluation.blockers.some((metric) => metric.id === "sample_count")).toBe(true);
  });

  it("returns retry when toc, masking, and slide grounding fail", () => {
    const evaluation = evaluateReportFamilyBenchmark(
      makeRun({
        tocExtractionAccuracy: 0.62,
        slideGroundingCoverage: 0.55,
        documentMaskingCoverage: 0.71,
        maskedSourceLeakageRate: 0.19,
        promptIterationWinRate: 0.28,
      }),
    );

    expect(evaluation.status).toBe("retry");
    expect(evaluation.passed).toBe(false);
    expect(evaluation.shouldRetry).toBe(true);
    expect(evaluation.blockers.some((metric) => metric.id === "toc_extraction_accuracy")).toBe(true);
    expect(evaluation.blockers.some((metric) => metric.id === "document_masking_coverage")).toBe(true);
    expect(evaluation.blockers.some((metric) => metric.id === "masked_source_leakage_rate")).toBe(true);
    expect(evaluation.nextFocusAreas.length).toBeGreaterThan(0);
  });

  it("passes when the family clears toc, masking, and prompt-loop thresholds", () => {
    const evaluation = evaluateReportFamilyBenchmark(
      makeRun({
        sampleCount: 5,
        tocExtractionAccuracy: 0.97,
        sectionCoverage: 0.96,
        slideGroundingCoverage: 0.93,
        documentMaskingCoverage: 0.99,
        maskedSourceLeakageRate: 0,
        layoutSimilarity: 0.91,
        tableStructureAccuracy: 0.92,
        promptIterationWinRate: 0.78,
        reviewerEditRate: 0.08,
        criticalHallucinationRate: 0,
        manualCorrectionMinutes: 18,
      }),
    );

    expect(evaluation.status).toBe("pass");
    expect(evaluation.passed).toBe(true);
    expect(evaluation.shouldRetry).toBe(false);
    expect(evaluation.overallScore).toBeGreaterThanOrEqual(85);
    expect(evaluation.blockers).toHaveLength(0);
  });
});
