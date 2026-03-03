import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Anthropic SDK
const mockStream = {
  on: vi.fn().mockReturnThis(),
  finalMessage: vi.fn(),
};
const mockMessagesStream = vi.fn().mockReturnValue(mockStream);

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { stream: mockMessagesStream };
  }
  return { default: MockAnthropic };
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
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeBadJsonRequest(): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json{",
  });
}

const VALID_BODY = {
  messages: [{ role: "user", content: "안녕" }],
  documentContext: {
    segments: [
      { segmentId: "s1", text: "테스트 문단", tag: "p", styleHints: {} },
    ],
    fileName: "test.hwpx",
  },
};

describe("/api/chat", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockMessagesStream.mockClear();
    mockStream.on.mockClear();
    mockStream.finalMessage.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 500 JSON when API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const json = await res.json();
    expect(json.code).toBe("API_KEY_MISSING");
  });

  it("returns 400 JSON when body is invalid JSON", async () => {
    const res = await POST(makeBadJsonRequest());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_FAILED");
  });

  it("returns SSE stream on valid request", async () => {
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: "text", text: "응답입니다." }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");

    // Read stream to completion
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    // Should contain done event
    expect(text).toContain("event: done");
  });

  it("sends tool_call and tool_result for read-only tools", async () => {
    // First call: AI requests read_document
    mockStream.finalMessage.mockResolvedValueOnce({
      content: [
        { type: "tool_use", id: "tc-1", name: "read_document", input: {} },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    // Second call: AI responds with text
    mockStream.finalMessage.mockResolvedValueOnce({
      content: [{ type: "text", text: "문서를 확인했습니다." }],
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(text).toContain("event: tool_call");
    expect(text).toContain("event: tool_result");
    expect(text).toContain("event: done");
  });

  it("sends tool_pending for write tools", async () => {
    mockStream.finalMessage.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tc-2",
          name: "edit_segment",
          input: { segmentId: "s1", newText: "수정된 문단" },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(text).toContain("event: tool_pending");
    expect(text).toContain('"waitingForApproval":true');
  });
});
