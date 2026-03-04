import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  return new Request("http://localhost/api/suggest-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/suggest-batch", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.mocked(requireUserApiKey).mockResolvedValue({ apiKey: "test-key", userEmail: "test@example.com" });
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns batch results on success", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            results: [
              { id: "seg-1", suggestion: "수정된 A" },
              { id: "seg-2", suggestion: "수정된 B" },
            ],
          }),
        },
      }],
    });

    const res = await POST(makeRequest({
      instruction: "간결하게 수정",
      items: [
        { id: "seg-1", text: "원문 A" },
        { id: "seg-2", text: "원문 B" },
      ],
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    expect(json.results[0].suggestion).toBe("수정된 A");
  });

  it("falls back to original text for items not in AI response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            results: [{ id: "seg-1", suggestion: "수정된 A" }],
          }),
        },
      }],
    });

    const res = await POST(makeRequest({
      instruction: "수정해줘",
      items: [
        { id: "seg-1", text: "원문 A" },
        { id: "seg-2", text: "원문 B" },
      ],
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    const seg2 = json.results.find((r: { id: string }) => r.id === "seg-2");
    expect(seg2.suggestion).toBe("원문 B");
  });

  it("returns 400 when instruction is missing", async () => {
    const res = await POST(makeRequest({
      items: [{ id: "seg-1", text: "원문" }],
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("instruction");
  });

  it("returns 400 when items are empty", async () => {
    const res = await POST(makeRequest({
      instruction: "수정해줘",
      items: [],
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("items");
  });

  it("returns 500 when API key is missing", async () => {
    vi.mocked(requireUserApiKey).mockRejectedValue(new ApiKeyError("OpenAI"));

    const res = await POST(makeRequest({
      instruction: "수정해줘",
      items: [{ id: "seg-1", text: "원문" }],
    }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("API_KEY_MISSING");
  });

  it("returns error when SDK throws", async () => {
    mockCreate.mockRejectedValue(new Error("Network error"));

    const res = await POST(makeRequest({
      instruction: "수정해줘",
      items: [{ id: "seg-1", text: "원문" }],
    }));

    expect(res.status).toBe(500);
  });
});
