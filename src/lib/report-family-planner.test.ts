import { describe, expect, it } from "vitest";
import {
  buildTargetDocumentFromRegisteredPacket,
  buildPptxReportFamilyPlanPayload,
  buildReportFamilyPlan,
  buildSourcePolicy,
  buildSectionPromptPlans,
  extractTableOfContents,
  resolveRegisteredReportFamilyPacket,
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

function makeMyscSlideDocument(): ReportFamilyDocumentInput {
  return {
    documentId: "slides-mysc",
    fileName: "mysc-source-slides.pptx",
    role: "slide_deck",
    segments: [
      { id: "m1", text: "운영사 소개", type: "heading", slideNumber: 1 },
      { id: "m2", text: "운영사의 주요 연혁과 기관 개요를 정리한다.", type: "paragraph", slideNumber: 1 },
      { id: "m3", text: "프로그램 핵심 전략", type: "heading", slideNumber: 2 },
      { id: "m4", text: "해양수산 생태계 관점의 장기 프로그램 운영 전략을 설명한다.", type: "paragraph", slideNumber: 2 },
      { id: "m5", text: "핵심 KPI 성과", type: "heading", slideNumber: 3 },
      { id: "m6", text: "직접 투자, 후속 투자, 고용, 매출 KPI 달성 현황을 요약한다.", type: "paragraph", slideNumber: 3 },
      { id: "m7", text: "사업 홍보", type: "heading", slideNumber: 4 },
      { id: "m8", text: "보도자료, 블로그, 홍보 활동을 정리한다.", type: "paragraph", slideNumber: 4 },
      { id: "m9", text: "만족도조사", type: "heading", slideNumber: 5 },
      { id: "m10", text: "참여 기업 만족도 조사와 설문 결과를 정리한다.", type: "paragraph", slideNumber: 5 },
      { id: "m11", text: "프로그램 제언", type: "heading", slideNumber: 6 },
      { id: "m12", text: "다음 연도 추진 전략과 개선 제언을 정리한다.", type: "paragraph", slideNumber: 6 },
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
      familyName: "일반 보고서 패밀리",
      fileName: "generic-demo.pptx",
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
    expect(payload.schemaSource).toBe("synthetic_outline");
    expect(payload.familyId).toBeNull();
    expect(payload.targetDocument.segments[1]?.text).toContain("1 사업 개요");
    expect(payload.sourceDocuments).toHaveLength(1);
    expect(payload.sourceDocuments[0]?.role).toBe("slide_deck");
    expect(payload.sourceDocuments[0]?.segments[0]?.slideNumber).toBe(1);
  });

  it("uses a registered family packet schema when the file matches MYSC marine reports", () => {
    const payload = buildPptxReportFamilyPlanPayload({
      familyName: "[MYSC] 해양수산 최종결과보고서 보고서",
      fileName: "[MYSC] 해양수산 최종결과보고서_1216_vf.pptx",
      outline: [
        { id: "o1", text: "1 운영사 소개", level: 1 },
        { id: "o2", text: "2 핵심 달성 목표", level: 1 },
      ],
      segments: [
        {
          segmentId: "pptx::0",
          fileName: "pptx",
          textIndex: 0,
          text: "운영사 소개",
          originalText: "운영사 소개",
          tag: "h2",
          styleHints: { slideNumber: "1", pptxRole: "title" },
        },
      ],
    });

    expect(payload.familyId).toBe("mysc-final-report");
    expect(payload.schemaSource).toBe("registered_packet");
    const toc = extractTableOfContents(payload.targetDocument);
    expect(toc.some((entry) => entry.title === "프로그램 개요")).toBe(true);
    expect(toc.some((entry) => entry.title === "사업내용")).toBe(true);
    expect(toc.some((entry) => entry.title === "보육기업 기본 정보")).toBe(true);
  });
});

describe("registered MYSC packet", () => {
  it("resolves the MYSC marine packet and materializes target-report TOC lines", () => {
    const packet = resolveRegisteredReportFamilyPacket({
      familyName: "MYSC 해양수산 최종보고서",
      fileName: "[MYSC] 해양수산 최종결과보고서_1216_vf.pptx",
    });

    expect(packet?.familyId).toBe("mysc-final-report");

    const targetDocument = buildTargetDocumentFromRegisteredPacket({
      packet: packet!,
      fileName: "mysc-marine-demo.pptx",
    });
    const toc = extractTableOfContents(targetDocument);

    expect(toc.some((entry) => entry.title === "프로그램 추진 결과 총괄표")).toBe(true);
    expect(toc.some((entry) => entry.title === "홍보 및 보도자료 요약정리")).toBe(true);
    expect(toc.some((entry) => entry.title === "기업 만족도 조사 결과")).toBe(true);
  });

  it("uses registered section mappings to align target sections with source slide topics", () => {
    const packet = resolveRegisteredReportFamilyPacket({
      familyName: "MYSC 해양수산 최종보고서",
      fileName: "[MYSC] 해양수산 최종결과보고서_1216_vf.pptx",
    });
    const targetDocument = buildTargetDocumentFromRegisteredPacket({
      packet: packet!,
      fileName: "mysc-marine-demo.pptx",
    });

    const plan = buildReportFamilyPlan({
      familyId: packet?.familyId,
      familyName: "MYSC 해양수산 최종보고서",
      schemaSource: "registered_packet",
      targetDocument,
      sourceDocuments: [makeMyscSlideDocument()],
    });

    const overviewSection = plan.sectionPlans.find((section) => section.tocTitle === "프로그램 개요");
    const prSection = plan.sectionPlans.find((section) => section.tocTitle === "홍보 및 보도자료 요약정리");
    const strategySection = plan.sectionPlans.find((section) => section.tocTitle === "2026년도 사업 추진 전략");

    expect(overviewSection?.alignmentStrategy).toBe("registered_mapping");
    expect(overviewSection?.supportingChunks.some((chunk) => chunk.title === "운영사 소개")).toBe(true);
    expect(overviewSection?.supportingChunks.some((chunk) => chunk.title === "프로그램 핵심 전략")).toBe(true);
    expect(overviewSection?.alignmentReasons.join(" ")).toContain("운영사 소개");

    expect(prSection?.supportingChunks[0]?.title).toBe("사업 홍보");
    expect(strategySection?.supportingChunks.some((chunk) => chunk.title === "프로그램 제언")).toBe(true);
  });
});
