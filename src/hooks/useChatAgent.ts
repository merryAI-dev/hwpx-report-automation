"use client";

import { useCallback } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useDocumentStore } from "@/store/document-store";
import { log } from "@/lib/logger";
import { streamChat } from "@/lib/chat/chat-stream";
import { getPreferredModel, checkCostLimit, getCostLimit } from "@/lib/preferences";
import type { ChatMessageAPI, ContentBlock, DocumentContext, EditPreview, TableContext, ToolCallInfo } from "@/types/chat";
import {
  replaceSegmentText,
  applyBatchSegmentTexts,
  applySearchReplace,
  fillTableRows,
  extractNodeText,
} from "@/lib/editor/editor-operations";

export function useChatAgent(editor: Editor | null) {
  const {
    editorDoc,
    sourceSegments,
    fileName,
    chatMessages,
    pendingToolCall,
    setStatus,
    setChatBusy,
    addChatMessage,
    updateLastAssistantMessage,
    finalizeLastAssistantMessage,
    appendToolCallToLastMessage,
    appendToolResultToLastMessage,
    setPendingToolCall,
    pushHistory,
    saveToolCallSnapshot,
  } = useDocumentStore();

  // ── Build document context for API ──

  const buildDocumentContext = useCallback((): DocumentContext => {
    const liveDoc = (editor?.getJSON() as JSONContent | undefined) || editorDoc;
    if (!liveDoc) {
      return {
        segments: sourceSegments.map((s) => ({
          segmentId: s.segmentId,
          text: s.text,
          tag: s.tag === "t" ? "p" : s.tag,
          styleHints: s.styleHints,
        })),
        fileName,
      };
    }

    const sourceBySegmentId = new Map(sourceSegments.map((s) => [s.segmentId, s]));
    const segments: DocumentContext["segments"] = [];
    const tables: TableContext[] = [];
    let tableCount = 0;

    const walk = (node: JSONContent): void => {
      if (node.type === "table") {
        const attrs = (node.attrs || {}) as { tableId?: string };
        const firstRow = node.content?.[0];
        const headers = (firstRow?.content || []).map((cell: JSONContent) => extractNodeText(cell));
        const rowCount = node.content?.length ?? 0;
        const colCount = firstRow?.content?.length ?? 0;
        if (attrs.tableId) {
          tables.push({
            tableIndex: tableCount,
            tableId: attrs.tableId,
            headers,
            rowCount,
            colCount,
          });
        }
        tableCount++;
      }
      if (node.type === "paragraph" || node.type === "heading") {
        const attrs = (node.attrs || {}) as { segmentId?: string; level?: number };
        if (attrs.segmentId) {
          const source = sourceBySegmentId.get(attrs.segmentId);
          const headingLevel = Number(attrs.level || 2);
          const tag =
            node.type === "heading"
              ? `h${Math.max(1, Math.min(6, Number.isFinite(headingLevel) ? headingLevel : 2))}`
              : "p";
          segments.push({
            segmentId: attrs.segmentId,
            text: extractNodeText(node),
            tag,
            styleHints: source?.styleHints || {},
          });
        }
      }
      for (const child of node.content || []) {
        walk(child);
      }
    };

    walk(liveDoc);

    return {
      segments,
      fileName,
      tables,
    };
  }, [editor, editorDoc, sourceSegments, fileName]);

  // ── Build edit preview from a write tool call ──

  const buildEditPreview = useCallback(
    (toolCall: ToolCallInfo): EditPreview => {
      const input = toolCall.input;
      const contextBySegmentId = new Map(
        buildDocumentContext().segments.map((segment) => [segment.segmentId, segment]),
      );
      if (toolCall.name === "edit_segment") {
        const seg = contextBySegmentId.get(String(input.segmentId));
        return {
          edits: [
            {
              segmentId: input.segmentId as string,
              before: seg?.text || "",
              after: input.newText as string,
            },
          ],
          summary: "1개 문단 수정",
        };
      }
      if (toolCall.name === "edit_segments") {
        const edits = (input.edits as Array<{ segmentId: string; newText: string }>).map((e) => {
          const seg = contextBySegmentId.get(e.segmentId);
          return { segmentId: e.segmentId, before: seg?.text || "", after: e.newText };
        });
        return { edits, summary: `${edits.length}개 문단 수정` };
      }
      if (toolCall.name === "search_replace") {
        const search = input.search as string;
        const replace = input.replace as string;
        const caseSensitive = input.caseSensitive === undefined ? true : Boolean(input.caseSensitive);
        const affected = Array.from(contextBySegmentId.values())
          .map((segment) => {
            const replaced = applySearchReplace(segment.text, search, replace, caseSensitive);
            if (!replaced.replacements) {
              return null;
            }
            return {
              segmentId: segment.segmentId,
              before: segment.text,
              after: replaced.nextText,
            };
          })
          .filter((row): row is { segmentId: string; before: string; after: string } => !!row);
        return {
          edits: affected,
          summary: `"${search}" → "${replace}" (${affected.length}건)`,
        };
      }
      if (toolCall.name === "fill_table_rows") {
        const ftInput = input as {
          tableIndex: number;
          startRow?: number;
          rows: Array<Record<string, string>>;
        };
        const ctx = buildDocumentContext();
        const tableCtx = ctx.tables?.[ftInput.tableIndex];
        const rowCount = ftInput.rows.length;
        const summary = tableCtx
          ? `표 ${ftInput.tableIndex + 1} (${tableCtx.headers.slice(0, 3).join(", ")}...) — ${rowCount}행 채우기`
          : `표 ${ftInput.tableIndex + 1} — ${rowCount}행 채우기`;
        const edits = ftInput.rows.map((row, i) => ({
          segmentId: `table-${ftInput.tableIndex}-row-${(ftInput.startRow ?? 1) + i}`,
          before: "",
          after: Object.values(row).join(" | "),
        }));
        return { edits, summary };
      }
      return { edits: [], summary: "" };
    },
    [buildDocumentContext],
  );

  // ── Patch write tool into messages (API 400 bug fix) ──

  function patchWriteToolIntoMessages(
    messages: ChatMessageAPI[],
    toolCall: ToolCallInfo,
    resultContent: string,
  ): ChatMessageAPI[] {
    const result = [...messages];

    let lastAsstIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === "assistant") { lastAsstIdx = i; break; }
    }
    if (lastAsstIdx === -1) return result;

    const lastAsst = result[lastAsstIdx];
    const asstContent: ContentBlock[] =
      typeof lastAsst.content === "string"
        ? [{ type: "text", text: lastAsst.content }]
        : [...(lastAsst.content as ContentBlock[])];
    asstContent.push({ type: "tool_use", id: toolCall.id, name: toolCall.name, input: toolCall.input });
    result[lastAsstIdx] = { ...lastAsst, content: asstContent };

    const nextIdx = lastAsstIdx + 1;
    const toolResultBlock: ContentBlock = {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: resultContent,
    };
    if (nextIdx < result.length && result[nextIdx].role === "user") {
      const existingUser = result[nextIdx];
      const userContent: ContentBlock[] =
        typeof existingUser.content === "string"
          ? []
          : [...(existingUser.content as ContentBlock[])];
      userContent.push(toolResultBlock);
      result[nextIdx] = { ...existingUser, content: userContent };
    } else {
      result.push({ role: "user", content: [toolResultBlock] });
    }

    return result;
  }

  // ── Convert UI messages to API format ──

  const buildApiMessages = useCallback((): ChatMessageAPI[] => {
    const apiMessages: ChatMessageAPI[] = [];

    for (const message of chatMessages) {
      if (message.role === "user") {
        if (message.content.trim()) {
          apiMessages.push({
            role: "user",
            content: message.content,
          });
        }
        continue;
      }

      const assistantBlocks: Array<{
        type: "text";
        text: string;
      } | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];

      if (message.content.trim()) {
        assistantBlocks.push({ type: "text", text: message.content });
      }
      for (const toolCall of message.toolCalls || []) {
        assistantBlocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
      }

      if (assistantBlocks.length === 1 && assistantBlocks[0].type === "text") {
        apiMessages.push({
          role: "assistant",
          content: message.content,
        });
      } else if (assistantBlocks.length > 1 || message.toolCalls?.length) {
        apiMessages.push({
          role: "assistant",
          content: assistantBlocks,
        });
      }

      if (message.toolResults?.length) {
        apiMessages.push({
          role: "user",
          content: message.toolResults.map((toolResult) => ({
            type: "tool_result" as const,
            tool_use_id: toolResult.toolCallId,
            content:
              typeof toolResult.result === "string"
                ? toolResult.result
                : JSON.stringify(toolResult.result),
          })),
        });
      }
    }

    return apiMessages;
  }, [chatMessages]);

  // ── Streaming callbacks factory ──

  function makeStreamCallbacks() {
    return {
      onTextDelta: (delta: string) => {
        updateLastAssistantMessage((prev) => prev + delta);
      },
      onToolCall: (tc: ToolCallInfo) => {
        appendToolCallToLastMessage(tc);
      },
      onToolResult: (tr: import("@/types/chat").ToolResultInfo) => {
        appendToolResultToLastMessage(tr);
      },
      onToolPending: (tc: ToolCallInfo) => {
        const preview = buildEditPreview(tc);
        setPendingToolCall({ toolCall: tc, preview });
      },
      onDone: () => {
        finalizeLastAssistantMessage();
        setChatBusy(false);
      },
      onError: (msg: string) => {
        updateLastAssistantMessage((prev) =>
          prev + (prev ? "\n" : "") + `오류: ${msg}`,
        );
        finalizeLastAssistantMessage();
        setChatBusy(false);
      },
    };
  }

  // ── Send message ──

  const onSendChatMessage = useCallback(
    async (text: string) => {
      const userMsgId = `user-${Date.now()}`;
      addChatMessage({
        id: userMsgId,
        role: "user",
        content: text,
        timestamp: Date.now(),
      });

      setChatBusy(true);

      const assistantMsgId = `assistant-${Date.now()}`;
      addChatMessage({
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      });

      const apiMessages = buildApiMessages();
      const lastApiMsg = apiMessages[apiMessages.length - 1];
      if (
        lastApiMsg &&
        lastApiMsg.role === "user" &&
        Array.isArray(lastApiMsg.content) &&
        (lastApiMsg.content as ContentBlock[]).some((b) => b.type === "tool_result")
      ) {
        (lastApiMsg.content as ContentBlock[]).push({ type: "text", text });
      } else {
        apiMessages.push({ role: "user", content: text });
      }

      try {
        const costError = await checkCostLimit();
        if (costError) {
          updateLastAssistantMessage(() => costError);
          finalizeLastAssistantMessage();
          setChatBusy(false);
          return;
        }
        await streamChat(
          {
            messages: apiMessages,
            documentContext: buildDocumentContext(),
            model: getPreferredModel("anthropic") || undefined,
            monthlyCostLimitUsd: getCostLimit() || undefined,
          },
          makeStreamCallbacks(),
        );
      } catch (err) {
        log.error("Chat stream failed", err);
        const message = err instanceof Error ? err.message : "채팅 오류";
        updateLastAssistantMessage((prev) =>
          prev + (prev ? "\n" : "") + `오류: ${message}`,
        );
        finalizeLastAssistantMessage();
        setChatBusy(false);
      }
    },
    [
      addChatMessage,
      setChatBusy,
      updateLastAssistantMessage,
      finalizeLastAssistantMessage,
      buildApiMessages,
      buildDocumentContext,
      buildEditPreview,
      appendToolCallToLastMessage,
      appendToolResultToLastMessage,
      setPendingToolCall,
    ],
  );

  // ── Approve pending tool ──

  const onApproveToolCall = useCallback(() => {
    if (!pendingToolCall || !editor) return;
    const { toolCall } = pendingToolCall;
    let resultMsg = "적용 완료";

    // Save snapshot before executing tool for rollback (Task 2.2)
    saveToolCallSnapshot();

    if (toolCall.name === "edit_segment") {
      const ok = replaceSegmentText(
        editor,
        toolCall.input.segmentId as string,
        toolCall.input.newText as string,
      );
      resultMsg = ok ? "1개 문단 수정 완료" : "대상 문단을 찾지 못했습니다";
    } else if (toolCall.name === "edit_segments") {
      const edits = toolCall.input.edits as Array<{ segmentId: string; newText: string }>;
      const count = applyBatchSegmentTexts(
        editor,
        edits.map((e) => ({ segmentId: e.segmentId, text: e.newText })),
      );
      resultMsg = `${count}개 문단 수정 완료`;
      pushHistory(`AI 채팅 일괄 수정 (${count}건)`, count, { actor: "ai" });
    } else if (toolCall.name === "search_replace") {
      const search = toolCall.input.search as string;
      const replace = toolCall.input.replace as string;
      const caseSensitive =
        toolCall.input.caseSensitive === undefined
          ? true
          : Boolean(toolCall.input.caseSensitive);
      let totalMatched = 0;
      let totalReplacedSegments = 0;
      const replacements: Array<{
        from: number;
        to: number;
        text: string;
        marks: PMNode["marks"];
      }> = [];

      editor.state.doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return true;
        const replaced = applySearchReplace(node.text, search, replace, caseSensitive);
        if (replaced.replacements > 0) {
          replacements.push({
            from: pos,
            to: pos + node.nodeSize,
            text: replaced.nextText,
            marks: node.marks,
          });
          totalMatched += replaced.replacements;
          totalReplacedSegments += 1;
        }
        return true;
      });

      let tr = editor.state.tr;
      replacements.sort((a, b) => b.from - a.from);
      for (const replacement of replacements) {
        tr = tr.replaceWith(
          replacement.from,
          replacement.to,
          editor.schema.text(replacement.text, replacement.marks),
        );
      }

      if (tr.docChanged) {
        editor.view.dispatch(tr.scrollIntoView());
      }
      resultMsg = `${totalReplacedSegments}개 문단 치환 완료 (${totalMatched}회 일치)`;
      pushHistory(`AI 채팅 찾아바꾸기 (${totalReplacedSegments}건)`, totalReplacedSegments, { actor: "ai" });
    } else if (toolCall.name === "fill_table_rows") {
      const ftInput = toolCall.input as {
        tableIndex: number;
        startRow?: number;
        rows: Array<Record<string, string>>;
      };
      const ctx = buildDocumentContext();
      const tableCtx = ctx.tables?.[ftInput.tableIndex];
      const headers = tableCtx?.headers ?? [];
      resultMsg = fillTableRows(
        editor,
        ftInput.tableIndex,
        ftInput.startRow ?? 1,
        ftInput.rows,
        headers,
      );
      pushHistory(`AI 표 채우기 (${ftInput.rows.length}행)`, ftInput.rows.length, { actor: "ai" });
    }

    setPendingToolCall(null);

    const continuationMessages = patchWriteToolIntoMessages(buildApiMessages(), toolCall, resultMsg);

    addChatMessage({
      id: `assistant-continue-${Date.now()}`,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    });

    setChatBusy(true);

    streamChat(
      {
        messages: continuationMessages,
        documentContext: buildDocumentContext(),
        model: getPreferredModel("anthropic") || undefined,
        monthlyCostLimitUsd: getCostLimit() || undefined,
      },
      makeStreamCallbacks(),
    ).catch((err) => {
      log.error("Chat continuation after tool approval failed", err);
      setChatBusy(false);
    });
  }, [
    pendingToolCall,
    editor,
    setPendingToolCall,
    setChatBusy,
    addChatMessage,
    updateLastAssistantMessage,
    finalizeLastAssistantMessage,
    appendToolCallToLastMessage,
    appendToolResultToLastMessage,
    buildApiMessages,
    buildDocumentContext,
    buildEditPreview,
    pushHistory,
    saveToolCallSnapshot,
  ]);

  // ── Reject pending tool ──

  const onRejectToolCall = useCallback(() => {
    if (!pendingToolCall) return;
    const { toolCall } = pendingToolCall;
    setPendingToolCall(null);

    const rejectMsg = "사용자가 이 수정을 거부했습니다. 다른 방법을 제안하거나 사용자의 추가 지시를 기다려주세요.";
    const continuationMessages = patchWriteToolIntoMessages(buildApiMessages(), toolCall, rejectMsg);

    addChatMessage({
      id: `assistant-reject-${Date.now()}`,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    });

    setChatBusy(true);

    streamChat(
      {
        messages: continuationMessages,
        documentContext: buildDocumentContext(),
        model: getPreferredModel("anthropic") || undefined,
        monthlyCostLimitUsd: getCostLimit() || undefined,
      },
      makeStreamCallbacks(),
    ).catch((err) => {
      log.error("Chat continuation after tool rejection failed", err);
      setChatBusy(false);
    });
  }, [
    pendingToolCall,
    setPendingToolCall,
    setChatBusy,
    addChatMessage,
    updateLastAssistantMessage,
    finalizeLastAssistantMessage,
    appendToolCallToLastMessage,
    appendToolResultToLastMessage,
    buildApiMessages,
    buildDocumentContext,
    buildEditPreview,
  ]);

  return {
    onSendChatMessage,
    onApproveToolCall,
    onRejectToolCall,
    buildDocumentContext,
  };
}
