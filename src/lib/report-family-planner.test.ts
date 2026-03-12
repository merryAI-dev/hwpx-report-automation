import { describe, expect, it } from "vitest";
import {
  buildPptxReportFamilyPlanPayload,
  buildReportFamilyPlan,
  buildSourcePolicy,
  buildSectionPromptPlans,
  extractTableOfContents,
  type ReportFamilyDocumentInput,
} from "./report-family-planner";

function makeTargetDocument(): ReportFamilyDocumentInput {
  return {
    documentId: "target-report",
    fileName: "target-report.pdf",
    role: "target_report",
    segments: [
      { id: "t0", text: "최종보고서", type: "heading" },
      { id: "t1", text: "목차", type: "heading" },
      { id: "t2", text: "1 운영사 소개\n2 핵심 달성 목표\n3 주요 추진 사항\n4 기업별 상세 현황\n5 제언", type: "paragraph" },
    ],
  };
}

function makeSlideDocument(): ReportFamilyDocumentInput {
  return {
    documentId: "slides-1",
    fileName: "source-slides.pptx",
    role: "slide_deck",
    segments: [
      { id: "s1", text: "운영사 소개", type: "heading", slideNumber: 1 },
      { id: "s2", text: "MYSC의 주요 연혁과 조직 역량을 정리한다.", type: "paragraph", slideNumber: 1 },
      { id: "s3", text: "핵심 달성 목표", type: "heading", slideNumber: 2 },
      { id: "s4", text: "KPI 달성률, 투자 유치, 신규 고용 성과를 요약한다.", type: "paragraph", slideNumber: 2 },
      { id: "s5", text: "주요 추진 사항", type: "heading", slideNumber: 3 },
      { id: "s6", text: "프로그램 일정, 특화 모듈, 네트워킹 활동을 설명한다.", type: "paragraph", slideNumber: 3 },
    ],
  };
}

describe("extractTableOfContents", () => {
  it("extracts numbered toc entries from the target report", () => {
    const toc = extractTableOfContents(makeTargetDocument());
    expect(toc).toHaveLength(5);
    expect(toc[0].title).toBe("운영사 소개");
    expect(toc[1].numbering).toBe("2");
  });
});

describe("buildSourcePolicy", () => {
  it("masks all non-slide documents and keeps the target report structural-only", () => {
    const target = makeTargetDocument();
    const policy = buildSourcePolicy(target, [
      makeSlideDocument(),
      {
        documentId: "evidence-1",
        fileName: "evidence.docx",
        role: "evidence_doc",
        segments: [{ id: "e1", text: "지원사업 증빙", type: "paragraph" }],
      },
    ]);

    expect(policy.allowedSourceIds).toEqual(["slides-1"]);
    expect(policy.maskedSourceIds).toEqual(["evidence-1"]);
    expect(policy.structuralOnlyDocumentIds).toEqual(["target-report"]);
  });
});

describe("buildSectionPromptPlans", () => {
  it("builds prompts grounded on slide chunks and names masked docs explicitly", () => {
    const target = makeTargetDocument();
    const slides = makeSlideDocument();
    const sourcePolicy = buildSourcePolicy(target, [
      slides,
      {
        documentId: "reference-1",
        fileName: "previous-report.pdf",
        role: "reference_doc",
        segments: [{ id: "r1", text: "참고 보고서", type: "paragraph" }],
      },
    ]);
    const toc = extractTableOfContents(target);
    const plans = buildSectionPromptPlans("MYSC 해양수산 최종보고서", toc, target, [slides], sourcePolicy);

    expect(plans[0].tocTitle).toBe("운영사 소개");
    expect(plans[0].supportingChunks[0].title).toContain("운영사 소개");
    expect(plans[0].prompt).toContain("masked source");
    expect(plans[0].prompt).toContain("슬라이드");
  });
});

describe("buildReportFamilyPlan", () => {
  it("returns toc, prompt plans, and retry planning when a benchmark run is provided", () => {
    const plan = buildReportFamilyPlan({
      familyName: "MYSC 해양수산 최종보고서",
      targetDocument: makeTargetDocument(),
      sourceDocuments: [
        makeSlideDocument(),
        {
          documentId: "evidence-1",
          fileName: "evidence.docx",
          role: "evidence_doc",
          segments: [{ id: "e1", text: "지원사업 증빙", type: "paragraph" }],
        },
      ],
      benchmarkRun: {
        familyId: "mysc-final-report",
        sampleCount: 3,
        tocExtractionAccuracy: 0.7,
        sectionCoverage: 0.82,
        slideGroundingCoverage: 0.6,
        documentMaskingCoverage: 0.74,
        maskedSourceLeakageRate: 0.11,
        layoutSimilarity: 0.8,
        tableStructureAccuracy: 0.78,
        promptIterationWinRate: 0.32,
        reviewerEditRate: 0.35,
        criticalHallucinationRate: 0.03,
        manualCorrectionMinutes: 55,
      },
    });

    expect(plan.toc).toHaveLength(5);
    expect(plan.sectionPlans.length).toBeGreaterThan(0);
    expect(plan.benchmarkEvaluation?.status).toBe("retry");
    expect(plan.retryPlan?.actions.some((action) => action.bucket === "tighten_document_masking")).toBe(true);
  });
});

describe("buildPptxReportFamilyPlanPayload", () => {
  it("builds a synthetic target report from outline and keeps slide grounding metadata", () => {
    const payload = buildPptxReportFamilyPlanPayload({
      familyName: "MYSC 해양수산 최종보고서",
      fileName: "marine-demo.pptx",
      outline: [
        { id: "o1", text: "1 사업 개요", level: 1 },
        { id: "o2", text: "2 주요 성과", level: 1 },
        { id: "o3", text: "2.1 후속 연계", level: 2 },
      ],
      segments: [
        {
          segmentId: "pptx::0",
          fileName: "pptx",
          textIndex: 0,
          text: "1 사업 개요",
          originalText: "1 사업 개요",
          tag: "h2",
          styleHints: { slideNumber: "1", pptxRole: "title" },
        },
        {
          segmentId: "pptx::1",
          fileName: "pptx",
          textIndex: 1,
          text: "운영 배경과 추진 체계를 설명한다.",
          originalText: "운영 배경과 추진 체계를 설명한다.",
          tag: "p",
          styleHints: { slideNumber: "1", pptxRole: "body" },
        },
      ],
    });

    expect(payload.targetDocument.role).toBe("target_report");
    expect(payload.targetDocument.segments[1]?.text).toContain("1 사업 개요");
    expect(payload.sourceDocuments).toHaveLength(1);
    expect(payload.sourceDocuments[0]?.role).toBe("slide_deck");
    expect(payload.sourceDocuments[0]?.segments[0]?.slideNumber).toBe(1);
  });
});
