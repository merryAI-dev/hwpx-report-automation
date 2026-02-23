import { create } from "zustand";
import type { JSONContent } from "@tiptap/core";
import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import type { TextEdit } from "@/lib/hwpx";
import type { OutlineItem } from "@/lib/editor/document-store";

export type SidebarTab = "outline" | "ai" | "history";

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
};

export type BatchSuggestionItem = {
  id: string;
  suggestion: string;
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

  resetDocument: () => void;
  setLoadedDocument: (params: {
    fileName: string;
    buffer: ArrayBuffer;
    doc: JSONContent;
    segments: EditorSegment[];
    extraSegmentsMap: Record<string, string[]>;
    integrityIssues: string[];
  }) => void;
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
  setAiBusy: (isBusy: boolean) => void;
  setDownload: (download: DownloadState) => void;
  setRenderResult: (html: string, elementMap: Record<string, RenderElementInfo>) => void;
  pushHistory: (summary: string, editCount: number) => void;
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
  status: "HWPX 파일을 업로드하세요.",
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
      download: initialDownload,
      renderHtml: null,
      renderElementMap: null,
      status: "HWPX 파일을 업로드하세요.",
      history: [],
    }),

  setLoadedDocument: ({ fileName, buffer, doc, segments, extraSegmentsMap, integrityIssues }) =>
    set({
      fileName,
      sourceBuffer: buffer,
      editorDoc: doc,
      sourceSegments: segments,
      extraSegmentsMap,
      integrityIssues,
      exportWarnings: [],
      editsPreview: [],
      isDirty: false,
      aiSuggestion: "",
      batchSuggestions: [],
      selection: { selectedSegmentId: null, selectedText: "" },
      download: {
        blob: null,
        fileName: fileName.replace(/\.hwpx$/i, "") + "-edited.hwpx",
      },
      status: integrityIssues.length
        ? `문서 로드 완료 (무결성 경고 ${integrityIssues.length}개)`
        : "문서 로드 완료",
    }),

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
  pushHistory: (summary, editCount) =>
    set((state) => ({
      history: [
        {
          id: `history-${state.history.length}-${Date.now()}`,
          timestamp: Date.now(),
          summary,
          editCount,
        },
        ...state.history,
      ].slice(0, 100),
    })),
}));
