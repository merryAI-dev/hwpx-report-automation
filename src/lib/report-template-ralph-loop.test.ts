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

  it("adds a family slot alignment action when section type or appendix rules fail", () => {
    const evaluation = evaluateReportFamilyBenchmark({
      familyId: "mysc-final-report",
      sampleCount: 3,
      tocExtractionAccuracy: 1,
      sectionCoverage: 0.96,
      sectionPlanCases: [
        {
          caseId: "section-plan-1",
          expectedSections: [
            {
              tocTitle: "보육기업 기본 정보",
              sectionType: "appendix_evidence",
              evidenceExpectation: "appendix_bundle_required",
            },
          ],
          predictedSections: [
            {
              tocTitle: "보육기업 기본 정보",
              sectionType: "narrative",
              evidenceExpectation: "slide_grounded",
            },
          ],
        },
      ],
      slideGroundingCoverage: 0.92,
      documentMaskingCoverage: 1,
      maskedSourceLeakageRate: 0,
      layoutSimilarity: 0.91,
      tableStructureAccuracy: 0.9,
      promptIterationWinRate: 0.77,
      reviewerEditRate: 0.08,
      criticalHallucinationRate: 0,
      manualCorrectionMinutes: 20,
    });

    const plan = buildReportFamilyRalphPlan(evaluation);

    expect(plan.actions.some((action) => action.bucket === "align_family_section_slots")).toBe(true);
  });
});
