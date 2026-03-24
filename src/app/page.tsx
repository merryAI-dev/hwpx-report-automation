"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DocumentEditor } from "@/components/editor/DocumentEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { HwpxSaveDialog } from "@/components/common/HwpxSaveDialog";
import {
  DocumentStartWizard,
  type PreviewStatus,
  type StartWizardMethod,
} from "@/components/common/DocumentStartWizard";
import { EditorLayout } from "@/components/editor/EditorLayout";
import { EditorRuler } from "@/components/editor/EditorRuler";
import { StatusBar } from "@/components/common/StatusBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { DocumentOutline } from "@/components/sidebar/DocumentOutline";
import { AiSuggestionPanel } from "@/components/sidebar/AiSuggestionPanel";
import { ChatPanel } from "@/components/sidebar/ChatPanel";
import { EditHistoryPanel } from "@/components/sidebar/EditHistoryPanel";
import { DocumentAnalysisPanel } from "@/components/sidebar/DocumentAnalysisPanel";
import { streamChat } from "@/lib/chat/chat-stream";
import type { ChatMessageAPI, ContentBlock, DocumentContext, EditPreview, TableContext, ToolCallInfo } from "@/types/chat";
import { InlineAiPopup } from "@/components/editor/InlineAiPopup";
import { buildBatchApplyPlan, collectSectionBatchItems } from "@/lib/editor/batch-ai";
import { buildDirtySummary, buildOutlineFromDoc } from "@/lib/editor/document-store";
import { parseHwpxToProseMirror } from "@/lib/editor/hwpx-to-prosemirror";
import { parseDocxToProseMirror } from "@/lib/editor/docx-to-prosemirror";
import { parsePptxToProseMirror } from "@/lib/editor/pptx-to-prosemirror";
import { applyProseMirrorDocToHwpx, collectDocumentEdits } from "@/lib/editor/prosemirror-to-hwpx";
import { buildHwpxModelFromDoc } from "@/lib/editor/hwpx-template-synthesizer";
import {
  DOCUMENT_TEMPLATES,
  type DocumentTemplate,
} from "@/lib/editor/document-templates";
import { exportToPdf } from "@/lib/editor/export-pdf";
import { exportToDocx } from "@/lib/editor/export-docx";
import { exportToMarkdown } from "@/lib/editor/export-markdown";
import { triggerDiffHighlightUpdate } from "@/lib/editor/diff-highlight-extension";
import type { DiffHighlightSuggestion } from "@/lib/editor/diff-highlight-extension";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";
import type { PresetKey } from "@/lib/editor/ai-presets";
import { uploadBlobForSignedDownload } from "@/lib/blob-storage-client";
import { buildTemplateCatalogFromDoc } from "@/lib/template-catalog";
import {
  buildPptxReportFamilyPlanPayload,
  type ReportFamilyPlan,
} from "@/lib/report-family-planner";
import { buildReportFamilyPromptContext } from "@/lib/report-family-prompt-context";
import {
  buildReportFamilyDraftEditorArtifacts,
  type ReportFamilyDraft,
} from "@/lib/report-family-draft-generator";
import type { SessionIdentityProvider, SessionTenantMembership } from "@/lib/auth/session";
import { evaluateQualityGate, type QualityGateResult } from "@/lib/quality-gates";
import { recordPilotMetricEvent } from "@/lib/pilot-metrics";
import { hasComplexObjectSignal } from "@/lib/editor/hwpx-complex-objects";
import {
  listRecentFileSnapshots,
  loadRecentFileSnapshot,
  saveRecentFileSnapshot,
  type RecentFileKind,
  type RecentFileSnapshotMeta,
} from "@/lib/recent-files";
import { useDocumentStore } from "@/store/document-store";
import type { RenderElementInfo, SidebarTab } from "@/store/document-store";
import type {
  WorkspaceBlobReference,
  WorkspaceDocumentDetail,
  WorkspaceSourceFormat,
  WorkspaceValidationSummary,
} from "@/lib/workspace-types";
import styles from "./page.module.css";

function replaceSegmentText(editor: Editor, segmentId: string, nextText: string): boolean {
  let replaced = false;
  editor.state.doc.descendants((node, pos) => {
    const attrs = node.attrs as { segmentId?: string };
    if (!attrs.segmentId || attrs.segmentId !== segmentId) {
      return true;
    }
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    editor.chain().focus().setTextSelection({ from, to }).insertContent(nextText).run();
    replaced = true;
    return false;
  });
  return replaced;
}

function focusSegment(editor: Editor, segmentId: string): boolean {
  let targetPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (targetPos !== null) {
      return false;
    }
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return true;
    }
    const attrs = node.attrs as { segmentId?: string };
    if (attrs.segmentId !== segmentId) {
      return true;
    }
    targetPos = pos + 1;
    return false;
  });

  if (targetPos === null) {
    return false;
  }
  editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
  return true;
}

type SegmentTextUpdate = {
  segmentId: string;
  text: string;
};

const AUTOSAVE_INTERVAL_MS = 60_000;
let uniqueSaveSequence = 0;

function toFileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").trim();
  return stem || "document";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function formatTimestampForFileName(ts: number): string {
  const date = new Date(ts);
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    "-",
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
    "-",
    pad3(date.getMilliseconds()),
  ].join("");
}

function createUniqueHwpxFileName(fileName: string, label: string): string {
  const stem = toFileStem(fileName || "document.hwpx");
  uniqueSaveSequence += 1;
  return `${stem}-${label}-${formatTimestampForFileName(Date.now())}-${pad3(uniqueSaveSequence % 1000)}.hwpx`;
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildInlineFragment(editor: Editor, text: string): Fragment {
  const nodes: PMNode[] = [];
  const hardBreakNode = editor.schema.nodes.hardBreak;
  const chunks = text.split(/\r\n|\r|\n/);
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0 && hardBreakNode) {
      nodes.push(hardBreakNode.create());
    }
    if (!chunk.length) {
      continue;
    }
    nodes.push(editor.schema.text(chunk));
  }
  return Fragment.fromArray(nodes);
}

function applyBatchSegmentTexts(editor: Editor, updates: SegmentTextUpdate[]): number {
  if (!updates.length) {
    return 0;
  }

  const textBySegment = new Map(updates.map((row) => [row.segmentId, row.text]));
  const ranges: Array<{ from: number; to: number; text: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return true;
    }
    const attrs = node.attrs as { segmentId?: string };
    if (!attrs.segmentId || !textBySegment.has(attrs.segmentId)) {
      return true;
    }
    ranges.push({
      from: pos + 1,
      to: pos + node.nodeSize - 1,
      text: textBySegment.get(attrs.segmentId) || "",
    });
    return true;
  });
  if (!ranges.length) {
    return 0;
  }

  ranges.sort((a, b) => b.from - a.from);
  let tr = editor.state.tr;
  for (const range of ranges) {
    tr = tr.replaceWith(range.from, range.to, buildInlineFragment(editor, range.text));
  }
  if (!tr.docChanged) {
    return 0;
  }
  editor.view.dispatch(tr.scrollIntoView());
  return ranges.length;
}

function extractNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text || "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (!node.content?.length) {
    return "";
  }
  return node.content.map((child) => extractNodeText(child)).join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeTemplateFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-");
}

function getPreviewTabTitle(previewStatus: PreviewStatus): string {
  switch (previewStatus) {
    case "loading":
      return "미리보기를 준비 중입니다.";
    case "ready":
      return "Java 미리보기를 사용할 수 있습니다.";
    case "error":
      return "Java 미리보기 서버에 연결하지 못했습니다.";
    case "unavailable":
      return "현재 문서는 Java 미리보기를 지원하지 않습니다.";
    default:
      return "문서를 열면 미리보기를 준비합니다.";
  }
}

function getPreviewBadgeLabel(previewStatus: PreviewStatus): string {
  switch (previewStatus) {
    case "loading":
      return "준비 중";
    case "ready":
      return "연결됨";
    case "error":
      return "오류";
    case "unavailable":
      return "미지원";
    default:
      return "대기";
  }
}

function fillTableRows(
  editor: Editor,
  tableIndex: number,
  startRow: number,
  rows: Array<Record<string, string>>,
  headers: string[],
): string {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const headerToCol = new Map<string, number>();
  headers.forEach((h, i) => headerToCol.set(normalize(h), i));

  // Step 1: JSON에서 대상 표 찾기
  const docJson = editor.getJSON();
  const docContent = docJson.content ?? [];
  let tblCount = 0;
  let tableNodeJson: JSONContent | null = null;
  for (const node of docContent) {
    if (node.type === "table") {
      if (tblCount === tableIndex) { tableNodeJson = node; break; }
      tblCount++;
    }
  }
  if (!tableNodeJson) return "표를 찾지 못했습니다";

  // Step 2: JSON에서 셀 내용 직접 수정
  let modified = 0;
  rows.forEach((rowData, i) => {
    const rowIdx = startRow + i;
    const rowNode = tableNodeJson!.content?.[rowIdx];
    if (!rowNode) return;
    for (const [headerName, cellText] of Object.entries(rowData)) {
      const colIdx = headerToCol.get(normalize(headerName));
      if (colIdx === undefined) continue;
      const cellNode = rowNode.content?.[colIdx];
      if (!cellNode) continue;
      const firstPara = cellNode.content?.[0];
      const text = String(cellText).trim();
      const paraContent: JSONContent[] = text
        ? [{ type: "text", text }]
        : [];
      cellNode.content = [{
        type: firstPara?.type ?? "paragraph",
        attrs: firstPara?.attrs ?? {},
        content: paraContent,
      }];
      modified++;
    }
  });

  if (modified === 0) {
    const keyList = [...headerToCol.keys()].join(", ");
    return `채울 셀을 찾지 못했습니다. 사용 가능한 헤더: ${keyList}`;
  }

  // Step 3: 수정된 JSON을 ProseMirror 노드로 파싱 후 표 전체를 교체
  type FoundTable = { pos: number; nodeSize: number };
  let foundTable: FoundTable | null = null;
  let tblCnt2 = 0;
  editor.state.doc.descendants((node, pos) => {
    if (foundTable) return false;
    if (node.type.name === "table") {
      if (tblCnt2 === tableIndex) { foundTable = { pos, nodeSize: node.nodeSize }; return false; }
      tblCnt2++;
    }
    return true;
  });
  if (!foundTable) return "표 위치를 파악하지 못했습니다";

  try {
    const newTableNode = editor.schema.nodeFromJSON(tableNodeJson!);
    const tr = editor.state.tr.replaceWith(
      (foundTable as FoundTable).pos,
      (foundTable as FoundTable).pos + (foundTable as FoundTable).nodeSize,
      newTableNode,
    );
    if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView());
  } catch (e) {
    return `표 업데이트 오류: ${e instanceof Error ? e.message : String(e)}`;
  }

  return `${rows.length}행 데이터 채우기 완료`;
}

function applySearchReplace(
  text: string,
  search: string,
  replace: string,
  caseSensitive: boolean,
): { nextText: string; replacements: number } {
  if (!search) {
    return { nextText: text, replacements: 0 };
  }

  if (caseSensitive) {
    let index = 0;
    let replacements = 0;
    while (true) {
      const found = text.indexOf(search, index);
      if (found === -1) {
        break;
      }
      replacements += 1;
      index = found + search.length;
    }
    if (!replacements) {
      return { nextText: text, replacements: 0 };
    }
    return {
      nextText: text.split(search).join(replace),
      replacements,
    };
  }

  const re = new RegExp(escapeRegExp(search), "gi");
  let replacements = 0;
  const nextText = text.replace(re, () => {
    replacements += 1;
    return replace;
  });
  return { nextText, replacements };
}

type JavaRenderPayload = {
  html?: string;
  elementMap?: Record<string, RenderElementInfo>;
};

type BatchJobPayload = {
  job?: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    completedChunks: number;
    totalChunks: number;
    resultCount: number;
    itemCount: number;
    error: string | null;
    results: Array<{
      id: string;
      suggestion: string;
      qualityGate: QualityGateResult;
    }>;
  };
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type HwpIntakeErrorPayload = {
  error?: string;
  code?: string;
  details?: string[];
};

type WorkspaceDocumentApiResponse = {
  document?: WorkspaceDocumentDetail;
  error?: string;
};

function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() || "";
}

function getFormatLabel(extension: string): string {
  if (extension === "hwp") return "HWP";
  if (extension === "docx") return "DOCX";
  if (extension === "pptx") return "PPTX";
  return "HWPX";
}

function inferWorkspaceSourceFormat(fileName: string): WorkspaceSourceFormat {
  const extension = getFileExtension(fileName);
  if (extension === "hwp" || extension === "docx" || extension === "pptx") {
    return extension;
  }
  return "hwpx";
}

function buildWorkspaceValidationSummary(
  integrityIssues: string[],
  warnings: string[],
): WorkspaceValidationSummary | null {
  if (!integrityIssues.length && !warnings.length) {
    return null;
  }

  return {
    infoCount: 0,
    warningCount: warnings.length,
    errorCount: 0,
    blockingCount: integrityIssues.length,
    topIssues: [
      ...integrityIssues.map((message, index) => ({
        code: `integrity_${index + 1}`,
        severity: "blocking" as const,
        message,
      })),
      ...warnings.slice(0, 5).map((message, index) => ({
        code: `warning_${index + 1}`,
        severity: "warning" as const,
        message,
      })),
    ],
  };
}

function parseContentDispositionFileName(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }

  const plainMatch = headerValue.match(/filename=\"?([^\";]+)\"?/i);
  return plainMatch?.[1] ?? null;
}

async function readHwpIntakeError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as HwpIntakeErrorPayload;
    const details = Array.isArray(payload.details) ? payload.details.filter(Boolean) : [];
    return [payload.error || `HWP 변환 실패 (${response.status})`, ...details].join(" | ");
  } catch {
    return `HWP 변환 실패 (${response.status})`;
  }
}

async function convertLegacyHwpForEditor(file: File): Promise<File> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/hwp-intake", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readHwpIntakeError(response));
  }

  const blob = await response.blob();
  const headerFileName = parseContentDispositionFileName(response.headers.get("content-disposition"));
  const convertedFileName =
    response.headers.get("x-converted-file-name")
    || headerFileName
    || `${toFileStem(file.name)}.hwpx`;

  return new File([blob], convertedFileName, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

type AuthSessionResponse = {
  authenticated: true;
  user: {
    sub: string;
    email: string;
    displayName: string;
  };
  provider: SessionIdentityProvider;
  memberships: SessionTenantMembership[];
  activeTenant: SessionTenantMembership | null;
  expiresAt: number;
};
export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceDocumentId = searchParams.get("documentId") || "";
  const onboardingMode = searchParams.get("onboarding") || "";
  const templateIdQuery = searchParams.get("templateId") || "";
  const [editor, setEditor] = useState<Editor | null>(null);
  const [viewMode, setViewMode] = useState<"editor" | "preview">("editor");
  const [startWizardOpen, setStartWizardOpen] = useState(!workspaceDocumentId);
  const [startWizardInitialMethod, setStartWizardInitialMethod] = useState<StartWizardMethod | null>(null);
  const [startWizardResetToken, setStartWizardResetToken] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [recentSnapshots, setRecentSnapshots] = useState<RecentFileSnapshotMeta[]>([]);
  const [selectedRecentSnapshotId, setSelectedRecentSnapshotId] = useState("");
  const [authSession, setAuthSession] = useState<AuthSessionResponse | null>(null);
  const [tenantSwitching, setTenantSwitching] = useState(false);
  const [workspaceDocument, setWorkspaceDocument] = useState<WorkspaceDocumentDetail | null>(null);
  const [reportFamilyDraftState, setReportFamilyDraftState] = useState<{
    isLoading: boolean;
    error: string | null;
  }>({
    isLoading: false,
    error: null,
  });
  const autoSaveInFlightRef = useRef(false);
  const docRevisionRef = useRef(0);
  const lastAutoSavedRevisionRef = useRef(-1);
  const loadedWorkspaceKeyRef = useRef("");
  const handledStartQueryRef = useRef("");

  const {
    fileName,
    sourceBuffer,
    editorDoc,
    sourceSegments,
    extraSegmentsMap,
    hwpxDocumentModel,
    integrityIssues,
    complexObjectReport,
    exportWarnings,
    outline,
    editsPreview,
    history,
    status,
    isBusy,
    isDirty,
    sidebarCollapsed,
    activeSidebarTab,
    instruction,
    aiSuggestion,
    batchSuggestions,
    aiBusy,
    selection,
    download,

    renderHtml,
    renderElementMap,

    // Phase 2-1: Accept/Reject
    batchDecisions,
    // Phase 2-3: Presets
    selectedPreset,
    // Phase 2-4: Document Intelligence
    documentAnalysis,
    reportFamilyPlanState,
    templateCatalog,
    analysisLoading,
    // Phase 2-5: Terminology
    terminologyDict,
    // Phase 2-6: Verification
    verificationResult,
    verificationLoading,
    singleSuggestionQualityGate,
    singleSuggestionApproved,
    // Batch mode
    batchMode,
    batchJob,
    // Form mode
    formMode,

    // Chat agent
    chatMessages,
    chatBusy,
    pendingToolCall,

    setLoadedDocument,
    setHwpxDocumentModel,
    setEditorDoc,
    setOutline,
    setEditsPreview,
    setExportWarnings,
    setStatus,
    setBusy,
    setDirty,
    toggleSidebar,
    setActiveSidebarTab,
    setInstruction,
    setSelection,
    setAiSuggestion,
    setBatchSuggestions,
    setAiBusy,
    setDownload,
    setRenderResult,
    pushHistory,

    // Phase 2-1
    setBatchDecision,
    clearBatchDecisions,
    // Phase 2-3
    setSelectedPreset,
    // Phase 2-4
    setDocumentAnalysis,
    setReportFamilyPlanState,
    setTemplateCatalog,
    setAnalysisLoading,
    // Phase 2-5
    updateTerminologyEntry,
    removeTerminologyEntry,
    // Phase 2-6
    setVerificationResult,
    setVerificationLoading,
    setSingleSuggestionQualityGate,
    setSingleSuggestionApproved,
    // Batch mode
    setBatchMode,
    setBatchJob,
    // Form mode
    setFormMode,

    // Chat agent
    addChatMessage,
    updateLastAssistantMessage,
    finalizeLastAssistantMessage,
    setChatBusy,
    setPendingToolCall,
    clearChat,
    appendToolCallToLastMessage,
    appendToolResultToLastMessage,

    // Tool call rollback
    lastToolCallSnapshot,
    undoLastToolCall,
  } = useDocumentStore();

  // Phase 2: appendTransaction 이후 Zustand 갱신 신호
  const onNewParaCreated = useCallback(
    () => {
      const model = useDocumentStore.getState().hwpxDocumentModel;
      if (model) setHwpxDocumentModel(model);
    },
    [setHwpxDocumentModel],
  );

  // Phase 2: 항상 최신 model을 반환하는 getter (클로저 stale 방지)
  const getHwpxDocumentModel = useCallback(
    () => useDocumentStore.getState().hwpxDocumentModel,
    [],
  );

  const refreshRecentSnapshots = useCallback(async (preferredId?: string) => {
    try {
      const rows = await listRecentFileSnapshots();
      setRecentSnapshots(rows);
      setSelectedRecentSnapshotId((prev) => {
        if (preferredId && rows.some((row) => row.id === preferredId)) {
          return preferredId;
        }
        if (prev && rows.some((row) => row.id === prev)) {
          return prev;
        }
        return rows[0]?.id || "";
      });
    } catch {
      // IndexedDB unavailable or blocked
      setRecentSnapshots([]);
      setSelectedRecentSnapshotId("");
    }
  }, []);

  useEffect(() => {
    void refreshRecentSnapshots();
  }, [refreshRecentSnapshots]);

  const openStartWizard = useCallback((method: StartWizardMethod | null = null) => {
    setStartWizardInitialMethod(method);
    setStartWizardResetToken((prev) => prev + 1);
    setStartWizardOpen(true);
  }, []);

  const closeStartWizard = useCallback(() => {
    if (!editorDoc || isBusy) {
      return;
    }
    setStartWizardOpen(false);
  }, [editorDoc, isBusy]);

  const refreshAuthSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        setAuthSession(null);
        return;
      }
      const payload = (await response.json()) as AuthSessionResponse;
      setAuthSession(payload);
    } catch {
      setAuthSession(null);
    }
  }, []);

  useEffect(() => {
    void refreshAuthSession();
  }, [refreshAuthSession]);

  useEffect(() => {
    if (editorDoc) {
      setStartWizardOpen(false);
    } else if (!workspaceDocumentId) {
      setStartWizardOpen(true);
    }
  }, [editorDoc, workspaceDocumentId]);

  const clearWorkspaceContext = useCallback(() => {
    setWorkspaceDocument(null);
    loadedWorkspaceKeyRef.current = "";
    if (workspaceDocumentId) {
      router.replace("/");
    }
  }, [router, workspaceDocumentId]);

  const confirmReplaceDocument = useCallback((nextActionLabel: string) => {
    if (!editorDoc || !isDirty) {
      return true;
    }
    return window.confirm(
      `현재 문서에 저장되지 않은 변경사항이 있습니다. ${nextActionLabel}로 시작하면 지금 작업이 닫힙니다. 계속할까요?`,
    );
  }, [editorDoc, isDirty]);

  const onSwitchTenant = useCallback(async (tenantId: string) => {
    if (!authSession?.activeTenant || authSession.activeTenant.tenantId === tenantId) {
      return;
    }

    setTenantSwitching(true);
    try {
      const response = await fetch("/api/auth/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<AuthSessionResponse> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "테넌트 전환 실패");
      }

      setAuthSession(payload as AuthSessionResponse);
      setWorkspaceDocument(null);
      loadedWorkspaceKeyRef.current = "";
      setDownload({
        ...download,
        remoteUrl: null,
        remoteExpiresAt: null,
        provider: null,
        blobId: null,
      });
      setStatus(
        `활성 테넌트를 ${(payload as AuthSessionResponse).activeTenant?.tenantName || tenantId}로 전환했습니다. 기존 서명 다운로드 URL은 초기화되었습니다.`,
      );
      if (workspaceDocumentId) {
        router.replace("/");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "테넌트 전환 실패";
      setStatus(message);
    } finally {
      setTenantSwitching(false);
    }
  }, [authSession, download, router, setDownload, setStatus, workspaceDocumentId]);

  const localDownloadUrl = useMemo(() => {
    if (!download.blob) {
      return "";
    }
    return URL.createObjectURL(download.blob);
  }, [download.blob]);
  const downloadUrl = useMemo(() => {
    if (
      download.remoteUrl &&
      (!download.remoteExpiresAt || Date.now() < Date.parse(download.remoteExpiresAt))
    ) {
      return download.remoteUrl;
    }
    return localDownloadUrl;
  }, [download.remoteUrl, download.remoteExpiresAt, localDownloadUrl]);

  const dirtySummary = useMemo(() => buildDirtySummary(editsPreview), [editsPreview]);
  const batchItems = useMemo(
    () => collectSectionBatchItems(editorDoc, batchMode === "document" ? null : selection.selectedSegmentId),
    [editorDoc, selection.selectedSegmentId, batchMode],
  );
  const selectedReportFamilyPlanContext = useMemo(
    () =>
      buildReportFamilyPromptContext({
        plan: reportFamilyPlanState.plan,
        segmentId: selection.selectedSegmentId,
        text: selection.selectedText,
      }),
    [reportFamilyPlanState.plan, selection.selectedSegmentId, selection.selectedText],
  );
  const batchItemsWithPlanContext = useMemo(
    () =>
      batchItems.map((item) => ({
        ...item,
        planContext: buildReportFamilyPromptContext({
          plan: reportFamilyPlanState.plan,
          segmentId: item.id,
          text: item.text,
          sectionTitle: item.styleHints.sectionTitle,
          prevText: item.prevText,
          nextText: item.nextText,
        }) || undefined,
      })),
    [batchItems, reportFamilyPlanState.plan],
  );
  const batchPlan = useMemo(
    () => buildBatchApplyPlan(batchItemsWithPlanContext, batchSuggestions),
    [batchItemsWithPlanContext, batchSuggestions],
  );
  const batchSuggestionCount = useMemo(
    () => batchPlan.filter((item) => item.changed).length,
    [batchPlan],
  );
  const batchDiffItems = useMemo(
    () =>
      batchPlan
        .filter((item) => item.changed)
        .slice(0, 20)
        .map((item) => ({
          id: item.id,
          before: item.originalText,
          after: item.suggestion,
          qualityGate: batchSuggestions.find((row) => row.id === item.id)?.qualityGate,
        })),
    [batchPlan, batchSuggestions],
  );
  const templateValidationWarnings = useMemo(
    () =>
      (templateCatalog?.issues || []).map(
        (issue) =>
          `[TEMPLATE-${issue.severity.toUpperCase()}][${issue.code}] ${issue.message}`,
      ),
    [templateCatalog],
  );

  useEffect(() => {
    return () => {
      if (localDownloadUrl) {
        URL.revokeObjectURL(localDownloadUrl);
      }
    };
  }, [localDownloadUrl]);

  /* ── Diff highlight sync: React → Editor ── */
  useEffect(() => {
    if (!editor) return;
    const suggestions: DiffHighlightSuggestion[] = batchPlan
      .filter((item) => item.changed)
      .map((item) => ({
        segmentId: item.id,
        originalText: item.originalText,
        suggestion: item.suggestion,
        decision: batchDecisions[item.id],
      }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.storage as any).diffHighlight.suggestions = suggestions;
    triggerDiffHighlightUpdate(editor);
  }, [editor, batchPlan, batchDecisions]);

  /* ── Sidebar tab toggle (from toolbar buttons) ── */
  const handleSetSidebarTab = (tab: SidebarTab) => {
    if (!sidebarCollapsed && activeSidebarTab === tab) {
      toggleSidebar(); // same tab click → collapse
    } else {
      if (sidebarCollapsed) toggleSidebar();
      setActiveSidebarTab(tab);
    }
  };

  /* ── Phase 2-4: Document Analysis ── */
  const fireDocumentAnalysis = useCallback((segments: Array<{ segmentId: string; text: string }>) => {
    setAnalysisLoading(true);
    const items = segments
      .filter((s) => s.text.trim())
      .slice(0, 100)
      .map((s) => ({
        id: s.segmentId,
        text: s.text.slice(0, 200),
      }));
    if (!items.length) {
      setAnalysisLoading(false);
      return;
    }
    fetch("/api/analyze-document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: items }),
    })
      .then(async (resp) => {
        if (!resp.ok) return;
        const data = await resp.json();
        setDocumentAnalysis(data);
        // Auto-select preset if suggested
        if (data.suggestedPreset) {
          const preset = INSTRUCTION_PRESETS.find((p) => p.key === data.suggestedPreset);
          if (preset) {
            setSelectedPreset(preset.key);
            if (preset.instruction) {
              setInstruction(preset.instruction);
            }
          }
        }
      })
      .catch(() => {
        // Analysis is optional
      })
      .finally(() => setAnalysisLoading(false));
  }, [setAnalysisLoading, setDocumentAnalysis, setInstruction, setSelectedPreset]);

  const fireReportFamilyPlanning = useCallback(
    async (params: {
      fileName: string;
      segments: typeof sourceSegments;
      outlineItems: typeof outline;
    }) => {
      const extension = getFileExtension(params.fileName);
      if (extension !== "pptx" || !params.segments.length || !params.outlineItems.length) {
        setReportFamilyPlanState({
          plan: null,
          isLoading: false,
          error: extension === "pptx" ? "목차 추출에 사용할 outline이 부족합니다." : null,
        });
        return;
      }

      setReportFamilyPlanState({
        plan: null,
        isLoading: true,
        error: null,
      });

      try {
        const payload = buildPptxReportFamilyPlanPayload({
          familyName: `${toFileStem(params.fileName)} 보고서`,
          fileName: params.fileName,
          segments: params.segments,
          outline: params.outlineItems,
        });

        const response = await fetch("/api/report-family/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = (await response.json()) as ReportFamilyPlan & { error?: string };

        if (!response.ok) {
          throw new Error(result.error || "리포트 패밀리 계획 계산 실패");
        }

        setReportFamilyPlanState({
          plan: result,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        setReportFamilyPlanState({
          plan: null,
          isLoading: false,
          error: error instanceof Error ? error.message : "리포트 패밀리 계획 계산 실패",
        });
      }
    },
    [setReportFamilyPlanState],
  );

  const onRefreshReportFamilyPlan = useCallback(() => {
    if (getFileExtension(fileName) !== "pptx") {
      setStatus("현재는 PPTX 문서에 대해서만 리포트 패밀리 계획을 계산합니다.");
      return;
    }
    void fireReportFamilyPlanning({
      fileName,
      segments: sourceSegments,
      outlineItems: outline,
    });
  }, [fileName, fireReportFamilyPlanning, outline, setStatus, sourceSegments]);

  const onGenerateReportFamilyDraft = useCallback(async () => {
    if (!reportFamilyPlanState.plan) {
      setStatus("먼저 리포트 패밀리 계획을 계산하세요.");
      return;
    }

    const confirmed = window.confirm(
      "현재 슬라이드 문서를 기반으로 새 보고서 초안을 생성해 편집기에 엽니다. 계속할까요?",
    );
    if (!confirmed) {
      return;
    }

    setReportFamilyDraftState({ isLoading: true, error: null });
    setBusy(true);
    setStatus("슬라이드와 목표 보고서 양식을 기준으로 보고서 초안을 생성 중입니다...");

    try {
      const response = await fetch("/api/report-family/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: reportFamilyPlanState.plan,
        }),
      });
      const result = (await response.json()) as {
        draft?: ReportFamilyDraft;
        error?: string;
      };

      if (!response.ok || !result.draft) {
        throw new Error(result.error || "리포트 패밀리 초안 생성 실패");
      }

      const artifacts = buildReportFamilyDraftEditorArtifacts(result.draft);
      const templateResp = await fetch("/base.hwpx");
      if (!templateResp.ok) {
        throw new Error("기본 HWPX 템플릿을 불러오지 못했습니다.");
      }
      const templateBuffer = await templateResp.arrayBuffer();
      const hwpxDocumentModel = await buildHwpxModelFromDoc(templateBuffer, artifacts.doc);
      const nextFileName = `${toFileStem(fileName || result.draft.familyName)}-report-draft.hwpx`;

      setLoadedDocument({
        fileName: nextFileName,
        buffer: templateBuffer,
        doc: artifacts.doc,
        segments: artifacts.segments,
        extraSegmentsMap: {},
        integrityIssues: [],
        complexObjectReport: null,
        hwpxDocumentModel,
      });
      setOutline(buildOutlineFromDoc(artifacts.doc));
      setTemplateCatalog(buildTemplateCatalogFromDoc(artifacts.doc));
      setSelectedPreset("custom");
      setPreviewStatus("unavailable");
      docRevisionRef.current = 0;
      lastAutoSavedRevisionRef.current = -1;

      const failedCount = result.draft.evaluation.failedSections.length;
      setStatus(
        failedCount
          ? `보고서 초안 생성 완료 (${result.draft.engine}, 점검 필요 섹션 ${failedCount}개)`
          : `보고서 초안 생성 완료 (${result.draft.engine})`,
      );
      setReportFamilyDraftState({ isLoading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "리포트 패밀리 초안 생성 실패";
      setReportFamilyDraftState({ isLoading: false, error: message });
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }, [
    fileName,
    reportFamilyPlanState.plan,
    setBusy,
    setLoadedDocument,
    setOutline,
    setSelectedPreset,
    setStatus,
    setTemplateCatalog,
  ]);

  /* ── File I/O ── */
  const loadFileIntoEditor = useCallback(
    async (
      file: File,
      recentKind: RecentFileKind | null = "opened",
      options?: { workspaceDocument?: WorkspaceDocumentDetail | null },
    ) => {
      setBusy(true);
      setReportFamilyDraftState({ isLoading: false, error: null });
      setViewMode("editor");
      try {
        const sourceExt = getFileExtension(file.name);
        let workingFile = file;
        let ext = sourceExt;

        if (sourceExt === "hwp") {
          setStatus("HWP를 HWPX로 변환 중입니다...");
          workingFile = await convertLegacyHwpForEditor(file);
          ext = "hwpx";
        }

        const formatLabel = getFormatLabel(ext);
        const isHwpx = ext === "hwpx";
        setPreviewStatus(isHwpx ? "loading" : "unavailable");
        setStatus(
          sourceExt === "hwp"
            ? "HWP를 HWPX로 변환한 뒤 문서를 분석 중입니다..."
            : `${formatLabel}를 분석하고 변환 중입니다...`,
        );

        const buffer = await workingFile.arrayBuffer();
        let parsePromise;
        if (ext === "docx") parsePromise = parseDocxToProseMirror(buffer);
        else if (ext === "pptx") parsePromise = parsePptxToProseMirror(buffer);
        else parsePromise = parseHwpxToProseMirror(buffer);

        const [parsed, previewPayload] = await Promise.all([
          parsePromise,
          !isHwpx
            ? Promise.resolve<JavaRenderPayload | null>(null)
            : (async () => {
                try {
                  const fd = new FormData();
                  fd.append("file", workingFile);
                  const resp = await fetch("/api/hwpx-render", { method: "POST", body: fd });
                  if (resp.ok) {
                    const payload = (await resp.json()) as JavaRenderPayload;
                    if (payload.html && payload.elementMap) {
                      setPreviewStatus("ready");
                      return payload;
                    } else {
                      setPreviewStatus("error");
                      return null;
                    }
                  } else {
                    setPreviewStatus("error");
                    return null;
                  }
                } catch {
                  setPreviewStatus("error");
                  return null;
                }
              })(),
        ]);

        // DOCX/PPTX: base.hwpx 템플릿으로 HwpxDocumentModel 합성 → HWPX 저장 활성화
        let hwpxDocumentModel = parsed.hwpxDocumentModel ?? null;
        if ((ext === "docx" || ext === "pptx") && !hwpxDocumentModel) {
          try {
            const templateResp = await fetch("/base.hwpx");
            if (templateResp.ok) {
              const templateBuffer = await templateResp.arrayBuffer();
              hwpxDocumentModel = await buildHwpxModelFromDoc(templateBuffer, parsed.doc);
            }
          } catch {
            // base.hwpx 로드 실패 시 null 유지 (HWPX 저장 비활성)
          }
        }

        setLoadedDocument({
          fileName: workingFile.name,
          buffer,
          doc: parsed.doc,
          segments: parsed.segments,
          extraSegmentsMap: parsed.extraSegmentsMap,
          integrityIssues: parsed.integrityIssues,
          complexObjectReport: parsed.complexObjectReport,
          hwpxDocumentModel,
        });
        if (previewPayload?.html && previewPayload.elementMap) {
          setRenderResult(previewPayload.html, previewPayload.elementMap);
        }
        const nextOutline = buildOutlineFromDoc(parsed.doc);
        setOutline(nextOutline);
        setTemplateCatalog(buildTemplateCatalogFromDoc(parsed.doc));
        setWorkspaceDocument(options?.workspaceDocument ?? null);
        loadedWorkspaceKeyRef.current = options?.workspaceDocument
          ? `${options.workspaceDocument.tenantId}:${options.workspaceDocument.id}`
          : "";
        if (options?.workspaceDocument?.currentVersion?.download) {
          setDownload({
            blob: null,
            fileName: options.workspaceDocument.currentVersion.fileName,
            remoteUrl: options.workspaceDocument.currentVersion.download.downloadUrl,
            remoteExpiresAt: options.workspaceDocument.currentVersion.download.expiresAt,
            provider: options.workspaceDocument.currentVersion.blob.provider,
            blobId: options.workspaceDocument.currentVersion.blob.blobId,
          });
        }
        docRevisionRef.current = 0;
        lastAutoSavedRevisionRef.current = -1;

        if (recentKind) {
          const snapshotMeta = await saveRecentFileSnapshot({
            name: workingFile.name,
            blob: workingFile,
            kind: recentKind,
          });
          if (snapshotMeta) {
            await refreshRecentSnapshots(snapshotMeta.id);
          }
        }

        setStatus(
          parsed.integrityIssues.length
            ? `${
              sourceExt === "hwp" ? "HWP 변환 후 로드 완료" : "로드 완료"
            }: 세그먼트 ${parsed.segments.length}개 (경고 ${parsed.integrityIssues.length}개)`
            : `${sourceExt === "hwp" ? "HWP 변환 후 로드 완료" : "로드 완료"}: 세그먼트 ${parsed.segments.length}개`,
        );
        recordPilotMetricEvent("document_loaded", {
          format: ext || "unknown",
          segments: parsed.segments.length,
          integrityIssues: parsed.integrityIssues.length,
          source: recentKind ?? "recent",
        });

        // Phase 2-4: Auto-analyze document on upload
        fireDocumentAnalysis(parsed.segments);
        if (ext === "pptx") {
          void fireReportFamilyPlanning({
            fileName: workingFile.name,
            segments: parsed.segments,
            outlineItems: nextOutline,
          });
        }
      } catch (error) {
        setPreviewStatus("error");
        const message = error instanceof Error ? error.message : "문서 로드 실패";
        setStatus(message);
      } finally {
        setBusy(false);
      }
    },
    [
      setBusy,
      setPreviewStatus,
      setViewMode,
      setStatus,
      setRenderResult,
      setLoadedDocument,
      setOutline,
      setDownload,
      setTemplateCatalog,
      setWorkspaceDocument,
      refreshRecentSnapshots,
      fireDocumentAnalysis,
      fireReportFamilyPlanning,
    ],
  );

  const startDocumentFromTemplate = useCallback(
    async (template: DocumentTemplate | null) => {
      const actionLabel = template ? `"${template.name}" 템플릿` : "빈 문서";
      if (!confirmReplaceDocument(actionLabel)) {
        return;
      }

      openStartWizard(template ? "template" : "blank");
      clearWorkspaceContext();
      setBusy(true);
      setReportFamilyDraftState({ isLoading: false, error: null });
      setViewMode("editor");
      setPreviewStatus("unavailable");
      setStatus(
        template
          ? `${template.name} 템플릿으로 새 문서를 준비 중입니다...`
          : "빈 문서를 준비 중입니다...",
      );

      try {
        const doc: JSONContent = {
          type: "doc",
          content: template
            ? structuredClone(template.starterContent)
            : [{ type: "paragraph" }],
        };
        const templateResp = await fetch("/base.hwpx");
        if (!templateResp.ok) {
          throw new Error("기본 HWPX 템플릿을 불러오지 못했습니다.");
        }
        const templateBuffer = await templateResp.arrayBuffer();
        const hwpxDocumentModel = await buildHwpxModelFromDoc(templateBuffer, doc);
        const fileName = `${sanitizeTemplateFileName(template?.name || "새 문서")}.hwpx`;

        setLoadedDocument({
          fileName,
          buffer: templateBuffer,
          doc,
          segments: [],
          extraSegmentsMap: {},
          integrityIssues: [],
          complexObjectReport: null,
          hwpxDocumentModel,
        });
        setOutline(buildOutlineFromDoc(doc));
        setTemplateCatalog(buildTemplateCatalogFromDoc(doc));
        if (template) {
          setSelectedPreset(template.defaultPreset);
          const preset = INSTRUCTION_PRESETS.find((item) => item.key === template.defaultPreset);
          if (preset?.instruction) {
            setInstruction(preset.instruction);
          }
        } else {
          setSelectedPreset("custom");
        }
        docRevisionRef.current = 0;
        lastAutoSavedRevisionRef.current = -1;
        setStatus(
          template
            ? `템플릿으로 새 문서를 시작했습니다: ${template.name}`
            : "빈 문서를 시작했습니다.",
        );
      } catch (error) {
        setPreviewStatus("error");
        const message = error instanceof Error ? error.message : "새 문서 생성 실패";
        setStatus(message);
      } finally {
        setBusy(false);
      }
    },
    [
      clearWorkspaceContext,
      confirmReplaceDocument,
      openStartWizard,
      setBusy,
      setLoadedDocument,
      setOutline,
      setInstruction,
      setPreviewStatus,
      setSelectedPreset,
      setStatus,
      setTemplateCatalog,
      setViewMode,
    ],
  );

  useEffect(() => {
    const queryKey = `${onboardingMode}|${templateIdQuery}`;
    if (!queryKey.replace("|", "") || handledStartQueryRef.current === queryKey) {
      return;
    }
    handledStartQueryRef.current = queryKey;

    if (templateIdQuery) {
      const template = DOCUMENT_TEMPLATES.find((item) => item.id === templateIdQuery);
      if (template) {
        void startDocumentFromTemplate(template);
      } else {
        setStatus("선택한 템플릿을 찾지 못했습니다.");
        openStartWizard("template");
      }
      router.replace("/");
      return;
    }

    if (onboardingMode === "template") {
      openStartWizard("template");
      router.replace("/");
    }
  }, [
    onboardingMode,
    openStartWizard,
    router,
    setStatus,
    startDocumentFromTemplate,
    templateIdQuery,
  ]);

  // ── Wizard draft handoff ──
  useEffect(() => {
    const raw = sessionStorage.getItem("pendingWizardDraft");
    if (!raw) return;
    sessionStorage.removeItem("pendingWizardDraft");

    interface WizardFormatSettings { h1FontSize?: number; h2FontSize?: number; bodyFontSize?: number }
    interface WizardPending { draft: ReportFamilyDraft; fileName?: string; formatSettings?: WizardFormatSettings }
    let pending: WizardPending | null = null;
    try {
      pending = JSON.parse(raw) as WizardPending;
    } catch {
      return;
    }
    if (!pending?.draft) return;

    /** doc JSON의 텍스트 노드에 fontSize textStyle 마크를 재귀 주입 */
    const injectFontSizes = (
      node: import("@tiptap/core").JSONContent,
      fmt: WizardFormatSettings,
    ): import("@tiptap/core").JSONContent => {
      const stamp = (n: import("@tiptap/core").JSONContent, pt: number) => {
        if (n.type !== "text" || !pt) return n;
        const marks = (n.marks ?? []).filter((m) => m.type !== "textStyle");
        return { ...n, marks: [...marks, { type: "textStyle", attrs: { fontSize: `${pt}pt` } }] };
      };
      if (node.type === "heading") {
        const lvl = (node.attrs as { level?: number } | undefined)?.level ?? 1;
        const pt = lvl === 1 ? (fmt.h1FontSize ?? 0) : (fmt.h2FontSize ?? 0);
        return { ...node, content: (node.content ?? []).map((c) => stamp(c, pt)) };
      }
      if (node.type === "paragraph") {
        const pt = fmt.bodyFontSize ?? 0;
        return { ...node, content: (node.content ?? []).map((c) => stamp(c, pt)) };
      }
      if (node.content) {
        return { ...node, content: node.content.map((c) => injectFontSizes(c, fmt)) };
      }
      return node;
    };

    const loadWizardDraft = async () => {
      setStatus("마법사에서 생성된 초안을 불러오는 중…");
      try {
        const rawArtifacts = buildReportFamilyDraftEditorArtifacts(pending!.draft);
        const fmt = pending!.formatSettings ?? {};
        const artifacts = {
          ...rawArtifacts,
          doc: (fmt.h1FontSize || fmt.h2FontSize || fmt.bodyFontSize)
            ? injectFontSizes(rawArtifacts.doc, fmt)
            : rawArtifacts.doc,
        };
        const templateResp = await fetch("/base.hwpx");
        if (!templateResp.ok) throw new Error("기본 HWPX 템플릿을 불러오지 못했습니다.");
        const templateBuffer = await templateResp.arrayBuffer();
        const hwpxDocumentModel = await buildHwpxModelFromDoc(templateBuffer, artifacts.doc);
        const stem = (pending!.fileName ?? pending!.draft.familyName).replace(/\s+/g, "-");
        setLoadedDocument({
          fileName: `${stem}-draft.hwpx`,
          buffer: templateBuffer,
          doc: artifacts.doc,
          segments: artifacts.segments,
          extraSegmentsMap: {},
          integrityIssues: [],
          complexObjectReport: null,
          hwpxDocumentModel,
        });
        setOutline(buildOutlineFromDoc(artifacts.doc));
        setTemplateCatalog(buildTemplateCatalogFromDoc(artifacts.doc));
        setSelectedPreset("custom");
        setPreviewStatus("unavailable");
        setStatus(`"${pending!.draft.familyName}" 초안 로드 완료`);
      } catch (err) {
        setStatus(`초안 로드 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
      }
    };
    void loadWizardDraft();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openWorkspaceDocument = useCallback(async (documentId: string) => {
    if (!authSession?.activeTenant || !documentId) {
      return;
    }
    setStatus("저장된 문서를 불러오는 중입니다...");
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as WorkspaceDocumentApiResponse;
      if (!response.ok || !payload.document) {
        throw new Error(payload.error || "문서를 불러오지 못했습니다.");
      }
      const currentVersion = payload.document.currentVersion;
      if (!currentVersion?.download) {
        throw new Error("문서의 최신 저장본을 찾지 못했습니다.");
      }
      const fileResponse = await fetch(currentVersion.download.downloadUrl, {
        method: "GET",
        cache: "no-store",
      });
      if (!fileResponse.ok) {
        throw new Error("저장된 HWPX 파일을 가져오지 못했습니다.");
      }
      const blob = await fileResponse.blob();
      const file = new File([blob], currentVersion.fileName, {
        type: currentVersion.blob.contentType || blob.type || "application/octet-stream",
        lastModified: Date.now(),
      });
      await loadFileIntoEditor(file, null, { workspaceDocument: payload.document });
      setStatus(`저장된 문서를 열었습니다: ${payload.document.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "문서 로드 실패";
      setStatus(message);
    }
  }, [authSession, loadFileIntoEditor, setStatus]);

  useEffect(() => {
    const tenantId = authSession?.activeTenant?.tenantId || "";
    if (!tenantId || !workspaceDocumentId) {
      return;
    }
    const nextKey = `${tenantId}:${workspaceDocumentId}`;
    if (loadedWorkspaceKeyRef.current === nextKey) {
      return;
    }
    void openWorkspaceDocument(workspaceDocumentId);
  }, [authSession, openWorkspaceDocument, workspaceDocumentId]);

  const onPickFile = async (file: File) => {
    if (!confirmReplaceDocument("새 파일")) {
      return;
    }
    openStartWizard("upload");
    clearWorkspaceContext();
    await loadFileIntoEditor(file, "opened");
  };

  const onLoadRecentSnapshot = async (snapshotId: string) => {
    if (!snapshotId) {
      setStatus("최근 파일을 먼저 선택하세요.");
      return;
    }
    if (!confirmReplaceDocument("최근 문서")) {
      return;
    }
    openStartWizard("recent");
    setStatus("최근 파일을 불러오는 중입니다...");
    try {
      const snapshot = await loadRecentFileSnapshot(snapshotId);
      if (!snapshot) {
        setStatus("선택한 최근 파일을 찾지 못했습니다.");
        await refreshRecentSnapshots();
        return;
      }
      const file = new File([snapshot.blob], snapshot.meta.name, {
        type: snapshot.meta.mimeType || "application/octet-stream",
      });
      clearWorkspaceContext();
      await loadFileIntoEditor(file, null);
      setSelectedRecentSnapshotId(snapshotId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "최근 파일 로드 실패";
      setStatus(message);
    }
  };

  const onEditorUpdateDoc = (doc: Parameters<typeof setEditorDoc>[0]) => {
    docRevisionRef.current += 1;
    setEditorDoc(doc);
    setOutline(buildOutlineFromDoc(doc));
    setTemplateCatalog(buildTemplateCatalogFromDoc(doc));
    const next = collectDocumentEdits(doc, sourceSegments, extraSegmentsMap);
    setEditsPreview(next.edits);
    // exportWarnings는 내보내기 시에만 갱신 (편집 중 배너 노출 방지)
  };

  const onGenerateSuggestion = async () => {
    const text = selection.selectedText.trim();
    if (!text) {
      setStatus("먼저 에디터에서 수정할 텍스트를 선택하세요.");
      return;
    }
    setAiBusy(true);
    setActiveSidebarTab("ai");
    setVerificationResult(null);
    setSingleSuggestionQualityGate(null);
    setSingleSuggestionApproved(false);
    setStatus("AI 제안을 생성 중입니다...");
    try {
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          instruction,
          planContext: selectedReportFamilyPlanContext || undefined,
          model: undefined,
        }),
      });
      const payload = (await response.json()) as { suggestion?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "AI 제안 생성 실패");
      }
      const suggestionText = payload.suggestion || "";
      const qualityGate = evaluateQualityGate({
        originalText: text,
        suggestion: suggestionText,
      });
      setAiSuggestion(suggestionText);
      setSingleSuggestionQualityGate(qualityGate);
      setSingleSuggestionApproved(!qualityGate.requiresApproval);
      recordPilotMetricEvent("single_suggestion_generated", {
        selectedTextLength: text.length,
        suggestionLength: suggestionText.length,
        requiresApproval: qualityGate.requiresApproval,
        issueCount: qualityGate.issues.length,
      });
      if (qualityGate.requiresApproval) {
        recordPilotMetricEvent("quality_gate_blocked", {
          source: "single",
          count: 1,
          issueCount: qualityGate.issues.length,
        });
      }
      setStatus(
        qualityGate.requiresApproval
          ? `AI 제안 생성 완료: 게이트 승인 필요 (${qualityGate.issues.length}건)`
          : "AI 제안이 생성되었습니다.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 제안 실패";
      setStatus(message);
    } finally {
      setAiBusy(false);
    }
  };

  const onApplySuggestion = () => {
    if (!editor) {
      setStatus("에디터가 아직 준비되지 않았습니다.");
      return;
    }
    if (!aiSuggestion.trim()) {
      setStatus("적용할 AI 제안이 없습니다.");
      return;
    }
    if (singleSuggestionQualityGate?.requiresApproval && !singleSuggestionApproved) {
      setStatus("품질 게이트 승인 후에만 적용할 수 있습니다.");
      return;
    }
    const hasSelection = editor.state.selection.from !== editor.state.selection.to;
    if (hasSelection) {
      editor.chain().focus().insertContent(aiSuggestion).run();
      recordPilotMetricEvent("single_suggestion_applied", {
        mode: "selection",
        count: 1,
        textLength: aiSuggestion.length,
      });
      setStatus("선택 영역에 AI 제안을 적용했습니다.");
      return;
    }
    const segmentId = selection.selectedSegmentId;
    if (!segmentId) {
      setStatus("선택된 문단이 없습니다.");
      return;
    }
    const replaced = replaceSegmentText(editor, segmentId, aiSuggestion);
    if (replaced) {
      recordPilotMetricEvent("single_suggestion_applied", {
        mode: "segment",
        count: 1,
        textLength: aiSuggestion.length,
      });
    }
    setStatus(replaced ? "문단 전체에 AI 제안을 적용했습니다." : "대상 문단을 찾지 못했습니다.");
  };

  const onApproveSingleSuggestion = () => {
    if (!singleSuggestionQualityGate?.requiresApproval) {
      setStatus("승인이 필요한 제안이 아닙니다.");
      return;
    }
    setSingleSuggestionApproved(true);
    recordPilotMetricEvent("quality_gate_approved", {
      source: "single",
      count: 1,
    });
    setStatus("단일 AI 제안이 승인되었습니다.");
  };

  const runHwpxExport = useCallback(
    async (params: {
      kind: Exclude<RecentFileKind, "opened">;
      fileLabel: string;
      triggerDownload: boolean;
      markClean: boolean;
      overrideFileName?: string;
    }) => {
      if (!sourceBuffer || !editorDoc) {
        throw new Error("먼저 문서 파일을 업로드하세요.");
      }
      if (!hwpxDocumentModel) {
        throw new Error("현재는 HWPX 원본 문서만 HWPX 저장/자동저장을 지원합니다.");
      }

      const result = await applyProseMirrorDocToHwpx(sourceBuffer, editorDoc, sourceSegments, extraSegmentsMap, hwpxDocumentModel);
      const combinedWarnings = Array.from(
        new Set([...(complexObjectReport?.warnings ?? []), ...result.warnings]),
      ).filter((w) => !w.includes("HWPX-CHARPR-MISSING"));
      setEditsPreview(result.edits);
      setExportWarnings(Array.from(new Set([...combinedWarnings, ...templateValidationWarnings])));
      if (result.integrityIssues.length) {
        throw new Error(`무결성 경고 ${result.integrityIssues.join(" | ")}`);
      }

      const nextName = params.overrideFileName ?? createUniqueHwpxFileName(fileName || "document.hwpx", params.fileLabel);
      let remoteDownload:
        | {
            blobId: string;
            provider: string;
            fileName: string;
            contentType: string;
            byteLength: number;
            createdAt: string;
            downloadUrl: string;
            expiresAt: string;
          }
        | null = null;
      let remoteUploadWarning: string | null = null;

      try {
        const uploaded = await uploadBlobForSignedDownload(result.blob, nextName);
        remoteDownload = {
          blobId: uploaded.blobId,
          provider: uploaded.provider,
          fileName: uploaded.fileName,
          contentType: uploaded.contentType,
          byteLength: uploaded.byteLength,
          createdAt: uploaded.createdAt,
          downloadUrl: uploaded.downloadUrl,
          expiresAt: uploaded.expiresAt,
        };
      } catch (error) {
        remoteUploadWarning =
          error instanceof Error ? error.message : "외부 저장소 업로드에 실패했습니다.";
      }

      setDownload({
        blob: result.blob,
        fileName: nextName,
        remoteUrl: remoteDownload?.downloadUrl ?? null,
        remoteExpiresAt: remoteDownload?.expiresAt ?? null,
        provider: remoteDownload?.provider ?? null,
        blobId: remoteDownload?.blobId ?? null,
      });

      if (params.triggerDownload) {
        triggerBrowserDownload(result.blob, nextName);
      }

      if (params.markClean) {
        setDirty(false);
      }

      lastAutoSavedRevisionRef.current = docRevisionRef.current;

      try {
        const snapshotMeta = await saveRecentFileSnapshot({
          name: nextName,
          blob: result.blob,
          kind: params.kind,
        });
        if (snapshotMeta) {
          await refreshRecentSnapshots(snapshotMeta.id);
        }
      } catch {
        // IndexedDB unavailable or blocked
      }

      return {
        edits: result.edits.length,
        fileName: nextName,
        warnings: combinedWarnings,
        storage: remoteDownload,
        storageWarning: remoteUploadWarning,
      };
    },
    [
      sourceBuffer,
      editorDoc,
      sourceSegments,
      extraSegmentsMap,
      hwpxDocumentModel,
      complexObjectReport,
      fileName,
      setEditsPreview,
      setExportWarnings,
      setDownload,
      setDirty,
      refreshRecentSnapshots,
      templateValidationWarnings,
    ],
  );

  const persistWorkspaceExport = useCallback(async (params: {
    fileName: string;
    label: string;
    storage:
      | (WorkspaceBlobReference & {
          downloadUrl: string;
          expiresAt: string;
        })
      | null;
    warnings: string[];
  }): Promise<{ document: WorkspaceDocumentDetail | null; warning?: string }> => {
    if (!authSession?.activeTenant) {
      return { document: null, warning: "활성 세션이 없어 문서함 저장을 생략했습니다." };
    }
    if (!editorDoc) {
      return { document: null, warning: "현재 문서 스냅샷이 없어 문서함 저장을 생략했습니다." };
    }
    if (!params.storage) {
      return { document: null, warning: "외부 저장소 업로드가 없어 문서함 저장을 생략했습니다." };
    }

    const payload = {
      title: workspaceDocument?.title || toFileStem(params.fileName),
      label: params.label,
      fileName: params.fileName,
      sourceFormat: inferWorkspaceSourceFormat(fileName || params.fileName),
      editorDoc,
      templateCatalog,
      validationSummary: buildWorkspaceValidationSummary([], params.warnings),
      blob: params.storage,
    };

    if (workspaceDocument?.id) {
      const versionResponse = await fetch(`/api/documents/${workspaceDocument.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const versionPayload = (await versionResponse.json().catch(() => ({}))) as { error?: string };
      if (!versionResponse.ok) {
        throw new Error(versionPayload.error || "문서 버전 저장 실패");
      }

      const detailResponse = await fetch(`/api/documents/${workspaceDocument.id}`, {
        method: "GET",
        cache: "no-store",
      });
      const detailPayload = (await detailResponse.json().catch(() => ({}))) as WorkspaceDocumentApiResponse;
      if (!detailResponse.ok || !detailPayload.document) {
        throw new Error(detailPayload.error || "문서 최신 상태 조회 실패");
      }
      setWorkspaceDocument(detailPayload.document);
      loadedWorkspaceKeyRef.current = `${detailPayload.document.tenantId}:${detailPayload.document.id}`;
      return { document: detailPayload.document };
    }

    const createResponse = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const createPayload = (await createResponse.json().catch(() => ({}))) as WorkspaceDocumentApiResponse;
    if (!createResponse.ok || !createPayload.document) {
      throw new Error(createPayload.error || "문서 생성 실패");
    }
    setWorkspaceDocument(createPayload.document);
    loadedWorkspaceKeyRef.current = `${createPayload.document.tenantId}:${createPayload.document.id}`;
    router.replace(`/?documentId=${createPayload.document.id}`);
    return { document: createPayload.document };
  }, [authSession, editorDoc, fileName, router, templateCatalog, workspaceDocument]);

  // 다른 이름으로 저장 다이얼로그 열기
  const onSave = () => setSaveDialogOpen(true);
  const onExport = () => setSaveDialogOpen(true);

  // 다이얼로그 확인 시 실제 저장 실행
  const onConfirmSave = async (customFileName: string) => {
    setSaveDialogOpen(false);
    setBusy(true);
    setStatus("저장 중입니다...");
    try {
      const result = await runHwpxExport({
        kind: "manual-save",
        fileLabel: "saved",
        triggerDownload: true,
        markClean: true,
        overrideFileName: customFileName,
      });
      const persisted = await persistWorkspaceExport({
        fileName: result.fileName,
        label: "manual-save",
        storage: result.storage,
        warnings: result.warnings,
      });
      pushHistory(`저장 완료 (${result.edits}건)`, result.edits);
      if (result.storage) {
        setStatus(
          persisted.warning
            ? `저장 완료: ${result.fileName} (외부저장 ${result.storage.provider}, ${persisted.warning})`
            : `저장 완료: ${result.fileName} (문서함 연동 완료, 외부저장 ${result.storage.provider}, 서명 URL 만료 ${new Date(result.storage.expiresAt).toLocaleTimeString("ko-KR")})`,
        );
      } else if (result.storageWarning) {
        setStatus(`저장 완료: ${result.fileName} (${result.storageWarning})`);
      } else {
        setStatus(`저장 완료: ${result.fileName}`);
      }
      recordPilotMetricEvent("manual_save_completed", {
        count: 1,
        edits: result.edits,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "저장 실패";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  };

  const onAutoSave = useCallback(async () => {
    if (autoSaveInFlightRef.current) {
      return;
    }
    if (!editorDoc || !sourceBuffer || !hwpxDocumentModel || !isDirty || isBusy || aiBusy) {
      return;
    }
    if (docRevisionRef.current === lastAutoSavedRevisionRef.current) {
      return;
    }

    autoSaveInFlightRef.current = true;
    try {
      const result = await runHwpxExport({
        kind: "auto-save",
        fileLabel: "autosave",
        triggerDownload: false,
        markClean: false,
      });
      const persisted = await persistWorkspaceExport({
        fileName: result.fileName,
        label: "auto-save",
        storage: result.storage,
        warnings: result.warnings,
      });
      if (result.storage) {
        setStatus(
          persisted.warning
            ? `자동 저장 완료: ${result.fileName} (${persisted.warning})`
            : `자동 저장 완료: ${result.fileName} (문서함 버전 저장 + 외부저장 ${result.storage.provider})`,
        );
      } else if (result.storageWarning) {
        setStatus(`자동 저장 완료: ${result.fileName} (${result.storageWarning})`);
      } else {
        setStatus(`자동 저장 완료: ${result.fileName}`);
      }
      recordPilotMetricEvent("autosave_completed", {
        count: 1,
        edits: result.edits,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "자동 저장 실패";
      setStatus(`자동 저장 실패: ${message}`);
    } finally {
      autoSaveInFlightRef.current = false;
    }
  }, [editorDoc, sourceBuffer, hwpxDocumentModel, isDirty, isBusy, aiBusy, persistWorkspaceExport, runHwpxExport, setStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void onAutoSave();
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [onAutoSave]);

  const onSelectOutlineSegment = (segmentId: string) => {
    if (!editor) {
      setStatus("에디터가 아직 준비되지 않았습니다.");
      return;
    }
    const moved = focusSegment(editor, segmentId);
    if (!moved) {
      setStatus("개요 항목과 연결된 문단을 찾지 못했습니다.");
      return;
    }
    setStatus("개요에서 문단으로 이동했습니다.");
  };

  /* ── Phase 2-7: Progressive batch suggestions ── */
  const onGenerateBatchSuggestions = async () => {
    if (!editorDoc) {
      setStatus("먼저 문서를 업로드하세요.");
      return;
    }
    if (!batchItems.length) {
      setStatus("일괄 수정할 섹션 텍스트가 없습니다.");
      return;
    }

    setAiBusy(true);
    setActiveSidebarTab("ai");
    clearBatchDecisions();
    setBatchSuggestions([]);
    setBatchJob(null);
    const requestedBatchItems = [...batchItemsWithPlanContext];
    let createdJobId: string | null = null;
    let batchFailureTracked = false;

    try {
      const createResponse = await fetch("/api/batch-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: requestedBatchItems,
          instruction,
          model: undefined,
        }),
      });
      const createdPayload = (await createResponse.json()) as BatchJobPayload;
      if (!createResponse.ok || !createdPayload.job) {
        throw new Error(createdPayload.error || "AI 일괄 작업 생성 실패");
      }

      setBatchJob({
        id: createdPayload.job.id,
        status: createdPayload.job.status,
        completedChunks: createdPayload.job.completedChunks,
        totalChunks: createdPayload.job.totalChunks,
        resultCount: createdPayload.job.resultCount,
        itemCount: createdPayload.job.itemCount,
        error: createdPayload.job.error,
      });
      createdJobId = createdPayload.job.id;
      recordPilotMetricEvent("batch_job_created", {
        count: 1,
        jobId: createdPayload.job.id,
        itemCount: createdPayload.job.itemCount,
        totalChunks: createdPayload.job.totalChunks,
      });
      setStatus(`AI 일괄 작업 생성됨... (0/${createdPayload.job.totalChunks})`);

      while (true) {
        await sleep(800);
        const response = await fetch(`/api/batch-jobs/${createdPayload.job.id}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as BatchJobPayload;
        if (!response.ok) {
          throw new Error(payload.error || "AI 일괄 작업 조회 실패");
        }
        const job = payload.job;
        if (!job) {
          throw new Error("배치 작업 상태가 비어 있습니다.");
        }

        setBatchJob({
          id: job.id,
          status: job.status,
          completedChunks: job.completedChunks,
          totalChunks: job.totalChunks,
          resultCount: job.resultCount,
          itemCount: job.itemCount,
          error: job.error,
        });
        setBatchSuggestions(job.results);

        if (job.status === "failed") {
          recordPilotMetricEvent("batch_job_failed", {
            count: 1,
            jobId: job.id,
            error: job.error,
          });
          batchFailureTracked = true;
          throw new Error(job.error || "AI 일괄 작업 실패");
        }
        if (job.status === "completed") {
          const nextPlan = buildBatchApplyPlan(requestedBatchItems, job.results);
          const changedCount = nextPlan.filter((row) => row.changed).length;
          const gatedCount = job.results.filter((row) => row.qualityGate.requiresApproval).length;
          recordPilotMetricEvent("batch_job_completed", {
            count: 1,
            jobId: job.id,
            resultCount: job.results.length,
            changedCount,
            gatedCount,
          });
          if (gatedCount) {
            recordPilotMetricEvent("quality_gate_blocked", {
              source: "batch",
              count: gatedCount,
              jobId: job.id,
            });
          }
          setStatus(
            gatedCount
              ? `AI 섹션 일괄 제안 완료: 변경 ${changedCount}개 / 승인 필요 ${gatedCount}개`
              : `AI 섹션 일괄 제안 완료: 대상 ${nextPlan.length}개 중 변경 ${changedCount}개`,
          );
          break;
        }

        setStatus(`AI 생성 작업 진행 중... (${job.completedChunks}/${job.totalChunks})`);
      }
    } catch (error) {
      if (createdJobId && !batchFailureTracked) {
        recordPilotMetricEvent("batch_job_failed", {
          count: 1,
          jobId: createdJobId,
          error: error instanceof Error ? error.message : "AI 일괄 제안 실패",
        });
      }
      const message = error instanceof Error ? error.message : "AI 일괄 제안 실패";
      setStatus(message);
    } finally {
      setAiBusy(false);
    }
  };

  const onApplyBatchSuggestions = () => {
    if (!editor) {
      setStatus("에디터가 아직 준비되지 않았습니다.");
      return;
    }
    if (!batchSuggestions.length) {
      setStatus("적용할 일괄 AI 제안이 없습니다.");
      return;
    }
    const gateById = new Map(batchSuggestions.map((item) => [item.id, item.qualityGate]));
    const approvedIds = new Set(
      Object.entries(batchDecisions)
        .filter(([, decision]) => decision === "accepted")
        .map(([id]) => id),
    );
    const changedPlan = buildBatchApplyPlan(batchItemsWithPlanContext, batchSuggestions).filter((item) => item.changed);
    const plan = changedPlan.filter((item) => {
      const gate = gateById.get(item.id);
      return !gate?.requiresApproval || approvedIds.has(item.id);
    });
    const blockedCount = changedPlan.length - plan.length;
    const approvedRiskCount = changedPlan.filter((item) => {
      const gate = gateById.get(item.id);
      return !!gate?.requiresApproval && approvedIds.has(item.id);
    }).length;
    if (!plan.length) {
      setStatus("승인되지 않은 위험 항목만 남아 있어 전체 적용할 수 없습니다.");
      return;
    }
    const appliedCount = applyBatchSegmentTexts(
      editor,
      plan.map((item) => ({
        segmentId: item.id,
        text: item.suggestion,
      })),
    );
    if (!appliedCount) {
      setStatus("적용 가능한 변경이 없습니다.");
      return;
    }
    setBatchSuggestions([]);
    clearBatchDecisions();
    setBatchJob(null);
    pushHistory(`AI 섹션 일괄 적용 (${appliedCount}건)`, appliedCount);
    recordPilotMetricEvent("batch_suggestion_applied", {
      mode: "all",
      count: appliedCount,
      blockedCount,
      approvedRiskCount,
    });
    if (approvedRiskCount) {
      recordPilotMetricEvent("quality_gate_approved", {
        source: "batch",
        count: approvedRiskCount,
      });
    }
    setStatus(
      blockedCount
        ? `AI 섹션 일괄 적용 완료: ${appliedCount}건 적용 / ${blockedCount}건은 승인 필요로 보류`
        : `AI 섹션 일괄 적용 완료: ${appliedCount}건`,
    );
  };

  /* ── Phase 2-1: Apply only accepted batch suggestions ── */
  const onApplySelectedBatchSuggestions = () => {
    if (!editor) {
      setStatus("에디터가 아직 준비되지 않았습니다.");
      return;
    }
    const acceptedIds = new Set(
      Object.entries(batchDecisions)
        .filter(([, decision]) => decision === "accepted")
        .map(([id]) => id),
    );
    if (!acceptedIds.size) {
      setStatus("수락된 항목이 없습니다.");
      return;
    }
    const plan = buildBatchApplyPlan(batchItemsWithPlanContext, batchSuggestions)
      .filter((item) => item.changed && acceptedIds.has(item.id));
    const approvedRiskCount = plan.filter((item) =>
      batchSuggestions.find((suggestion) => suggestion.id === item.id)?.qualityGate.requiresApproval,
    ).length;
    const appliedCount = applyBatchSegmentTexts(
      editor,
      plan.map((item) => ({
        segmentId: item.id,
        text: item.suggestion,
      })),
    );
    if (!appliedCount) {
      setStatus("적용 가능한 변경이 없습니다.");
      return;
    }
    setBatchSuggestions([]);
    clearBatchDecisions();
    setBatchJob(null);
    pushHistory(`AI 선택 적용 (${appliedCount}건)`, appliedCount);
    recordPilotMetricEvent("batch_suggestion_applied", {
      mode: "selected",
      count: appliedCount,
      approvedRiskCount,
    });
    if (approvedRiskCount) {
      recordPilotMetricEvent("quality_gate_approved", {
        source: "batch",
        count: approvedRiskCount,
      });
    }
    setStatus(`AI 선택 적용 완료: ${appliedCount}건`);
  };

  /* ── Phase 2-6: Verify AI suggestion ── */
  const onVerifySuggestion = async () => {
    const text = selection.selectedText.trim();
    if (!text || !aiSuggestion.trim()) {
      setStatus("검증할 원문과 AI 제안이 필요합니다.");
      return;
    }
    setVerificationLoading(true);
    setVerificationResult(null);
    try {
      const resp = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalText: text,
          modifiedText: aiSuggestion,
          instruction,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "검증 실패");
      }
      setVerificationResult(data);
      setStatus(data.passed ? "검증 통과" : `검증 이슈 ${data.issues?.length || 0}건`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "검증 실패";
      setStatus(message);
    } finally {
      setVerificationLoading(false);
    }
  };

  /* ── Phase 2-5: Apply terminology replacements ── */
  const onApplyTerminology = () => {
    if (!editor) {
      setStatus("에디터가 아직 준비되지 않았습니다.");
      return;
    }
    const entries = Object.entries(terminologyDict);
    if (!entries.length) {
      setStatus("용어 사전이 비어 있습니다.");
      return;
    }

    let totalReplaced = 0;
    let tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return true;
      let text = node.text;
      let modified = false;
      for (const [variant, canonical] of entries) {
        if (text.includes(variant)) {
          text = text.split(variant).join(canonical);
          modified = true;
        }
      }
      if (modified) {
        const from = pos;
        const to = pos + node.nodeSize;
        tr = tr.replaceWith(from, to, editor.schema.text(text, node.marks));
        totalReplaced++;
      }
      return true;
    });
    if (tr.docChanged) {
      editor.view.dispatch(tr.scrollIntoView());
      pushHistory(`용어 일괄 치환 (${totalReplaced}건)`, totalReplaced);
      setStatus(`용어 일괄 치환 완료: ${totalReplaced}건`);
    } else {
      setStatus("치환할 용어가 문서에 없습니다.");
    }
  };

  /* ── Phase 2-3: Preset selection ── */
  const onSelectPreset = (key: PresetKey) => {
    setSelectedPreset(key);
    const preset = INSTRUCTION_PRESETS.find((p) => p.key === key);
    if (preset && preset.instruction) {
      setInstruction(preset.instruction);
    }
  };

  /* ── Chat agent: build DocumentContext for API ── */
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
        // 표 내부도 계속 탐색 (표 안의 단락도 segments에 포함)
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

  /* ── Chat agent: build EditPreview from a write tool call ── */
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

  /* ── Chat agent: patch write tool into messages (API 400 bug fix) ── */
  function patchWriteToolIntoMessages(
    messages: ChatMessageAPI[],
    toolCall: ToolCallInfo,
    resultContent: string,
  ): ChatMessageAPI[] {
    const result = [...messages];

    // 마지막 assistant 메시지에 write_tool_use 주입
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

    // write_tool_result를 바로 다음 user 메시지에 추가 (없으면 새로 생성)
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

  /* ── Chat agent: convert UI messages to API format ── */
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

  /* ── Chat agent: send message ── */
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
      // read 툴 자동 실행 후 assistant가 tool_results user 메시지를 남긴 경우,
      // 새 user 텍스트를 별도 push하면 user→user 연속이 되어 API 400 발생.
      // → 마지막 user 메시지에 tool_result가 있으면 텍스트를 그 안에 합친다.
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
        await streamChat(
          {
            messages: apiMessages,
            documentContext: buildDocumentContext(),
          },
          {
            onTextDelta: (delta) => {
              updateLastAssistantMessage((prev) => prev + delta);
            },
            onToolCall: (tc) => {
              appendToolCallToLastMessage(tc);
            },
            onToolResult: (tr) => {
              appendToolResultToLastMessage(tr);
            },
            onToolPending: (tc) => {
              const preview = buildEditPreview(tc);
              setPendingToolCall({ toolCall: tc, preview });
            },
            onDone: () => {
              finalizeLastAssistantMessage();
              setChatBusy(false);
            },
            onError: (msg) => {
              updateLastAssistantMessage((prev) =>
                prev + (prev ? "\n" : "") + `오류: ${msg}`,
              );
              finalizeLastAssistantMessage();
              setChatBusy(false);
            },
          },
        );
      } catch (err) {
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
      appendToolCallToLastMessage,
      appendToolResultToLastMessage,
      setPendingToolCall,
      buildApiMessages,
      buildDocumentContext,
      buildEditPreview,
    ],
  );

  /* ── Chat agent: approve pending tool ── */
  const onApproveToolCall = useCallback(() => {
    if (!pendingToolCall || !editor) return;
    const { toolCall } = pendingToolCall;
    let resultMsg = "적용 완료";

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
      pushHistory(`AI 채팅 일괄 수정 (${count}건)`, count);
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
      resultMsg = `${totalReplacedSegments}개 세그먼트 치환 완료 (${totalMatched}회 일치)`;
      pushHistory(`AI 채팅 찾아바꾸기 (${totalReplacedSegments}건)`, totalReplacedSegments);
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
      pushHistory(`AI 표 채우기 (${ftInput.rows.length}행)`, ftInput.rows.length);
    }

    setPendingToolCall(null);

    // Continue the conversation with the tool result (patchWriteToolIntoMessages fixes API 400)
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
      },
      {
        onTextDelta: (delta) => {
          updateLastAssistantMessage((prev) => prev + delta);
        },
        onToolCall: (tc) => {
          appendToolCallToLastMessage(tc);
        },
        onToolResult: (tr) => {
          appendToolResultToLastMessage(tr);
        },
        onToolPending: (tc) => {
          const preview = buildEditPreview(tc);
          setPendingToolCall({ toolCall: tc, preview });
        },
        onDone: () => {
          finalizeLastAssistantMessage();
          setChatBusy(false);
        },
        onError: (msg) => {
          updateLastAssistantMessage((prev) =>
            prev + (prev ? "\n" : "") + `오류: ${msg}`,
          );
          finalizeLastAssistantMessage();
          setChatBusy(false);
        },
      },
    ).catch(() => {
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
  ]);

  /* ── Chat agent: reject pending tool ── */
  const onRejectToolCall = useCallback(() => {
    if (!pendingToolCall) return;
    const { toolCall } = pendingToolCall;
    setPendingToolCall(null);

    // Continue conversation telling the agent the tool was rejected
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
      },
      {
        onTextDelta: (delta) => {
          updateLastAssistantMessage((prev) => prev + delta);
        },
        onToolCall: (tc) => {
          appendToolCallToLastMessage(tc);
        },
        onToolResult: (tr) => {
          appendToolResultToLastMessage(tr);
        },
        onToolPending: (tc) => {
          const preview = buildEditPreview(tc);
          setPendingToolCall({ toolCall: tc, preview });
        },
        onDone: () => {
          finalizeLastAssistantMessage();
          setChatBusy(false);
        },
        onError: (msg) => {
          updateLastAssistantMessage((prev) =>
            prev + (prev ? "\n" : "") + `오류: ${msg}`,
          );
          finalizeLastAssistantMessage();
          setChatBusy(false);
        },
      },
    ).catch(() => {
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

  return (
    <div className={styles.page}>
      {/* ── HWP-style 통합 툴바 ── */}
      <EditorToolbar
        editor={editor}
        sidebarCollapsed={sidebarCollapsed}
        activeSidebarTab={activeSidebarTab}
        disabled={isBusy}
        hasDocument={!!editorDoc}
        downloadUrl={downloadUrl}
        downloadName={download.fileName}
        onSetSidebarTab={handleSetSidebarTab}
        onAiCommand={() => {
          setActiveSidebarTab("ai");
          void onGenerateSuggestion();
        }}
        recentSnapshots={recentSnapshots}
        selectedRecentSnapshotId={selectedRecentSnapshotId}
        onSelectRecentSnapshot={setSelectedRecentSnapshotId}
        onLoadRecentSnapshot={onLoadRecentSnapshot}
        onPickFile={onPickFile}
        onOpenStartWizard={() => openStartWizard(null)}
        onExport={onExport}
        onExportPdf={() => {
          const editorWrap = document.querySelector(".document-editor-wrap");
          if (!editorWrap) {
            setStatus("에디터를 찾을 수 없습니다.");
            return;
          }
          try {
            exportToPdf(editorWrap as HTMLElement, fileName || "document");
            recordPilotMetricEvent("pdf_export_completed", {
              count: 1,
              fileName: fileName || "document",
            });
            setStatus(`PDF 내보내기 창을 열었습니다: ${fileName || "document"}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : "PDF 내보내기 실패";
            setStatus(message);
          }
        }}
        onExportMarkdown={() => {
          if (!editorDoc) {
            setStatus("먼저 문서를 업로드하세요.");
            return;
          }
          try {
            exportToMarkdown(editorDoc, fileName || "document");
            setStatus(`마크다운 내보내기 완료`);
          } catch (error) {
            setStatus(`마크다운 내보내기 실패: ${error instanceof Error ? error.message : "오류"}`);
          }
        }}
        onExportDocx={async () => {
          if (!editorDoc) {
            setStatus("먼저 문서를 업로드하세요.");
            return;
          }
          setBusy(true);
          setStatus("DOCX 파일을 생성하고 있습니다...");
          try {
            const result = await exportToDocx(editorDoc, fileName || "document");
            setDownload({
              blob: result.blob,
              fileName: result.fileName,
              remoteUrl: null,
              remoteExpiresAt: null,
              provider: null,
              blobId: null,
            });
            recordPilotMetricEvent("docx_export_completed", {
              count: 1,
              fileName: result.fileName,
            });
            setStatus(`DOCX 내보내기 완료: ${result.fileName}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : "DOCX 내보내기 실패";
            setStatus(message);
          } finally {
            setBusy(false);
          }
        }}
        onSave={onSave}
        sessionContext={
          authSession
            ? {
                email: authSession.user.email,
                displayName: authSession.user.displayName,
                providerDisplayName: authSession.provider.displayName,
                activeTenantId: authSession.activeTenant?.tenantId || "",
                memberships: authSession.memberships,
              }
            : null
        }
        tenantSwitching={tenantSwitching}
        onSwitchTenant={onSwitchTenant}
        onLogout={() => {
          void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
            window.location.assign("/login");
          });
        }}
        formMode={formMode}
        onToggleFormMode={() => setFormMode(!formMode)}
      />

      {/* ── 경고 배너 ── */}
      {integrityIssues.length ? (
        <div className={styles.warning}>
          <strong>무결성 경고</strong>
          {integrityIssues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      ) : null}
      {hasComplexObjectSignal(complexObjectReport) ? (
        <div className={styles.warningSoft}>
          <strong>복합 객체 주의</strong>
          {complexObjectReport?.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {exportWarnings.length ? (
        <div className={styles.warningSoft}>
          <strong>내보내기 주의</strong>
          {exportWarnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {/* ── 메인: 에디터 캔버스 + 사이드바 ── */}
      <main className={styles.main}>
        <section className={styles.editorArea}>
          <div className={styles.editorCenter}>
            {!editorDoc ? (
              <DocumentStartWizard
                key={`wizard-${startWizardResetToken}-${startWizardInitialMethod ?? "none"}`}
                hasDocument={false}
                initialMethod={startWizardInitialMethod}
                recentSnapshots={recentSnapshots}
                isBusy={isBusy}
                status={status}
                previewStatus={previewStatus}
                onPickFile={onPickFile}
                onLoadRecentSnapshot={onLoadRecentSnapshot}
                onStartBlank={() => void startDocumentFromTemplate(null)}
                onStartFromTemplate={(template) => void startDocumentFromTemplate(template)}
              />
            ) : (
              <>
                <div className={styles.viewTabs}>
                  <button
                    type="button"
                    className={`${styles.viewTabBtn} ${viewMode === "editor" ? styles.viewTabBtnActive : ""}`}
                    onClick={() => setViewMode("editor")}
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    className={`${styles.viewTabBtn} ${viewMode === "preview" ? styles.viewTabBtnActive : ""}`}
                    onClick={() => setViewMode("preview")}
                    disabled={previewStatus !== "ready" || !renderHtml}
                    title={getPreviewTabTitle(previewStatus)}
                  >
                    <span className={styles.previewTabLabel}>미리보기</span>
                    <span className={`${styles.previewTabBadge} ${styles[`previewTabBadge${previewStatus[0].toUpperCase()}${previewStatus.slice(1)}`]}`}>
                      {getPreviewBadgeLabel(previewStatus)}
                    </span>
                  </button>
                </div>

                <EditorRuler />

                {/* 편집 탭 */}
                <div style={{ display: viewMode === "editor" ? "block" : "none" }}>
                  <EditorLayout>
                    <DocumentEditor
                      content={editorDoc}
                      formMode={formMode}
                      onUpdateDoc={onEditorUpdateDoc}
                      onSelectionChange={setSelection}
                      onEditorReady={setEditor}
                      onAiCommand={() => {
                        setActiveSidebarTab("ai");
                        void onGenerateSuggestion();
                      }}
                      onDiffSegmentClick={(segmentId) => {
                        if (sidebarCollapsed) toggleSidebar();
                        setActiveSidebarTab("ai");
                        setTimeout(() => {
                          const el = document.querySelector(`[data-batch-diff-id="${segmentId}"]`);
                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 100);
                      }}
                      onNewParaCreated={onNewParaCreated}
                      getHwpxDocumentModel={getHwpxDocumentModel}
                    />
                  </EditorLayout>
                  <InlineAiPopup
                    editor={editor}
                    onAction={(action, text) => {
                      const instructionMap: Record<string, string> = {
                        "다듬기": `선택된 텍스트를 더 자연스럽고 전문적으로 다듬어주세요: ${text}`,
                        "요약": `다음 텍스트를 2-3문장으로 요약해주세요: ${text}`,
                        "번역": `다음 텍스트를 영어로 번역해주세요: ${text}`,
                        "확장": `다음 텍스트를 더 자세하게 확장해주세요: ${text}`,
                      };
                      const msg = instructionMap[action] ?? `${action}: ${text}`;
                      setActiveSidebarTab("chat");
                      if (sidebarCollapsed) toggleSidebar();
                      void onSendChatMessage(msg);
                    }}
                  />
                </div>

                {/* 미리보기 탭 */}
                {viewMode === "preview" && renderHtml ? (
                  <div
                    className={styles.previewPane}
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted Java server output
                    dangerouslySetInnerHTML={{ __html: renderHtml }}
                    onClick={(e) => {
                      const target = (e.target as HTMLElement).closest("[data-segment-id]");
                      if (!target) return;
                      const segmentId = target.getAttribute("data-segment-id");
                      if (!segmentId) return;
                      setViewMode("editor");
                      setSelection({ selectedSegmentId: segmentId, selectedText: renderElementMap?.[segmentId]?.text ?? "" });
                      if (editor) focusSegment(editor, segmentId);
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
          {startWizardOpen && editorDoc ? (
            <div className={styles.wizardOverlay}>
              <DocumentStartWizard
                key={`wizard-overlay-${startWizardResetToken}-${startWizardInitialMethod ?? "none"}`}
                hasDocument
                initialMethod={startWizardInitialMethod}
                recentSnapshots={recentSnapshots}
                isBusy={isBusy}
                status={status}
                previewStatus={previewStatus}
                onClose={closeStartWizard}
                onPickFile={onPickFile}
                onLoadRecentSnapshot={onLoadRecentSnapshot}
                onStartBlank={() => void startDocumentFromTemplate(null)}
                onStartFromTemplate={(template) => void startDocumentFromTemplate(template)}
              />
            </div>
          ) : null}
        </section>

        {editorDoc ? (
          <Sidebar
            collapsed={sidebarCollapsed}
            activeTab={activeSidebarTab}
            outline={
              <DocumentOutline
                outline={outline}
                selectedSegmentId={selection.selectedSegmentId}
                onSelectSegment={onSelectOutlineSegment}
              />
            }
            ai={
              <AiSuggestionPanel
                instruction={instruction}
                suggestion={aiSuggestion}
                selectedText={selection.selectedText}
                singleQualityGate={singleSuggestionQualityGate}
                singleSuggestionApproved={singleSuggestionApproved}
                batchTargetCount={batchItems.length}
                batchSuggestionCount={batchSuggestionCount}
                batchDiffItems={batchDiffItems}
                batchJob={batchJob}
                isBusy={isBusy || aiBusy}
                onChangeInstruction={setInstruction}
                onRequestSuggestion={() => void onGenerateSuggestion()}
                onApplySuggestion={onApplySuggestion}
                onApproveSuggestion={onApproveSingleSuggestion}
                onRequestBatchSuggestion={() => void onGenerateBatchSuggestions()}
                onApplyBatchSuggestion={onApplyBatchSuggestions}
                batchDecisions={batchDecisions}
                onSetBatchDecision={setBatchDecision}
                onApplySelectedBatchSuggestion={onApplySelectedBatchSuggestions}
                presets={INSTRUCTION_PRESETS}
                selectedPreset={selectedPreset}
                onSelectPreset={onSelectPreset}
                verificationResult={verificationResult}
                verificationLoading={verificationLoading}
                onVerifySuggestion={() => void onVerifySuggestion()}
                batchMode={batchMode}
                onSetBatchMode={setBatchMode}
              />
            }
            chat={
              <ChatPanel
                messages={chatMessages}
                isBusy={chatBusy}
                pendingToolCall={pendingToolCall}
                hasDocument={!!editorDoc}
                onSendMessage={(text) => void onSendChatMessage(text)}
                onApproveTool={onApproveToolCall}
                onRejectTool={onRejectToolCall}
                onClearChat={clearChat}
                canUndo={!!lastToolCallSnapshot}
                onUndoLastToolCall={() => {
                  const snapshot = undoLastToolCall();
                  if (snapshot && editor) {
                    editor.commands.setContent(snapshot);
                  }
                }}
              />
            }
              analysis={
                <DocumentAnalysisPanel
                  analysis={documentAnalysis}
                  complexObjectReport={complexObjectReport}
                  templateCatalog={templateCatalog}
                  isLoading={analysisLoading}
                  terminologyDict={terminologyDict}
                  onUpdateEntry={updateTerminologyEntry}
                  onRemoveEntry={removeTerminologyEntry}
                  onApplyTerminology={onApplyTerminology}
                  isBusy={isBusy}
                  compatibilityWarnings={exportWarnings}
                  collaborationStats={{
                    historyCount: history.length,
                    aiActionCount: history.filter((h) => h.actor === "ai").length,
                  }}
                  performanceStats={{
                    segmentCount: sourceSegments.length,
                    complexity: sourceSegments.length > 200 ? "high" : sourceSegments.length > 50 ? "medium" : "low",
                  }}
                  qaStats={{
                    integrityIssueCount: integrityIssues.length,
                    exportWarningCount: exportWarnings.length,
                    compatibilityWarningCount: exportWarnings.length,
                  }}
                  reportFamilyPlanState={reportFamilyPlanState}
                  reportFamilyDraftState={reportFamilyDraftState}
                  canGenerateReportFamilyPlan={getFileExtension(fileName) === "pptx" && sourceSegments.length > 0 && outline.length > 0}
                  onGenerateReportFamilyPlan={onRefreshReportFamilyPlan}
                  canGenerateReportFamilyDraft={Boolean(reportFamilyPlanState.plan?.sectionPlans.length)}
                  onGenerateReportFamilyDraft={() => void onGenerateReportFamilyDraft()}
                />
              }
            history={
              <EditHistoryPanel
                history={history}
                onRestoreItem={(id) => {
                  const item = history.find((h) => h.id === id);
                  if (item?.snapshotDoc && editor) {
                    editor.commands.setContent(item.snapshotDoc);
                  }
                }}
                disabled={isBusy || aiBusy}
              />
            }
          />
        ) : null}
      </main>

      {/* ── 하단 상태 표시줄 ── */}
      <StatusBar
        fileName={fileName}
        nodeCount={sourceSegments.length}
        editCount={editsPreview.length}
        dirtyFileCount={dirtySummary.dirtyFileCount}
        isDirty={isDirty}
        status={status}
      />

      {/* ── 다른 이름으로 저장 다이얼로그 ── */}
      <HwpxSaveDialog
        open={saveDialogOpen}
        defaultFileName={`${toFileStem(fileName || "document")}.hwpx`}
        sourceFormat={
          fileName.toLowerCase().endsWith(".docx")
            ? "docx"
            : fileName.toLowerCase().endsWith(".pptx")
              ? "pptx"
              : "hwpx"
        }
        editorDoc={editorDoc}
        onClose={() => setSaveDialogOpen(false)}
        onConfirm={onConfirmSave}
      />
    </div>
  );
}
