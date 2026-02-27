import { create } from "zustand";
import type { JSONContent } from "@tiptap/core";
import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import type { TextEdit } from "@/lib/hwpx";
import type { OutlineItem } from "@/lib/editor/document-store";
import type { PresetKey } from "@/lib/editor/ai-presets";
import type { HwpxDocumentModel } from "@/types/hwpx-model";

import type { ChatMessageUI, PendingToolCall } from "@/types/chat";

export type SidebarTab = "outline" | "ai" | "chat" | "history" | "analysis";

export type RenderElementInfo = {
  segmentId: string;
  textIndex: number;
  text: string;
};

export type EditHistoryItem = {
  id: string;
  timestamp: number;
  summary: string;
  editCount: number;
  actor: "system" | "ai" | "user";
  snapshotDoc: JSONContent | null;
};

export type BatchSuggestionItem = {
  id: string;
  suggestion: string;
};

export type DocumentAnalysis = {
  documentType: string;
  suggestedPreset: string;
  readabilityScore: number;
  globalIssues: string[];
  inconsistentTerms: Array<{
    variants: string[];
    suggestedTerm: string;
  }>;
};

export type VerificationResult = {
  passed: boolean;
  issues: string[];
};

type DownloadState = {
  blob: Blob | null;
  fileName: string;
};

type EditorSelectionState = {
  selectedSegmentId: string | null;
  selectedText: string;
};

type DocumentState = {
  fileName: string;
  sourceBuffer: ArrayBuffer | null;
  editorDoc: JSONContent | null;
  sourceSegments: EditorSegment[];
  extraSegmentsMap: Record<string, string[]>;
  integrityIssues: string[];
  exportWarnings: string[];
  outline: OutlineItem[];
  editsPreview: TextEdit[];
  history: EditHistoryItem[];
  status: string;
  isBusy: boolean;
  isDirty: boolean;
  sidebarCollapsed: boolean;
  activeSidebarTab: SidebarTab;
  instruction: string;
  aiSuggestion: string;
  batchSuggestions: BatchSuggestionItem[];
  aiBusy: boolean;
  selection: EditorSelectionState;
  download: DownloadState;
  renderHtml: string | null;
  renderElementMap: Record<string, RenderElementInfo> | null;

  // Phase 2-1: Accept/Reject
  batchDecisions: Record<string, "accepted" | "rejected">;
  // Phase 2-3: Presets
  selectedPreset: PresetKey;
  // Phase 2-4: Document Intelligence
  documentAnalysis: DocumentAnalysis | null;
  analysisLoading: boolean;
  // Phase 2-5: Terminology
  terminologyDict: Record<string, string>;
  // Phase 2-6: Verification
  verificationResult: VerificationResult | null;
  verificationLoading: boolean;
  // Batch mode
  batchMode: "section" | "document";

  // Form mode
  formMode: boolean;

  // OWPML in-memory document model (para-snapshot round-trip)
  hwpxDocumentModel: HwpxDocumentModel | null;

  // Chat agent
  chatMessages: ChatMessageUI[];
  chatBusy: boolean;
  pendingToolCall: PendingToolCall | null;

  resetDocument: () => void;
  setLoadedDocument: (params: {
    fileName: string;
    buffer: ArrayBuffer;
    doc: JSONContent;
    segments: EditorSegment[];
    extraSegmentsMap: Record<string, string[]>;
    integrityIssues: string[];
    hwpxDocumentModel: HwpxDocumentModel | null;
  }) => void;
  setHwpxDocumentModel: (model: HwpxDocumentModel | null) => void;
  setEditorDoc: (doc: JSONContent) => void;
  setOutline: (outline: OutlineItem[]) => void;
  setEditsPreview: (edits: TextEdit[]) => void;
  setExportWarnings: (warnings: string[]) => void;
  setStatus: (status: string) => void;
  setBusy: (isBusy: boolean) => void;
  setDirty: (isDirty: boolean) => void;
  toggleSidebar: () => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  setInstruction: (instruction: string) => void;
  setSelection: (selection: EditorSelectionState) => void;
  setAiSuggestion: (suggestion: string) => void;
  setBatchSuggestions: (suggestions: BatchSuggestionItem[]) => void;
  setAiBusy: (aiBusy: boolean) => void;
  setDownload: (download: DownloadState) => void;
  setRenderResult: (html: string, elementMap: Record<string, RenderElementInfo>) => void;
  pushHistory: (
    summary: string,
    editCount: number,
    options?: {
      actor?: "system" | "ai" | "user";
      snapshotDoc?: JSONContent | null;
    },
  ) => void;

  // Phase 2-1
  setBatchDecision: (id: string, decision: "accepted" | "rejected") => void;
  clearBatchDecisions: () => void;
  // Phase 2-3
  setSelectedPreset: (preset: PresetKey) => void;
  // Phase 2-4
  setDocumentAnalysis: (analysis: DocumentAnalysis | null) => void;
  setAnalysisLoading: (loading: boolean) => void;
  // Phase 2-5
  setTerminologyDict: (dict: Record<string, string>) => void;
  updateTerminologyEntry: (variant: string, canonical: string) => void;
  removeTerminologyEntry: (variant: string) => void;
  // Phase 2-6
  setVerificationResult: (result: VerificationResult | null) => void;
  setVerificationLoading: (loading: boolean) => void;
  // Batch mode
  setBatchMode: (mode: "section" | "document") => void;
  // Form mode
  setFormMode: (formMode: boolean) => void;

  // Chat agent
  addChatMessage: (msg: ChatMessageUI) => void;
  updateLastAssistantMessage: (fn: (prev: string) => string) => void;
  finalizeLastAssistantMessage: () => void;
  setChatBusy: (busy: boolean) => void;
  setPendingToolCall: (pending: PendingToolCall | null) => void;
  clearChat: () => void;
  appendToolCallToLastMessage: (tc: import("@/types/chat").ToolCallInfo) => void;
  appendToolResultToLastMessage: (tr: import("@/types/chat").ToolResultInfo) => void;
};

const INITIAL_INSTRUCTION = "문장을 간결하게 다듬고 기술 문서 톤으로 수정해줘.";

const initialDownload: DownloadState = {
  blob: null,
  fileName: "edited.hwpx",
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  fileName: "",
  sourceBuffer: null,
  editorDoc: null,
  sourceSegments: [],
  extraSegmentsMap: {},
  integrityIssues: [],
  exportWarnings: [],
  outline: [],
  editsPreview: [],
  history: [],
  status: "HWPX 또는 DOCX 파일을 업로드하세요.",
  isBusy: false,
  isDirty: false,
  sidebarCollapsed: false,
  activeSidebarTab: "outline",
  instruction: INITIAL_INSTRUCTION,
  aiSuggestion: "",
  batchSuggestions: [],
  aiBusy: false,
  selection: {
    selectedSegmentId: null,
    selectedText: "",
  },
  download: initialDownload,
  renderHtml: null,
  renderElementMap: null,

  batchDecisions: {},
  selectedPreset: "custom",
  documentAnalysis: null,
  analysisLoading: false,
  terminologyDict: {},
  verificationResult: null,
  verificationLoading: false,
  batchMode: "section",
  formMode: false,

  hwpxDocumentModel: null,

  chatMessages: [],
  chatBusy: false,
  pendingToolCall: null,

  resetDocument: () =>
    set({
      fileName: "",
      sourceBuffer: null,
      editorDoc: null,
      sourceSegments: [],
      extraSegmentsMap: {},
      integrityIssues: [],
      exportWarnings: [],
      outline: [],
      editsPreview: [],
      isDirty: false,
      selection: { selectedSegmentId: null, selectedText: "" },
      aiSuggestion: "",
      batchSuggestions: [],
      batchDecisions: {},
      documentAnalysis: null,
      analysisLoading: false,
      terminologyDict: {},
      verificationResult: null,
      verificationLoading: false,
      batchMode: "section",
      hwpxDocumentModel: null,
      chatMessages: [],
      chatBusy: false,
      pendingToolCall: null,
      download: initialDownload,
      renderHtml: null,
      renderElementMap: null,
      status: "HWPX 또는 DOCX 파일을 업로드하세요.",
      history: [],
    }),

  setLoadedDocument: ({ fileName, buffer, doc, segments, extraSegmentsMap, integrityIssues, hwpxDocumentModel }) =>
    set({
      fileName,
      sourceBuffer: buffer,
      editorDoc: doc,
      sourceSegments: segments,
      extraSegmentsMap,
      integrityIssues,
      hwpxDocumentModel,
      exportWarnings: [],
      editsPreview: [],
      isDirty: false,
      aiSuggestion: "",
      batchSuggestions: [],
      batchDecisions: {},
      documentAnalysis: null,
      terminologyDict: {},
      verificationResult: null,
      verificationLoading: false,
      batchMode: "section",
      selection: { selectedSegmentId: null, selectedText: "" },
      download: {
        blob: null,
        fileName: fileName.replace(/\.hwpx$/i, "") + "-edited.hwpx",
      },
      status: integrityIssues.length
        ? `문서 로드 완료 (무결성 경고 ${integrityIssues.length}개)`
        : "문서 로드 완료",
    }),

  setHwpxDocumentModel: (hwpxDocumentModel) => set({ hwpxDocumentModel }),
  setEditorDoc: (doc) => set({ editorDoc: doc, isDirty: true }),
  setOutline: (outline) => set({ outline }),
  setEditsPreview: (edits) => set({ editsPreview: edits }),
  setExportWarnings: (warnings) => set({ exportWarnings: warnings }),
  setStatus: (status) => set({ status }),
  setBusy: (isBusy) => set({ isBusy }),
  setDirty: (isDirty) => set({ isDirty }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  setInstruction: (instruction) => set({ instruction }),
  setSelection: (selection) => set({ selection }),
  setAiSuggestion: (aiSuggestion) => set({ aiSuggestion }),
  setBatchSuggestions: (batchSuggestions) => set({ batchSuggestions }),
  setAiBusy: (aiBusy) => set({ aiBusy }),
  setDownload: (download) => set({ download }),
  setRenderResult: (renderHtml, renderElementMap) => set({ renderHtml, renderElementMap }),
  pushHistory: (summary, editCount, options) =>
    set((state) => ({
      history: [
        {
          id: `history-${state.history.length}-${Date.now()}`,
          timestamp: Date.now(),
          summary,
          editCount,
          actor: options?.actor ?? "system",
          snapshotDoc:
            options?.snapshotDoc !== undefined
              ? options.snapshotDoc
              : state.editorDoc
                ? JSON.parse(JSON.stringify(state.editorDoc))
                : null,
        },
        ...state.history,
      ].slice(0, 100),
    })),

  // Phase 2-1: Accept/Reject
  setBatchDecision: (id, decision) =>
    set((state) => ({
      batchDecisions: { ...state.batchDecisions, [id]: decision },
    })),
  clearBatchDecisions: () => set({ batchDecisions: {} }),

  // Phase 2-3: Presets
  setSelectedPreset: (selectedPreset) => set({ selectedPreset }),

  // Phase 2-4: Document Intelligence
  setDocumentAnalysis: (documentAnalysis) => set({ documentAnalysis }),
  setAnalysisLoading: (analysisLoading) => set({ analysisLoading }),

  // Phase 2-5: Terminology
  setTerminologyDict: (terminologyDict) => set({ terminologyDict }),
  updateTerminologyEntry: (variant, canonical) =>
    set((state) => ({
      terminologyDict: { ...state.terminologyDict, [variant]: canonical },
    })),
  removeTerminologyEntry: (variant) =>
    set((state) => {
      const next = { ...state.terminologyDict };
      delete next[variant];
      return { terminologyDict: next };
    }),

  // Phase 2-6: Verification
  setVerificationResult: (verificationResult) => set({ verificationResult }),
  setVerificationLoading: (verificationLoading) => set({ verificationLoading }),

  // Batch mode
  setBatchMode: (batchMode) => set({ batchMode }),

  // Form mode
  setFormMode: (formMode) => set({ formMode }),

  // Chat agent
  addChatMessage: (msg) =>
    set((state) => ({ chatMessages: [...state.chatMessages, msg] })),

  updateLastAssistantMessage: (fn) =>
    set((state) => {
      const msgs = [...state.chatMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], content: fn(msgs[i].content) };
          break;
        }
      }
      return { chatMessages: msgs };
    }),

  finalizeLastAssistantMessage: () =>
    set((state) => {
      const msgs = [...state.chatMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], isStreaming: false };
          break;
        }
      }
      return { chatMessages: msgs };
    }),

  setChatBusy: (chatBusy) => set({ chatBusy }),
  setPendingToolCall: (pendingToolCall) => set({ pendingToolCall }),
  clearChat: () => set({ chatMessages: [], pendingToolCall: null, chatBusy: false }),

  appendToolCallToLastMessage: (tc) =>
    set((state) => {
      const msgs = [...state.chatMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], toolCalls: [...(msgs[i].toolCalls || []), tc] };
          break;
        }
      }
      return { chatMessages: msgs };
    }),

  appendToolResultToLastMessage: (tr) =>
    set((state) => {
      const msgs = [...state.chatMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], toolResults: [...(msgs[i].toolResults || []), tr] };
          break;
        }
      }
      return { chatMessages: msgs };
    }),
}));
