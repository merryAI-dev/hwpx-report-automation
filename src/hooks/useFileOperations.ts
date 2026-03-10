"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { useDocumentStore } from "@/store/document-store";
import { toast } from "@/store/toast-store";
import type { RenderElementInfo } from "@/store/document-store";
import { parseHwpxToProseMirror } from "@/lib/editor/hwpx-to-prosemirror";
import { parseDocxToProseMirror } from "@/lib/editor/docx-to-prosemirror";
import { parsePptxToProseMirror } from "@/lib/editor/pptx-to-prosemirror";
import { getPreferredModel, getCostLimit } from "@/lib/preferences";
import {
  applyProseMirrorDocToHwpx,
  collectDocumentEdits,
  collectExportCompatibilityWarnings,
} from "@/lib/editor/prosemirror-to-hwpx";
import { buildHwpxModelFromDoc } from "@/lib/editor/hwpx-template-synthesizer";
import { log } from "@/lib/logger";
import { buildOutlineFromDoc } from "@/lib/editor/document-store";
import { exportToPdf } from "@/lib/editor/export-pdf";
import { exportToDocx } from "@/lib/editor/export-docx";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";
import {
  listRecentFileSnapshots,
  loadRecentFileSnapshot,
  saveRecentFileSnapshot,
  type RecentFileKind,
  type RecentFileSnapshotMeta,
} from "@/lib/recent-files";
import {
  createUniqueHwpxFileName,
  triggerBrowserDownload,
} from "@/lib/editor/editor-operations";

type JavaRenderPayload = {
  html?: string;
  elementMap?: Record<string, RenderElementInfo>;
};

const AUTOSAVE_INTERVAL_MS = 60_000;

function trackExport(action: string, details: Record<string, unknown>) {
  fetch("/api/dashboard/audit-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, details }),
  }).catch(() => { /* fire-and-forget */ });
}

export function useFileOperations(editor: Editor | null) {
  const autoSaveInFlightRef = useRef(false);
  const docRevisionRef = useRef(0);
  const lastAutoSavedRevisionRef = useRef(-1);
  const derivedStateTimerRef = useRef<number | null>(null);
  const pendingDerivedDocRef = useRef<JSONContent | null>(null);

  const {
    fileName,
    editorDoc,
    sourceSegments,
    extraSegmentsMap,
    hwpxDocumentModel,
    isDirty,
    isBusy,
    aiBusy,
    documentId,
    setLoadedDocument,
    setHwpxDocumentModel,
    setEditorDoc,
    setOutline,
    setEditsPreview,
    setExportWarnings,
    setStatus,
    setBusy,
    setDirty,
    setRenderResult,
    setDownload,
    pushHistory,
    setDocumentAnalysis,
    setAnalysisLoading,
    setSelectedPreset,
    setInstruction,
    setDocumentId,
  } = useDocumentStore();

  // ── Recent file snapshots ──

  const refreshRecentSnapshots = useCallback(async (
    preferredId?: string,
  ): Promise<{ snapshots: RecentFileSnapshotMeta[]; selectedId: string }> => {
    try {
      const rows = await listRecentFileSnapshots();
      let selectedId = "";
      if (preferredId && rows.some((row) => row.id === preferredId)) {
        selectedId = preferredId;
      } else {
        selectedId = rows[0]?.id || "";
      }
      return { snapshots: rows, selectedId };
    } catch (err) {
      log.error("Failed to refresh recent snapshots", err);
      return { snapshots: [], selectedId: "" };
    }
  }, []);

  // ── Document analysis (auto-fire on load) ──

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
      body: JSON.stringify({ segments: items, model: getPreferredModel("openai") || undefined, monthlyCostLimitUsd: getCostLimit() || undefined }),
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

  // ── Derived state (outline, edits preview) ──

  const flushDerivedState = useCallback(
    (doc: JSONContent) => {
      setOutline(buildOutlineFromDoc(doc));
      const next = collectDocumentEdits(doc, sourceSegments, extraSegmentsMap);
      setEditsPreview(next.edits);
    },
    [setOutline, sourceSegments, extraSegmentsMap, setEditsPreview],
  );

  const scheduleDerivedStateUpdate = useCallback(
    (doc: JSONContent) => {
      pendingDerivedDocRef.current = doc;
      if (derivedStateTimerRef.current !== null) {
        window.clearTimeout(derivedStateTimerRef.current);
      }
      const segmentCount = sourceSegments.length;
      const waitMs = segmentCount > 2500 ? 180 : segmentCount > 800 ? 90 : 40;
      derivedStateTimerRef.current = window.setTimeout(() => {
        derivedStateTimerRef.current = null;
        const queued = pendingDerivedDocRef.current;
        pendingDerivedDocRef.current = null;
        if (!queued) return;
        flushDerivedState(queued);
      }, waitMs);
    },
    [sourceSegments.length, flushDerivedState],
  );

  useEffect(() => {
    return () => {
      if (derivedStateTimerRef.current !== null) {
        window.clearTimeout(derivedStateTimerRef.current);
      }
    };
  }, []);

  // ── Editor doc update handler ──

  const onEditorUpdateDoc = useCallback(
    (doc: Parameters<typeof setEditorDoc>[0]) => {
      docRevisionRef.current += 1;
      setEditorDoc(doc);
      scheduleDerivedStateUpdate(doc);
    },
    [setEditorDoc, scheduleDerivedStateUpdate],
  );

  // ── File loading ──

  const loadFileIntoEditor = useCallback(
    async (file: File, recentKind: RecentFileKind | null = "opened") => {
      setBusy(true);
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
                } catch (err) {
                  log.warn("Java render server unavailable", { error: err instanceof Error ? err.message : String(err) });
                }
              })(),
        ]);

        let hwpxModel = parsed.hwpxDocumentModel ?? null;
        if ((ext === "docx" || ext === "pptx") && !hwpxModel) {
          try {
            const templateResp = await fetch("/base.hwpx");
            if (templateResp.ok) {
              const templateBuffer = await templateResp.arrayBuffer();
              hwpxModel = await buildHwpxModelFromDoc(templateBuffer, parsed.doc);
            }
          } catch (err) {
            log.warn("base.hwpx template load failed", { error: err instanceof Error ? err.message : String(err) });
          }
        }

        setLoadedDocument({
          fileName: file.name,
          buffer,
          doc: parsed.doc,
          segments: parsed.segments,
          extraSegmentsMap: parsed.extraSegmentsMap,
          integrityIssues: parsed.integrityIssues,
          complexObjectReport: parsed.complexObjectReport ?? null,
          hwpxDocumentModel: hwpxModel,
        });
        setOutline(buildOutlineFromDoc(parsed.doc));
        docRevisionRef.current = 0;
        lastAutoSavedRevisionRef.current = -1;

        let snapshotResult: { snapshots: RecentFileSnapshotMeta[]; selectedId: string } | null = null;
        if (recentKind) {
          const snapshotMeta = await saveRecentFileSnapshot({
            name: file.name,
            blob: file,
            kind: recentKind,
          });
          if (snapshotMeta) {
            snapshotResult = await refreshRecentSnapshots(snapshotMeta.id);
          }
        }

        const loadMsg = parsed.integrityIssues.length
          ? `로드 완료: 문단 ${parsed.segments.length}개 (경고 ${parsed.integrityIssues.length}개)`
          : `로드 완료: 문단 ${parsed.segments.length}개`;
        setStatus(loadMsg);
        toast.success(loadMsg);
        trackExport("document-open", { fileName: file.name, format: ext, segments: parsed.segments.length });

        fireDocumentAnalysis(parsed.segments);

        return { snapshotResult };
      } catch (error) {
        log.error("Document load failed", error, { fileName: file.name, ext });
        const message = error instanceof Error ? error.message : "문서 로드 실패";
        setStatus(message);
        toast.error(message);
        return { snapshotResult: null };
      } finally {
        setBusy(false);
      }
    },
    [
      setBusy,
      setStatus,
      setRenderResult,
      setLoadedDocument,
      setOutline,
      refreshRecentSnapshots,
      fireDocumentAnalysis,
    ],
  );

  // ── HWPX export ──

  const runHwpxExport = useCallback(
    async (params: {
      kind: Exclude<RecentFileKind, "opened">;
      fileLabel: string;
      triggerDownload: boolean;
      markClean: boolean;
      overrideFileName?: string;
    }) => {
      if (!editorDoc) {
        throw new Error("먼저 문서 파일을 업로드하세요.");
      }
      if (!hwpxDocumentModel) {
        throw new Error("현재는 HWPX 원본 문서만 HWPX 저장/자동저장을 지원합니다.");
      }

      const result = await applyProseMirrorDocToHwpx(hwpxDocumentModel.baseBuffer, editorDoc, sourceSegments, extraSegmentsMap, hwpxDocumentModel);
      setEditsPreview(result.edits);
      setExportWarnings(result.warnings);
      if (result.integrityIssues.length) {
        throw new Error(`무결성 경고 ${result.integrityIssues.join(" | ")}`);
      }

      const nextName = params.overrideFileName ?? createUniqueHwpxFileName(fileName || "document.hwpx", params.fileLabel);
      setDownload({
        blob: result.blob,
        fileName: nextName,
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
      } catch (err) {
        log.warn("IndexedDB snapshot save failed", { error: err instanceof Error ? err.message : String(err) });
      }

      return {
        edits: result.edits.length,
        fileName: nextName,
      };
    },
    [
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

  const onConfirmSave = useCallback(
    async (customFileName: string) => {
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
        pushHistory(`저장 완료 (${result.edits}건)`, result.edits, { actor: "system" });
        setStatus(`저장 완료: ${result.fileName}`);
        toast.success(`저장 완료: ${result.fileName}`);
        trackExport("export-hwpx", { fileName: result.fileName, edits: result.edits });
      } catch (error) {
        log.error("Manual save failed", error);
        const message = error instanceof Error ? error.message : "저장 실패";
        setStatus(message);
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [setBusy, setStatus, runHwpxExport, pushHistory],
  );

  // ── Auto-save ──

  const onAutoSave = useCallback(async () => {
    if (autoSaveInFlightRef.current) {
      return;
    }
    if (!editorDoc || !hwpxDocumentModel || !isDirty || isBusy || aiBusy) {
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
      setStatus(`자동 저장 완료: ${result.fileName}`);
    } catch (error) {
      log.error("Auto-save failed", error);
      const message = error instanceof Error ? error.message : "자동 저장 실패";
      setStatus(`자동 저장 실패: ${message}`);
      toast.warning(`자동 저장 실패: ${message}`);
    } finally {
      autoSaveInFlightRef.current = false;
    }
  }, [editorDoc, hwpxDocumentModel, isDirty, isBusy, aiBusy, runHwpxExport, setStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void onAutoSave();
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [onAutoSave]);

  // ── Server persistence ──

  const serverSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveToServer = useCallback(async () => {
    if (!editorDoc || !sourceSegments.length) return;

    const docJsonStr = JSON.stringify(editorDoc);
    const segmentsStr = JSON.stringify(
      sourceSegments.map((s) => ({ segmentId: s.segmentId, text: s.text, tag: s.tag })),
    );

    try {
      if (documentId) {
        // Update existing document
        await fetch(`/api/documents/${documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docJson: docJsonStr,
            segments: segmentsStr,
            versionLabel: "auto-save",
          }),
        });
        log.debug("Server auto-save completed", { documentId });
      } else {
        // Create new document on first save
        const hwpxBase64 = hwpxDocumentModel?.baseBuffer
          ? btoa(
              Array.from(new Uint8Array(hwpxDocumentModel.baseBuffer))
                .map((b) => String.fromCharCode(b))
                .join(""),
            )
          : "";
        const resp = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fileName || "untitled.hwpx",
            hwpxBlob: hwpxBase64,
            docJson: docJsonStr,
            segments: segmentsStr,
            extraSegmentsMap: JSON.stringify(extraSegmentsMap),
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setDocumentId(data.id);
          log.info("Document created on server", { documentId: data.id });
        }
      }
    } catch (err) {
      log.warn("Server save failed (offline?)", { error: err instanceof Error ? err.message : String(err) });
    }
  }, [editorDoc, sourceSegments, extraSegmentsMap, documentId, hwpxDocumentModel, fileName, setDocumentId]);

  // Debounced server save triggered after local auto-save
  const scheduleServerSave = useCallback(() => {
    if (serverSaveDebounceRef.current) {
      clearTimeout(serverSaveDebounceRef.current);
    }
    serverSaveDebounceRef.current = setTimeout(() => {
      void saveToServer();
    }, 30_000); // 30 second debounce
  }, [saveToServer]);

  // Hook server save into the auto-save cycle
  useEffect(() => {
    if (isDirty && editorDoc) {
      scheduleServerSave();
    }
    return () => {
      if (serverSaveDebounceRef.current) {
        clearTimeout(serverSaveDebounceRef.current);
      }
    };
  }, [isDirty, editorDoc, scheduleServerSave]);

  // ── Recent file loading ──

  const onLoadRecentSnapshot = useCallback(
    async (snapshotId: string): Promise<RecentFileSnapshotMeta[] | null> => {
      if (!snapshotId) {
        setStatus("최근 파일을 먼저 선택하세요.");
        return null;
      }
      setStatus("최근 파일을 불러오는 중입니다...");
      try {
        const snapshot = await loadRecentFileSnapshot(snapshotId);
        if (!snapshot) {
          setStatus("선택한 최근 파일을 찾지 못했습니다.");
          const result = await refreshRecentSnapshots();
          return result.snapshots;
        }
        const file = new File([snapshot.blob], snapshot.meta.name, {
          type: snapshot.meta.mimeType || "application/octet-stream",
        });
        await loadFileIntoEditor(file, null);
        return null;
      } catch (error) {
        log.error("Recent snapshot load failed", error, { snapshotId });
        const message = error instanceof Error ? error.message : "최근 파일 로드 실패";
        setStatus(message);
        return null;
      }
    },
    [setStatus, refreshRecentSnapshots, loadFileIntoEditor],
  );

  // ── Export to PDF / DOCX ──

  const onExportPdf = useCallback(() => {
    const editorWrap = document.querySelector(".document-editor-wrap");
    if (editorWrap) {
      exportToPdf(editorWrap as HTMLElement, fileName || "document");
      trackExport("export-pdf", { fileName: fileName || "document" });
    } else {
      setStatus("에디터를 찾을 수 없습니다.");
    }
  }, [fileName, setStatus]);

  const onExportDocx = useCallback(async () => {
    if (!editorDoc) {
      setStatus("먼저 문서를 업로드하세요.");
      return;
    }
    setBusy(true);
    setStatus("DOCX 파일을 생성하고 있습니다...");
    try {
      const result = await exportToDocx(editorDoc, fileName || "document");
      setDownload({ blob: result.blob, fileName: result.fileName });
      setStatus(`DOCX 내보내기 완료: ${result.fileName}`);
      toast.success(`DOCX 내보내기 완료: ${result.fileName}`);
      trackExport("export-docx", { fileName: result.fileName });
    } catch (error) {
      log.error("DOCX export failed", error);
      const message = error instanceof Error ? error.message : "DOCX 내보내기 실패";
      setStatus(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [editorDoc, fileName, setStatus, setBusy, setDownload]);

  // ── Load from server ──

  const loadFromServer = useCallback(
    async (serverDocId: string) => {
      setBusy(true);
      setStatus("서버에서 문서를 불러오는 중...");
      try {
        const resp = await fetch(`/api/documents/${serverDocId}`);
        if (!resp.ok) {
          throw new Error("서버에서 문서를 찾을 수 없습니다.");
        }
        const data = await resp.json();

        let doc: JSONContent;
        let rawSegments: Array<{ segmentId: string; text: string; tag: string }>;
        let parsedExtraMap: Record<string, string[]>;
        try {
          doc = JSON.parse(data.docJson) as JSONContent;
        } catch {
          throw new Error("서버 응답의 문서 JSON이 올바르지 않습니다.");
        }
        try {
          rawSegments = JSON.parse(data.segments) as Array<{ segmentId: string; text: string; tag: string }>;
        } catch {
          throw new Error("서버 응답의 문단 데이터가 올바르지 않습니다.");
        }
        try {
          parsedExtraMap = data.extraSegmentsMap ? JSON.parse(data.extraSegmentsMap) as Record<string, string[]> : {};
        } catch {
          parsedExtraMap = {};
        }

        // Server-stored segments are minimal — fill in missing EditorSegment fields
        const segments = rawSegments.map((s, i) => ({
          ...s,
          fileName: "",
          textIndex: i,
          originalText: s.text,
          styleHints: {} as Record<string, string>,
        }));

        setDocumentId(data.id);
        setLoadedDocument({
          fileName: data.name,
          buffer: new ArrayBuffer(0), // No HWPX buffer needed for server-loaded docs
          doc,
          segments,
          extraSegmentsMap: parsedExtraMap,
          integrityIssues: [],
          complexObjectReport: null,
          hwpxDocumentModel: null,
        });
        setOutline(buildOutlineFromDoc(doc));
        setStatus(`서버에서 불러옴: ${data.name}`);
        toast.success(`서버에서 불러옴: ${data.name}`);
        log.info("Document loaded from server", { documentId: serverDocId, name: data.name });
        trackExport("document-open", { fileName: data.name, source: "server", documentId: serverDocId });
      } catch (error) {
        log.error("Server document load failed", error, { serverDocId });
        const message = error instanceof Error ? error.message : "서버 문서 로드 실패";
        setStatus(message);
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [setBusy, setStatus, setDocumentId, setLoadedDocument, setOutline],
  );

  // ── Compatibility warnings ──

  const getCompatibilityWarnings = useCallback(
    () => (editorDoc ? collectExportCompatibilityWarnings(editorDoc) : []),
    [editorDoc],
  );

  // ── OWPML model helpers ──

  const onNewParaCreated = useCallback(() => {
    const model = useDocumentStore.getState().hwpxDocumentModel;
    if (model) setHwpxDocumentModel(model);
  }, [setHwpxDocumentModel]);

  const getHwpxDocumentModel = useCallback(
    () => useDocumentStore.getState().hwpxDocumentModel,
    [],
  );

  return {
    loadFileIntoEditor,
    onLoadRecentSnapshot,
    onEditorUpdateDoc,
    onConfirmSave,
    onExportPdf,
    onExportDocx,
    runHwpxExport,
    refreshRecentSnapshots,
    getCompatibilityWarnings,
    onNewParaCreated,
    getHwpxDocumentModel,
    fireDocumentAnalysis,
    saveToServer,
    loadFromServer,
  };
}
