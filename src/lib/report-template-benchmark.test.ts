import { describe, expect, it } from "vitest";
import {
  evaluateReportFamilyBenchmark,
  evaluateSectionPlanBenchmarkCases,
  evaluateTocBenchmarkCases,
  type ReportFamilyBenchmarkRun,
} from "./report-template-benchmark";

function makeRun(overrides: Partial<ReportFamilyBenchmarkRun> = {}): ReportFamilyBenchmarkRun {
  return {
    familyId: "mysc-final-report",
    sampleCount: 3,
    tocExtractionAccuracy: 1,
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
  it("scores toc benchmark cases by exact match instead of loose overlap", () => {
    const summary = evaluateTocBenchmarkCases([
      {
        caseId: "packet-1",
        goldEntries: [
          { numbering: "1", title: "사업 개요" },
          { numbering: "2", title: "주요 성과" },
        ],
        predictedEntries: [
          { numbering: "1", title: "사업 개요" },
          { numbering: "2", title: "주요 성과" },
        ],
      },
      {
        caseId: "packet-2",
        goldEntries: [
          { numbering: "1", title: "사업 개요" },
          { numbering: "2", title: "주요 성과" },
          { numbering: "3", title: "향후 계획" },
        ],
        predictedEntries: [
          { numbering: "1", title: "사업 개요" },
          { numbering: "3", title: "향후 계획" },
          { numbering: "2", title: "주요 성과" },
        ],
      },
    ]);

    expect(summary.exactMatchRate).toBe(0.5);
    expect(summary.requiredSectionMatchRate).toBe(1);
    expect(summary.caseResults[1]?.exactMatch).toBe(false);
    expect(summary.caseResults[1]?.orderPassed).toBe(false);
  });

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

  it("scores section-plan cases for type, appendix, and entity alignment", () => {
    const summary = evaluateSectionPlanBenchmarkCases([
      {
        caseId: "section-plan-1",
        expectedSections: [
          { tocTitle: "프로그램 개요", sectionType: "narrative" },
          {
            tocTitle: "보육기업 기본 정보",
            sectionType: "appendix_evidence",
            evidenceExpectation: "appendix_bundle_required",
            minEvidenceBundleCount: 1,
          },
          {
            tocTitle: "로비고스",
            sectionType: "case_study",
            focusEntities: ["로비고스"],
          },
        ],
        predictedSections: [
          { tocTitle: "프로그램 개요", sectionType: "narrative" },
          {
            tocTitle: "보육기업 기본 정보",
            sectionType: "appendix_evidence",
            evidenceExpectation: "slide_grounded",
            evidenceBundleCount: 0,
          },
          {
            tocTitle: "로비고스",
            sectionType: "case_study",
            focusEntities: ["저크"],
            focusEntityResolved: false,
          },
        ],
      },
    ]);

    expect(summary.sectionTypeExactMatchRate).toBe(1);
    expect(summary.appendixEvidenceReadinessRate).toBe(0);
    expect(summary.entityFocusCoverageRate).toBe(0);
    expect(summary.caseResults[0]?.appendixGaps).toEqual([
      "보육기업 기본 정보: expected bundle 1, got 0",
    ]);
    expect(summary.caseResults[0]?.entityGaps).toEqual(["로비고스"]);
  });

  it("passes when the family clears toc, masking, and prompt-loop thresholds", () => {
    const evaluation = evaluateReportFamilyBenchmark(
      makeRun({
        sampleCount: 5,
        tocExtractionAccuracy: 1,
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

  it("forces retry when toc exact-match is not perfect even if other metrics pass", () => {
    const evaluation = evaluateReportFamilyBenchmark(
      makeRun({
        sampleCount: 5,
        tocExtractionAccuracy: 0.99,
        sectionCoverage: 0.98,
        slideGroundingCoverage: 0.95,
        documentMaskingCoverage: 1,
        maskedSourceLeakageRate: 0,
        layoutSimilarity: 0.94,
        tableStructureAccuracy: 0.94,
        promptIterationWinRate: 0.83,
        reviewerEditRate: 0.05,
        criticalHallucinationRate: 0,
        manualCorrectionMinutes: 15,
      }),
    );

    expect(evaluation.status).toBe("retry");
    expect(evaluation.blockers.some((metric) => metric.id === "toc_extraction_accuracy")).toBe(true);
  });

  it("uses detailed toc benchmark packets as the hard gate source of truth", () => {
    const evaluation = evaluateReportFamilyBenchmark(
      makeRun({
        sampleCount: 5,
        tocExtractionAccuracy: 1,
        tocBenchmarkCases: [
          {
            caseId: "packet-1",
            goldEntries: [
              { numbering: "1", title: "사업 개요" },
              { numbering: "2", title: "주요 성과" },
            ],
            predictedEntries: [
              { numbering: "1", title: "사업 개요" },
              { numbering: "2", title: "주요 성과" },
            ],
          },
          {
            caseId: "packet-2",
            goldEntries: [
              { numbering: "1", title: "사업 개요" },
              { numbering: "2", title: "주요 성과" },
            ],
            predictedEntries: [
              { numbering: "1", title: "사업 개요" },
            ],
          },
        ],
        sectionCoverage: 0.98,
        slideGroundingCoverage: 0.95,
        documentMaskingCoverage: 1,
        maskedSourceLeakageRate: 0,
        layoutSimilarity: 0.94,
        tableStructureAccuracy: 0.94,
        promptIterationWinRate: 0.83,
        reviewerEditRate: 0.05,
        criticalHallucinationRate: 0,
        manualCorrectionMinutes: 15,
      }),
    );

    expect(evaluation.status).toBe("retry");
    expect(evaluation.metrics.find((metric) => metric.id === "toc_extraction_accuracy")?.value).toBe(0.5);
    expect(evaluation.tocSummary?.caseResults[1]?.missingRequiredEntries).toEqual(["2 주요 성과"]);
  });

  it("forces retry when registered family section slots are misaligned", () => {
    const evaluation = evaluateReportFamilyBenchmark(
      makeRun({
        sampleCount: 5,
        tocExtractionAccuracy: 1,
        tocBenchmarkCases: [
          {
            caseId: "packet-1",
            goldEntries: [{ numbering: "1", title: "사업 개요" }],
            predictedEntries: [{ numbering: "1", title: "사업 개요" }],
          },
        ],
        sectionCoverage: 0.98,
        sectionPlanCases: [
          {
            caseId: "section-plan-1",
            expectedSections: [
              {
                tocTitle: "보육기업 기본 정보",
                sectionType: "appendix_evidence",
                evidenceExpectation: "appendix_bundle_required",
                minEvidenceBundleCount: 1,
              },
              {
                tocTitle: "로비고스",
                sectionType: "case_study",
                focusEntities: ["로비고스"],
              },
            ],
            predictedSections: [
              {
                tocTitle: "보육기업 기본 정보",
                sectionType: "appendix_evidence",
                evidenceExpectation: "slide_grounded",
                evidenceBundleCount: 0,
              },
              {
                tocTitle: "로비고스",
                sectionType: "narrative",
                focusEntities: [],
                focusEntityResolved: false,
              },
            ],
          },
        ],
        slideGroundingCoverage: 0.95,
        documentMaskingCoverage: 1,
        maskedSourceLeakageRate: 0,
        layoutSimilarity: 0.94,
        tableStructureAccuracy: 0.94,
        promptIterationWinRate: 0.83,
        reviewerEditRate: 0.05,
        criticalHallucinationRate: 0,
        manualCorrectionMinutes: 15,
      }),
    );

    expect(evaluation.status).toBe("retry");
    expect(evaluation.blockers.some((metric) => metric.id === "section_type_alignment")).toBe(true);
    expect(evaluation.blockers.some((metric) => metric.id === "appendix_evidence_readiness")).toBe(true);
    expect(evaluation.sectionPlanSummary?.entityFocusCoverageRate).toBe(0);
  });
});
