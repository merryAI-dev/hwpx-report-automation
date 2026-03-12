import { describe, expect, it } from "vitest";
import { evaluateReportFamilyBenchmark } from "./report-template-benchmark";
import { buildReportFamilyRalphPlan } from "./report-template-ralph-loop";

describe("buildReportFamilyRalphPlan", () => {
  it("maps toc, masking, and prompt failures to concrete retry actions", () => {
    const evaluation = evaluateReportFamilyBenchmark({
      familyId: "mysc-final-report",
      sampleCount: 3,
      tocExtractionAccuracy: 0.6,
      sectionCoverage: 0.82,
      slideGroundingCoverage: 0.58,
      documentMaskingCoverage: 0.7,
      maskedSourceLeakageRate: 0.2,
      layoutSimilarity: 0.8,
      tableStructureAccuracy: 0.8,
      promptIterationWinRate: 0.31,
      reviewerEditRate: 0.34,
      criticalHallucinationRate: 0.04,
      manualCorrectionMinutes: 65,
    });

    const plan = buildReportFamilyRalphPlan(evaluation);

    expect(plan.shouldContinueLoop).toBe(true);
    expect(plan.actions.some((action) => action.bucket === "improve_toc_extractor")).toBe(true);
    expect(plan.actions.some((action) => action.bucket === "tighten_document_masking")).toBe(true);
    expect(plan.actions.some((action) => action.bucket === "strengthen_slide_grounding_prompt")).toBe(true);
    expect(plan.actions.some((action) => action.bucket === "promote_reviewer_feedback")).toBe(true);
  });
});
