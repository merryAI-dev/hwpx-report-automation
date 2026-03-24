import { describe, expect, it } from "vitest";
import {
  buildFallbackDraftSection,
  buildReportFamilyDraft,
  buildReportFamilyDraftEditorArtifacts,
} from "./report-family-draft-generator";
import type { ReportFamilyDocumentInput } from "./report-family-planner";
import { buildReportFamilyPlan } from "./report-family-planner";

function makeTargetDocument(): ReportFamilyDocumentInput {
  return {
    documentId: "target-report",
    fileName: "target-report.pdf",
    role: "target_report",
    segments: [
      { id: "t0", text: "최종보고서", type: "heading" },
      { id: "t1", text: "목차", type: "heading" },
      { id: "t2", text: "1 사업 개요\n2 운영 성과 요약표\n3 보육기업 기본 정보", type: "paragraph" },
    ],
  };
}

function makeSlideDocument(): ReportFamilyDocumentInput {
  return {
    documentId: "slides-1",
    fileName: "source-slides.pptx",
    role: "slide_deck",
    segments: [
      { id: "s1", text: "사업 개요", type: "heading", slideNumber: 1 },
      { id: "s2", text: "사업 배경과 운영 구조를 설명한다.", type: "paragraph", slideNumber: 1 },
      { id: "s3", text: "운영 성과 요약표", type: "heading", slideNumber: 2 },
      { id: "s4", text: "투자, 고용, 후속 연계 성과를 종합 정리한다.", type: "paragraph", slideNumber: 2 },
      { id: "s5", text: "보육기업 기본 정보", type: "heading", slideNumber: 3 },
      { id: "s6", text: "증빙 항목과 제출 자료 목록을 설명한다.", type: "paragraph", slideNumber: 3 },
    ],
  };
}

function makeEvidenceDocument(): ReportFamilyDocumentInput {
  return {
    documentId: "evidence-1",
    fileName: "appendix-evidence.pdf",
    role: "evidence_doc",
    segments: [
      { id: "e1", text: "보육기업 기본 정보", type: "heading", pageNumber: 10 },
      { id: "e2", text: "제출 자료 목록과 세부 증빙 항목을 정리한다.", type: "paragraph", pageNumber: 10 },
    ],
  };
}

describe("report-family-draft-generator", () => {
  it("builds a fallback table draft for table-shaped sections", () => {
    const plan = buildReportFamilyPlan({
      familyName: "일반 최종보고서",
      targetDocument: makeTargetDocument(),
      sourceDocuments: [makeSlideDocument(), makeEvidenceDocument()],
    });
    const section = plan.sectionPlans.find((item) => item.tocTitle === "운영 성과 요약표");

    expect(section).toBeTruthy();
    const draft = buildFallbackDraftSection(section!);

    expect(draft.table?.headers).toEqual(["항목", "핵심 내용", "근거 슬라이드"]);
    expect(draft.table?.rows.length).toBeGreaterThan(0);
    expect(draft.citations.some((citation) => citation.sourceType === "slide_chunk")).toBe(true);
    expect(draft.evaluation.typeAligned).toBe(true);
  });

  it("marks appendix sections as retry when evidence bundles are missing", () => {
    const plan = buildReportFamilyPlan({
      familyName: "일반 최종보고서",
      targetDocument: makeTargetDocument(),
      sourceDocuments: [makeSlideDocument()],
    });

    const draft = buildReportFamilyDraft(plan);

    expect(draft.evaluation.status).toBe("retry");
    expect(draft.evaluation.retryReasons.some((reason) => reason.includes("appendix evidence missing"))).toBe(true);
  });

  it("materializes a report draft into editor artifacts with headings and table nodes", () => {
    const plan = buildReportFamilyPlan({
      familyName: "일반 최종보고서",
      targetDocument: makeTargetDocument(),
      sourceDocuments: [makeSlideDocument(), makeEvidenceDocument()],
    });

    const draft = buildReportFamilyDraft(plan);
    const artifacts = buildReportFamilyDraftEditorArtifacts(draft);

    expect(artifacts.doc.type).toBe("doc");
    expect(artifacts.doc.content?.[0]?.type).toBe("heading");
    expect(artifacts.doc.content?.some((node) => node.type === "table")).toBe(true);
    expect(artifacts.segments.some((segment) => segment.styleHints.generated === "true")).toBe(true);
  });
});
