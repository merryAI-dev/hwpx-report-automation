import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "./document-store";
import type { JSONContent } from "@tiptap/core";

function getState() {
  return useDocumentStore.getState();
}

describe("document-store", () => {
  beforeEach(() => {
    // Reset store to initial state
    getState().resetDocument();
  });

  describe("initial state", () => {
    it("starts with default values", () => {
      const state = getState();
      expect(state.fileName).toBe("");
      expect(state.editorDoc).toBeNull();
      expect(state.sourceSegments).toEqual([]);
      expect(state.isDirty).toBe(false);
      expect(state.activeSidebarTab).toBe("outline");
      expect(state.batchMode).toBe("section");
      expect(state.chatMessages).toEqual([]);
    });
  });

  describe("setLoadedDocument", () => {
    it("sets document state and resets AI state", () => {
      const doc: JSONContent = { type: "doc", content: [] };
      getState().setLoadedDocument({
        fileName: "test.hwpx",
        buffer: new ArrayBuffer(0),
        doc,
        segments: [],
        extraSegmentsMap: {},
        integrityIssues: [],
        hwpxDocumentModel: null,
      });

      const state = getState();
      expect(state.fileName).toBe("test.hwpx");
      expect(state.editorDoc).toEqual(doc);
      expect(state.isDirty).toBe(false);
      expect(state.aiSuggestion).toBe("");
      expect(state.batchSuggestions).toEqual([]);
      expect(state.batchDecisions).toEqual({});
      expect(state.status).toBe("문서 로드 완료");
    });

    it("shows integrity warning count in status", () => {
      getState().setLoadedDocument({
        fileName: "broken.hwpx",
        buffer: new ArrayBuffer(0),
        doc: { type: "doc", content: [] },
        segments: [],
        extraSegmentsMap: {},
        integrityIssues: ["issue1", "issue2"],
        hwpxDocumentModel: null,
      });

      expect(getState().status).toContain("무결성 경고 2개");
    });

    it("sets download fileName based on input", () => {
      getState().setLoadedDocument({
        fileName: "report.hwpx",
        buffer: new ArrayBuffer(0),
        doc: { type: "doc", content: [] },
        segments: [],
        extraSegmentsMap: {},
        integrityIssues: [],
        hwpxDocumentModel: null,
      });

      expect(getState().download.fileName).toBe("report-edited.hwpx");
    });
  });

  describe("setEditorDoc", () => {
    it("sets doc and marks dirty", () => {
      const doc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
      getState().setEditorDoc(doc);
      expect(getState().editorDoc).toEqual(doc);
      expect(getState().isDirty).toBe(true);
    });
  });

  describe("pushHistory", () => {
    it("adds history entry at the beginning", () => {
      getState().pushHistory("첫 번째 수정", 3);
      getState().pushHistory("두 번째 수정", 1, { actor: "ai" });

      const { history } = getState();
      expect(history).toHaveLength(2);
      expect(history[0].summary).toBe("두 번째 수정");
      expect(history[0].actor).toBe("ai");
      expect(history[1].summary).toBe("첫 번째 수정");
      expect(history[1].actor).toBe("system");
    });

    it("limits history to 100 entries", () => {
      for (let i = 0; i < 105; i++) {
        getState().pushHistory(`edit-${i}`, 1);
      }
      expect(getState().history).toHaveLength(100);
    });

    it("snapshots editorDoc every 5th entry", () => {
      const doc: JSONContent = { type: "doc", content: [] };
      getState().setEditorDoc(doc);

      // Entry 0 (index 0 % 5 === 0 → should snapshot)
      getState().pushHistory("edit-0", 1);
      expect(getState().history[0].snapshotDoc).toEqual(doc);

      // Entries 1-4 (index 1..4 % 5 !== 0 → no snapshot)
      for (let i = 1; i <= 4; i++) {
        getState().pushHistory(`edit-${i}`, 1);
      }
      expect(getState().history[0].snapshotDoc).toBeNull(); // entry 4

      // Entry 5 (index 5 % 5 === 0 → should snapshot)
      getState().pushHistory("edit-5", 1);
      expect(getState().history[0].snapshotDoc).toEqual(doc);
    });
  });

  describe("batchDecisions", () => {
    it("sets and clears batch decisions", () => {
      getState().setBatchDecision("seg1", "accepted");
      getState().setBatchDecision("seg2", "rejected");

      expect(getState().batchDecisions).toEqual({
        seg1: "accepted",
        seg2: "rejected",
      });

      getState().clearBatchDecisions();
      expect(getState().batchDecisions).toEqual({});
    });
  });

  describe("terminology", () => {
    it("adds and updates terminology entries", () => {
      getState().updateTerminologyEntry("머신러닝", "기계학습");
      getState().updateTerminologyEntry("딥러닝", "심층학습");

      expect(getState().terminologyDict).toEqual({
        "머신러닝": "기계학습",
        "딥러닝": "심층학습",
      });
    });

    it("removes terminology entry", () => {
      getState().updateTerminologyEntry("AI", "인공지능");
      getState().updateTerminologyEntry("ML", "기계학습");
      getState().removeTerminologyEntry("AI");

      expect(getState().terminologyDict).toEqual({ ML: "기계학습" });
    });

    it("replaces entire dictionary", () => {
      getState().updateTerminologyEntry("old", "value");
      getState().setTerminologyDict({ new: "dict" });

      expect(getState().terminologyDict).toEqual({ new: "dict" });
    });
  });

  describe("chat messages", () => {
    it("adds messages", () => {
      getState().addChatMessage({ role: "user", content: "안녕" });
      getState().addChatMessage({
        role: "assistant",
        content: "안녕하세요",
        isStreaming: true,
      });

      const msgs = getState().chatMessages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe("안녕");
      expect(msgs[1].isStreaming).toBe(true);
    });

    it("updates last assistant message content", () => {
      getState().addChatMessage({ role: "user", content: "질문" });
      getState().addChatMessage({ role: "assistant", content: "응", isStreaming: true });

      getState().updateLastAssistantMessage((prev) => prev + "답");
      expect(getState().chatMessages[1].content).toBe("응답");
    });

    it("finalizes last assistant message", () => {
      getState().addChatMessage({ role: "assistant", content: "완료", isStreaming: true });
      getState().finalizeLastAssistantMessage();

      expect(getState().chatMessages[0].isStreaming).toBe(false);
    });

    it("clears chat", () => {
      getState().addChatMessage({ role: "user", content: "test" });
      getState().setChatBusy(true);
      getState().clearChat();

      expect(getState().chatMessages).toEqual([]);
      expect(getState().chatBusy).toBe(false);
      expect(getState().pendingToolCall).toBeNull();
    });

    it("appends tool calls and results", () => {
      getState().addChatMessage({ role: "assistant", content: "", isStreaming: true });

      getState().appendToolCallToLastMessage({
        id: "tc-1",
        name: "replace_text",
        input: { segmentId: "s1", text: "new" },
      });

      const msg = getState().chatMessages[0];
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0].name).toBe("replace_text");

      getState().appendToolResultToLastMessage({
        toolCallId: "tc-1",
        result: "success",
      });

      const updated = getState().chatMessages[0];
      expect(updated.toolResults).toHaveLength(1);
    });
  });

  describe("tool call rollback", () => {
    it("saves and restores snapshot", () => {
      const doc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
      getState().setEditorDoc(doc);
      getState().saveToolCallSnapshot();

      expect(getState().lastToolCallSnapshot).toEqual(doc);

      // Modify doc
      getState().setEditorDoc({ type: "doc", content: [] });

      // Undo
      const restored = getState().undoLastToolCall();
      expect(restored).toEqual(doc);
      expect(getState().lastToolCallSnapshot).toBeNull();
    });

    it("returns null when no snapshot exists", () => {
      expect(getState().undoLastToolCall()).toBeNull();
    });
  });

  describe("toggleSidebar", () => {
    it("toggles sidebar collapsed state", () => {
      expect(getState().sidebarCollapsed).toBe(false);
      getState().toggleSidebar();
      expect(getState().sidebarCollapsed).toBe(true);
      getState().toggleSidebar();
      expect(getState().sidebarCollapsed).toBe(false);
    });
  });

  describe("resetDocument", () => {
    it("resets all state to initial values", () => {
      // Set various state
      getState().setEditorDoc({ type: "doc", content: [] });
      getState().setStatus("loaded");
      getState().setBatchDecision("x", "accepted");
      getState().addChatMessage({ role: "user", content: "test" });
      getState().setDocumentId("doc-123");

      // Reset
      getState().resetDocument();

      const state = getState();
      expect(state.editorDoc).toBeNull();
      expect(state.isDirty).toBe(false);
      expect(state.batchDecisions).toEqual({});
      expect(state.chatMessages).toEqual([]);
      expect(state.documentId).toBeNull();
      expect(state.status).toContain("업로드");
    });
  });
});
