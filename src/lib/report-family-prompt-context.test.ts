import { describe, expect, it } from "vitest";
import type { ReportFamilyPlan } from "@/lib/report-family-planner";
import { buildReportFamilyPromptContext, matchReportFamilySection } from "./report-family-prompt-context";

function makePlan(): ReportFamilyPlan {
  return {
    familyId: "mysc-final-report",
    familyName: "MYSC 해양수산 최종보고서",
    schemaSource: "registered_packet",
    toc: [],
    sourcePolicy: {
      allowedSourceIds: ["slides-1"],
      maskedSourceIds: ["evidence-1"],
      structuralOnlyDocumentIds: ["target-1"],
      reasons: [],
    },
    sectionPlans: [
      {
        tocEntryId: "toc-1",
        tocTitle: "로비고스",
        numbering: null,
        sectionType: "case_study",
        focusEntities: ["로비고스"],
        evidenceExpectation: "slide_grounded",
        outputScaffold: ["기업 개요 | 해결 과제 | 지원/프로그램 개입 | 성과/후속 변화"],
        prompt: "prompt",
        chunkingStrategy: "slide_entity",
        supportingChunks: [
          {
            chunkId: "slides-1::s1",
            documentId: "slides-1",
            title: "로비고스 · 기업별 상세내용",
            slideNumber: 8,
            summary: "로비고스는 직접 투자와 후속 연계 성과가 두드러진다.",
            segmentIds: ["pptx::15", "pptx::16"],
            score: 1,
          },
        ],
        evidenceBundles: [],
        maskedDocumentIds: ["evidence-1"],
        alignmentStrategy: "registered_mapping",
        alignmentReasons: [],
      },
      {
        tocEntryId: "toc-2",
        tocTitle: "보육기업 기본 정보",
        numbering: "[첨부1]",
        sectionType: "appendix_evidence",
        focusEntities: [],
        evidenceExpectation: "appendix_bundle_required",
        outputScaffold: ["증빙명 | 관련 기업/지표 | 필요한 첨부 근거"],
        prompt: "prompt",
        chunkingStrategy: "slide",
        supportingChunks: [],
        evidenceBundles: [
          {
            bundleId: "evidence-1::a1",
            documentId: "evidence-1",
            fileName: "appendix-evidence.pdf",
            title: "보육기업 기본 정보",
            pageNumber: 10,
            summary: "기업 기본 정보 및 증빙 첨부 자료",
            segmentIds: ["a1", "a2"],
            score: 1,
          },
        ],
        maskedDocumentIds: ["evidence-1"],
        alignmentStrategy: "registered_mapping",
        alignmentReasons: [],
      },
    ],
    planQuality: null,
    benchmarkEvaluation: null,
    retryPlan: null,
  };
}

describe("report-family prompt context", () => {
  it("matches a section by direct segment membership", () => {
    const section = matchReportFamilySection({
      plan: makePlan(),
      segmentId: "pptx::16",
      text: "로비고스는 직접 투자와 후속 연계 성과가 두드러진다.",
    });

    expect(section?.tocTitle).toBe("로비고스");
  });

  it("builds prompt context with matched section scaffold and evidence candidates", () => {
    const sectionContext = buildReportFamilyPromptContext({
      plan: makePlan(),
      text: "보육기업 기본 정보 및 증빙 첨부 자료",
      sectionTitle: "보육기업 기본 정보",
    });

    expect(sectionContext).toContain("section: 보육기업 기본 정보");
    expect(sectionContext).toContain("evidence_expectation: appendix_bundle_required");
    expect(sectionContext).toContain("appendix-evidence.pdf");
  });
});
