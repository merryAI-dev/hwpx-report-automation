"use client";

import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { DocumentEditor } from "@/components/editor/DocumentEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { FileUpload } from "@/components/common/FileUpload";
import { DownloadButton } from "@/components/common/DownloadButton";
import { StatusBar } from "@/components/common/StatusBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { DocumentOutline } from "@/components/sidebar/DocumentOutline";
import { AiSuggestionPanel } from "@/components/sidebar/AiSuggestionPanel";
import { EditHistoryPanel } from "@/components/sidebar/EditHistoryPanel";
import { buildBatchApplyPlan, collectSectionBatchItems } from "@/lib/editor/batch-ai";
import { buildDirtySummary, buildOutlineFromDoc } from "@/lib/editor/document-store";
import { parseHwpxToProseMirror } from "@/lib/editor/hwpx-to-prosemirror";
import { applyProseMirrorDocToHwpx, collectDocumentEdits } from "@/lib/editor/prosemirror-to-hwpx";
import { useDocumentStore } from "@/store/document-store";
import type { RenderElementInfo } from "@/store/document-store";
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

type JavaRenderPayload = {
  html?: string;
  elementMap?: Record<string, RenderElementInfo>;
};

export default function Home() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [viewMode, setViewMode] = useState<"editor" | "preview">("editor");

  const {
    fileName,
    sourceBuffer,
    editorDoc,
    sourceSegments,
    extraSegmentsMap,
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

    setLoadedDocument,
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
  } = useDocumentStore();

  const downloadUrl = useMemo(() => {
    if (!download.blob) {
      return "";
    }
    return URL.createObjectURL(download.blob);
  }, [download.blob]);

  const dirtySummary = useMemo(() => buildDirtySummary(editsPreview), [editsPreview]);
  const batchItems = useMemo(
    () => collectSectionBatchItems(editorDoc, selection.selectedSegmentId),
    [editorDoc, selection.selectedSegmentId],
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
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const onPickFile = async (file: File) => {
    setBusy(true);
    setViewMode("editor");
    setStatus("HWPX를 분석하고 WYSIWYG 문서로 변환 중입니다...");
    try {
      const buffer = await file.arrayBuffer();
      const [parsed] = await Promise.all([
        parseHwpxToProseMirror(buffer),
        // Fire Java rendering request concurrently; ignore errors (server may not be running)
        (async () => {
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
            // Java server not running – preview will show a placeholder
          }
        })(),
      ]);
      setLoadedDocument({
        fileName: file.name,
        buffer,
        doc: parsed.doc,
        segments: parsed.segments,
        extraSegmentsMap: parsed.extraSegmentsMap,
        integrityIssues: parsed.integrityIssues,
      });
      setOutline(buildOutlineFromDoc(parsed.doc));
      setStatus(
        parsed.integrityIssues.length
          ? `로드 완료: 세그먼트 ${parsed.segments.length}개 (무결성 경고 ${parsed.integrityIssues.length}개)`
          : `로드 완료: 세그먼트 ${parsed.segments.length}개`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "문서 로드 실패";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  };

  const onEditorUpdateDoc = (doc: Parameters<typeof setEditorDoc>[0]) => {
    setEditorDoc(doc);
    setOutline(buildOutlineFromDoc(doc));
    const next = collectDocumentEdits(doc, sourceSegments, extraSegmentsMap);
    setEditsPreview(next.edits);
    setExportWarnings(next.warnings);
  };

  const onGenerateSuggestion = async () => {
    const text = selection.selectedText.trim();
    if (!text) {
      setStatus("먼저 에디터에서 수정할 텍스트를 선택하세요.");
      return;
    }
    setAiBusy(true);
    setActiveSidebarTab("ai");
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

  const onExport = async () => {
    if (!sourceBuffer || !editorDoc) {
      setStatus("먼저 HWPX 파일을 업로드하세요.");
      return;
    }
    setBusy(true);
    setStatus("수정 내용을 HWPX로 내보내는 중입니다...");
    try {
      const result = await applyProseMirrorDocToHwpx(sourceBuffer, editorDoc, sourceSegments, extraSegmentsMap);
      setEditsPreview(result.edits);
      setExportWarnings(result.warnings);
      if (result.integrityIssues.length) {
        setStatus(`내보내기 실패: 무결성 경고 ${result.integrityIssues.join(" | ")}`);
        return;
      }
      const nextName = fileName ? fileName.replace(/\.hwpx$/i, "") + "-edited.hwpx" : "edited.hwpx";
      setDownload({
        blob: result.blob,
        fileName: nextName,
      });
      setDirty(false);
      pushHistory(`내보내기 완료 (${result.edits.length}건)`, result.edits.length);
      setStatus(`내보내기 완료: 수정 ${result.edits.length}건`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "내보내기 실패";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  };

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
    const chunks: Array<typeof batchItems> = [];
    for (let index = 0; index < batchItems.length; index += BATCH_API_CHUNK_SIZE) {
      chunks.push(batchItems.slice(index, index + BATCH_API_CHUNK_SIZE));
    }
    setStatus(`AI 섹션 일괄 제안을 생성 중입니다... (${batchItems.length}개 / ${chunks.length}회 요청)`);
    try {
      const responses = await Promise.all(
        chunks.map(async (chunk) => {
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
          return payload.results || [];
        }),
      );
      const next = responses
        .flat()
        .map((row) => ({
          id: String(row.id || "").trim(),
          suggestion: String(row.suggestion || "").trim(),
        }))
        .filter((row) => row.id && row.suggestion);
      setBatchSuggestions(next);
      const nextPlan = buildBatchApplyPlan(batchItems, next);
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
    pushHistory(`AI 섹션 일괄 적용 (${appliedCount}건)`, appliedCount);
    setStatus(`AI 섹션 일괄 적용 완료: ${appliedCount}건`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>HWPX Interactive WYSIWYG Editor</h1>
          <p>한글 문서를 실제 문서처럼 보면서 편집하고, 손상 방지 검증 후 다시 HWPX로 저장합니다.</p>
        </div>
        <div className={styles.headerActions}>
          <FileUpload disabled={isBusy} onPickFile={onPickFile} />
          <DownloadButton
            onGenerate={onExport}
            disabled={isBusy || !editorDoc}
            downloadUrl={downloadUrl}
            downloadName={download.fileName}
          />
        </div>
      </header>

      <EditorToolbar
        editor={editor}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onAiCommand={() => {
          setActiveSidebarTab("ai");
          void onGenerateSuggestion();
        }}
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
          {editorDoc ? (
            <div className={styles.viewTabs}>
              <button
                className={`${styles.viewTabBtn} ${viewMode === "editor" ? styles.viewTabBtnActive : ""}`}
                onClick={() => setViewMode("editor")}
              >
                편집
              </button>
              <button
                className={`${styles.viewTabBtn} ${viewMode === "preview" ? styles.viewTabBtnActive : ""}`}
                onClick={() => setViewMode("preview")}
                disabled={!renderHtml}
                title={renderHtml ? undefined : "Java 서버에 연결되지 않았습니다"}
              >
                미리보기
              </button>
            </div>
          ) : null}
          <div style={{ display: viewMode === "editor" ? "block" : "none" }}>
            <DocumentEditor
              content={editorDoc}
              onUpdateDoc={onEditorUpdateDoc}
              onSelectionChange={setSelection}
              onEditorReady={setEditor}
              onAiCommand={() => {
                setActiveSidebarTab("ai");
                void onGenerateSuggestion();
              }}
            />
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
        </section>

        <Sidebar
          collapsed={sidebarCollapsed}
          activeTab={activeSidebarTab}
          onChangeTab={setActiveSidebarTab}
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
            />
          }
          history={<EditHistoryPanel history={history} />}
        />
      </main>

      <StatusBar
        fileName={fileName}
        nodeCount={sourceSegments.length}
        editCount={editsPreview.length}
        dirtyFileCount={dirtySummary.dirtyFileCount}
        isDirty={isDirty}
        status={status}
      />
    </div>
  );
}
