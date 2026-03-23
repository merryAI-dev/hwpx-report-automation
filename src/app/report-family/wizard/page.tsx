"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parsePptxToProseMirror } from "@/lib/editor/pptx-to-prosemirror";
import { buildOutlineFromDoc } from "@/lib/editor/document-store";
import {
  buildPptxReportFamilyPlanPayload,
} from "@/lib/report-family-planner";
import type { ReportFamilyPlan, TocEntry, SectionPromptPlan, SlideChunk } from "@/lib/report-family-planner";
import type { ReportFamilyDraft, ReportFamilyDraftSection } from "@/lib/report-family-draft-generator";

// ─── Step types ───────────────────────────────────────────────────────────────

type WizardStep = "upload" | "toc" | "generating" | "review" | "complete" | "format";

type EditableTocEntry = TocEntry & { deleted?: boolean; sectionType?: string; customInstruction?: string };

type SectionReview = {
  section: ReportFamilyDraftSection;
  status: "pending" | "accepted" | "edited" | "rejected";
  editedParagraphs: string[];
  qualityScore: number | null;
};

type TournamentVariantResult = {
  variantId: string;
  changeDescription: string;
  score: number;
  isBaseline: boolean;
};

// ─── Section type labels ──────────────────────────────────────────────────────

const SECTION_TYPE_LABELS: Record<string, string> = {
  narrative: "서술형",
  summary_table: "요약표",
  operations_timeline: "일정",
  case_study: "사례",
  survey_summary: "설문",
  recommendation: "제언",
  appendix: "부록",
  unknown: "기타",
};

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { id: "upload", label: "PPTX 업로드" },
  { id: "toc", label: "목차 확정" },
  { id: "generating", label: "초안 생성" },
  { id: "review", label: "섹션 검토" },
  { id: "complete", label: "피드백" },
  { id: "format", label: "문서 양식" },
] as const;

// ─── Format settings ──────────────────────────────────────────────────────────

type FormatPreset = "admin" | "report" | "institution" | "simple" | "custom";

type FormatSettings = {
  preset: FormatPreset;
  h1Marker: string;
  h2Marker: string;
  bulletMarker: string;
  h1FontSize: number;  // pt
  h2FontSize: number;  // pt
  bodyFontSize: number; // pt
};

const FORMAT_PRESETS: Record<FormatPreset, { label: string; desc: string; settings: Omit<FormatSettings, "preset"> }> = {
  admin: {
    label: "행정문서",
    desc: "■ / □ / -",
    settings: { h1Marker: "■", h2Marker: "□", bulletMarker: "-", h1FontSize: 14, h2FontSize: 12, bodyFontSize: 10 },
  },
  report: {
    label: "보고서형",
    desc: "1. / 가. / ○",
    settings: { h1Marker: "1.", h2Marker: "가.", bulletMarker: "○", h1FontSize: 16, h2FontSize: 13, bodyFontSize: 11 },
  },
  institution: {
    label: "기관보고서",
    desc: "▶ / ○ / ·",
    settings: { h1Marker: "▶", h2Marker: "○", bulletMarker: "·", h1FontSize: 14, h2FontSize: 12, bodyFontSize: 10 },
  },
  simple: {
    label: "간결형",
    desc: "마커 없음 / -",
    settings: { h1Marker: "", h2Marker: "", bulletMarker: "-", h1FontSize: 13, h2FontSize: 11, bodyFontSize: 10 },
  },
  custom: {
    label: "사용자 정의",
    desc: "직접 입력",
    settings: { h1Marker: "", h2Marker: "", bulletMarker: "-", h1FontSize: 14, h2FontSize: 12, bodyFontSize: 10 },
  },
};

const DEFAULT_FORMAT: FormatSettings = { preset: "admin", ...FORMAT_PRESETS.admin.settings };

/** ProseMirror JSONContent doc에 textStyle fontSize 마크를 재귀 주입 */
function applyFontSizesToDoc(
  node: import("@tiptap/core").JSONContent,
  format: Pick<FormatSettings, "h1FontSize" | "h2FontSize" | "bodyFontSize">,
): import("@tiptap/core").JSONContent {
  if (!node) return node;

  // 현재 노드가 text 타입이면 마크에 fontSize 추가 (부모에서 호출할 때 size를 넘겨줌)
  // → 이 함수는 노드 트리를 받아서 새 트리를 반환

  const cloneWithFontSize = (
    n: import("@tiptap/core").JSONContent,
    ptSize: number,
  ): import("@tiptap/core").JSONContent => {
    if (n.type !== "text") return n;
    const existingMarks = (n.marks ?? []).filter((m) => m.type !== "textStyle");
    return {
      ...n,
      marks: [
        ...existingMarks,
        { type: "textStyle", attrs: { fontSize: `${ptSize}pt` } },
      ],
    };
  };

  if (node.type === "heading") {
    const level = (node.attrs as { level?: number } | undefined)?.level ?? 1;
    const ptSize = level === 1 ? format.h1FontSize : format.h2FontSize;
    return {
      ...node,
      content: (node.content ?? []).map((child) => cloneWithFontSize(child, ptSize)),
    };
  }

  if (node.type === "paragraph") {
    return {
      ...node,
      content: (node.content ?? []).map((child) => cloneWithFontSize(child, format.bodyFontSize)),
    };
  }

  if (node.content) {
    return {
      ...node,
      content: node.content.map((child) => applyFontSizesToDoc(child, format)),
    };
  }

  return node;
}

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0 w-full max-w-2xl mx-auto">
      {STEPS.map((step, i) => {
        const isDone = i < currentIdx;
        const isActive = i === currentIdx;
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  isDone
                    ? "bg-notion-accent text-white"
                    : isActive
                      ? "bg-notion-accent text-white ring-4 ring-notion-accent-light"
                      : "bg-notion-bg-active text-notion-text-tertiary",
                ].join(" ")}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <span
                className={[
                  "text-xs whitespace-nowrap",
                  isActive ? "text-notion-accent font-medium" : "text-notion-text-tertiary",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={[
                  "flex-1 h-0.5 mx-1 mb-5 transition-colors",
                  isDone ? "bg-notion-accent" : "bg-notion-border",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Upload step ──────────────────────────────────────────────────────────────

function UploadStep({
  onNext,
}: {
  onNext: (params: { file: File; familyName: string }) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [familyName, setFamilyName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.name.endsWith(".pptx")) return;
    setFile(f);
    if (!familyName) {
      setFamilyName(f.name.replace(/\.pptx$/i, "").replace(/[-_]/g, " ") + " 보고서");
    }
  };

  return (
    <div className="flex flex-col gap-8 items-center w-full max-w-xl mx-auto">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-notion-text mb-2">PPTX 업로드</h2>
        <p className="text-notion-text-secondary text-sm">
          발표 자료를 올리면 AI가 보고서 목차를 제안합니다
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={[
          "w-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors",
          dragActive
            ? "border-notion-accent bg-notion-accent-light"
            : file
              ? "border-notion-green bg-green-50"
              : "border-notion-border hover:border-notion-border-strong hover:bg-notion-bg-hover",
        ].join(" ")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pptx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {file ? (
          <>
            <div className="text-3xl">📊</div>
            <div className="font-medium text-notion-text">{file.name}</div>
            <div className="text-xs text-notion-text-secondary">
              {(file.size / 1024).toFixed(0)} KB
            </div>
            <button
              className="text-xs text-notion-text-secondary hover:text-notion-red mt-1"
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
            >
              다른 파일 선택
            </button>
          </>
        ) : (
          <>
            <div className="text-3xl">📤</div>
            <div className="font-medium text-notion-text">PPTX 파일을 끌어다 놓거나 클릭하세요</div>
            <div className="text-xs text-notion-text-secondary">.pptx 파일만 지원됩니다</div>
          </>
        )}
      </div>

      {/* Family name */}
      <div className="w-full flex flex-col gap-2">
        <label className="text-sm font-medium text-notion-text-secondary">
          보고서 유형 이름
        </label>
        <input
          type="text"
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          placeholder="예: 해양수산 액셀러레이터 최종보고서"
          className="w-full px-3 py-2 rounded-lg border border-notion-border bg-notion-bg text-notion-text text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent focus:border-transparent placeholder:text-notion-text-tertiary"
        />
        <p className="text-xs text-notion-text-tertiary">
          동일한 유형의 PPTX를 다음에 올리면 이 이름으로 패턴을 재사용합니다
        </p>
      </div>

      <button
        disabled={!file || !familyName.trim()}
        onClick={() => file && onNext({ file, familyName: familyName.trim() })}
        className="w-full py-3 rounded-lg bg-notion-accent text-white font-medium text-sm hover:bg-notion-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        분석 시작 →
      </button>
    </div>
  );
}

// ─── TOC step ─────────────────────────────────────────────────────────────────

function TocStep({
  toc,
  isLoading,
  error,
  globalInstruction,
  sectionPlans,
  pptxPreviewUrl,
  onTocChange,
  onGlobalInstructionChange,
  onNext,
  onBack,
}: {
  toc: EditableTocEntry[];
  isLoading: boolean;
  error: string | null;
  globalInstruction: string;
  sectionPlans?: SectionPromptPlan[];
  pptxPreviewUrl?: string | null;
  onTocChange: (toc: EditableTocEntry[]) => void;
  onGlobalInstructionChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedInstructionId, setExpandedInstructionId] = useState<string | null>(null);
  const [expandedSlideId, setExpandedSlideId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(!!pptxPreviewUrl);

  const chunksByTocId = useMemo<Record<string, SlideChunk[]>>(() => {
    if (!sectionPlans) return {};
    return Object.fromEntries(
      sectionPlans.map((sp) => [sp.tocEntryId, sp.supportingChunks ?? []])
    );
  }, [sectionPlans]);

  const visibleToc = toc.filter((e) => !e.deleted);

  const move = (id: string, dir: -1 | 1) => {
    const visible = toc.filter((e) => !e.deleted);
    const idx = visible.findIndex((e) => e.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= visible.length) return;
    const newVisible = [...visible];
    [newVisible[idx], newVisible[newIdx]] = [newVisible[newIdx], newVisible[idx]];
    // Rebuild full list preserving deleted items at end
    const deleted = toc.filter((e) => e.deleted);
    onTocChange([...newVisible, ...deleted]);
  };

  const rename = (id: string) => {
    onTocChange(toc.map((e) => e.id === id ? { ...e, title: editValue } : e));
    setEditingId(null);
  };

  const remove = (id: string) => {
    onTocChange(toc.map((e) => e.id === id ? { ...e, deleted: true } : e));
  };

  const setSectionInstruction = (id: string, val: string) => {
    onTocChange(toc.map((e) => e.id === id ? { ...e, customInstruction: val } : e));
  };

  return (
    <div className={["flex gap-6 w-full", showPreview && pptxPreviewUrl ? "flex-row items-start" : "flex-col max-w-2xl mx-auto"].join(" ")}>
      {/* PPTX Office Online Viewer panel */}
      {showPreview && pptxPreviewUrl && (
        <div className="sticky top-4 flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-notion-text-secondary">슬라이드 미리보기</span>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="text-xs text-notion-text-tertiary hover:text-notion-text px-2 py-1 rounded hover:bg-notion-bg-active transition-colors"
            >
              닫기 ×
            </button>
          </div>
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(pptxPreviewUrl)}`}
            className="w-full rounded-lg border border-notion-border bg-notion-bg-hover"
            style={{ height: "70vh" }}
            title="PPTX 미리보기"
          />
          {pptxPreviewUrl.includes("localhost") && (
            <p className="text-[10px] text-notion-text-tertiary text-center">
              로컬 환경에서는 Microsoft Viewer가 파일에 접근할 수 없어 미리보기가 제한됩니다. Vercel 배포 후 정상 동작합니다.
            </p>
          )}
        </div>
      )}

      {/* TOC panel */}
      <div className={["flex flex-col gap-6", showPreview && pptxPreviewUrl ? "w-96 shrink-0" : "w-full"].join(" ")}>
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-notion-text mb-2">목차 확정</h2>
        <p className="text-notion-text-secondary text-sm">
          AI가 제안한 보고서 목차입니다. 순서 조정, 이름 변경, 삭제 후 확정하세요.
        </p>
        {pptxPreviewUrl && !showPreview && (
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
          >
            슬라이드 미리보기 열기 →
          </button>
        )}
      </div>

      {/* Global instruction */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-notion-text-secondary">
          전체 지시사항 <span className="text-notion-text-tertiary font-normal">(선택)</span>
        </label>
        <textarea
          value={globalInstruction}
          onChange={(e) => onGlobalInstructionChange(e.target.value)}
          rows={2}
          placeholder="예: 수치는 반드시 출처를 명시하고, 문어체로 작성해주세요."
          className="w-full px-3 py-2 rounded-lg border border-notion-border bg-notion-bg text-notion-text text-sm focus:outline-none focus:ring-2 focus:ring-notion-accent focus:border-transparent placeholder:text-notion-text-tertiary resize-none"
        />
        <p className="text-xs text-notion-text-tertiary">모든 섹션에 공통으로 전달할 작성 지시입니다</p>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="w-8 h-8 border-2 border-notion-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-notion-text-secondary">슬라이드 분석 중…</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-notion-red/30 rounded-lg px-4 py-3 text-sm text-notion-red">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="flex flex-col gap-2">
          {visibleToc.length === 0 && (
            <p className="text-center text-notion-text-tertiary text-sm py-8">
              목차 항목이 없습니다
            </p>
          )}
          {visibleToc.map((entry, i) => (
            <div
              key={entry.id}
              className="flex flex-col rounded-lg border border-notion-border bg-notion-bg hover:bg-notion-bg-hover group transition-colors"
            >
            <div className="flex items-center gap-3 p-3">
              {/* Order controls */}
              <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => move(entry.id, -1)}
                  disabled={i === 0}
                  className="text-notion-text-tertiary hover:text-notion-text disabled:opacity-20 leading-none text-xs px-1"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(entry.id, 1)}
                  disabled={i === visibleToc.length - 1}
                  className="text-notion-text-tertiary hover:text-notion-text disabled:opacity-20 leading-none text-xs px-1"
                >
                  ▼
                </button>
              </div>

              {/* Numbering */}
              {entry.numbering && (
                <span className="text-xs text-notion-text-tertiary font-mono w-8 shrink-0">
                  {entry.numbering}
                </span>
              )}

              {/* Title */}
              <div className="flex-1 min-w-0">
                {editingId === entry.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => rename(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(entry.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full text-sm text-notion-text bg-transparent border-b border-notion-accent focus:outline-none"
                  />
                ) : (
                  <span
                    className="text-sm text-notion-text cursor-text"
                    onDoubleClick={() => { setEditingId(entry.id); setEditValue(entry.title); }}
                  >
                    {entry.title}
                  </span>
                )}
              </div>

              {/* Section type badge */}
              <span className="text-xs px-2 py-0.5 rounded-full bg-notion-bg-active text-notion-text-secondary shrink-0">
                {SECTION_TYPE_LABELS[entry.sectionType ?? "unknown"] ?? entry.sectionType}
              </span>

              {/* Slide source badges */}
              {(chunksByTocId[entry.id] ?? []).slice(0, 3).map((chunk) => (
                <button
                  key={chunk.chunkId}
                  type="button"
                  onClick={() => {
                    setExpandedSlideId(expandedSlideId === entry.id ? null : entry.id);
                    setExpandedInstructionId(null);
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 shrink-0 transition-colors"
                  title={`슬라이드 ${chunk.slideNumber ?? "?"}: ${chunk.title}`}
                >
                  슬라이드 {chunk.slideNumber ?? "?"}
                </button>
              ))}

              {/* Actions */}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => {
                    setExpandedInstructionId(expandedInstructionId === entry.id ? null : entry.id);
                    setExpandedSlideId(null);
                  }}
                  className={[
                    "text-xs px-2 py-1 rounded transition-colors",
                    entry.customInstruction?.trim()
                      ? "text-notion-accent bg-notion-accent-light"
                      : "text-notion-text-secondary hover:bg-notion-bg-active",
                  ].join(" ")}
                  title="섹션 작성 지시 추가"
                >
                  지시
                </button>
                <button
                  onClick={() => { setEditingId(entry.id); setEditValue(entry.title); }}
                  className="text-xs px-2 py-1 rounded text-notion-text-secondary hover:bg-notion-bg-active"
                >
                  편집
                </button>
                <button
                  onClick={() => remove(entry.id)}
                  className="text-xs px-2 py-1 rounded text-notion-red/70 hover:bg-red-50"
                >
                  삭제
                </button>
              </div>
            </div>

            {/* Per-section instruction */}
            {expandedInstructionId === entry.id && (
              <div className="px-3 pb-3 pt-0">
                <textarea
                  autoFocus
                  value={entry.customInstruction ?? ""}
                  onChange={(e) => setSectionInstruction(entry.id, e.target.value)}
                  rows={2}
                  placeholder={`"${entry.title}" 섹션 전용 작성 지시 (예: 표 형태로 정리해주세요)`}
                  className="w-full px-3 py-2 rounded-lg border border-notion-accent/40 bg-notion-bg-secondary text-notion-text text-xs focus:outline-none focus:ring-1 focus:ring-notion-accent placeholder:text-notion-text-tertiary resize-none"
                />
              </div>
            )}

            {/* Slide reference cards */}
            {expandedSlideId === entry.id && (chunksByTocId[entry.id] ?? []).length > 0 && (
              <div className="px-3 pb-3 pt-0 flex flex-col gap-2">
                <p className="text-[10px] text-notion-text-tertiary">참고한 슬라이드</p>
                {(chunksByTocId[entry.id] ?? []).map((chunk) => (
                  <div
                    key={chunk.chunkId}
                    className={[
                      "rounded-lg border p-3 text-xs",
                      chunk.score < 0.3
                        ? "border-slate-200 bg-slate-50 opacity-60"
                        : "border-blue-200 bg-blue-50",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px]">
                        슬라이드 {chunk.slideNumber ?? "?"}
                      </span>
                      <span className="font-medium text-notion-text truncate">{chunk.title}</span>
                      {chunk.score < 0.3 && (
                        <span className="text-notion-text-tertiary ml-auto shrink-0">관련성 낮음</span>
                      )}
                    </div>
                    {chunk.summary && (
                      <p className="text-notion-text-secondary leading-relaxed">{chunk.summary}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
          ))}

          <p className="text-xs text-notion-text-tertiary text-center mt-2">
            항목 이름을 더블클릭하면 수정할 수 있습니다
          </p>
        </div>
      )}

      <div className="flex gap-3 mt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg border border-notion-border text-notion-text-secondary text-sm hover:bg-notion-bg-hover transition-colors"
        >
          ← 이전
        </button>
        <button
          onClick={onNext}
          disabled={isLoading || visibleToc.length === 0}
          className="flex-1 py-2 rounded-lg bg-notion-accent text-white font-medium text-sm hover:bg-notion-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          목차 확정 → 초안 생성
        </button>
      </div>
      </div>{/* end TOC panel */}
    </div>
  );
}

// ─── Generating step ──────────────────────────────────────────────────────────

function GeneratingStep({
  total,
  completed,
  currentTitle,
  error,
}: {
  total: number;
  completed: number;
  currentTitle: string;
  error: string | null;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-8 items-center w-full max-w-md mx-auto">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-notion-text mb-2">초안 생성 중</h2>
        <p className="text-notion-text-secondary text-sm">
          섹션별로 AI 초안을 생성하고 있습니다
        </p>
      </div>

      {error ? (
        <div className="bg-red-50 border border-notion-red/30 rounded-lg px-4 py-3 text-sm text-notion-red w-full">
          {error}
        </div>
      ) : (
        <>
          <div className="w-full">
            <div className="flex justify-between text-xs text-notion-text-secondary mb-2">
              <span>{currentTitle || "준비 중…"}</span>
              <span>{completed} / {total}</span>
            </div>
            <div className="w-full bg-notion-bg-active rounded-full h-2">
              <div
                className="bg-notion-accent h-2 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-notion-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-notion-text-secondary">
              {pct}% 완료
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Review step ──────────────────────────────────────────────────────────────

function ReviewStep({
  reviews,
  currentIdx,
  onAction,
  onNavigate,
}: {
  reviews: SectionReview[];
  currentIdx: number;
  onAction: (idx: number, action: "accept" | "edit" | "reject", edited?: string[]) => void;
  onNavigate: (idx: number) => void;
}) {
  const review = reviews[currentIdx];
  const [editMode, setEditMode] = useState(false);
  const [editedParagraphs, setEditedParagraphs] = useState<string[]>([]);
  const [qualityScore, setQualityScore] = useState<number | null>(null);

  const startEdit = () => {
    setEditedParagraphs([...review.section.paragraphs]);
    setEditMode(true);
  };

  const doneCount = reviews.filter((r) => r.status !== "pending").length;

  const statusBadge = (s: SectionReview["status"]) => {
    const map = {
      pending: { label: "대기", cls: "bg-notion-bg-active text-notion-text-tertiary" },
      accepted: { label: "승인", cls: "bg-green-100 text-green-700" },
      edited: { label: "편집", cls: "bg-blue-100 text-blue-700" },
      rejected: { label: "거절", cls: "bg-red-100 text-notion-red" },
    };
    return map[s];
  };

  return (
    <div className="flex gap-6 w-full max-w-5xl mx-auto">
      {/* Section list sidebar */}
      <div className="w-52 shrink-0 flex flex-col gap-1">
        <div className="text-xs font-medium text-notion-text-secondary mb-2 px-1">
          {doneCount} / {reviews.length} 완료
        </div>
        {reviews.map((r, i) => {
          const badge = statusBadge(r.status);
          return (
            <button
              key={r.section.tocEntryId}
              onClick={() => onNavigate(i)}
              className={[
                "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors",
                i === currentIdx
                  ? "bg-notion-accent-light text-notion-accent font-medium"
                  : "text-notion-text-secondary hover:bg-notion-bg-hover",
              ].join(" ")}
            >
              <div className="truncate mb-1">{r.section.title}</div>
              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${badge.cls}`}>
                {badge.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main review panel */}
      <div className="flex-1 flex flex-col gap-5 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-notion-text-tertiary mb-1">
              {SECTION_TYPE_LABELS[review.section.sectionType] ?? review.section.sectionType}
            </div>
            <h3 className="text-lg font-semibold text-notion-text leading-tight">
              {review.section.title}
            </h3>
          </div>
          {/* Quality score */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-notion-text-tertiary">품질</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setQualityScore(n)}
                className={[
                  "text-lg leading-none transition-colors",
                  (qualityScore ?? 0) >= n ? "text-notion-yellow" : "text-notion-bg-active",
                ].join(" ")}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 rounded-lg border border-notion-border bg-notion-bg-secondary p-4 min-h-64 overflow-y-auto">
          {editMode ? (
            <div className="flex flex-col gap-3">
              {editedParagraphs.map((p, pi) => (
                <div key={pi} className="flex gap-2">
                  <textarea
                    value={p}
                    onChange={(e) => {
                      const next = [...editedParagraphs];
                      next[pi] = e.target.value;
                      setEditedParagraphs(next);
                    }}
                    rows={3}
                    className="flex-1 text-sm text-notion-text bg-notion-bg border border-notion-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-notion-accent"
                  />
                  <button
                    onClick={() => setEditedParagraphs(editedParagraphs.filter((_, j) => j !== pi))}
                    className="text-notion-text-tertiary hover:text-notion-red text-xs self-start mt-2"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditedParagraphs([...editedParagraphs, ""])}
                className="text-xs text-notion-text-secondary hover:text-notion-text border border-dashed border-notion-border rounded-lg px-3 py-2"
              >
                + 문단 추가
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {review.section.paragraphs.length === 0 ? (
                <p className="text-notion-text-tertiary text-sm italic">내용 없음</p>
              ) : (
                review.section.paragraphs.map((p, pi) => (
                  <p key={pi} className="text-sm text-notion-text leading-relaxed">
                    {p}
                  </p>
                ))
              )}
              {review.section.table && (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr>
                        {review.section.table.headers.map((h, hi) => (
                          <th
                            key={hi}
                            className="border border-notion-border px-3 py-1.5 bg-notion-bg-active text-notion-text text-left font-medium"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {review.section.table.rows.map((row, ri) => (
                        <tr key={ri} className="even:bg-notion-bg-secondary">
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="border border-notion-border px-3 py-1.5 text-notion-text"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {editMode ? (
            <>
              <button
                onClick={() => setEditMode(false)}
                className="px-4 py-2 rounded-lg border border-notion-border text-notion-text-secondary text-sm hover:bg-notion-bg-hover"
              >
                취소
              </button>
              <button
                onClick={() => {
                  onAction(currentIdx, "edit", editedParagraphs);
                  setEditMode(false);
                }}
                className="flex-1 py-2 rounded-lg bg-notion-accent text-white font-medium text-sm hover:bg-notion-accent-hover"
              >
                편집 저장 ✓
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onAction(currentIdx, "reject")}
                className="px-4 py-2 rounded-lg border border-notion-red/30 text-notion-red text-sm hover:bg-red-50"
              >
                거절
              </button>
              <button
                onClick={startEdit}
                className="px-4 py-2 rounded-lg border border-notion-border text-notion-text-secondary text-sm hover:bg-notion-bg-hover"
              >
                편집
              </button>
              <button
                onClick={() => onAction(currentIdx, "accept")}
                className="flex-1 py-2 rounded-lg bg-notion-green text-white font-medium text-sm hover:opacity-90"
              >
                승인 ✓
              </button>
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <button
            onClick={() => onNavigate(Math.max(0, currentIdx - 1))}
            disabled={currentIdx === 0}
            className="text-sm text-notion-text-secondary hover:text-notion-text disabled:opacity-30 px-2 py-1"
          >
            ← 이전 섹션
          </button>
          <button
            onClick={() => onNavigate(Math.min(reviews.length - 1, currentIdx + 1))}
            disabled={currentIdx === reviews.length - 1}
            className="text-sm text-notion-text-secondary hover:text-notion-text disabled:opacity-30 px-2 py-1"
          >
            다음 섹션 →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Format step ──────────────────────────────────────────────────────────────

function FormatStep({
  draft,
  familyName,
  format,
  onFormatChange,
  onOpenEditor,
  onBack,
}: {
  draft: import("@/lib/report-family-draft-generator").ReportFamilyDraft | null;
  familyName: string;
  format: FormatSettings;
  onFormatChange: (f: FormatSettings) => void;
  onOpenEditor: () => void;
  onBack: () => void;
}) {
  const previewSection = draft?.sections[0] ?? null;

  const handleDownloadMarkdown = () => {
    if (!draft) return;
    const { draftToMarkdown, downloadMarkdown } = require("@/lib/editor/export-markdown") as typeof import("@/lib/editor/export-markdown");
    const md = draftToMarkdown({
      familyName: format.h1Marker ? `${format.h1Marker} ${draft.familyName}` : draft.familyName,
      sections: draft.sections.map((s) => ({
        title: format.h2Marker ? `${format.h2Marker} ${s.title}` : s.title,
        paragraphs: s.paragraphs.map((p) => format.bulletMarker ? `${format.bulletMarker} ${p}` : p),
        table: s.table,
      })),
    });
    downloadMarkdown(md, familyName || draft.familyName);
  };

  const setPreset = (preset: FormatPreset) => {
    if (preset === "custom") {
      onFormatChange({ ...format, preset });
    } else {
      onFormatChange({ preset, ...FORMAT_PRESETS[preset].settings });
    }
  };

  const mark = (marker: string, text: string) =>
    marker ? `${marker} ${text}` : text;

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-notion-text mb-1">문서 양식 설정</h2>
        <p className="text-notion-text-tertiary text-xs">
          한국 공문서 양식을 선택하고 에디터에서 열어보세요
        </p>
      </div>

      {/* Preset selector */}
      <div className="grid grid-cols-5 gap-2">
        {(Object.entries(FORMAT_PRESETS) as [FormatPreset, (typeof FORMAT_PRESETS)[FormatPreset]][]).map(([key, p]) => (
          <button
            key={key}
            onClick={() => setPreset(key)}
            className={[
              "flex flex-col items-center gap-1 p-3 rounded-xl border text-center transition-all",
              format.preset === key
                ? "border-notion-accent bg-notion-accent-light text-notion-accent"
                : "border-notion-border bg-notion-bg text-notion-text-secondary hover:bg-notion-bg-hover",
            ].join(" ")}
          >
            <span className="text-xs font-medium">{p.label}</span>
            <span className="text-[10px] text-notion-text-tertiary font-mono leading-tight">{p.desc}</span>
          </button>
        ))}
      </div>

      {/* Marker + font size customizer */}
      <div className="rounded-xl border border-notion-border bg-notion-bg-secondary p-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-x-6">
          {/* Left: markers */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-notion-text-secondary">마커</p>
            {[
              { label: "대제목", key: "h1Marker" as const, placeholder: "■ □ ▶ 1." },
              { label: "중제목", key: "h2Marker" as const, placeholder: "□ ○ 가." },
              { label: "항목", key: "bulletMarker" as const, placeholder: "- · ○ ①" },
            ].map(({ label, key, placeholder }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-notion-text-tertiary w-12 shrink-0">{label}</span>
                <input
                  type="text"
                  value={format[key]}
                  onChange={(e) => onFormatChange({ ...format, preset: "custom", [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-14 px-2 py-1 rounded-lg border border-notion-border bg-notion-bg text-notion-text text-xs font-mono focus:outline-none focus:ring-1 focus:ring-notion-accent text-center"
                />
              </div>
            ))}
          </div>

          {/* Right: font sizes */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-notion-text-secondary">폰트 크기</p>
            {[
              { label: "대제목", key: "h1FontSize" as const },
              { label: "중제목", key: "h2FontSize" as const },
              { label: "본문", key: "bodyFontSize" as const },
            ].map(({ label, key }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-notion-text-tertiary w-12 shrink-0">{label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={6}
                    max={36}
                    value={format[key]}
                    onChange={(e) => onFormatChange({ ...format, preset: "custom", [key]: Number(e.target.value) })}
                    className="w-14 px-2 py-1 rounded-lg border border-notion-border bg-notion-bg text-notion-text text-xs font-mono focus:outline-none focus:ring-1 focus:ring-notion-accent text-center"
                  />
                  <span className="text-xs text-notion-text-tertiary">pt</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-notion-border bg-notion-bg overflow-hidden">
        <div className="px-4 py-2 border-b border-notion-border bg-notion-bg-secondary flex items-center gap-2">
          <span className="text-[10px] text-notion-text-tertiary uppercase tracking-wide">미리보기</span>
          <span className="text-[10px] text-notion-text-tertiary">— {familyName || "보고서"}</span>
        </div>
        <div className="p-5 leading-7 text-notion-text space-y-1">
          <p className="font-semibold" style={{ fontSize: `${format.h1FontSize}pt` }}>
            {mark(format.h1Marker, previewSection?.title ?? "1. 서론 및 배경")}
          </p>
          {(previewSection?.paragraphs.slice(0, 3) ?? [
            "본 보고서는 사업 추진 경과 및 주요 성과를 정리한 자료입니다.",
            "세부 내용은 아래와 같습니다.",
            "관련 데이터는 붙임 자료를 참조하시기 바랍니다.",
          ]).map((p, i) => (
            <p key={i} className="pl-3 text-notion-text-secondary" style={{ fontSize: `${format.bodyFontSize}pt` }}>
              {mark(format.bulletMarker, p.length > 60 ? p.slice(0, 60) + "…" : p)}
            </p>
          ))}
          {previewSection?.table && (
            <p className="pl-3 text-notion-text-tertiary text-xs italic">
              {mark(format.bulletMarker, `[표] ${previewSection.table.headers.join(" / ")}`)}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg border border-notion-border text-notion-text-secondary text-sm hover:bg-notion-bg-hover transition-colors"
        >
          ← 이전
        </button>
        <button
          onClick={handleDownloadMarkdown}
          className="px-4 py-2.5 rounded-xl border border-notion-border text-notion-text-secondary text-sm font-medium hover:bg-notion-bg-hover transition-colors"
        >
          MD 다운로드
        </button>
        <button
          onClick={onOpenEditor}
          className="flex-1 py-2.5 rounded-xl bg-notion-accent text-white font-medium text-sm hover:bg-notion-accent-hover transition-colors"
        >
          HWPX 에디터에서 열기 →
        </button>
      </div>
    </div>
  );
}

// ─── Complete step ────────────────────────────────────────────────────────────

function CompleteStep({
  reviews,
  rewardScore,
  tournamentVariants,
  tournamentLoading,
  onSelectWinner,
  onRunTournament,
  onFinish,
  onNextFormat,
  familyId,
}: {
  reviews: SectionReview[];
  rewardScore: number | null;
  tournamentVariants: TournamentVariantResult[];
  tournamentLoading: boolean;
  onSelectWinner: (variantId: string) => void;
  onRunTournament: () => void;
  onFinish: () => void;
  onNextFormat: () => void;
  familyId: string | null;
}) {
  const accepted = reviews.filter((r) => r.status === "accepted").length;
  const edited = reviews.filter((r) => r.status === "edited").length;
  const rejected = reviews.filter((r) => r.status === "rejected").length;
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center pt-2">
        <h2 className="text-xl font-semibold text-notion-text mb-1">검토 완료</h2>
        <p className="text-notion-text-tertiary text-xs">
          피드백이 저장되었습니다. 다음 번 생성 시 자동으로 반영됩니다.
        </p>
      </div>

      {/* Stats — glassmorphism cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "승인", count: accepted },
          { label: "편집", count: edited },
          { label: "거절", count: rejected },
        ].map(({ label, count }) => (
          <div
            key={label}
            className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-sm p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
          >
            <div className="text-2xl font-light text-notion-text">{count}</div>
            <div className="text-xs text-notion-text-tertiary mt-1 tracking-wide uppercase">{label}</div>
          </div>
        ))}
      </div>

      {/* Reward score */}
      {rewardScore !== null && (
        <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-sm p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs text-notion-text-secondary tracking-wide uppercase">AI 초안 품질</span>
            <span className="text-xl font-light text-notion-text">
              {(rewardScore * 100).toFixed(0)}<span className="text-sm ml-0.5 text-notion-text-tertiary">점</span>
            </span>
          </div>
          <div className="w-full bg-black/10 rounded-full h-1">
            <div
              className="h-1 rounded-full bg-notion-text/40 transition-all duration-700"
              style={{ width: `${rewardScore * 100}%` }}
            />
          </div>
          <p className="text-xs text-notion-text-tertiary mt-2.5">
            {rewardScore >= 0.85
              ? "매우 좋은 초안입니다"
              : rewardScore >= 0.5
                ? "검토자 수정이 반영되어 다음 생성에서 개선됩니다"
                : "많은 수정이 있었습니다. 패턴 학습 후 다음 생성에서 크게 개선됩니다"}
          </p>
        </div>
      )}

      {/* Tournament section */}
      {familyId && (
        <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-sm p-5 flex flex-col gap-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-notion-text">프롬프트 토너먼트</h3>
              <p className="text-xs text-notion-text-tertiary mt-0.5">
                쌓인 피드백 패턴으로 프롬프트 변형을 비교합니다
              </p>
            </div>
            {tournamentVariants.length === 0 && (
              <button
                onClick={onRunTournament}
                disabled={tournamentLoading}
                className="px-3 py-1.5 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-notion-text-secondary text-xs hover:bg-white/20 disabled:opacity-40 transition-colors"
              >
                {tournamentLoading ? "실행 중…" : "실행"}
              </button>
            )}
          </div>

          {tournamentVariants.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-notion-text-tertiary">다음 생성에 사용할 프롬프트를 선택하세요</p>
              {tournamentVariants.map((v) => (
                <label
                  key={v.variantId}
                  className={[
                    "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                    selectedVariant === v.variantId
                      ? "border-white/30 bg-white/20"
                      : "border-white/10 bg-white/5 hover:bg-white/10",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="tournament-winner"
                    value={v.variantId}
                    checked={selectedVariant === v.variantId}
                    onChange={() => setSelectedVariant(v.variantId)}
                    className="accent-notion-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-notion-text">{v.changeDescription}</span>
                      {v.isBaseline && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-notion-text-tertiary">
                          현재
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-20 bg-black/10 rounded-full h-1">
                        <div
                          className="bg-notion-text/30 h-1 rounded-full"
                          style={{ width: `${v.score * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-notion-text-tertiary">
                        {(v.score * 100).toFixed(1)}점
                      </span>
                    </div>
                  </div>
                </label>
              ))}

              {selectedVariant && (
                <button
                  onClick={() => onSelectWinner(selectedVariant)}
                  className="w-full py-2 rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm text-notion-text text-sm hover:bg-white/20 transition-colors mt-1"
                >
                  선택 적용 →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onFinish}
          className="px-4 py-2.5 rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm text-notion-text-secondary text-sm hover:bg-white/20 transition-colors"
        >
          메인으로
        </button>
        <button
          onClick={onNextFormat}
          className="flex-1 py-2.5 rounded-xl bg-notion-accent text-white font-medium text-sm hover:bg-notion-accent-hover transition-colors"
        >
          문서 양식 설정 →
        </button>
      </div>
    </div>
  );
}

// ─── Main wizard page ─────────────────────────────────────────────────────────

export default function ReportFamilyWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("upload");

  // Upload step
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [familyName, setFamilyName] = useState("");

  // TOC step
  const [plan, setPlan] = useState<ReportFamilyPlan | null>(null);
  const [toc, setToc] = useState<EditableTocEntry[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [tocError, setTocError] = useState<string | null>(null);
  const [globalInstruction, setGlobalInstruction] = useState("");

  // PPTX preview
  const [pptxPreviewUrl, setPptxPreviewUrl] = useState<string | null>(null);

  // Generating step
  const [draft, setDraft] = useState<ReportFamilyDraft | null>(null);
  const [genProgress, setGenProgress] = useState({ completed: 0, total: 0, currentTitle: "" });
  const [genError, setGenError] = useState<string | null>(null);
  const [generationRunId, setGenerationRunId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);

  // Review step
  const [reviews, setReviews] = useState<SectionReview[]>([]);
  const [currentReviewIdx, setCurrentReviewIdx] = useState(0);

  // Complete step
  const [rewardScore, setRewardScore] = useState<number | null>(null);
  const [tournamentVariants, setTournamentVariants] = useState<TournamentVariantResult[]>([]);
  const [tournamentLoading, setTournamentLoading] = useState(false);

  // ── Step 1 → 2: Upload + build plan ──
  const handleUpload = useCallback(async ({ file, familyName: name }: { file: File; familyName: string }) => {
    setUploadFile(file);
    setFamilyName(name);
    setStep("toc");
    setTocLoading(true);
    setTocError(null);
    setPptxPreviewUrl(null);

    // Fire-and-forget: upload PPTX for Office Online Viewer preview
    void (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("fileName", file.name);
        const uploadRes = await fetch("/api/blob/upload", { method: "POST", body: fd });
        if (uploadRes.ok) {
          const data = (await uploadRes.json()) as { downloadUrl?: string };
          if (data.downloadUrl) {
            setPptxPreviewUrl(`${window.location.origin}${data.downloadUrl}`);
          }
        }
      } catch {
        // preview unavailable — silently ignore
      }
    })();

    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parsePptxToProseMirror(buffer);
      const outline = buildOutlineFromDoc(parsed.doc);

      const payload = buildPptxReportFamilyPlanPayload({
        familyName: name,
        fileName: file.name,
        segments: parsed.segments,
        outline,
      });

      const res = await fetch("/api/report-family/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await res.json()) as ReportFamilyPlan & { error?: string };
      if (!res.ok) throw new Error(result.error || "목차 추출 실패");

      setPlan(result);
      // Enrich TOC entries with sectionType from sectionPlans
      const sectionTypeById = new Map(result.sectionPlans.map((s) => [s.tocEntryId, s.sectionType]));
      setToc(result.toc.map((e) => ({ ...e, sectionType: sectionTypeById.get(e.id) ?? "unknown" })) as EditableTocEntry[]);
      setFamilyId(result.familyId);
    } catch (e) {
      setTocError(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setTocLoading(false);
    }
  }, []);

  // ── Step 2 → 3: Confirm TOC + generate draft ──
  const handleTocConfirm = useCallback(async () => {
    if (!plan) return;
    setStep("generating");
    setGenError(null);

    const confirmedTocIds = new Set(toc.filter((e) => !e.deleted).map((e) => e.id));
    const orderedToc = toc.filter((e) => !e.deleted);

    // Build modified plan with confirmed TOC order + titles
    const tocByOrigId = new Map(toc.map((e) => [e.id, e]));
    const modifiedPlan: ReportFamilyPlan = {
      ...plan,
      toc: orderedToc,
      sectionPlans: orderedToc
        .map((tocEntry) => {
          const sp = plan.sectionPlans.find((s) => s.tocEntryId === tocEntry.id);
          if (!sp) return null;
          return { ...sp, tocTitle: tocByOrigId.get(tocEntry.id)?.title ?? sp.tocTitle };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null && confirmedTocIds.has(s.tocEntryId)),
    };

    setGenProgress({ completed: 0, total: modifiedPlan.sectionPlans.length, currentTitle: "준비 중…" });

    try {
      // Ensure family exists in DB
      let resolvedFamilyId = familyId;
      if (!resolvedFamilyId) {
        const famRes = await fetch("/api/training/families", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: familyName, description: uploadFile?.name ?? "" }),
        });
        if (famRes.ok) {
          const { family } = (await famRes.json()) as { family: { id: string } };
          resolvedFamilyId = family.id;
          setFamilyId(resolvedFamilyId);
        }
      }

      // Build per-section instruction map from toc entries
      const sectionInstructions: Record<string, string> = {};
      for (const entry of toc) {
        if (!entry.deleted && entry.customInstruction?.trim()) {
          sectionInstructions[entry.id] = entry.customInstruction.trim();
        }
      }

      // ── 단일 SSE 스트림 요청 → 섹션 완료마다 실시간 진행률 업데이트 ──
      const totalSections = modifiedPlan.sectionPlans.length;
      setGenProgress({ completed: 0, total: totalSections, currentTitle: "준비 중…" });

      const res = await fetch("/api/report-family/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: modifiedPlan,
          model: "gpt-4.1-mini",
          maxAttempts: 2,
          ...(resolvedFamilyId ? { saveGenerationRun: true, familyId: resolvedFamilyId } : {}),
          ...(globalInstruction.trim() ? { globalInstruction: globalInstruction.trim() } : {}),
          ...(Object.keys(sectionInstructions).length ? { sectionInstructions } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "초안 생성 실패");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let mergedDraft: ReportFamilyDraft | null = null;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const messages = sseBuffer.split("\n\n");
        sseBuffer = messages.pop() ?? "";

        for (const msg of messages) {
          if (!msg.trim()) continue;
          let eventType = "message";
          let dataStr = "";
          for (const line of msg.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;

          if (eventType === "section_complete") {
            const payload = JSON.parse(dataStr) as { currentTitle: string; completedCount: number; totalCount: number };
            setGenProgress({ completed: payload.completedCount, total: payload.totalCount, currentTitle: payload.currentTitle });
          } else if (eventType === "done") {
            const payload = JSON.parse(dataStr) as { draft: ReportFamilyDraft; generationRunId?: string; usage: unknown };
            mergedDraft = payload.draft;
            if (payload.generationRunId) setGenerationRunId(payload.generationRunId);
            break outer;
          } else if (eventType === "error") {
            const payload = JSON.parse(dataStr) as { message: string };
            throw new Error(payload.message || "초안 생성 실패");
          }
        }
      }

      if (!mergedDraft) throw new Error("초안 데이터를 받지 못했습니다.");

      setDraft(mergedDraft);
      setGenProgress({ completed: totalSections, total: totalSections, currentTitle: "완료" });

      // Initialize reviews
      setReviews(
        mergedDraft.sections.map((s) => ({
          section: s,
          status: "pending",
          editedParagraphs: [...s.paragraphs],
          qualityScore: null,
        })),
      );

      setStep("review");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "초안 생성 실패");
    }
  }, [plan, toc, familyId, familyName, uploadFile, globalInstruction]);

  // ── Step 3 → 4: Review actions ──
  const handleReviewAction = useCallback((
    idx: number,
    action: "accept" | "edit" | "reject",
    edited?: string[],
  ) => {
    setReviews((prev) =>
      prev.map((r, i) =>
        i === idx
          ? {
              ...r,
              status: action === "edit" ? "edited" : action === "accept" ? "accepted" : "rejected",
              editedParagraphs: edited ?? r.editedParagraphs,
            }
          : r,
      ),
    );
    // Auto-advance to next pending section
    const next = reviews.findIndex((r, i) => i > idx && r.status === "pending");
    if (next >= 0) setCurrentReviewIdx(next);
  }, [reviews]);

  // ── Step 4 → 5: Submit feedback + go to complete ──
  const handleReviewComplete = useCallback(async () => {
    if (!generationRunId && !familyId) {
      setStep("complete");
      return;
    }

    try {
      // Build human sections from review results
      const humanSections = reviews
        .filter((r) => r.status !== "rejected")
        .map((r) => ({
          ...r.section,
          paragraphs: r.status === "edited" ? r.editedParagraphs : r.section.paragraphs,
        }));

      const body = {
        generationRunId: generationRunId ?? undefined,
        familyId: familyId ?? undefined,
        humanSections,
        qualityScore: (() => {
          const scores = reviews.map((r) => r.qualityScore).filter((s): s is number => s !== null);
          return scores.length ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : null;
        })(),
        savePreferences: true,
      };

      await fetch("/api/feedback/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Promote patterns to PromptMemory
      if (familyId) {
        await fetch("/api/feedback/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ familyId }),
        });
      }

      // Compute reward score
      if (generationRunId) {
        const evalRes = await fetch("/api/rlhf/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationRunId, applyGate: true }),
        });
        if (evalRes.ok) {
          const { reward } = (await evalRes.json()) as { reward?: { score: number } };
          if (reward) setRewardScore(reward.score);
        }
      }
    } catch {
      // Non-fatal
    }

    setStep("complete");
  }, [generationRunId, familyId, reviews]);

  // ── Tournament ──
  const handleRunTournament = useCallback(async () => {
    if (!familyId) return;
    setTournamentLoading(true);
    try {
      // Get unique section types in this draft
      const sectionTypes = [...new Set(reviews.map((r) => r.section.sectionType))];
      const firstType = sectionTypes[0];
      if (!firstType) return;

      const res = await fetch("/api/rlhf/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, sectionType: firstType, promoteWinner: false }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { tournamentRun?: { variants: Array<{ variantId: string; changeDescription: string }>; results: Array<{ variantId: string; reward: { score: number } }> } };
      const run = data.tournamentRun;
      if (!run) return;

      const variants: TournamentVariantResult[] = run.variants.map((v) => {
        const result = run.results.find((r) => r.variantId === v.variantId);
        return {
          variantId: v.variantId,
          changeDescription: v.changeDescription,
          score: result?.reward.score ?? 0,
          isBaseline: v.variantId === "baseline",
        };
      });
      setTournamentVariants(variants.sort((a, b) => b.score - a.score));
    } finally {
      setTournamentLoading(false);
    }
  }, [familyId, reviews]);

  const handleSelectWinner = useCallback(async (variantId: string) => {
    if (!familyId) return;
    const sectionType = reviews[0]?.section.sectionType;
    if (!sectionType) return;
    await fetch("/api/rlhf/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyId, sectionType, promoteWinner: true }),
    });
    setTournamentVariants((prev) =>
      prev.map((v) => ({ ...v, isBaseline: v.variantId === variantId })),
    );
  }, [familyId, reviews]);

  // ── Format settings ──
  const [formatSettings, setFormatSettings] = useState<FormatSettings>(DEFAULT_FORMAT);

  const handleOpenEditor = useCallback(() => {
    if (!draft) return;
    // Apply format markers to the draft before sending to editor
    const formattedDraft = {
      ...draft,
      sections: draft.sections.map((s) => ({
        ...s,
        title: formatSettings.h2Marker
          ? `${formatSettings.h2Marker} ${s.title}`
          : s.title,
        paragraphs: s.paragraphs.map((p) =>
          formatSettings.bulletMarker ? `${formatSettings.bulletMarker} ${p}` : p,
        ),
      })),
      familyName: formatSettings.h1Marker
        ? `${formatSettings.h1Marker} ${draft.familyName}`
        : draft.familyName,
    };

    sessionStorage.setItem(
      "pendingWizardDraft",
      JSON.stringify({
        draft: formattedDraft,
        fileName: familyName,
        formatSettings,   // 에디터에서 fontSize 마크 주입에 사용
      }),
    );
    router.push("/");
  }, [draft, familyName, formatSettings, router]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const doneCount = reviews.filter((r) => r.status !== "pending").length;
  const allReviewed = reviews.length > 0 && doneCount === reviews.length;

  return (
    <div className={["min-h-screen transition-colors duration-500", (step === "complete" || step === "format") ? "bg-gradient-to-br from-slate-100 via-stone-50 to-zinc-100" : "bg-notion-bg"].join(" ")}>
      {/* Header */}
      <div className="border-b border-notion-border bg-notion-bg sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="text-notion-text-secondary hover:text-notion-text text-sm"
          >
            ← 나가기
          </button>
          <div className="flex-1">
            <h1 className="text-sm font-semibold text-notion-text">
              보고서 생성 마법사
            </h1>
            {familyName && (
              <p className="text-xs text-notion-text-tertiary">{familyName}</p>
            )}
          </div>
          {step === "review" && reviews.length > 0 && (
            <button
              onClick={() => void handleReviewComplete()}
              disabled={doneCount === 0}
              className={[
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                allReviewed
                  ? "bg-notion-accent text-white hover:bg-notion-accent-hover"
                  : "bg-notion-bg-active text-notion-text-secondary hover:bg-notion-bg-hover",
              ].join(" ")}
            >
              {allReviewed ? "검토 완료 →" : `완료 (${doneCount}/${reviews.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Step indicator */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        <StepIndicator current={step} />
      </div>

      {/* Step content */}
      <div className="max-w-6xl mx-auto px-6 pb-16">
        {step === "upload" && (
          <UploadStep onNext={(params) => void handleUpload(params)} />
        )}
        {step === "toc" && (
          <TocStep
            toc={toc}
            isLoading={tocLoading}
            error={tocError}
            globalInstruction={globalInstruction}
            sectionPlans={plan?.sectionPlans}
            pptxPreviewUrl={pptxPreviewUrl}
            onTocChange={setToc}
            onGlobalInstructionChange={setGlobalInstruction}
            onNext={() => void handleTocConfirm()}
            onBack={() => setStep("upload")}
          />
        )}
        {step === "generating" && (
          <GeneratingStep
            total={genProgress.total}
            completed={genProgress.completed}
            currentTitle={genProgress.currentTitle}
            error={genError}
          />
        )}
        {step === "review" && reviews.length > 0 && (
          <ReviewStep
            reviews={reviews}
            currentIdx={currentReviewIdx}
            onAction={handleReviewAction}
            onNavigate={setCurrentReviewIdx}
          />
        )}
        {step === "complete" && (
          <CompleteStep
            reviews={reviews}
            rewardScore={rewardScore}
            tournamentVariants={tournamentVariants}
            tournamentLoading={tournamentLoading}
            onSelectWinner={(id) => void handleSelectWinner(id)}
            onRunTournament={() => void handleRunTournament()}
            onFinish={() => router.push("/")}
            onNextFormat={() => setStep("format")}
            familyId={familyId}
          />
        )}
        {step === "format" && (
          <FormatStep
            draft={draft}
            familyName={familyName}
            format={formatSettings}
            onFormatChange={setFormatSettings}
            onOpenEditor={handleOpenEditor}
            onBack={() => setStep("complete")}
          />
        )}
      </div>
    </div>
  );
}
