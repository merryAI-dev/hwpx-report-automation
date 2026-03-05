"use client";

import { useEffect, useMemo, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
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
import { BatchTemplatePanel } from "@/components/sidebar/BatchTemplatePanel";
import { buildBatchApplyPlan, collectSectionBatchItems } from "@/lib/editor/batch-ai";
import { buildDirtySummary } from "@/lib/editor/document-store";
import { collectExportCompatibilityWarnings } from "@/lib/editor/prosemirror-to-hwpx";
import { triggerDiffHighlightUpdate, setDiffHighlightSuggestions } from "@/lib/editor/diff-highlight-extension";
import type { DiffHighlightSuggestion } from "@/lib/editor/diff-highlight-extension";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";
import type { DocumentTemplate } from "@/lib/editor/document-templates";
import type { RecentFileSnapshotMeta } from "@/lib/recent-files";
import { useDocumentStore } from "@/store/document-store";
import type { SidebarTab } from "@/store/document-store";
import { useShallow } from "zustand/react/shallow";
import { focusSegment, toFileStem } from "@/lib/editor/editor-operations";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useAiSuggestions } from "@/hooks/useAiSuggestions";
import { useChatAgent } from "@/hooks/useChatAgent";
import { WelcomeScreen } from "@/components/common/WelcomeScreen";
import styles from "./page.module.css";

export default function Home() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [viewMode, setViewMode] = useState<"editor" | "preview">("editor");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [recentSnapshots, setRecentSnapshots] = useState<RecentFileSnapshotMeta[]>([]);
  const [selectedRecentSnapshotId, setSelectedRecentSnapshotId] = useState("");

  // ── Zustand store — useShallow로 기능별 구독 분리 (불필요한 re-render 방지) ──
  const {
    fileName, editorDoc, sourceSegments, integrityIssues, exportWarnings,
    outline, editsPreview, history, status, isBusy, isDirty,
    selection, download, renderHtml, renderElementMap,
  } = useDocumentStore(useShallow((s) => ({
    fileName: s.fileName, editorDoc: s.editorDoc, sourceSegments: s.sourceSegments,
    integrityIssues: s.integrityIssues, exportWarnings: s.exportWarnings,
    outline: s.outline, editsPreview: s.editsPreview, history: s.history,
    status: s.status, isBusy: s.isBusy, isDirty: s.isDirty,
    selection: s.selection, download: s.download, renderHtml: s.renderHtml,
    renderElementMap: s.renderElementMap,
  })));

  const {
    sidebarCollapsed, activeSidebarTab, batchMode, formMode,
  } = useDocumentStore(useShallow((s) => ({
    sidebarCollapsed: s.sidebarCollapsed, activeSidebarTab: s.activeSidebarTab,
    batchMode: s.batchMode, formMode: s.formMode,
  })));

  const {
    instruction, aiSuggestion, batchSuggestions, aiBusy,
    batchDecisions, selectedPreset,
  } = useDocumentStore(useShallow((s) => ({
    instruction: s.instruction, aiSuggestion: s.aiSuggestion,
    batchSuggestions: s.batchSuggestions, aiBusy: s.aiBusy,
    batchDecisions: s.batchDecisions, selectedPreset: s.selectedPreset,
  })));

  const {
    documentAnalysis, analysisLoading, terminologyDict,
    verificationResult, verificationLoading,
  } = useDocumentStore(useShallow((s) => ({
    documentAnalysis: s.documentAnalysis, analysisLoading: s.analysisLoading,
    terminologyDict: s.terminologyDict, verificationResult: s.verificationResult,
    verificationLoading: s.verificationLoading,
  })));

  const {
    chatMessages, chatBusy, pendingToolCall, lastToolCallSnapshot,
  } = useDocumentStore(useShallow((s) => ({
    chatMessages: s.chatMessages, chatBusy: s.chatBusy,
    pendingToolCall: s.pendingToolCall, lastToolCallSnapshot: s.lastToolCallSnapshot,
  })));

  // Actions — 안정 참조이므로 re-render 유발하지 않음
  const setStatus = useDocumentStore((s) => s.setStatus);
  const setBusy = useDocumentStore((s) => s.setBusy);
  const toggleSidebar = useDocumentStore((s) => s.toggleSidebar);
  const setActiveSidebarTab = useDocumentStore((s) => s.setActiveSidebarTab);
  const setInstruction = useDocumentStore((s) => s.setInstruction);
  const setSelection = useDocumentStore((s) => s.setSelection);
  const setDownload = useDocumentStore((s) => s.setDownload);
  const setBatchDecision = useDocumentStore((s) => s.setBatchDecision);
  const setBatchMode = useDocumentStore((s) => s.setBatchMode);
  const setFormMode = useDocumentStore((s) => s.setFormMode);
  const updateTerminologyEntry = useDocumentStore((s) => s.updateTerminologyEntry);
  const removeTerminologyEntry = useDocumentStore((s) => s.removeTerminologyEntry);
  const clearChat = useDocumentStore((s) => s.clearChat);
  const pushHistory = useDocumentStore((s) => s.pushHistory);
  const undoLastToolCall = useDocumentStore((s) => s.undoLastToolCall);
  const setEditorDoc = useDocumentStore((s) => s.setEditorDoc);
  const setSelectedPreset = useDocumentStore((s) => s.setSelectedPreset);
  const setLoadedDocument = useDocumentStore((s) => s.setLoadedDocument);
  const setOutline = useDocumentStore((s) => s.setOutline);

  // ── Custom hooks ──
  const fileOps = useFileOperations(editor);
  const aiSuggestionOps = useAiSuggestions(editor);
  const chatAgent = useChatAgent(editor);

  // ── Load recent snapshots on mount ──
  useEffect(() => {
    void fileOps.refreshRecentSnapshots().then((result) => {
      setRecentSnapshots(result.snapshots);
      setSelectedRecentSnapshotId(result.selectedId);
    });
  }, [fileOps.refreshRecentSnapshots]);

  // ── Auto-open document from /documents page ──
  useEffect(() => {
    const docId = sessionStorage.getItem("openDocumentId");
    if (docId) {
      sessionStorage.removeItem("openDocumentId");
      void fileOps.loadFromServer(docId);
    }
  }, [fileOps.loadFromServer]);

  // ── Warn on unsaved changes ──
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── File handlers ──
  const onPickFile = async (file: File) => {
    setViewMode("editor");
    const result = await fileOps.loadFileIntoEditor(file, "opened");
    if (result.snapshotResult) {
      setRecentSnapshots(result.snapshotResult.snapshots);
      setSelectedRecentSnapshotId(result.snapshotResult.selectedId);
    }
  };

  const onLoadRecentSnapshot = async (snapshotId: string) => {
    const snapshots = await fileOps.onLoadRecentSnapshot(snapshotId);
    if (snapshots) {
      setRecentSnapshots(snapshots);
    } else {
      setSelectedRecentSnapshotId(snapshotId);
    }
  };

  const onStartFromTemplate = useCallback(
    (template: DocumentTemplate) => {
      const doc: JSONContent = {
        type: "doc",
        content: template.starterContent,
      };
      setLoadedDocument({
        fileName: `${template.name}.hwpx`,
        buffer: new ArrayBuffer(0),
        doc,
        segments: template.starterContent
          .filter((n) => n.type === "paragraph" || n.type === "heading")
          .map((n, i) => ({
            segmentId: `tpl-${template.id}-${i}`,
            text: n.content?.[0]?.text ?? "",
            tag: n.type === "heading" ? `h${(n.attrs?.level as number) ?? 1}` : "p",
            fileName: "",
            textIndex: i,
            originalText: n.content?.[0]?.text ?? "",
            styleHints: {} as Record<string, string>,
          })),
        extraSegmentsMap: {},
        integrityIssues: [],
        hwpxDocumentModel: null,
      });
      setOutline([]);
      // Apply default AI preset for the template type
      const preset = INSTRUCTION_PRESETS.find((p) => p.key === template.defaultPreset);
      if (preset) {
        setSelectedPreset(preset.key);
        setInstruction(preset.instruction);
      }
      setViewMode("editor");
      setStatus(`템플릿 적용: ${template.name}`);
    },
    [setLoadedDocument, setOutline, setSelectedPreset, setInstruction, setStatus],
  );

  const onSave = () => setSaveDialogOpen(true);
  const onExport = () => setSaveDialogOpen(true);

  const onConfirmSave = async (customFileName: string) => {
    setSaveDialogOpen(false);
    await fileOps.onConfirmSave(customFileName);
  };

  // ── Tool call undo ──
  const onUndoLastToolCall = useCallback(() => {
    const snapshot = undoLastToolCall();
    if (snapshot && editor) {
      setEditorDoc(snapshot);
      editor.commands.setContent(snapshot);
      setStatus("마지막 AI 편집을 취소했습니다.");
      pushHistory("AI 편집 실행 취소", 0, { actor: "user" });
    }
  }, [undoLastToolCall, editor, setEditorDoc, setStatus, pushHistory]);

  // ── Sidebar tab toggle ──
  const handleSetSidebarTab = (tab: SidebarTab) => {
    if (!sidebarCollapsed && activeSidebarTab === tab) {
      toggleSidebar();
    } else {
      if (sidebarCollapsed) toggleSidebar();
      setActiveSidebarTab(tab);
    }
  };

  // ── Outline navigation ──
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

  // ── History restore ──
  const onRestoreHistoryItem = useCallback(
    (historyId: string) => {
      if (!editor) {
        setStatus("에디터가 아직 준비되지 않았습니다.");
        return;
      }
      const target = history.find((item) => item.id === historyId);
      if (!target?.snapshotDoc) {
        setStatus("복원 가능한 스냅샷이 없습니다.");
        return;
      }
      const snapshot = JSON.parse(JSON.stringify(target.snapshotDoc)) as JSONContent;
      editor.commands.setContent(snapshot);
      setStatus(`이력 복원 완료: ${target.summary}`);
      pushHistory(`이력 복원: ${target.summary}`, 0, {
        actor: "user",
        snapshotDoc: snapshot,
      });
    },
    [editor, history, setStatus, pushHistory],
  );

  // ── Computed values ──
  const downloadUrl = useMemo(() => {
    if (!download.blob) return "";
    return URL.createObjectURL(download.blob);
  }, [download.blob]);

  const dirtySummary = useMemo(() => buildDirtySummary(editsPreview), [editsPreview]);

  const docStats = useMemo(() => {
    if (!editorDoc?.content) return { charCount: 0, wordCount: 0 };
    let chars = 0;
    let words = 0;
    const walk = (node: JSONContent) => {
      if (node.text) {
        chars += node.text.length;
        // Count words: split on whitespace for mixed Korean/English
        const trimmed = node.text.trim();
        if (trimmed) words += trimmed.split(/\s+/).length;
      }
      for (const child of node.content ?? []) walk(child);
    };
    walk(editorDoc);
    return { charCount: chars, wordCount: words };
  }, [editorDoc]);
  const compatibilityWarnings = useMemo(
    () => (editorDoc ? collectExportCompatibilityWarnings(editorDoc) : []),
    [editorDoc],
  );
  const collaborationStats = useMemo(
    () => ({
      historyCount: history.length,
      aiActionCount: history.filter((item) => item.actor === "ai").length,
    }),
    [history],
  );
  const performanceStats = useMemo(
    () => ({
      segmentCount: sourceSegments.length,
      complexity: (sourceSegments.length > 2500 ? "high" : sourceSegments.length > 800 ? "medium" : "low") as "high" | "medium" | "low",
    }),
    [sourceSegments.length],
  );
  const qaStats = useMemo(
    () => ({
      integrityIssueCount: integrityIssues.length,
      exportWarningCount: exportWarnings.length,
      compatibilityWarningCount: compatibilityWarnings.length,
    }),
    [integrityIssues.length, exportWarnings.length, compatibilityWarnings.length],
  );
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

  // ── Effects ──
  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  // Diff highlight sync
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
    setDiffHighlightSuggestions(editor, suggestions);
    triggerDiffHighlightUpdate(editor);
  }, [editor, batchPlan, batchDecisions]);

  // ── Render ──
  return (
    <div className={styles.page}>
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
          void aiSuggestionOps.onGenerateSuggestion();
        }}
        recentSnapshots={recentSnapshots}
        selectedRecentSnapshotId={selectedRecentSnapshotId}
        onSelectRecentSnapshot={setSelectedRecentSnapshotId}
        onLoadRecentSnapshot={onLoadRecentSnapshot}
        onPickFile={onPickFile}
        onExport={onExport}
        onExportPdf={fileOps.onExportPdf}
        onExportDocx={() => void fileOps.onExportDocx()}
        onSave={onSave}
        formMode={formMode}
        onToggleFormMode={() => setFormMode(!formMode)}
      />

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

      <main className={styles.main}>
        <section className={styles.editorArea}>
          <div className={styles.editorCenter}>
            {!editorDoc ? (
              <WelcomeScreen
                recentSnapshots={recentSnapshots}
                onPickFile={onPickFile}
                onLoadRecentSnapshot={(id) => void onLoadRecentSnapshot(id)}
                onStartFromTemplate={onStartFromTemplate}
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
                  disabled={!renderHtml}
                  title={renderHtml ? undefined : "Java 서버에 연결되지 않았습니다"}
                >
                  미리보기
                </button>
              </div>

            <EditorRuler />

            <div style={{ display: viewMode === "editor" ? "block" : "none" }}>
              <EditorLayout>
                <DocumentEditor
                  content={editorDoc}
                  formMode={formMode}
                  onUpdateDoc={fileOps.onEditorUpdateDoc}
                  onSelectionChange={setSelection}
                  onEditorReady={setEditor}
                  onAiCommand={() => {
                    setActiveSidebarTab("ai");
                    void aiSuggestionOps.onGenerateSuggestion();
                  }}
                  onDiffSegmentClick={(segmentId) => {
                    if (sidebarCollapsed) toggleSidebar();
                    setActiveSidebarTab("ai");
                    setTimeout(() => {
                      const el = document.querySelector(`[data-batch-diff-id="${segmentId}"]`);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 100);
                  }}
                  onNewParaCreated={fileOps.onNewParaCreated}
                  getHwpxDocumentModel={fileOps.getHwpxDocumentModel}
                />
              </EditorLayout>
            </div>

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
              onRequestSuggestion={() => void aiSuggestionOps.onGenerateSuggestion()}
              onApplySuggestion={aiSuggestionOps.onApplySuggestion}
              onRequestBatchSuggestion={() => void aiSuggestionOps.onGenerateBatchSuggestions()}
              onApplyBatchSuggestion={aiSuggestionOps.onApplyBatchSuggestions}
              batchDecisions={batchDecisions}
              onSetBatchDecision={setBatchDecision}
              onApplySelectedBatchSuggestion={aiSuggestionOps.onApplySelectedBatchSuggestions}
              presets={INSTRUCTION_PRESETS}
              selectedPreset={selectedPreset}
              onSelectPreset={aiSuggestionOps.onSelectPreset}
              verificationResult={verificationResult}
              verificationLoading={verificationLoading}
              onVerifySuggestion={() => void aiSuggestionOps.onVerifySuggestion()}
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
              canUndo={!!lastToolCallSnapshot}
              onSendMessage={(text) => void chatAgent.onSendChatMessage(text)}
              onApproveTool={chatAgent.onApproveToolCall}
              onRejectTool={chatAgent.onRejectToolCall}
              onClearChat={clearChat}
              onUndoLastToolCall={onUndoLastToolCall}
            />
          }
          analysis={
            <DocumentAnalysisPanel
              analysis={documentAnalysis}
              isLoading={analysisLoading}
              terminologyDict={terminologyDict}
              onUpdateEntry={updateTerminologyEntry}
              onRemoveEntry={removeTerminologyEntry}
              onApplyTerminology={aiSuggestionOps.onApplyTerminology}
              isBusy={isBusy}
              compatibilityWarnings={compatibilityWarnings}
              collaborationStats={collaborationStats}
              performanceStats={performanceStats}
              qaStats={qaStats}
            />
          }
          history={
            <EditHistoryPanel
              history={history}
              onRestoreItem={onRestoreHistoryItem}
              disabled={isBusy}
            />
          }
          batch={
            <BatchTemplatePanel
              editor={editor}
              onSaveRow={async (rowIdx, totalRows) => {
                const base = fileName
                  ? fileName.replace(/\.hwpx$/i, "")
                  : "document";
                const padded = String(rowIdx + 1).padStart(
                  String(totalRows).length,
                  "0",
                );
                const overrideFileName = `${base}_row${padded}.hwpx`;
                await fileOps.runHwpxExport({
                  kind: "manual-save",
                  fileLabel: `row${padded}`,
                  triggerDownload: true,
                  markClean: false,
                  overrideFileName,
                });
              }}
            />
          }
        />
      </main>

      <StatusBar
        fileName={fileName}
        nodeCount={sourceSegments.length}
        editCount={editsPreview.length}
        dirtyFileCount={dirtySummary.dirtyFileCount}
        isDirty={isDirty}
        status={status}
        charCount={docStats.charCount}
        wordCount={docStats.wordCount}
      />

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
