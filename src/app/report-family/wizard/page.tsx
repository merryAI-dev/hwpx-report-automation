"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parsePptxToProseMirror } from "@/lib/editor/pptx-to-prosemirror";
import { buildOutlineFromDoc } from "@/lib/editor/document-store";
import {
  buildPptxReportFamilyPlanPayload,
} from "@/lib/report-family-planner";
import type { ReportFamilyPlan, TocEntry } from "@/lib/report-family-planner";
import type { ReportFamilyDraft, ReportFamilyDraftSection } from "@/lib/report-family-draft-generator";

// ─── Step types ───────────────────────────────────────────────────────────────

type WizardStep = "upload" | "toc" | "generating" | "review" | "complete";

type EditableTocEntry = TocEntry & { deleted?: boolean; sectionType?: string };

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
  { id: "complete", label: "완료" },
] as const;

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
  onTocChange,
  onNext,
  onBack,
}: {
  toc: EditableTocEntry[];
  isLoading: boolean;
  error: string | null;
  onTocChange: (toc: EditableTocEntry[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-notion-text mb-2">목차 확정</h2>
        <p className="text-notion-text-secondary text-sm">
          AI가 제안한 보고서 목차입니다. 순서 조정, 이름 변경, 삭제 후 확정하세요.
        </p>
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
              className="flex items-center gap-3 p-3 rounded-lg border border-notion-border bg-notion-bg hover:bg-notion-bg-hover group transition-colors"
            >
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

              {/* Actions */}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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

// ─── Complete step ────────────────────────────────────────────────────────────

function CompleteStep({
  reviews,
  rewardScore,
  tournamentVariants,
  tournamentLoading,
  onSelectWinner,
  onRunTournament,
  onFinish,
  familyId,
}: {
  reviews: SectionReview[];
  rewardScore: number | null;
  tournamentVariants: TournamentVariantResult[];
  tournamentLoading: boolean;
  onSelectWinner: (variantId: string) => void;
  onRunTournament: () => void;
  onFinish: () => void;
  familyId: string | null;
}) {
  const accepted = reviews.filter((r) => r.status === "accepted").length;
  const edited = reviews.filter((r) => r.status === "edited").length;
  const rejected = reviews.filter((r) => r.status === "rejected").length;
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8 w-full max-w-2xl mx-auto">
      <div className="text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-2xl font-semibold text-notion-text mb-2">검토 완료</h2>
        <p className="text-notion-text-secondary text-sm">
          피드백이 저장되었습니다. 다음 번 생성 시 자동으로 반영됩니다.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "승인", count: accepted, cls: "bg-green-50 text-green-700 border-green-200" },
          { label: "편집", count: edited, cls: "bg-blue-50 text-blue-700 border-blue-200" },
          { label: "거절", count: rejected, cls: "bg-red-50 text-notion-red border-red-200" },
        ].map(({ label, count, cls }) => (
          <div key={label} className={`rounded-xl border p-4 text-center ${cls}`}>
            <div className="text-2xl font-bold">{count}</div>
            <div className="text-sm font-medium mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Reward score */}
      {rewardScore !== null && (
        <div className="rounded-xl border border-notion-border bg-notion-bg-secondary p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-notion-text">AI 초안 품질 점수</span>
            <span className={[
              "text-lg font-bold",
              rewardScore >= 0.85 ? "text-notion-green" : rewardScore >= 0.5 ? "text-notion-yellow" : "text-notion-red",
            ].join(" ")}>
              {(rewardScore * 100).toFixed(0)}점
            </span>
          </div>
          <div className="w-full bg-notion-bg-active rounded-full h-2">
            <div
              className={[
                "h-2 rounded-full transition-all",
                rewardScore >= 0.85 ? "bg-notion-green" : rewardScore >= 0.5 ? "bg-notion-yellow" : "bg-notion-red",
              ].join(" ")}
              style={{ width: `${rewardScore * 100}%` }}
            />
          </div>
          <p className="text-xs text-notion-text-tertiary mt-2">
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
        <div className="rounded-xl border border-notion-border p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-notion-text">프롬프트 토너먼트</h3>
              <p className="text-xs text-notion-text-secondary mt-1">
                지금까지 쌓인 피드백 패턴으로 프롬프트 변형들을 비교합니다
              </p>
            </div>
            {tournamentVariants.length === 0 && (
              <button
                onClick={onRunTournament}
                disabled={tournamentLoading}
                className="px-3 py-1.5 rounded-lg bg-notion-accent text-white text-xs font-medium hover:bg-notion-accent-hover disabled:opacity-50"
              >
                {tournamentLoading ? "실행 중…" : "토너먼트 실행"}
              </button>
            )}
          </div>

          {tournamentVariants.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-notion-text-secondary">
                아래 변형 중 다음 생성에 사용할 프롬프트를 선택하세요:
              </p>
              {tournamentVariants.map((v) => (
                <label
                  key={v.variantId}
                  className={[
                    "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedVariant === v.variantId
                      ? "border-notion-accent bg-notion-accent-light"
                      : "border-notion-border hover:bg-notion-bg-hover",
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
                      <span className="text-sm text-notion-text font-medium">
                        {v.changeDescription}
                      </span>
                      {v.isBaseline && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-notion-bg-active text-notion-text-tertiary">
                          현재
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-20 bg-notion-bg-active rounded-full h-1.5">
                        <div
                          className="bg-notion-accent h-1.5 rounded-full"
                          style={{ width: `${v.score * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-notion-text-secondary">
                        {(v.score * 100).toFixed(1)}점
                      </span>
                    </div>
                  </div>
                </label>
              ))}

              {selectedVariant && (
                <button
                  onClick={() => onSelectWinner(selectedVariant)}
                  className="w-full py-2 rounded-lg bg-notion-accent text-white text-sm font-medium hover:bg-notion-accent-hover"
                >
                  "{tournamentVariants.find(v => v.variantId === selectedVariant)?.changeDescription}" 선택 적용
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onFinish}
        className="w-full py-3 rounded-lg bg-notion-accent text-white font-medium text-sm hover:bg-notion-accent-hover"
      >
        완료 — 메인으로 돌아가기
      </button>
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

      setGenProgress((p) => ({ ...p, currentTitle: modifiedPlan.sectionPlans[0]?.tocTitle ?? "초안 생성 중…" }));

      const res = await fetch("/api/report-family/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: modifiedPlan,
          model: "gpt-4.1-mini",
          maxAttempts: 2,
          saveGenerationRun: !!resolvedFamilyId,
          familyId: resolvedFamilyId,
        }),
      });
      const result = (await res.json()) as { draft?: ReportFamilyDraft; generationRunId?: string; error?: string };
      if (!res.ok || !result.draft) throw new Error(result.error || "초안 생성 실패");

      setDraft(result.draft);
      if (result.generationRunId) setGenerationRunId(result.generationRunId);
      setGenProgress({ completed: result.draft.sections.length, total: result.draft.sections.length, currentTitle: "완료" });

      // Initialize reviews
      setReviews(
        result.draft.sections.map((s) => ({
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
  }, [plan, toc, familyId, familyName, uploadFile]);

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
    // Re-run tournament with promoteWinner=true and selected winner
    await fetch("/api/rlhf/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyId, sectionType, promoteWinner: true }),
    });
    setTournamentVariants((prev) =>
      prev.map((v) => ({ ...v, isBaseline: v.variantId === variantId })),
    );
  }, [familyId, reviews]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const doneCount = reviews.filter((r) => r.status !== "pending").length;
  const allReviewed = reviews.length > 0 && doneCount === reviews.length;

  return (
    <div className="min-h-screen bg-notion-bg">
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
            onTocChange={setToc}
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
            familyId={familyId}
          />
        )}
      </div>
    </div>
  );
}
