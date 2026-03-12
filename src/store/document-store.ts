import { create } from "zustand";
import type { JSONContent } from "@tiptap/core";
import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import type { TextEdit } from "@/lib/hwpx";
import type { OutlineItem } from "@/lib/editor/document-store";
import type { PresetKey } from "@/lib/editor/ai-presets";
import type { TemplateCatalog } from "@/lib/template-catalog";
import type { HwpxDocumentModel } from "@/types/hwpx-model";
import type { QualityGateResult } from "@/lib/quality-gates";
import type { ComplexObjectReport } from "@/lib/editor/hwpx-complex-objects";

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
  qualityGate: QualityGateResult;
};

export type BatchJobStatus = "queued" | "running" | "completed" | "failed";

export type BatchJobState = {
  id: string;
  status: BatchJobStatus;
  completedChunks: number;
  totalChunks: number;
  resultCount: number;
  itemCount: number;
  error: string | null;
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
  remoteUrl?: string | null;
  remoteExpiresAt?: string | null;
  provider?: string | null;
  blobId?: string | null;
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
  complexObjectReport: ComplexObjectReport | null;
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
  templateCatalog: TemplateCatalog | null;
  analysisLoading: boolean;
  // Phase 2-5: Terminology
  terminologyDict: Record<string, string>;
  // Phase 2-6: Verification
  verificationResult: VerificationResult | null;
  verificationLoading: boolean;
  singleSuggestionQualityGate: QualityGateResult | null;
  singleSuggestionApproved: boolean;
  // Batch mode
  batchMode: "section" | "document";
  batchJob: BatchJobState | null;

  // Form mode
  formMode: boolean;

  // OWPML in-memory document model (para-snapshot round-trip)
  hwpxDocumentModel: HwpxDocumentModel | null;

  // Chat agent
  chatMessages: ChatMessageUI[];
  chatBusy: boolean;
  pendingToolCall: PendingToolCall | null;

  // Tool call rollback (Task 2.2)
  lastToolCallSnapshot: JSONContent | null;

  // Server persistence (Sprint 5)
  documentId: string | null;

  resetDocument: () => void;
  setLoadedDocument: (params: {
    fileName: string;
    buffer: ArrayBuffer;
    doc: JSONContent;
    segments: EditorSegment[];
    extraSegmentsMap: Record<string, string[]>;
    integrityIssues: string[];
    complexObjectReport: ComplexObjectReport | null;
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
  setTemplateCatalog: (catalog: TemplateCatalog | null) => void;
  setAnalysisLoading: (loading: boolean) => void;
  // Phase 2-5
  setTerminologyDict: (dict: Record<string, string>) => void;
  updateTerminologyEntry: (variant: string, canonical: string) => void;
  removeTerminologyEntry: (variant: string) => void;
  // Phase 2-6
  setVerificationResult: (result: VerificationResult | null) => void;
  setVerificationLoading: (loading: boolean) => void;
  setSingleSuggestionQualityGate: (gate: QualityGateResult | null) => void;
  setSingleSuggestionApproved: (approved: boolean) => void;
  // Batch mode
  setBatchMode: (mode: "section" | "document") => void;
  setBatchJob: (batchJob: BatchJobState | null) => void;
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

  // Tool call rollback (Task 2.2)
  saveToolCallSnapshot: () => void;
  undoLastToolCall: () => JSONContent | null;

  // Server persistence (Sprint 5)
  setDocumentId: (id: string | null) => void;
};

const INITIAL_INSTRUCTION = "문장을 간결하게 다듬고 기술 문서 톤으로 수정해줘.";

const initialDownload: DownloadState = {
  blob: null,
  fileName: "edited.hwpx",
  remoteUrl: null,
  remoteExpiresAt: null,
  provider: null,
  blobId: null,
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  fileName: "",
  sourceBuffer: null,
  editorDoc: null,
  sourceSegments: [],
  extraSegmentsMap: {},
  integrityIssues: [],
  complexObjectReport: null,
  exportWarnings: [],
  outline: [],
  editsPreview: [],
  history: [],
  status: "HWP, HWPX, DOCX 또는 PPTX 파일을 업로드하세요.",
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
  templateCatalog: null,
  analysisLoading: false,
  terminologyDict: {},
  verificationResult: null,
  verificationLoading: false,
  singleSuggestionQualityGate: null,
  singleSuggestionApproved: false,
  batchMode: "section",
  batchJob: null,
  formMode: false,

  hwpxDocumentModel: null,

  chatMessages: [],
  chatBusy: false,
  pendingToolCall: null,

  lastToolCallSnapshot: null,

  documentId: null,

  resetDocument: () =>
    set({
      fileName: "",
      sourceBuffer: null,
      editorDoc: null,
      sourceSegments: [],
      extraSegmentsMap: {},
      integrityIssues: [],
      complexObjectReport: null,
      exportWarnings: [],
      outline: [],
      editsPreview: [],
      isDirty: false,
      selection: { selectedSegmentId: null, selectedText: "" },
      aiSuggestion: "",
      batchSuggestions: [],
      batchDecisions: {},
      documentAnalysis: null,
      templateCatalog: null,
      analysisLoading: false,
      terminologyDict: {},
      verificationResult: null,
      verificationLoading: false,
      singleSuggestionQualityGate: null,
      singleSuggestionApproved: false,
      batchMode: "section",
      batchJob: null,
      hwpxDocumentModel: null,
      chatMessages: [],
      chatBusy: false,
      pendingToolCall: null,
      lastToolCallSnapshot: null,
      documentId: null,
      download: initialDownload,
      renderHtml: null,
      renderElementMap: null,
      status: "HWP, HWPX, DOCX 또는 PPTX 파일을 업로드하세요.",
      history: [],
    }),

  setLoadedDocument: ({
    fileName,
    buffer,
    doc,
    segments,
    extraSegmentsMap,
    integrityIssues,
    complexObjectReport,
    hwpxDocumentModel,
  }) =>
    set({
      fileName,
      sourceBuffer: buffer,
      editorDoc: doc,
      sourceSegments: segments,
      extraSegmentsMap,
      integrityIssues,
      complexObjectReport,
      hwpxDocumentModel,
      exportWarnings: [],
      editsPreview: [],
      isDirty: false,
      aiSuggestion: "",
      batchSuggestions: [],
      batchDecisions: {},
      documentAnalysis: null,
      templateCatalog: null,
      terminologyDict: {},
      verificationResult: null,
      verificationLoading: false,
      singleSuggestionQualityGate: null,
      singleSuggestionApproved: false,
      batchMode: "section",
      batchJob: null,
      selection: { selectedSegmentId: null, selectedText: "" },
      history: [],
      chatMessages: [],
      chatBusy: false,
      pendingToolCall: null,
      lastToolCallSnapshot: null,
      download: {
        blob: null,
        fileName: fileName.replace(/\.hwpx$/i, "") + "-edited.hwpx",
      },
      renderHtml: null,
      renderElementMap: null,
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
    set((state) => {
      const historyIndex = state.history.length;
      // Snapshot every 5th entry to reduce memory usage (Task 2.4)
      const shouldSnapshot = historyIndex % 5 === 0;
      const snapshotDoc =
        options?.snapshotDoc !== undefined
          ? options.snapshotDoc
          : shouldSnapshot && state.editorDoc
            ? structuredClone(state.editorDoc)
            : null;
      return {
        history: [
          {
            id: `history-${historyIndex}-${Date.now()}`,
            timestamp: Date.now(),
            summary,
            editCount,
            actor: options?.actor ?? "system",
            snapshotDoc,
          },
          ...state.history,
        ].slice(0, 100),
      };
    }),

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
  setTemplateCatalog: (templateCatalog) => set({ templateCatalog }),
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
  setSingleSuggestionQualityGate: (singleSuggestionQualityGate) => set({ singleSuggestionQualityGate }),
  setSingleSuggestionApproved: (singleSuggestionApproved) => set({ singleSuggestionApproved }),

  // Batch mode
  setBatchMode: (batchMode) => set({ batchMode }),
  setBatchJob: (batchJob) => set({ batchJob }),

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

  // Tool call rollback (Task 2.2)
  saveToolCallSnapshot: () =>
    set((state) => ({
      lastToolCallSnapshot: state.editorDoc
        ? structuredClone(state.editorDoc)
        : null,
    })),

  undoLastToolCall: () => {
    const { lastToolCallSnapshot } = get();
    if (!lastToolCallSnapshot) return null;
    set({ lastToolCallSnapshot: null });
    return lastToolCallSnapshot;
  },

  setDocumentId: (id) => set({ documentId: id }),
}));
