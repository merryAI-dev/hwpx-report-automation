import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/with-api-auth", () => ({
  withApiAuth: (handler: (...args: unknown[]) => unknown) =>
    (req: unknown) => handler(req, { sub: "test-user", email: "test@example.com", activeTenant: null }),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/report-family/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/report-family/plan", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a report family plan with toc, masking policy, and section prompts", async () => {
    const response = await POST(makeRequest({
      familyName: "MYSC 해양수산 최종보고서",
      targetDocument: {
        documentId: "target-report",
        fileName: "target-report.pdf",
        role: "target_report",
        segments: [
          { id: "t1", text: "목차", type: "heading" },
          { id: "t2", text: "1 운영사 소개\n2 핵심 달성 목표\n3 주요 추진 사항", type: "paragraph" },
        ],
      },
      sourceDocuments: [
        {
          documentId: "slides-1",
          fileName: "source-slides.pptx",
          role: "slide_deck",
          segments: [
            { id: "s1", text: "운영사 소개", type: "heading", slideNumber: 1 },
            { id: "s2", text: "조직 역량과 주요 연혁을 설명한다.", type: "paragraph", slideNumber: 1 },
          ],
        },
        {
          documentId: "reference-1",
          fileName: "previous-report.pdf",
          role: "reference_doc",
          segments: [
            { id: "r1", text: "이전 결과보고서", type: "paragraph" },
          ],
        },
        {
          documentId: "evidence-1",
          fileName: "appendix-evidence.pdf",
          role: "evidence_doc",
          segments: [
            { id: "e1", text: "보육기업 기본 정보", type: "heading", pageNumber: 10 },
            { id: "e2", text: "기업 기본 정보 및 증빙 첨부 자료", type: "paragraph", pageNumber: 10 },
          ],
        },
      ],
      benchmarkRun: {
        familyId: "mysc-final-report",
        sampleCount: 3,
        tocExtractionAccuracy: 0.72,
        sectionCoverage: 0.8,
        slideGroundingCoverage: 0.63,
        documentMaskingCoverage: 0.76,
        maskedSourceLeakageRate: 0.08,
        layoutSimilarity: 0.82,
        tableStructureAccuracy: 0.8,
        promptIterationWinRate: 0.41,
        reviewerEditRate: 0.28,
        criticalHallucinationRate: 0.03,
        manualCorrectionMinutes: 48,
      },
    }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.toc).toHaveLength(3);
    expect(json.sourcePolicy.allowedSourceIds).toEqual(["slides-1"]);
    expect(json.sourcePolicy.maskedSourceIds).toEqual(["reference-1", "evidence-1"]);
    expect(json.sectionPlans[0].prompt).toContain("masked source");
    expect(json.retryPlan.actions.some((action: { bucket: string }) => action.bucket === "improve_toc_extractor")).toBe(true);
  });

  it("returns 400 when sourceDocuments are missing", async () => {
    const response = await POST(makeRequest({
      familyName: "MYSC",
      targetDocument: {
        fileName: "target-report.pdf",
        segments: [{ id: "t1", text: "목차", type: "heading" }],
      },
    }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("sourceDocuments");
  });
});
