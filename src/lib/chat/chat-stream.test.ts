// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatStreamCallbacks } from "./chat-stream";
import { streamChat } from "./chat-stream";

function encodeSSE(events: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  for (const { event, data } of events) {
    chunks.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  const text = chunks.join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeCallbacks(): ChatStreamCallbacks & {
  calls: Record<string, unknown[][]>;
} {
  const calls: Record<string, unknown[][]> = {
    onTextDelta: [],
    onToolCall: [],
    onToolResult: [],
    onToolPending: [],
    onDone: [],
    onError: [],
  };
  return {
    onTextDelta: vi.fn((...args: unknown[]) => calls.onTextDelta.push(args)),
    onToolCall: vi.fn((...args: unknown[]) => calls.onToolCall.push(args)),
    onToolResult: vi.fn((...args: unknown[]) => calls.onToolResult.push(args)),
    onToolPending: vi.fn((...args: unknown[]) => calls.onToolPending.push(args)),
    onDone: vi.fn((...args: unknown[]) => calls.onDone.push(args)),
    onError: vi.fn((...args: unknown[]) => calls.onError.push(args)),
    calls,
  };
}

const fetchSpy = vi.spyOn(globalThis, "fetch");

describe("streamChat", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
  });

  it("parses text_delta events", async () => {
    fetchSpy.mockResolvedValue(
      new Response(encodeSSE([
        { event: "text_delta", data: { content: "안녕" } },
        { event: "text_delta", data: { content: "하세요" } },
        { event: "done", data: { usage: { inputTokens: 10, outputTokens: 5 } } },
      ]), { status: 200 }),
    );

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onTextDelta).toHaveBeenCalledTimes(2);
    expect(cb.onTextDelta).toHaveBeenCalledWith("안녕");
    expect(cb.onTextDelta).toHaveBeenCalledWith("하세요");
    expect(cb.onDone).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5 });
  });

  it("parses tool_call and tool_result events", async () => {
    const toolCall = { id: "tc-1", name: "replace_text", input: { segmentId: "s1", text: "new" } };
    const toolResult = { toolCallId: "tc-1", result: "ok" };

    fetchSpy.mockResolvedValue(
      new Response(encodeSSE([
        { event: "tool_call", data: { toolCall } },
        { event: "tool_result", data: { result: toolResult } },
        { event: "done", data: { usage: { inputTokens: 0, outputTokens: 0 } } },
      ]), { status: 200 }),
    );

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onToolCall).toHaveBeenCalledWith(toolCall);
    expect(cb.onToolResult).toHaveBeenCalledWith(toolResult);
  });

  it("parses tool_pending event", async () => {
    const toolCall = { id: "tc-2", name: "fill_table", input: {} };

    fetchSpy.mockResolvedValue(
      new Response(encodeSSE([
        { event: "tool_pending", data: { toolCall } },
        { event: "done", data: { usage: { inputTokens: 0, outputTokens: 0 } } },
      ]), { status: 200 }),
    );

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onToolPending).toHaveBeenCalledWith(toolCall);
  });

  it("calls onError for non-200 response", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 }),
    );

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onError).toHaveBeenCalledWith("Rate limited");
  });

  it("calls onError for non-200 response with non-JSON body", async () => {
    fetchSpy.mockResolvedValue(
      new Response("Server error", { status: 500 }),
    );

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onError).toHaveBeenCalledWith("API error: 500");
  });

  it("calls onError when no response body", async () => {
    fetchSpy.mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onError).toHaveBeenCalledWith("No response body");
  });

  it("handles chunked SSE delivery", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Split SSE across chunks
        controller.enqueue(encoder.encode("event: text_del"));
        controller.enqueue(encoder.encode("ta\ndata: {\"content\":\"chunk\"}\n\n"));
        controller.enqueue(encoder.encode("event: done\ndata: {\"usage\":{\"inputTokens\":0,\"outputTokens\":0}}\n\n"));
        controller.close();
      },
    });

    fetchSpy.mockResolvedValue(new Response(stream, { status: 200 }));

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onTextDelta).toHaveBeenCalledWith("chunk");
    expect(cb.onDone).toHaveBeenCalled();
  });

  it("ignores malformed SSE data gracefully", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: text_delta\ndata: not-json\n\n"));
        controller.enqueue(encoder.encode("event: done\ndata: {\"usage\":{\"inputTokens\":0,\"outputTokens\":0}}\n\n"));
        controller.close();
      },
    });

    fetchSpy.mockResolvedValue(new Response(stream, { status: 200 }));

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    // Malformed data skipped, done still fires
    expect(cb.onTextDelta).not.toHaveBeenCalled();
    expect(cb.onDone).toHaveBeenCalled();
  });

  it("handles error event from stream", async () => {
    fetchSpy.mockResolvedValue(
      new Response(encodeSSE([
        { event: "error", data: { message: "Token limit exceeded" } },
      ]), { status: 200 }),
    );

    const cb = makeCallbacks();
    await streamChat({ messages: [], segments: [] }, cb);

    expect(cb.onError).toHaveBeenCalledWith("Token limit exceeded");
  });
});
