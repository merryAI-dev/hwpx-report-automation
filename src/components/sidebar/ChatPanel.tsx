"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { diffWords } from "diff";
import type { ChatMessageUI, PendingToolCall, EditPreviewItem } from "@/types/chat";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";

type ChatPanelProps = {
  messages: ChatMessageUI[];
  isBusy: boolean;
  pendingToolCall: PendingToolCall | null;
  hasDocument: boolean;
  onSendMessage: (text: string) => void;
  onApproveTool: () => void;
  onRejectTool: () => void;
  onClearChat: () => void;
};

const QUICK_COMMANDS = INSTRUCTION_PRESETS
  .filter((p) => p.key !== "custom" && p.key !== "yearly_update")
  .map((p) => ({
    label: p.label,
    message: `전체 문서를 다음과 같이 수정해줘: ${p.instruction}`,
  }));

export function ChatPanel({
  messages,
  isBusy,
  pendingToolCall,
  hasDocument,
  onSendMessage,
  onApproveTool,
  onRejectTool,
  onClearChat,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingToolCall]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    onSendMessage(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  return (
    <div className="chat-panel">
      {/* Message list */}
      <div className="chat-messages">
        {messages.length === 0 && !isBusy && (
          <div className="chat-empty">
            <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", padding: "20px 0" }}>
              {hasDocument
                ? "문서에 대해 자유롭게 지시하세요.\n예: \"전체 톤을 공문서체로 바꿔줘\""
                : "먼저 문서를 업로드하세요."}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Pending tool approval */}
        {pendingToolCall && (
          <div className="chat-pending-tool">
            <div className="chat-pending-tool-header">
              <span className="chat-tool-badge">편집 승인 대기</span>
              <span className="chat-tool-name">{pendingToolCall.toolCall.name}</span>
            </div>
            {pendingToolCall.preview && (
              <div className="chat-pending-tool-preview">
                <p className="chat-tool-summary">{pendingToolCall.preview.summary}</p>
                <div className="chat-tool-diffs">
                  {pendingToolCall.preview.edits.slice(0, 5).map((edit, i) => (
                    <EditDiffItem key={i} edit={edit} />
                  ))}
                  {pendingToolCall.preview.edits.length > 5 && (
                    <p style={{ fontSize: 11, color: "#6b7280", padding: "4px 8px" }}>
                      ... 외 {pendingToolCall.preview.edits.length - 5}건
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="chat-pending-tool-actions">
              <button className="btn primary" onClick={onApproveTool} disabled={isBusy}>
                수락
              </button>
              <button className="btn" onClick={onRejectTool} disabled={isBusy}>
                거부
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick commands */}
      {messages.length === 0 && hasDocument && (
        <div className="chat-quick-commands">
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd.label}
              className="chat-quick-chip"
              onClick={() => onSendMessage(cmd.message)}
              disabled={isBusy}
            >
              {cmd.label}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area">
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={input}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder={hasDocument ? "메시지를 입력하세요..." : "문서를 먼저 업로드하세요"}
            disabled={isBusy || !hasDocument}
            rows={1}
          />
          <button
            className="chat-send-btn"
            onClick={handleSubmit}
            disabled={!input.trim() || isBusy || !hasDocument}
          >
            전송
          </button>
        </div>
        {messages.length > 0 && (
          <button
            className="chat-clear-btn"
            onClick={onClearChat}
            disabled={isBusy}
          >
            대화 초기화
          </button>
        )}
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: ChatMessageUI }) {
  const isUser = message.role === "user";

  return (
    <div className={`chat-msg ${isUser ? "chat-msg-user" : "chat-msg-assistant"}`}>
      <div className={`chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-assistant"}`}>
        <p className="chat-bubble-text">{message.content}</p>
        {message.isStreaming && !message.content && (
          <span className="chat-typing">...</span>
        )}
      </div>
      {/* Tool calls display */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="chat-tool-calls">
          {message.toolCalls.map((tc) => (
            <ToolCallBadge key={tc.id} name={tc.name} isAutoExecuted={
              message.toolResults?.some((tr) => tr.toolCallId === tc.id && tr.isAutoExecuted) ?? false
            } />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallBadge({ name, isAutoExecuted }: { name: string; isAutoExecuted: boolean }) {
  const TOOL_LABELS: Record<string, string> = {
    read_document: "문서 읽기",
    read_segment: "세그먼트 읽기",
    edit_segment: "세그먼트 수정",
    edit_segments: "일괄 수정",
    search_replace: "찾아 바꾸기",
    analyze_style: "스타일 분석",
  };

  return (
    <span className={`chat-tool-badge ${isAutoExecuted ? "auto" : "manual"}`}>
      {isAutoExecuted ? "✓" : "⏳"} {TOOL_LABELS[name] || name}
    </span>
  );
}

function EditDiffItem({ edit }: { edit: EditPreviewItem }) {
  const changes = useMemo(() => diffWords(edit.before, edit.after), [edit.before, edit.after]);

  return (
    <div className="chat-diff-item">
      <p style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {changes.map((change, i) => {
          if (change.removed) {
            return (
              <span key={`d-${i}`} className="diff-text-removed">
                {change.value}
              </span>
            );
          }
          if (change.added) {
            return (
              <span key={`d-${i}`} className="diff-text-added">
                {change.value}
              </span>
            );
          }
          return <span key={`d-${i}`}>{change.value}</span>;
        })}
      </p>
    </div>
  );
}
