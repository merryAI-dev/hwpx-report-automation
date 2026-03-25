"use client";

import { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type Template = {
  name: string;
  description: string;
  url: string;
};

type TextNode = {
  file: string;
  index: number;
  text: string;
};

type AppState =
  | "IDLE"
  | "LOADING_TEMPLATES"
  | "TEMPLATE_SELECTED"
  | "EXTRACTING"
  | "FORM_READY"
  | "FILLING"
  | "DONE"
  | "ERROR"
  | "RATE_LIMITED";

// ── Component ──────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [appState, setAppState] = useState<AppState>("IDLE");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textNodes, setTextNodes] = useState<TextNode[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [fillCount, setFillCount] = useState<number>(0);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function nodeKey(node: TextNode): string {
    return `${node.file}:${node.index}`;
  }

  function showError(msg: string, state: AppState = "ERROR") {
    setErrorMessage(msg);
    setAppState(state);
  }

  // ── Fetch templates on mount ──────────────────────────────────────────────

  useEffect(() => {
    setAppState("LOADING_TEMPLATES");
    fetch("/api/public/templates")
      .then((res) => res.json())
      .then((data: Template[]) => {
        setTemplates(data);
        setAppState("IDLE");
      })
      .catch(() => {
        showError("템플릿 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.");
      });
  }, []);

  // ── Select template: fetch file → extract nodes ───────────────────────────

  async function handleSelectTemplate(template: Template) {
    setSelectedTemplate(template);
    setAppState("TEMPLATE_SELECTED");
    setTextNodes([]);
    setFormValues({});
    setErrorMessage("");

    // 1. Fetch sample file
    let file: File;
    try {
      const res = await fetch(template.url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      file = new File([blob], `${template.name}.hwpx`, {
        type: "application/octet-stream",
      });
    } catch {
      showError("템플릿 파일을 불러오지 못했습니다.");
      return;
    }

    setSelectedFile(file);
    setAppState("EXTRACTING");

    // 2. Extract text nodes
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/public/extract", {
        method: "POST",
        body: formData,
      });

      if (res.status === 429) {
        showError("", "RATE_LIMITED");
        return;
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showError(
          (json as { message?: string }).message ??
            "텍스트 노드를 추출하지 못했습니다."
        );
        return;
      }

      const json = (await res.json()) as { nodes: TextNode[]; count: number };
      setTextNodes(json.nodes);

      // Pre-fill form values with original text
      const initial: Record<string, string> = {};
      for (const node of json.nodes) {
        initial[nodeKey(node)] = node.text;
      }
      setFormValues(initial);
      setAppState("FORM_READY");
    } catch {
      showError("네트워크 오류가 발생했습니다.");
    }
  }

  // ── Fill template ─────────────────────────────────────────────────────────

  async function handleFill() {
    if (!selectedFile) return;
    setAppState("FILLING");
    setErrorMessage("");

    // Build data: Record<string, string> keyed by original text (placeholder key)
    // The fill API expects { "TITLE": "새 제목", "AUTHOR": "홍길동" } etc.
    // Since the extract returns the raw text content of nodes, we build a map
    // of original_text → new_value for nodes that were edited.
    //
    // Actually, the fill API uses applyPlaceholders which expects placeholder
    // keys (e.g. "{{TITLE}}"). Looking at the fill route, `data` is just a
    // Record<string,string> passed directly to applyPlaceholders.
    //
    // The simplest correct approach: send the node's original text as key.
    // But that won't work if placeholder is "{{TITLE}}" and we send text "{{TITLE}}".
    // Per the fill route comment: data = '{"TITLE":"2026 보고서"}' — keys are bare
    // without braces. So we need to strip {{ }} from node text if present.
    //
    // Build map: for each node whose value changed, strip {{...}} and use as key.
    const data: Record<string, string> = {};
    for (const node of textNodes) {
      const key = nodeKey(node);
      const newVal = formValues[key] ?? node.text;
      // Strip {{ }} wrapper if present, otherwise use text as-is
      const stripped = node.text.replace(/^\{\{(.+)\}\}$/, "$1").trim();
      data[stripped] = newVal;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("data", JSON.stringify(data));

    try {
      const res = await fetch("/api/public/fill", {
        method: "POST",
        body: formData,
      });

      if (res.status === 429) {
        showError("", "RATE_LIMITED");
        return;
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showError(
          (json as { message?: string }).message ??
            "파일 생성 중 오류가 발생했습니다."
        );
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = downloadLinkRef.current!;
      a.href = url;
      a.download = `${selectedTemplate?.name ?? "output"}.hwpx`;
      a.click();
      URL.revokeObjectURL(url);

      setFillCount(textNodes.length);
      setAppState("DONE");
    } catch {
      showError("네트워크 오류가 발생했습니다.");
    }
  }

  // ── Retry ─────────────────────────────────────────────────────────────────

  function handleRetry() {
    if (appState === "ERROR" || appState === "RATE_LIMITED") {
      // If we have extracted nodes, just re-try fill (not extract)
      if (textNodes.length > 0 || appState === "RATE_LIMITED") {
        setAppState("FORM_READY");
      } else {
        setAppState("IDLE");
      }
      setErrorMessage("");
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const isEmpty = appState === "FORM_READY" && textNodes.length === 0;
  const isLoading =
    appState === "LOADING_TEMPLATES" ||
    appState === "EXTRACTING" ||
    appState === "TEMPLATE_SELECTED" ||
    appState === "FILLING";
  const canFill =
    appState === "FORM_READY" && textNodes.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[var(--color-notion-bg)] text-[var(--color-notion-text)]">
      {/* Hidden download anchor */}
      <a ref={downloadLinkRef} className="hidden" />

      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            HWPX 템플릿 채우기
          </h1>
          <p className="mt-2 text-sm text-[var(--color-notion-text-secondary)]">
            샘플 템플릿을 선택하고 내용을 입력하면 완성된 HWPX 파일을 바로
            다운로드할 수 있어요.
          </p>
        </div>

        {/* ── Step 1: Template cards ─────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-[var(--color-notion-text-secondary)]">
            1. 템플릿 선택
          </h2>

          {appState === "LOADING_TEMPLATES" ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-notion-text-secondary)]">
              <Spinner />
              <span>템플릿 불러오는 중...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((t) => {
                const isSelected = selectedTemplate?.name === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => handleSelectTemplate(t)}
                    disabled={isLoading}
                    className={[
                      "rounded-xl border px-5 py-4 text-left transition-all",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-notion-accent)]",
                      isSelected
                        ? "border-[var(--color-notion-accent)] bg-[var(--color-notion-accent-light)] shadow-sm"
                        : "border-[var(--color-notion-border)] bg-[var(--color-notion-bg-secondary)] hover:border-[var(--color-notion-border-strong)] hover:bg-[var(--color-notion-bg-hover)]",
                      isLoading ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    ].join(" ")}
                  >
                    <div className="font-medium capitalize">{t.name}</div>
                    <div className="mt-1 text-xs text-[var(--color-notion-text-secondary)]">
                      {t.description}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Step 2: Loading / error / form ────────────────────────── */}
        {(appState === "EXTRACTING" ||
          appState === "TEMPLATE_SELECTED") && (
          <div className="mb-8 flex items-center gap-2 rounded-xl border border-[var(--color-notion-border)] bg-[var(--color-notion-bg-secondary)] px-5 py-4 text-sm text-[var(--color-notion-text-secondary)]">
            <Spinner />
            <span>텍스트 노드 추출 중...</span>
          </div>
        )}

        {(appState === "ERROR" || appState === "RATE_LIMITED") && (
          <div className="mb-8 rounded-xl border border-red-200 bg-red-50 px-5 py-4 dark:border-red-900/40 dark:bg-red-950/20">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {appState === "RATE_LIMITED"
                ? "잠시 후 다시 시도해주세요 (분당 2회 제한)"
                : errorMessage || "오류가 발생했습니다."}
            </p>
            <button
              onClick={handleRetry}
              className="mt-2 text-xs font-medium text-red-600 underline underline-offset-2 hover:text-red-800 dark:text-red-400"
            >
              다시 시도
            </button>
          </div>
        )}

        {(appState === "FORM_READY" ||
          appState === "FILLING" ||
          appState === "DONE") && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-[var(--color-notion-text-secondary)]">
              2. 내용 입력
            </h2>

            {isEmpty ? (
              <div className="rounded-xl border border-[var(--color-notion-border)] bg-[var(--color-notion-bg-secondary)] px-5 py-6 text-center">
                <p className="text-sm text-[var(--color-notion-text-secondary)]">
                  이 템플릿에는 입력할 내용이 없어요.
                </p>
                <a
                  href="/"
                  className="mt-3 inline-block text-xs font-medium text-[var(--color-notion-accent)] hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  직접 편집하려면 HWPX Studio ↗
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {textNodes.map((node) => {
                  const key = nodeKey(node);
                  return (
                    <div key={key}>
                      <label className="mb-1 block text-xs text-[var(--color-notion-text-secondary)]">
                        {node.file} · 노드 #{node.index}
                      </label>
                      <input
                        type="text"
                        value={formValues[key] ?? node.text}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        disabled={appState === "FILLING" || appState === "DONE"}
                        className={[
                          "w-full rounded-lg border px-3 py-2 text-sm",
                          "border-[var(--color-notion-border)] bg-[var(--color-notion-bg)]",
                          "placeholder:text-[var(--color-notion-text-tertiary)]",
                          "focus:outline-none focus:ring-2 focus:ring-[var(--color-notion-accent)]",
                          "disabled:opacity-50",
                        ].join(" ")}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Step 3: Generate button ────────────────────────────────── */}
        {(appState === "FORM_READY" ||
          appState === "FILLING" ||
          appState === "DONE") && (
          <section>
            <button
              onClick={handleFill}
              disabled={appState !== "FORM_READY" || textNodes.length === 0}
              className={[
                "inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-notion-accent)]",
                canFill && appState === "FORM_READY"
                  ? "bg-[var(--color-notion-accent)] text-white hover:bg-[var(--color-notion-accent-hover)]"
                  : "cursor-not-allowed bg-[var(--color-notion-border)] text-[var(--color-notion-text-tertiary)]",
              ].join(" ")}
            >
              {appState === "FILLING" ? (
                <>
                  <Spinner white />
                  생성 중...
                </>
              ) : (
                "생성하기"
              )}
            </button>

            {appState === "DONE" && (
              <p className="mt-3 text-center text-sm text-[var(--color-notion-text-secondary)]">
                ✓ {fillCount}개 텍스트가 수정되었습니다. 파일이 다운로드되었어요.
              </p>
            )}

            {isEmpty && (
              <p className="mt-2 text-center text-xs text-[var(--color-notion-text-tertiary)]">
                입력할 플레이스홀더가 없어 생성하기를 사용할 수 없어요.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────

function Spinner({ white = false }: { white?: boolean }) {
  return (
    <svg
      className={[
        "h-4 w-4 animate-spin",
        white ? "text-white" : "text-[var(--color-notion-text-secondary)]",
      ].join(" ")}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
