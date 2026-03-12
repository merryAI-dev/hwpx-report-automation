import { describe, expect, it } from "vitest";
import {
  evaluateReportAutomationReadiness,
  type ReportAutomationSignals,
} from "./report-template-readiness";

function makeSignals(overrides: Partial<ReportAutomationSignals> = {}): ReportAutomationSignals {
  return {
    sourceFormats: ["hwp", "hwpx", "docx", "pptx"],
    canExtractLayoutFromPdf: false,
    canDetectSectionsFromExemplar: false,
    canExtractTableOfContents: false,
    canVersionTemplateSchema: true,
    canUseCanonicalSectionSchema: false,
    canMaskNonSlideDocuments: false,
    canGenerateFromSlides: false,
    hasSlideGroundingPrompt: false,
    hasPromptReinforcementLoop: false,
    canRenderTablesAndCharts: false,
    canPreserveHeadersFooters: false,
    canRunVisualDiff: false,
    hasHumanReviewQueue: false,
    hasRegressionCorpus: false,
    corpusFamilyCount: 1,
    exemplarCountPerFamily: 1,
    tocExtractionAccuracy: 0.35,
    slideGroundingCoverage: 0.22,
    maskingCoverage: 0.1,
    layoutFidelityScore: 0.35,
    promptIterationWinRate: 0.15,
    reviewTurnaroundHours: 72,
    ...overrides,
  };
}

describe("evaluateReportAutomationReadiness", () => {
  it("scores the current product baseline as foundation with slide-grounding blockers", () => {
    const report = evaluateReportAutomationReadiness(makeSignals());

    expect(report.stage).toBe("foundation");
    expect(report.passesGate).toBe(false);
    expect(report.overallScore).toBeLessThan(45);
    expect(report.findings.some((finding) => finding.id === "missing_toc_extraction")).toBe(true);
    expect(report.findings.some((finding) => finding.id === "missing_document_masking")).toBe(true);
    expect(report.findings.some((finding) => finding.id === "missing_prompt_reinforcement")).toBe(true);
  });

  it("elevates to guided_pilot when toc and slide-grounding foundations exist", () => {
    const report = evaluateReportAutomationReadiness(
      makeSignals({
        sourceFormats: ["hwp", "hwpx", "docx", "pptx", "pdf"],
        canExtractLayoutFromPdf: true,
        canDetectSectionsFromExemplar: true,
        canExtractTableOfContents: true,
        canUseCanonicalSectionSchema: true,
        canMaskNonSlideDocuments: true,
        canGenerateFromSlides: true,
        hasSlideGroundingPrompt: true,
        tocExtractionAccuracy: 0.87,
        slideGroundingCoverage: 0.82,
        maskingCoverage: 0.97,
        layoutFidelityScore: 0.8,
        promptIterationWinRate: 0.52,
        corpusFamilyCount: 2,
        exemplarCountPerFamily: 3,
      }),
    );

    expect(report.stage).toBe("guided_pilot");
    expect(report.overallScore).toBeGreaterThanOrEqual(45);
    expect(report.passesGate).toBe(false);
    expect(report.findings.some((finding) => finding.id === "missing_prompt_reinforcement")).toBe(true);
  });

  it("marks a mature system as factory_ready with no blockers", () => {
    const report = evaluateReportAutomationReadiness(
      makeSignals({
        sourceFormats: ["hwp", "hwpx", "docx", "pptx", "pdf", "xlsx"],
        canExtractLayoutFromPdf: true,
        canDetectSectionsFromExemplar: true,
        canExtractTableOfContents: true,
        canUseCanonicalSectionSchema: true,
        canMaskNonSlideDocuments: true,
        canGenerateFromSlides: true,
        hasSlideGroundingPrompt: true,
        hasPromptReinforcementLoop: true,
        canRenderTablesAndCharts: true,
        canPreserveHeadersFooters: true,
        canRunVisualDiff: true,
        hasHumanReviewQueue: true,
        hasRegressionCorpus: true,
        corpusFamilyCount: 6,
        exemplarCountPerFamily: 5,
        tocExtractionAccuracy: 0.96,
        slideGroundingCoverage: 0.94,
        maskingCoverage: 0.99,
        layoutFidelityScore: 0.92,
        promptIterationWinRate: 0.81,
        reviewTurnaroundHours: 12,
      }),
    );

    expect(report.stage).toBe("factory_ready");
    expect(report.passesGate).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(85);
    expect(report.findings.filter((finding) => finding.severity === "blocker")).toHaveLength(0);
  });

  it("keeps a strong system in scale_ready when layout and ops are good but not yet factory grade", () => {
    const report = evaluateReportAutomationReadiness(
      makeSignals({
        sourceFormats: ["pptx", "pdf"],
        canExtractLayoutFromPdf: true,
        canDetectSectionsFromExemplar: true,
        canExtractTableOfContents: true,
        canUseCanonicalSectionSchema: true,
        canMaskNonSlideDocuments: true,
        canGenerateFromSlides: true,
        hasSlideGroundingPrompt: true,
        hasPromptReinforcementLoop: true,
        canRenderTablesAndCharts: true,
        canPreserveHeadersFooters: true,
        canRunVisualDiff: false,
        hasHumanReviewQueue: true,
        hasRegressionCorpus: true,
        corpusFamilyCount: 4,
        exemplarCountPerFamily: 3,
        tocExtractionAccuracy: 0.86,
        slideGroundingCoverage: 0.86,
        maskingCoverage: 0.96,
        layoutFidelityScore: 0.82,
        promptIterationWinRate: 0.58,
        reviewTurnaroundHours: 24,
      }),
    );

    expect(report.stage).toBe("scale_ready");
    expect(report.passesGate).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(70);
    expect(report.overallScore).toBeLessThan(90);
  });
});
