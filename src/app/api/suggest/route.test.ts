import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock OpenAI before importing the route
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

vi.mock("@/lib/api-utils", async () => {
  const actual = await vi.importActual("@/lib/api-utils");
  return {
    ...actual,
    requireUserApiKey: vi.fn().mockResolvedValue({ apiKey: "test-key", userEmail: "test@example.com" }),
  };
});

// Mock logger to suppress output
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
import { requireUserApiKey } from "@/lib/api-utils";
import { ApiKeyError } from "@/lib/errors";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/suggest", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.mocked(requireUserApiKey).mockResolvedValue({ apiKey: "test-key", userEmail: "test@example.com" });
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns suggestion on success", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "수정된 문장입니다." } }],
    });

    const res = await POST(makeRequest({
      text: "원문입니다.",
      instruction: "간결하게 수정해줘",
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.suggestion).toBe("수정된 문장입니다.");
  });

  it("returns 400 when text is missing", async () => {
    const res = await POST(makeRequest({
      instruction: "수정해줘",
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("text");
  });

  it("returns 400 when instruction is missing", async () => {
    const res = await POST(makeRequest({
      text: "원문",
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("instruction");
  });

  it("returns 500 when API key is missing", async () => {
    vi.mocked(requireUserApiKey).mockRejectedValue(new ApiKeyError("OpenAI"));

    const res = await POST(makeRequest({
      text: "원문",
      instruction: "수정해줘",
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("API_KEY_MISSING");
  });

  it("returns 502 when AI returns empty content", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "" } }],
    });

    const res = await POST(makeRequest({
      text: "원문",
      instruction: "수정해줘",
    }));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("NO_SUGGESTION");
  });

  it("returns error when SDK throws", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI rate limit"));

    const res = await POST(makeRequest({
      text: "원문",
      instruction: "수정해줘",
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("rate limit");
  });
});
