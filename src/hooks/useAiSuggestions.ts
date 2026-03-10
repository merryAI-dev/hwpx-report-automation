"use client";

import { useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { useDocumentStore } from "@/store/document-store";
import { log } from "@/lib/logger";
import { buildBatchApplyPlan, collectSectionBatchItems } from "@/lib/editor/batch-ai";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";
import type { PresetKey } from "@/lib/editor/ai-presets";
import {
  replaceSegmentText,
  applyBatchSegmentTexts,
} from "@/lib/editor/editor-operations";
import { getPreferredModel, checkCostLimit, getCostLimit } from "@/lib/preferences";
import type { QualityGateIssue } from "@/lib/quality-gates";

const BATCH_API_CHUNK_SIZE = 40;

export function useAiSuggestions(editor: Editor | null) {
  const {
    editorDoc,
    instruction,
    aiSuggestion,
    batchSuggestions,
    batchMode,
    selection,
    terminologyDict,
    setStatus,
    setAiBusy,
    setActiveSidebarTab,
    setAiSuggestion,
    setBatchSuggestions,
    clearBatchDecisions,
    pushHistory,
    setVerificationResult,
    setVerificationLoading,
    setSelectedPreset,
    setInstruction,
  } = useDocumentStore();

  // ── Single suggestion ──

  const onGenerateSuggestion = useCallback(async () => {
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
      const costError = await checkCostLimit();
      if (costError) {
        setStatus(costError);
        setAiBusy(false);
        return;
      }
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          instruction,
          model: getPreferredModel("openai") || undefined,
          monthlyCostLimitUsd: getCostLimit() || undefined,
        }),
      });
      const payload = (await response.json()) as { suggestion?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "AI 제안 생성 실패");
      }
      setAiSuggestion(payload.suggestion || "");
      setStatus("AI 제안이 생성되었습니다.");
    } catch (error) {
      log.error("AI suggestion failed", error);
      const message = error instanceof Error ? error.message : "AI 제안 실패";
      setStatus(message);
    } finally {
      setAiBusy(false);
    }
  }, [selection.selectedText, instruction, setAiBusy, setActiveSidebarTab, setVerificationResult, setStatus, setAiSuggestion]);

  // ── Apply single suggestion ──

  const onApplySuggestion = useCallback(() => {
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
  }, [editor, aiSuggestion, selection.selectedSegmentId, setStatus]);

  // ── Batch suggestions ──

  const onGenerateBatchSuggestions = useCallback(async () => {
    if (!editorDoc) {
      setStatus("먼저 HWPX 파일을 업로드하세요.");
      return;
    }
    const batchItems = collectSectionBatchItems(editorDoc, batchMode === "document" ? null : selection.selectedSegmentId);
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

    let accumulated: Array<{ id: string; suggestion: string; qualityGate: { passed: boolean; requiresApproval: boolean; issues: QualityGateIssue[] } }> = [];

    try {
      const costError = await checkCostLimit();
      if (costError) {
        setStatus(costError);
        setAiBusy(false);
        return;
      }
      for (let ci = 0; ci < chunks.length; ci++) {
        setStatus(`AI 생성 중... (${ci + 1}/${chunks.length})`);
        const chunk = chunks[ci];
        const response = await fetch("/api/suggest-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: chunk,
            instruction,
            model: getPreferredModel("openai") || undefined,
            monthlyCostLimitUsd: getCostLimit() || undefined,
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
            qualityGate: { passed: true, requiresApproval: false, issues: [] },
          }))
          .filter((row) => row.id && row.suggestion);
        accumulated = [...accumulated, ...chunkResults];
        setBatchSuggestions([...accumulated]);
      }
      const nextPlan = buildBatchApplyPlan(batchItems, accumulated);
      const changedCount = nextPlan.filter((row) => row.changed).length;
      setStatus(`AI 섹션 일괄 제안 완료: 대상 ${nextPlan.length}개 중 변경 ${changedCount}개`);
    } catch (error) {
      log.error("AI batch suggestion failed", error, { chunkCount: chunks.length });
      const message = error instanceof Error ? error.message : "AI 일괄 제안 실패";
      setStatus(message);
    } finally {
      setAiBusy(false);
    }
  }, [editorDoc, batchMode, selection.selectedSegmentId, instruction, setAiBusy, setActiveSidebarTab, clearBatchDecisions, setBatchSuggestions, setStatus]);

  const onApplyBatchSuggestions = useCallback(() => {
    if (!editor) {
      setStatus("에디터가 아직 준비되지 않았습니다.");
      return;
    }
    if (!batchSuggestions.length) {
      setStatus("적용할 일괄 AI 제안이 없습니다.");
      return;
    }
    const batchItems = collectSectionBatchItems(editorDoc, batchMode === "document" ? null : selection.selectedSegmentId);
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
    pushHistory(`AI 섹션 일괄 적용 (${appliedCount}건)`, appliedCount, { actor: "ai" });
    setStatus(`AI 섹션 일괄 적용 완료: ${appliedCount}건`);
  }, [editor, batchSuggestions, editorDoc, batchMode, selection.selectedSegmentId, setStatus, setBatchSuggestions, clearBatchDecisions, pushHistory]);

  const onApplySelectedBatchSuggestions = useCallback(() => {
    if (!editor) {
      setStatus("에디터가 아직 준비되지 않았습니다.");
      return;
    }
    const { batchDecisions } = useDocumentStore.getState();
    const acceptedIds = new Set(
      Object.entries(batchDecisions)
        .filter(([, decision]) => decision === "accepted")
        .map(([id]) => id),
    );
    if (!acceptedIds.size) {
      setStatus("수락된 항목이 없습니다.");
      return;
    }
    const batchItems = collectSectionBatchItems(editorDoc, batchMode === "document" ? null : selection.selectedSegmentId);
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
    pushHistory(`AI 선택 적용 (${appliedCount}건)`, appliedCount, { actor: "ai" });
    setStatus(`AI 선택 적용 완료: ${appliedCount}건`);
  }, [editor, editorDoc, batchMode, selection.selectedSegmentId, batchSuggestions, setStatus, setBatchSuggestions, clearBatchDecisions, pushHistory]);

  // ── Verification ──

  const onVerifySuggestion = useCallback(async () => {
    const text = selection.selectedText.trim();
    if (!text || !aiSuggestion.trim()) {
      setStatus("검증할 원문과 AI 제안이 필요합니다.");
      return;
    }
    setVerificationLoading(true);
    setVerificationResult(null);
    try {
      const costError = await checkCostLimit();
      if (costError) {
        setStatus(costError);
        setVerificationLoading(false);
        return;
      }
      const resp = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalText: text,
          modifiedText: aiSuggestion,
          instruction,
          model: getPreferredModel("openai") || undefined,
          monthlyCostLimitUsd: getCostLimit() || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "검증 실패");
      }
      setVerificationResult(data);
      setStatus(data.passed ? "검증 통과" : `검증 이슈 ${data.issues?.length || 0}건`);
    } catch (error) {
      log.error("AI verification failed", error);
      const message = error instanceof Error ? error.message : "검증 실패";
      setStatus(message);
    } finally {
      setVerificationLoading(false);
    }
  }, [selection.selectedText, aiSuggestion, instruction, setVerificationLoading, setVerificationResult, setStatus]);

  // ── Terminology ──

  const onApplyTerminology = useCallback(() => {
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
      pushHistory(`용어 일괄 치환 (${totalReplaced}건)`, totalReplaced, { actor: "user" });
      setStatus(`용어 일괄 치환 완료: ${totalReplaced}건`);
    } else {
      setStatus("치환할 용어가 문서에 없습니다.");
    }
  }, [editor, terminologyDict, pushHistory, setStatus]);

  // ── Preset selection ──

  const onSelectPreset = useCallback((key: PresetKey) => {
    setSelectedPreset(key);
    const preset = INSTRUCTION_PRESETS.find((p) => p.key === key);
    if (preset && preset.instruction) {
      setInstruction(preset.instruction);
    }
  }, [setSelectedPreset, setInstruction]);

  return {
    onGenerateSuggestion,
    onApplySuggestion,
    onGenerateBatchSuggestions,
    onApplyBatchSuggestions,
    onApplySelectedBatchSuggestions,
    onVerifySuggestion,
    onApplyTerminology,
    onSelectPreset,
  };
}
