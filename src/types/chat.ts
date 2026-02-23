export type ChatRole = "user" | "assistant";

export type ToolCallInfo = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultInfo = {
  toolCallId: string;
  name: string;
  result: unknown;
  isAutoExecuted: boolean;
};

export type EditPreviewItem = {
  segmentId: string;
  before: string;
  after: string;
};

export type EditPreview = {
  edits: EditPreviewItem[];
  summary: string;
};

export type PendingToolCall = {
  toolCall: ToolCallInfo;
  preview: EditPreview | null;
};

export type ChatMessageUI = {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  toolResults?: ToolResultInfo[];
  isStreaming?: boolean;
};

/**
 * Sent to /api/chat as POST body.
 */
export type ChatRequest = {
  messages: ChatMessageAPI[];
  documentContext: DocumentContext;
  approvedToolCall?: ApprovedToolCall;
};

export type ChatMessageAPI = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type DocumentContext = {
  segments: DocumentContextSegment[];
  fileName: string;
};

export type DocumentContextSegment = {
  segmentId: string;
  text: string;
  tag: string;
  styleHints: Record<string, string>;
};

export type ApprovedToolCall = {
  toolCallId: string;
  toolName: string;
  result: string;
};

/**
 * SSE event types from /api/chat
 */
export type SSEEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_call"; toolCall: ToolCallInfo }
  | { type: "tool_result"; result: ToolResultInfo }
  | { type: "tool_pending"; toolCall: ToolCallInfo }
  | { type: "done"; usage: { inputTokens: number; outputTokens: number } }
  | { type: "error"; message: string };
