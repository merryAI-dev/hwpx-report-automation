import type { ChatRequest, ToolCallInfo, ToolResultInfo } from "@/types/chat";
import { getApiKeyHeaders } from "@/lib/client-api-keys";

export type ChatStreamCallbacks = {
  onTextDelta: (text: string) => void;
  onToolCall: (toolCall: ToolCallInfo) => void;
  onToolResult: (result: ToolResultInfo) => void;
  onToolPending: (toolCall: ToolCallInfo) => void;
  onDone: (usage: { inputTokens: number; outputTokens: number }) => void;
  onError: (message: string) => void;
};

/**
 * Stream a POST request to /api/chat and parse SSE events.
 * Uses fetch + ReadableStream (EventSource only supports GET).
 */
export async function streamChat(
  request: ChatRequest,
  callbacks: ChatStreamCallbacks,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getApiKeyHeaders() },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg = `API error: ${response.status}`;
    try {
      const json = JSON.parse(text);
      msg = json.error || msg;
    } catch {
      // ignore
    }
    callbacks.onError(msg);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  let currentEvent = "";
  let currentData = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "") {
          if (currentEvent && currentData) {
            processSSEEvent(currentEvent, currentData, callbacks);
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }

    // Process any remaining buffered event
    if (currentEvent && currentData) {
      processSSEEvent(currentEvent, currentData, callbacks);
    }
  } finally {
    reader.releaseLock();
  }
}

function processSSEEvent(
  event: string,
  data: string,
  callbacks: ChatStreamCallbacks,
) {
  try {
    const parsed = JSON.parse(data);

    switch (event) {
      case "text_delta":
        callbacks.onTextDelta(parsed.content);
        break;
      case "tool_call":
        callbacks.onToolCall(parsed.toolCall);
        break;
      case "tool_result":
        callbacks.onToolResult(parsed.result);
        break;
      case "tool_pending":
        callbacks.onToolPending(parsed.toolCall);
        break;
      case "done":
        callbacks.onDone(parsed.usage || { inputTokens: 0, outputTokens: 0 });
        break;
      case "error":
        callbacks.onError(parsed.message || "Unknown error");
        break;
    }
  } catch {
    // Malformed SSE data, skip
  }
}

