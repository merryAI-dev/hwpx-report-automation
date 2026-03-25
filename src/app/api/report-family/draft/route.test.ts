// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/with-api-auth", () => ({
  withApiAuth: (handler: (...args: unknown[]) => unknown) =>
    (req: unknown) => handler(req, { sub: "test-user", email: "test@example.com", activeTenant: null }),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/report-family/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function parseSseResponse(response: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await response.text();
  const events: { event: string; data: unknown }[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let eventType = "message";
    let dataStr = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventType = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
    }
    if (dataStr) events.push({ event: eventType, data: JSON.parse(dataStr) });
  }
  return events;
}

describe("/api/report-family/draft", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a fallback report draft even when no OpenAI key is configured", async () => {
    const response = await POST(
      makeRequest({
        plan: {
          familyId: null,
          familyName: "일반 보고서 패밀리",
          schemaSource: "synthetic_outline",
          toc: [
            {
              id: "toc-1",
              title: "사업 개요",
              numbering: "1",
              level: 1,
              sourceSegmentId: "t1",
            },
          ],
          sourcePolicy: {
            allowedSourceIds: ["slides-1"],
            maskedSourceIds: [],
            structuralOnlyDocumentIds: ["target-report"],
            reasons: ["target document structure only"],
          },
          sectionPlans: [
            {
              tocEntryId: "toc-1",
              tocTitle: "사업 개요",
              numbering: "1",
              sectionType: "narrative",
              focusEntities: [],
              evidenceExpectation: "slide_grounded",
              outputScaffold: ["배경", "핵심 성과"],
              prompt: "슬라이드 기반으로 사업 개요를 작성하라.",
              chunkingStrategy: "slide",
              supportingChunks: [
                {
                  chunkId: "chunk-1",
                  documentId: "slides-1",
                  title: "사업 개요",
                  slideNumber: 1,
                  summary: "사업 배경과 운영 구조를 설명한다.",
                  segmentIds: ["s1", "s2"],
                  score: 1,
                },
              ],
              evidenceBundles: [],
              maskedDocumentIds: [],
              alignmentStrategy: "heuristic",
              alignmentReasons: ["token overlap"],
            },
          ],
          planQuality: null,
          benchmarkEvaluation: null,
          retryPlan: null,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await parseSseResponse(response);
    const done = events.find((e) => e.event === "done")?.data as { draft: { engine: string; sections: { paragraphs: string[] }[] }; usage: { model: string | null } };
    expect(done.draft.engine).toBe("fallback");
    expect(done.draft.sections[0].paragraphs[0]).toContain("사업");
    expect(done.usage.model).toBeNull();
  });

  it("returns 400 when the plan is missing", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("plan");
  });
});
