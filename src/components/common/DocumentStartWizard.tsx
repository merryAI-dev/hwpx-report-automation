"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from "@/lib/editor/document-templates";
import type { RecentFileSnapshotMeta } from "@/lib/recent-files";

export type StartWizardMethod = "blank" | "upload" | "recent" | "template";
export type PreviewStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

type DocumentStartWizardProps = {
  hasDocument: boolean;
  initialMethod?: StartWizardMethod | null;
  recentSnapshots: RecentFileSnapshotMeta[];
  isBusy: boolean;
  status: string;
  previewStatus: PreviewStatus;
  onClose?: () => void;
  onPickFile: (file: File) => void;
  onLoadRecentSnapshot: (id: string) => void;
  onStartBlank: () => void;
  onStartFromTemplate: (template: DocumentTemplate) => void;
};

type WizardStep = "method" | "detail" | "processing";
type ProcessingState = "current" | "done" | "error";

const METHOD_META: Record<
  StartWizardMethod,
  {
    title: string;
    eyebrow: string;
    description: string;
    pillClassName: string;
    cardClassName: string;
    accentClassName: string;
    metaLabel: string;
  }
> = {
  blank: {
    title: "빈 문서로 시작",
    eyebrow: "직접 작성",
    description: "저장 가능한 HWPX 기반 빈 문서를 바로 열고, 필요한 경우 AI preset만 선택해서 시작합니다.",
    pillClassName: "bg-slate-100 text-slate-700",
    cardClassName: "hover:border-slate-300/80 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)]",
    accentClassName: "from-slate-400/10 via-transparent to-transparent",
    metaLabel: "A4 편집 캔버스 즉시 준비",
  },
  upload: {
    title: "기존 문서 업로드",
    eyebrow: "파일 가져오기",
    description: "HWP, HWPX, DOCX, PPTX를 가져오면 구조 파싱과 AI 분석이 자동으로 이어집니다.",
    pillClassName: "bg-sky-100 text-sky-700",
    cardClassName: "hover:border-sky-300/70 hover:shadow-[0_18px_40px_-28px_rgba(14,116,144,0.45)]",
    accentClassName: "from-sky-400/18 via-transparent to-transparent",
    metaLabel: "구조 분석과 outline 자동 생성",
  },
  recent: {
    title: "최근 작업 열기",
    eyebrow: "이어쓰기",
    description: "최근 스냅샷에서 이어서 작업합니다. 로컬 저장소에 있는 문서만 표시됩니다.",
    pillClassName: "bg-emerald-100 text-emerald-700",
    cardClassName: "hover:border-emerald-300/70 hover:shadow-[0_18px_40px_-28px_rgba(5,150,105,0.35)]",
    accentClassName: "from-emerald-400/16 via-transparent to-transparent",
    metaLabel: "최근 로컬 스냅샷 빠른 복귀",
  },
  template: {
    title: "템플릿으로 시작",
    eyebrow: "빠른 초안",
    description: "문서 목적에 맞는 초안 구조와 AI preset을 한 번에 세팅합니다.",
    pillClassName: "bg-violet-100 text-violet-700",
    cardClassName: "hover:border-violet-300/70 hover:shadow-[0_18px_40px_-28px_rgba(109,40,217,0.35)]",
    accentClassName: "from-violet-400/16 via-transparent to-transparent",
    metaLabel: "starter content + preset 동시 구성",
  },
};

const METHOD_ORDER: StartWizardMethod[] = ["upload", "template", "recent", "blank"];

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function formatRecentTime(savedAt: number): string {
  return new Date(savedAt).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

function getPreviewBadgeText(previewStatus: PreviewStatus): string {
  switch (previewStatus) {
    case "loading":
      return "미리보기 준비 중";
    case "ready":
      return "미리보기 사용 가능";
    case "error":
      return "미리보기 연결 실패";
    case "unavailable":
      return "미리보기 미지원";
    default:
      return "미리보기 대기";
  }
}

function getPreviewBadgeClassName(previewStatus: PreviewStatus): string {
  switch (previewStatus) {
    case "loading":
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200";
    case "ready":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200";
    case "error":
      return "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200";
    case "unavailable":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200";
  }
}

function getProcessingItemClassName(state: ProcessingState): string {
  switch (state) {
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200";
    default:
      return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200";
  }
}

function getStepChipClassName(active: boolean): string {
  return active
    ? "border-sky-300/80 bg-sky-100/90 text-sky-800 shadow-[0_8px_18px_-14px_rgba(14,116,144,0.7)] dark:border-sky-400/25 dark:bg-sky-500/15 dark:text-sky-100"
    : "border-slate-200/80 bg-white/75 text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-400";
}

const primaryButtonClassName =
  "inline-flex items-center justify-center rounded-2xl border border-sky-700 bg-[linear-gradient(135deg,#124b7c_0%,#2563eb_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.75)] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_22px_38px_-18px_rgba(37,99,235,0.75)]";

const secondaryButtonClassName =
  "inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-700 transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-900";

export function DocumentStartWizard({
  hasDocument,
  initialMethod = null,
  recentSnapshots,
  isBusy,
  status,
  previewStatus,
  onClose,
  onPickFile,
  onLoadRecentSnapshot,
  onStartBlank,
  onStartFromTemplate,
}: DocumentStartWizardProps) {
  const [step, setStep] = useState<WizardStep>(initialMethod ? "detail" : "method");
  const [method, setMethod] = useState<StartWizardMethod | null>(initialMethod);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMethod(initialMethod);
    setStep(isBusy ? "processing" : initialMethod ? "detail" : "method");
  }, [initialMethod, isBusy]);

  useEffect(() => {
    if (isBusy) {
      setStep("processing");
    }
  }, [isBusy]);

  const selectMethod = useCallback((next: StartWizardMethod) => {
    setMethod(next);
    setStep("detail");
  }, []);

  const processingItems = useMemo(
    () => [
      {
        label: "문서 구조 파싱",
        state: isBusy ? "current" : "done",
      },
      {
        label: "문서 분석 및 outline 생성",
        state: isBusy ? "current" : "done",
      },
      {
        label: getPreviewBadgeText(previewStatus),
        state:
          previewStatus === "ready" || previewStatus === "unavailable"
            ? "done"
            : previewStatus === "error"
              ? "error"
              : "current",
      },
    ],
    [isBusy, previewStatus],
  );

  const handleDroppedFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      onPickFile(file);
    },
    [onPickFile],
  );

  const renderDetailPanel = () => {
    if (!method) return null;

    if (method === "blank") {
      return (
        <div className="flex flex-col gap-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-7 shadow-[0_24px_50px_-34px_rgba(15,23,42,0.35)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {METHOD_META.blank.eyebrow}
            </p>
            <h3 className="mt-3 text-[26px] font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">
              {METHOD_META.blank.title}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              {METHOD_META.blank.description}
            </p>
            <ul className="mt-5 space-y-2 text-sm leading-7 text-slate-700 dark:text-slate-200">
              <li className="flex items-start gap-3">
                <span className="mt-2 h-2 w-2 rounded-full bg-sky-500" />
                저장 가능한 HWPX 모델을 바로 생성합니다.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-2 w-2 rounded-full bg-sky-500" />
                문서 개요와 AI 패널은 빈 상태로 시작합니다.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-2 w-2 rounded-full bg-sky-500" />
                필요하면 나중에 템플릿 구조를 직접 추가할 수 있습니다.
              </li>
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <button type="button" className={secondaryButtonClassName} onClick={() => setStep("method")}>
                이전
              </button>
              <button type="button" className={primaryButtonClassName} onClick={onStartBlank}>
                빈 문서 열기
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (method === "upload") {
      return (
        <div className="flex flex-col gap-4">
          <div
            className={cn(
              "group relative overflow-hidden rounded-[28px] border-2 border-dashed p-9 text-center transition duration-150",
              dragActive
                ? "border-sky-400 bg-sky-100/80 shadow-[0_22px_45px_-24px_rgba(14,116,144,0.35)] dark:border-sky-300/70 dark:bg-sky-500/10"
                : "border-slate-300/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.96))] hover:border-sky-300/70 hover:bg-sky-50/50 dark:border-slate-700 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(30,41,59,0.92))] dark:hover:border-sky-400/40 dark:hover:bg-sky-500/5",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              handleDroppedFile(event.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[20px] bg-sky-100 text-sm font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-100">
              문서
            </div>
            <strong className="mt-5 block text-xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">
              파일을 끌어놓거나 클릭해서 업로드
            </strong>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              HWP, HWPX, DOCX, PPTX를 바로 불러올 수 있습니다.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {["HWPX", "DOCX", "PPTX", "HWP"].map((format) => (
                <span
                  key={format}
                  className="rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
                >
                  {format}
                </span>
              ))}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".hwp,.hwpx,.docx,.pptx"
            className="hidden"
            onChange={(event) => {
              handleDroppedFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButtonClassName} onClick={() => setStep("method")}>
              이전
            </button>
          </div>
        </div>
      );
    }

    if (method === "recent") {
      return (
        <div className="flex flex-col gap-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-7 shadow-[0_24px_50px_-34px_rgba(15,23,42,0.35)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {METHOD_META.recent.eyebrow}
            </p>
            <h3 className="mt-3 text-[26px] font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">
              {METHOD_META.recent.title}
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {METHOD_META.recent.description}
            </p>
            {recentSnapshots.length ? (
              <div className="mt-6 grid gap-3">
                {recentSnapshots.slice(0, 6).map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    className="group rounded-[22px] border border-slate-200/80 bg-white/90 px-5 py-4 text-left transition duration-150 hover:-translate-y-0.5 hover:border-emerald-300/70 hover:shadow-[0_18px_42px_-28px_rgba(5,150,105,0.38)] dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-emerald-400/40"
                    onClick={() => onLoadRecentSnapshot(snapshot.id)}
                  >
                    <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">{snapshot.name}</span>
                    <span className="mt-2 block text-xs text-slate-500 dark:text-slate-400">
                      {snapshot.kind} · {formatRecentTime(snapshot.savedAt)} · {formatFileSize(snapshot.size)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-[24px] border border-dashed border-slate-300/80 bg-slate-50/80 p-6 dark:border-slate-700 dark:bg-slate-900/60">
                <strong className="block text-base font-semibold text-slate-900 dark:text-slate-50">
                  최근 스냅샷이 없습니다.
                </strong>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  첫 문서를 열면 여기에서 바로 이어서 작업할 수 있습니다.
                </p>
              </div>
            )}
            <div className="mt-7 flex flex-wrap gap-3">
              <button type="button" className={secondaryButtonClassName} onClick={() => setStep("method")}>
                이전
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-7 shadow-[0_24px_50px_-34px_rgba(15,23,42,0.35)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {METHOD_META.template.eyebrow}
          </p>
          <h3 className="mt-3 text-[26px] font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">
            {METHOD_META.template.title}
          </h3>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {METHOD_META.template.description}
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {DOCUMENT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="group relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 px-5 py-5 text-left transition duration-150 hover:-translate-y-0.5 hover:border-violet-300/70 hover:shadow-[0_18px_42px_-28px_rgba(109,40,217,0.35)] dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-violet-400/40"
                onClick={() => onStartFromTemplate(template)}
              >
                <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,rgba(167,139,250,0.16),transparent)] opacity-70" />
                <div className="relative flex gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-violet-100 text-xl dark:bg-violet-500/15">
                    {template.icon}
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-[15px] font-semibold text-slate-900 dark:text-slate-50">
                      {template.name}
                    </strong>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {template.description}
                    </p>
                    <span className="mt-4 inline-flex rounded-full bg-violet-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
                      {template.defaultPreset}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" className={secondaryButtonClassName} onClick={() => setStep("method")}>
              이전
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={cn("mx-auto w-[min(1120px,calc(100vw-32px))]", hasDocument && "px-4 pt-4")}>
      <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(241,245,249,0.94))] shadow-[0_40px_90px_-44px_rgba(15,23,42,0.38)] backdrop-blur-2xl dark:border-slate-700/70 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.92))]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.1),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_22%),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.12),transparent_26%)]" />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-800 dark:text-sky-200">
                Workspace Wizard
              </p>
              <h2 className="mt-3 text-[34px] font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50 sm:text-[40px]">
                문서를 어떻게 시작할지 먼저 정합니다
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
                업로드, 템플릿, 최근 작업, 빈 문서 중 하나를 골라서 바로 편집 환경으로 이어집니다.
              </p>
            </div>
            {onClose ? (
              <button type="button" className={secondaryButtonClassName} onClick={onClose}>
                닫기
              </button>
            ) : null}
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {[
              { key: "method", label: "1. 시작 방식" },
              { key: "detail", label: "2. 세부 선택" },
              { key: "processing", label: "3. 문서 준비" },
            ].map((item) => (
              <span
                key={item.key}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-semibold tracking-[0.04em] transition",
                  getStepChipClassName(step === item.key),
                )}
              >
                {item.label}
              </span>
            ))}
          </div>

          <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_340px]">
            <section className="min-w-0">
              {step === "method" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {METHOD_ORDER.map((methodKey) => {
                    const meta = METHOD_META[methodKey];
                    return (
                      <button
                        key={methodKey}
                        type="button"
                        className={cn(
                          "group relative overflow-hidden rounded-[26px] border border-slate-200/90 bg-white/94 p-6 text-left transition duration-150 dark:border-slate-700 dark:bg-slate-900/80",
                          meta.cardClassName,
                        )}
                        onClick={() => selectMethod(methodKey)}
                      >
                        <div className={cn("absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,var(--tw-gradient-stops))]", meta.accentClassName)} />
                        <div className="relative">
                          <span className={cn("inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", meta.pillClassName)}>
                            {meta.eyebrow}
                          </span>
                          <strong className="mt-5 block text-[28px] font-semibold tracking-[-0.04em] text-slate-900 dark:text-slate-50">
                            {meta.title}
                          </strong>
                          <p className="mt-3 text-[15px] leading-7 text-slate-700 dark:text-slate-200">
                            {meta.description}
                          </p>
                          <div className="mt-6 flex items-center justify-between text-xs font-medium tracking-[0.04em] text-slate-600 dark:text-slate-300">
                            <span>{meta.metaLabel}</span>
                            <span className="rounded-full border border-slate-200/80 px-2.5 py-1 dark:border-slate-700">
                              선택
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : step === "processing" ? (
                <div className="rounded-[30px] border border-slate-200/80 bg-white/88 p-8 shadow-[0_28px_55px_-38px_rgba(15,23,42,0.35)] dark:border-slate-700 dark:bg-slate-900/72">
                  <div className="flex items-start gap-5">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500 dark:border-slate-700 dark:border-t-sky-300" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Step 3
                      </p>
                      <h3 className="mt-3 text-[26px] font-semibold tracking-[-0.04em] text-slate-900 dark:text-slate-50">
                        문서를 준비하는 중입니다
                      </h3>
                      <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{status}</p>
                    </div>
                  </div>
                  <div className="mt-7 grid gap-3">
                    {processingItems.map((item) => (
                      <div
                        key={item.label}
                        className={cn(
                          "flex items-center gap-3 rounded-[18px] border px-4 py-3 text-sm font-medium",
                          getProcessingItemClassName(item.state as ProcessingState),
                        )}
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-current" />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  {!isBusy ? (
                    <div className="mt-7 flex flex-wrap gap-3">
                      <button
                        type="button"
                        className={secondaryButtonClassName}
                        onClick={() => setStep(method ? "detail" : "method")}
                      >
                        다른 방식 선택
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                renderDetailPanel()
              )}
            </section>

            <aside className="grid min-w-0 gap-4">
              <div className="rounded-[28px] border border-slate-200/80 bg-white/82 p-6 shadow-[0_24px_50px_-38px_rgba(15,23,42,0.32)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/68">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  작업 흐름
                </p>
                <h3 className="mt-3 text-[26px] font-semibold tracking-[-0.04em] text-slate-900 dark:text-slate-50">
                  지금 UX에서 줄이는 마찰
                </h3>
                <ul className="mt-5 space-y-3 text-[15px] leading-7 text-slate-700 dark:text-slate-200">
                  <li className="flex items-start gap-3">
                    <span className="mt-2 h-2 w-2 rounded-full bg-sky-500" />
                    문서가 없는 상태의 빈 종이 화면 대신 명확한 시작 선택지를 제공합니다.
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-2 h-2 w-2 rounded-full bg-sky-500" />
                    업로드 후 바로 outline, AI 분석, preview 준비 상태를 같은 컨텍스트에서 보여줍니다.
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-2 h-2 w-2 rounded-full bg-sky-500" />
                    template/onboarding query 진입도 메인 편집기 안에서 자연스럽게 이어집니다.
                  </li>
                </ul>
              </div>

              <div className="rounded-[28px] border border-slate-200/80 bg-white/82 p-6 shadow-[0_24px_50px_-38px_rgba(15,23,42,0.32)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/68">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  현재 상태
                </p>
                <h3 className="mt-3 text-[26px] font-semibold tracking-[-0.04em] text-slate-900 dark:text-slate-50">
                  {method ? METHOD_META[method].title : "시작 방식을 선택하세요"}
                </h3>
                <p className="mt-3 text-[15px] leading-7 text-slate-700 dark:text-slate-200">
                  {method ? METHOD_META[method].description : "첫 단계에서 작업 경로를 선택하면 다음 화면이 그 경로에 맞게 바뀝니다."}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]",
                      getPreviewBadgeClassName(previewStatus),
                    )}
                  >
                    {getPreviewBadgeText(previewStatus)}
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
