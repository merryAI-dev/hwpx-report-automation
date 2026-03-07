"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { useCallback } from "react";
import { DocumentEditor } from "@/components/editor/DocumentEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { HwpxSaveDialog } from "@/components/common/HwpxSaveDialog";
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
import { buildBatchApplyPlan, collectSectionBatchItems } from "@/lib/editor/batch-ai";
import { buildDirtySummary, buildOutlineFromDoc } from "@/lib/editor/document-store";
import { parseHwpxToProseMirror } from "@/lib/editor/hwpx-to-prosemirror";
import { parseDocxToProseMirror } from "@/lib/editor/docx-to-prosemirror";
import { parsePptxToProseMirror } from "@/lib/editor/pptx-to-prosemirror";
import { applyProseMirrorDocToHwpx, collectDocumentEdits } from "@/lib/editor/prosemirror-to-hwpx";
import { buildHwpxModelFromDoc } from "@/lib/editor/hwpx-template-synthesizer";
import { exportToPdf } from "@/lib/editor/export-pdf";
import { exportToDocx } from "@/lib/editor/export-docx";
import { triggerDiffHighlightUpdate } from "@/lib/editor/diff-highlight-extension";
import type { DiffHighlightSuggestion } from "@/lib/editor/diff-highlight-extension";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";
import type { PresetKey } from "@/lib/editor/ai-presets";
import { uploadBlobForSignedDownload } from "@/lib/blob-storage-client";
import {
  listRecentFileSnapshots,
  loadRecentFileSnapshot,
  saveRecentFileSnapshot,
  type RecentFileKind,
  type RecentFileSnapshotMeta,
} from "@/lib/recent-files";
import { useDocumentStore } from "@/store/document-store";
import type { RenderElementInfo, SidebarTab } from "@/store/document-store";
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

const BATCH_API_CHUNK_SIZE = 40;
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

export default function Home() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [viewMode, setViewMode] = useState<"editor" | "preview">("editor");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [recentSnapshots, setRecentSnapshots] = useState<RecentFileSnapshotMeta[]>([]);
  const [selectedRecentSnapshotId, setSelectedRecentSnapshotId] = useState("");
  const autoSaveInFlightRef = useRef(false);
  const docRevisionRef = useRef(0);
  const lastAutoSavedRevisionRef = useRef(-1);

  const {
    fileName,
    sourceBuffer,
    editorDoc,
    sourceSegments,
    extraSegmentsMap,
    hwpxDocumentModel,
    integrityIssues,
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
    analysisLoading,
    // Phase 2-5: Terminology
    terminologyDict,
    // Phase 2-6: Verification
    verificationResult,
    verificationLoading,
    // Batch mode
    batchMode,
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
    setAnalysisLoading,
    // Phase 2-5
    updateTerminologyEntry,
    removeTerminologyEntry,
    // Phase 2-6
    setVerificationResult,
    setVerificationLoading,
    // Batch mode
    setBatchMode,
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
  } = useDocumentStore();

  // Phase 2: appendTransaction 이후 Zustand 갱신 신호
  const onNewParaCreated = useCallback(() => {
    const model = useDocumentStore.getState().hwpxDocumentModel;
    if (model) setHwpxDocumentModel(model);
  }, [setHwpxDocumentModel]);

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
  const batchPlan = useMemo(
    () => buildBatchApplyPlan(batchItems, batchSuggestions),
    [batchItems, batchSuggestions],
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
        })),
    [batchPlan],
  );

  useEffect(() => {
    return () => {
      if (localDownloadUrl) {
        URL.revokeObjectURL(localDownloadUrl);
      }
    };
  }, [localDownloadUrl]);

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
  }, [setAnalysisLoading, setDocumentAnalysis, setSelectedPreset, setInstruction]);

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

  /* ── File I/O ── */
  const loadFileIntoEditor = useCallback(
    async (file: File, recentKind: RecentFileKind | null = "opened") => {
      setBusy(true);
      setViewMode("editor");
      const ext = file.name.toLowerCase().split(".").pop() || "";
      const formatLabel = ext === "docx" ? "DOCX" : ext === "pptx" ? "PPTX" : "HWPX";
      const isHwpx = ext === "hwpx";
      setStatus(`${formatLabel}를 분석하고 변환 중입니다...`);
      try {
        const buffer = await file.arrayBuffer();
        let parsePromise;
        if (ext === "docx") parsePromise = parseDocxToProseMirror(buffer);
        else if (ext === "pptx") parsePromise = parsePptxToProseMirror(buffer);
        else parsePromise = parseHwpxToProseMirror(buffer);

        const [parsed] = await Promise.all([
          parsePromise,
          !isHwpx
            ? Promise.resolve()
            : (async () => {
                try {
                  const fd = new FormData();
                  fd.append("file", file);
                  const resp = await fetch("/api/hwpx-render", { method: "POST", body: fd });
                  if (resp.ok) {
                    const payload = (await resp.json()) as JavaRenderPayload;
                    if (payload.html && payload.elementMap) {
                      setRenderResult(payload.html, payload.elementMap);
                    }
                  }
                } catch {
                  // Java server not running
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
          fileName: file.name,
          buffer,
          doc: parsed.doc,
          segments: parsed.segments,
          extraSegmentsMap: parsed.extraSegmentsMap,
          integrityIssues: parsed.integrityIssues,
          hwpxDocumentModel,
        });
        setOutline(buildOutlineFromDoc(parsed.doc));
        docRevisionRef.current = 0;
        lastAutoSavedRevisionRef.current = -1;

        if (recentKind) {
          const snapshotMeta = await saveRecentFileSnapshot({
            name: file.name,
            blob: file,
            kind: recentKind,
          });
          if (snapshotMeta) {
            await refreshRecentSnapshots(snapshotMeta.id);
          }
        }

        setStatus(
          parsed.integrityIssues.length
            ? `로드 완료: 세그먼트 ${parsed.segments.length}개 (경고 ${parsed.integrityIssues.length}개)`
            : `로드 완료: 세그먼트 ${parsed.segments.length}개`,
        );

        // Phase 2-4: Auto-analyze document on upload
        fireDocumentAnalysis(parsed.segments);
      } catch (error) {
        const message = error instanceof Error ? error.message : "문서 로드 실패";
        setStatus(message);
      } finally {
        setBusy(false);
      }
    },
    [
      setBusy,
      setViewMode,
      setStatus,
      setRenderResult,
      setLoadedDocument,
      setOutline,
      refreshRecentSnapshots,
      fireDocumentAnalysis,
    ],
  );

  const onPickFile = async (file: File) => {
    await loadFileIntoEditor(file, "opened");
  };

  const onLoadRecentSnapshot = async (snapshotId: string) => {
    if (!snapshotId) {
      setStatus("최근 파일을 먼저 선택하세요.");
      return;
    }
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
    setStatus("AI 제안을 생성 중입니다...");
    try {
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          instruction,
          model: undefined,
        }),
      });
      const payload = (await response.json()) as { suggestion?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "AI 제안 생성 실패");
      }
      setAiSuggestion(payload.suggestion || "");
      setStatus("AI 제안이 생성되었습니다.");
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
    const hasSelection = editor.state.selection.from !== editor.state.selection.to;
    if (hasSelection) {
      editor.chain().focus().insertContent(aiSuggestion).run();
      setStatus("선택 영역에 AI 제안을 적용했습니다.");
      return;
    }
    const segmentId = selection.selectedSegmentId;
    if (!segmentId) {
      setStatus("선택된 문단이 없습니다.");
      return;
    }
    const replaced = replaceSegmentText(editor, segmentId, aiSuggestion);
    setStatus(replaced ? "문단 전체에 AI 제안을 적용했습니다." : "대상 문단을 찾지 못했습니다.");
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
      setEditsPreview(result.edits);
      setExportWarnings(result.warnings);
      if (result.integrityIssues.length) {
        throw new Error(`무결성 경고 ${result.integrityIssues.join(" | ")}`);
      }

      const nextName = params.overrideFileName ?? createUniqueHwpxFileName(fileName || "document.hwpx", params.fileLabel);
      let remoteDownload:
        | {
            blobId: string;
            provider: string;
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
      fileName,
      setEditsPreview,
      setExportWarnings,
      setDownload,
      setDirty,
      refreshRecentSnapshots,
    ],
  );

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
      pushHistory(`저장 완료 (${result.edits}건)`, result.edits);
      if (result.storage) {
        setStatus(
          `저장 완료: ${result.fileName} (외부저장 ${result.storage.provider}, 서명 URL 만료 ${new Date(result.storage.expiresAt).toLocaleTimeString("ko-KR")})`,
        );
      } else if (result.storageWarning) {
        setStatus(`저장 완료: ${result.fileName} (${result.storageWarning})`);
      } else {
        setStatus(`저장 완료: ${result.fileName}`);
      }
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
      if (result.storage) {
        setStatus(`자동 저장 완료: ${result.fileName} (외부저장 ${result.storage.provider})`);
      } else if (result.storageWarning) {
        setStatus(`자동 저장 완료: ${result.fileName} (${result.storageWarning})`);
      } else {
        setStatus(`자동 저장 완료: ${result.fileName}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "자동 저장 실패";
      setStatus(`자동 저장 실패: ${message}`);
    } finally {
      autoSaveInFlightRef.current = false;
    }
  }, [editorDoc, sourceBuffer, hwpxDocumentModel, isDirty, isBusy, aiBusy, runHwpxExport, setStatus]);

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
      setStatus("먼저 HWPX 파일을 업로드하세요.");
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

    const chunks: Array<typeof batchItems> = [];
    for (let index = 0; index < batchItems.length; index += BATCH_API_CHUNK_SIZE) {
      chunks.push(batchItems.slice(index, index + BATCH_API_CHUNK_SIZE));
    }

    let accumulated: Array<{ id: string; suggestion: string }> = [];

    try {
      for (let ci = 0; ci < chunks.length; ci++) {
        setStatus(`AI 생성 중... (${ci + 1}/${chunks.length})`);
        const chunk = chunks[ci];
        const response = await fetch("/api/suggest-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: chunk,
            instruction,
            model: undefined,
          }),
        });
        const payload = (await response.json()) as {
          results?: Array<{ id?: string; suggestion?: string }>;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "AI 일괄 제안 생성 실패");
        }
        const chunkResults = (payload.results || [])
          .map((row) => ({
            id: String(row.id || "").trim(),
            suggestion: String(row.suggestion || "").trim(),
          }))
          .filter((row) => row.id && row.suggestion);
        accumulated = [...accumulated, ...chunkResults];
        setBatchSuggestions([...accumulated]); // progressive UI update
      }
      const nextPlan = buildBatchApplyPlan(batchItems, accumulated);
      const changedCount = nextPlan.filter((row) => row.changed).length;
      setStatus(`AI 섹션 일괄 제안 완료: 대상 ${nextPlan.length}개 중 변경 ${changedCount}개`);
    } catch (error) {
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
    const plan = buildBatchApplyPlan(batchItems, batchSuggestions).filter((item) => item.changed);
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
    pushHistory(`AI 섹션 일괄 적용 (${appliedCount}건)`, appliedCount);
    setStatus(`AI 섹션 일괄 적용 완료: ${appliedCount}건`);
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
    const plan = buildBatchApplyPlan(batchItems, batchSuggestions)
      .filter((item) => item.changed && acceptedIds.has(item.id));
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
    pushHistory(`AI 선택 적용 (${appliedCount}건)`, appliedCount);
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
        onToggleSidebar={toggleSidebar}
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
        onExport={onExport}
        onExportPdf={() => {
          const editorWrap = document.querySelector(".document-editor-wrap");
          if (editorWrap) exportToPdf(editorWrap as HTMLElement, fileName || "document");
          else setStatus("에디터를 찾을 수 없습니다.");
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
            setStatus(`DOCX 내보내기 완료: ${result.fileName}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : "DOCX 내보내기 실패";
            setStatus(message);
          } finally {
            setBusy(false);
          }
        }}
        onSave={onSave}
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
            {editorDoc ? (
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
                  disabled={!renderHtml}
                  title={renderHtml ? undefined : "Java 서버에 연결되지 않았습니다"}
                >
                  미리보기
                </button>
              </div>
            ) : null}

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
          </div>
        </section>

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
              batchTargetCount={batchItems.length}
              batchSuggestionCount={batchSuggestionCount}
              batchDiffItems={batchDiffItems}
              isBusy={isBusy || aiBusy}
              onChangeInstruction={setInstruction}
              onRequestSuggestion={() => void onGenerateSuggestion()}
              onApplySuggestion={onApplySuggestion}
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
            />
          }
          analysis={
            <DocumentAnalysisPanel
              analysis={documentAnalysis}
              isLoading={analysisLoading}
              terminologyDict={terminologyDict}
              onUpdateEntry={updateTerminologyEntry}
              onRemoveEntry={removeTerminologyEntry}
              onApplyTerminology={onApplyTerminology}
              isBusy={isBusy}
            />
          }
          history={<EditHistoryPanel history={history} />}
        />
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
