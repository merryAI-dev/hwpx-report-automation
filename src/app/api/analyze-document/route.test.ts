import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth/with-api-auth", () => ({
  withApiAuth: (handler: (...args: unknown[]) => unknown) =>
    (req: unknown) => handler(req, { sub: "test-user", email: "test@example.com", activeTenant: null }),
}));

const mockCreate = vi.fn();
vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockOpenAI };
});

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
  },
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/analyze-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/analyze-document", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns analysis on success", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            documentType: "기술제안서",
            suggestedPreset: "technical_proposal",
            readabilityScore: 72,
            globalIssues: ["수동태 과다 사용"],
            inconsistentTerms: [
              { variants: ["시스템", "체계"], suggestedTerm: "시스템" },
            ],
          }),
        },
      }],
    });

    const res = await POST(makeRequest({
      segments: [
        { id: "s1", text: "시스템 개요", type: "heading" },
        { id: "s2", text: "본 체계는 다음과 같다.", type: "paragraph" },
      ],
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.documentType).toBe("기술제안서");
    expect(json.suggestedPreset).toBe("technical_proposal");
    expect(json.readabilityScore).toBe(72);
    expect(json.globalIssues).toContain("수동태 과다 사용");
    expect(json.inconsistentTerms).toHaveLength(1);
  });

  it("returns 400 when segments is empty", async () => {
    const res = await POST(makeRequest({
      segments: [],
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segments");
  });

  it("returns 400 when segments is missing", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segments");
  });

  it("returns 500 when API key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const res = await POST(makeRequest({
      segments: [{ id: "s1", text: "테스트", type: "paragraph" }],
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("API_KEY_MISSING");
  });

  it("returns defaults when AI returns incomplete JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: { content: "{}" },
      }],
    });

    const res = await POST(makeRequest({
      segments: [{ id: "s1", text: "테스트", type: "paragraph" }],
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.documentType).toBe("일반 문서");
    expect(json.suggestedPreset).toBe("custom");
    expect(json.readabilityScore).toBe(50);
    expect(json.globalIssues).toEqual([]);
    expect(json.inconsistentTerms).toEqual([]);
  });

  it("returns error when SDK throws", async () => {
    mockCreate.mockRejectedValue(new Error("Service unavailable"));

    const res = await POST(makeRequest({
      segments: [{ id: "s1", text: "테스트", type: "paragraph" }],
    }));

    expect(res.status).toBe(500);
  });
});
