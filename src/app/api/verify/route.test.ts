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
  return new Request("http://localhost/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/verify", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns passed: true when no issues", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({ passed: true, issues: [] }),
        },
      }],
    });

    const res = await POST(makeRequest({
      originalText: "원문입니다.",
      modifiedText: "수정된 문장입니다.",
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.passed).toBe(true);
    expect(json.issues).toEqual([]);
  });

  it("returns passed: false with issues", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            passed: false,
            issues: ["핵심 정보 누락"],
          }),
        },
      }],
    });

    const res = await POST(makeRequest({
      originalText: "2024년 매출 100억",
      modifiedText: "매출이 증가했습니다.",
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.passed).toBe(false);
    expect(json.issues).toContain("핵심 정보 누락");
  });

  it("returns 400 when originalText is missing", async () => {
    const res = await POST(makeRequest({
      modifiedText: "수정문",
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("originalText");
  });

  it("returns 400 when modifiedText is missing", async () => {
    const res = await POST(makeRequest({
      originalText: "원문",
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("modifiedText");
  });

  it("returns 500 when API key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const res = await POST(makeRequest({
      originalText: "원문",
      modifiedText: "수정문",
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("API_KEY_MISSING");
  });

  it("defaults to passed: false when AI returns incomplete JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: { content: "{}" },
      }],
    });

    const res = await POST(makeRequest({
      originalText: "원문",
      modifiedText: "수정문",
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.passed).toBe(false);
    expect(json.issues).toEqual([]);
  });

  it("defaults to passed: false when AI returns invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: { content: "not json at all" },
      }],
    });

    const res = await POST(makeRequest({
      originalText: "원문",
      modifiedText: "수정문",
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.passed).toBe(false);
    expect(json.issues).toHaveLength(1);
    expect(json.issues[0]).toContain("파싱");
  });
});
