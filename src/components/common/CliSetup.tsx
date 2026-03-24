"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from "@/lib/editor/document-templates";
import type { RecentFileSnapshotMeta } from "@/lib/recent-files";
import {
  hasStoredApiKey,
  setStoredApiKey,
  type ApiProvider,
} from "@/lib/client-api-keys";

type CliSetupProps = {
  recentSnapshots: RecentFileSnapshotMeta[];
  isBusy: boolean;
  status: string;
  onPickFile: (file: File) => void;
  onLoadRecentSnapshot: (id: string) => void;
  onStartBlank: () => void;
  onStartFromTemplate: (template: DocumentTemplate) => void;
  onClose?: () => void;
};

type Phase =
  | "api-setup"
  | "api-key-input"
  | "api-add-more"
  | "doc-select"
  | "upload"
  | "template"
  | "recent"
  | "processing";

type ApiProviderInfo = {
  id: ApiProvider;
  label: string;
  placeholder: string;
  description: string;
};

const PROVIDERS: ApiProviderInfo[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-api03-...", description: "Claude — 채팅 · 편집 AI" },
  { id: "openai",    label: "OpenAI",    placeholder: "sk-...",           description: "GPT — 제안 · 검증 AI" },
  { id: "gemini",    label: "Gemini",    placeholder: "AIza...",          description: "Gemini — OpenAI 대체 가능" },
];

const DOC_OPTIONS = [
  { key: "upload",   label: "파일 가져오기",   desc: "HWP · HWPX · DOCX · PPTX 업로드" },
  { key: "hwpx",     label: "HWPX 기반 작업", desc: "기존 문서 AI 보완 · 재편집" },
  { key: "template", label: "템플릿으로 시작", desc: "AI preset 포함 빠른 초안" },
  { key: "recent",   label: "최근 작업 열기",  desc: "로컬 스냅샷 복귀" },
  { key: "blank",    label: "빈 문서",         desc: "바로 편집 시작" },
] as const;

function formatTime(savedAt: number): string {
  return new Date(savedAt).toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 mb-1">
      <span className="text-[var(--color-cli-green)] select-none shrink-0">$</span>
      <span className="text-[var(--color-cli-text)] font-semibold">{children}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-3 border-t border-[var(--color-cli-surface)]" />;
}

function CliLine({ children, dim, green, red, blue }: {
  children: React.ReactNode;
  dim?: boolean;
  green?: boolean;
  red?: boolean;
  blue?: boolean;
}) {
  const color = green ? "text-[var(--color-cli-green)]"
    : red   ? "text-[var(--color-cli-red)]"
    : blue  ? "text-[var(--color-cli-blue)]"
    : dim   ? "text-[var(--color-cli-dim)]"
    :         "text-[var(--color-cli-text)]";
  return <div className={color}>{children}</div>;
}

function Indent({ children }: { children: React.ReactNode }) {
  return <div className="pl-4 text-[var(--color-cli-dim)]">{children}</div>;
}

function KeyHints({ hints }: { hints: string[] }) {
  return (
    <div className="mt-5 pt-3 border-t border-[var(--color-cli-surface)] flex flex-wrap gap-x-4 gap-y-1">
      {hints.map((h) => (
        <span key={h} className="text-[var(--color-cli-dim)] text-xs">{h}</span>
      ))}
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex items-center gap-1.5 text-[var(--color-cli-dim)] hover:text-[var(--color-cli-text)] font-code text-xs transition-colors cursor-pointer"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      뒤로 <span className="opacity-50">[Esc]</span>
    </button>
  );
}

function Cursor() {
  return (
    <div className="mt-4 flex items-center gap-1.5">
      <span className="text-[var(--color-cli-green)] select-none">&gt;</span>
      <span className="inline-block w-[9px] h-[1em] bg-[var(--color-cli-green)] animate-cli-blink align-text-bottom" />
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-block w-4 h-4 border-2 border-[var(--color-cli-green)] border-t-transparent rounded-full animate-spin shrink-0" />
      <span className="text-[var(--color-cli-text)]">{text}</span>
    </div>
  );
}

// ── Option row with keyboard cursor indicator ─────────────────────────────────

function OptionRow({
  shortcut,
  label,
  desc,
  badge,
  active,
  onClick,
  dimShortcut,
}: {
  shortcut: string;
  label?: string;
  desc?: string;
  badge?: string;
  active: boolean;
  onClick: () => void;
  dimShortcut?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={[
        "flex items-start gap-3 rounded-md px-2 py-1.5 text-left w-full font-code text-sm transition-all duration-100 cursor-pointer",
        active
          ? "bg-[var(--color-cli-surface)] outline outline-1 outline-[var(--color-cli-border)]"
          : "hover:bg-[var(--color-cli-surface)]",
      ].join(" ")}
    >
      <span className="text-[var(--color-cli-green)] w-3 shrink-0 select-none mt-px">
        {active ? "▶" : " "}
      </span>
      <span className={[
        "shrink-0 w-5",
        dimShortcut ? "text-[var(--color-cli-dim)]" : "text-[var(--color-cli-green)]",
      ].join(" ")}>
        [{shortcut}]
      </span>
      {label && (
        <span className="text-[var(--color-cli-blue)] w-32 shrink-0 truncate">{label}</span>
      )}
      {desc && (
        <span className="text-[var(--color-cli-dim)] truncate">{desc}</span>
      )}
      {badge && (
        <span className="ml-auto shrink-0 text-[var(--color-cli-green)] text-xs opacity-70">{badge}</span>
      )}
    </button>
  );
}

// ── Saved provider status chips ───────────────────────────────────────────────

function ProviderChips({ savedProviders }: { savedProviders: ApiProvider[] }) {
  if (savedProviders.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-1">
      {savedProviders.map((id) => {
        const p = PROVIDERS.find((x) => x.id === id)!;
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs bg-[var(--color-cli-surface)] border border-[var(--color-cli-border)] text-[var(--color-cli-green)]"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-cli-green)]" />
            {p.label}
          </span>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function CliSetup({
  recentSnapshots,
  isBusy,
  status,
  onPickFile,
  onLoadRecentSnapshot,
  onStartBlank,
  onStartFromTemplate,
  onClose,
}: CliSetupProps) {
  const hasAnyKey = PROVIDERS.some((p) => hasStoredApiKey(p.id));
  const [phase, setPhase] = useState<Phase>(hasAnyKey ? "doc-select" : "api-setup");
  const [selectedProvider, setSelectedProvider] = useState<ApiProviderInfo | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savedProviders, setSavedProviders] = useState<ApiProvider[]>(
    PROVIDERS.filter((p) => hasStoredApiKey(p.id)).map((p) => p.id),
  );
  const [keyError, setKeyError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [uploadContext, setUploadContext] = useState<"generic" | "hwpx">("generic");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isBusy) setPhase("processing"); }, [isBusy]);
  useEffect(() => { setCursor(0); }, [phase]);

  // ── Keyboard handler ────────────────────────────────────────────────────────

  const getOptions = useCallback((): (() => void)[] => {
    const remaining = PROVIDERS.filter((p) => !savedProviders.includes(p.id));
    switch (phase) {
      case "api-setup":
        return [
          ...PROVIDERS.map((p) => () => {
            setSelectedProvider(p); setApiKeyInput(""); setKeyError(""); setPhase("api-key-input");
          }),
          () => setPhase("doc-select"),
        ];
      case "api-add-more":
        return [
          ...remaining.map((p) => () => {
            setSelectedProvider(p); setApiKeyInput(""); setKeyError(""); setPhase("api-key-input");
          }),
          () => setPhase("doc-select"),
        ];
      case "doc-select":
        return [
          () => { setUploadContext("generic"); setPhase("upload"); },
          () => { setUploadContext("hwpx"); setPhase("upload"); },
          () => setPhase("template"),
          () => setPhase("recent"),
          () => onStartBlank(),
        ];
      case "upload":
        return [() => fileInputRef.current?.click()];
      case "template":
        return [
          ...DOCUMENT_TEMPLATES.map((t) => () => onStartFromTemplate(t)),
          () => setPhase("doc-select"),
        ];
      case "recent":
        return [
          ...recentSnapshots.slice(0, 8).map((s) => () => onLoadRecentSnapshot(s.id)),
          () => setPhase("doc-select"),
        ];
      default:
        return [];
    }
  }, [phase, savedProviders, recentSnapshots, onStartBlank, onStartFromTemplate, onLoadRecentSnapshot]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const options = getOptions();
      if (options.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => (c + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => (c - 1 + options.length) % options.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        options[cursor]?.();
      } else if (e.key === "Escape") {
        if (phase === "api-key-input") setPhase("api-setup");
        else if (["upload", "template", "recent"].includes(phase)) setPhase("doc-select");
        else if (phase === "api-add-more") setPhase("doc-select");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [cursor, phase, getOptions]);

  // ── Event handlers ──────────────────────────────────────────────────────────

  const handleSaveKey = useCallback(() => {
    if (!selectedProvider) return;
    const trimmed = apiKeyInput.trim();
    if (!trimmed) { setKeyError("API 키를 입력하세요."); return; }
    setStoredApiKey(selectedProvider.id, trimmed);
    setSavedProviders((prev) =>
      prev.includes(selectedProvider.id) ? prev : [...prev, selectedProvider.id],
    );
    setApiKeyInput("");
    setKeyError("");
    setPhase("api-add-more");
  }, [selectedProvider, apiKeyInput]);

  const handleDroppedFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    onPickFile(file);
  }, [onPickFile]);

  // ── Phase renderers ─────────────────────────────────────────────────────────

  function renderApiSetup() {
    const options = [
      ...PROVIDERS.map((p, i) => ({
        shortcut: String(i + 1),
        label: p.label,
        desc: p.description,
        dimShortcut: false,
        onClick: () => { setSelectedProvider(p); setApiKeyInput(""); setKeyError(""); setPhase("api-key-input"); },
      })),
      { shortcut: "s", label: undefined, desc: "건너뛰기 — 나중에 설정 페이지에서 입력", dimShortcut: true, onClick: () => setPhase("doc-select") },
    ];

    return (
      <div className="flex flex-col gap-2">
        <Prompt>hwpx-studio --setup</Prompt>
        <Divider />
        <CliLine>
          <span className="text-[var(--color-cli-yellow)]">!</span>{" "}
          API 키가 설정되지 않았습니다.
        </CliLine>
        <Indent>AI 기능(채팅 · 제안 · 검증)을 사용하려면 키가 필요합니다.</Indent>
        <Divider />
        <CliLine dim>공급자를 선택하세요:</CliLine>
        <div className="mt-1 flex flex-col gap-0.5">
          {options.map((opt, i) => (
            <OptionRow
              key={opt.shortcut}
              shortcut={opt.shortcut}
              label={opt.label}
              desc={opt.desc}
              active={cursor === i}
              dimShortcut={opt.dimShortcut}
              onClick={opt.onClick}
            />
          ))}
        </div>
        <KeyHints hints={["↑↓ 이동", "Enter 선택", "s 건너뛰기"]} />
      </div>
    );
  }

  function renderKeyInput() {
    return (
      <div className="flex flex-col gap-2">
        <Prompt>hwpx-studio --setup</Prompt>
        <Divider />
        {savedProviders.length > 0 && <ProviderChips savedProviders={savedProviders} />}
        <CliLine>
          <span className="text-[var(--color-cli-blue)]">{selectedProvider?.label}</span>
          {" "}API 키를 입력하세요:
        </CliLine>
        <Indent>{selectedProvider?.placeholder}</Indent>
        <div className="mt-2 flex items-center gap-2 bg-[var(--color-cli-surface)] rounded-md px-3 py-2 border border-[var(--color-cli-border)] focus-within:border-[var(--color-cli-green)] transition-colors">
          <span className="text-[var(--color-cli-green)] select-none shrink-0">&gt;</span>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => { setApiKeyInput(e.target.value); setKeyError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveKey();
              if (e.key === "Escape") setPhase("api-setup");
            }}
            placeholder={selectedProvider?.placeholder}
            autoFocus
            className="flex-1 bg-transparent border-none outline-none text-[var(--color-cli-text)] placeholder:text-[var(--color-cli-dim)] font-code text-sm caret-[var(--color-cli-green)]"
          />
          <button
            type="button"
            onClick={handleSaveKey}
            className="shrink-0 rounded px-3 py-1 text-xs bg-[var(--color-cli-btn-save)] text-white hover:bg-[var(--color-cli-btn-save-hover)] transition-colors font-code cursor-pointer"
          >
            저장
          </button>
        </div>
        {keyError && (
          <CliLine red>
            <span className="mr-1">✗</span>{keyError}
          </CliLine>
        )}
        <BackBtn onClick={() => setPhase("api-setup")} />
        <KeyHints hints={["Enter 저장", "Esc 뒤로"]} />
      </div>
    );
  }

  function renderAddMore() {
    const remaining = PROVIDERS.filter((p) => !savedProviders.includes(p.id));
    const options = [
      ...remaining.map((p, i) => ({
        shortcut: String(i + 1),
        label: p.label,
        desc: p.description,
        dimShortcut: false,
        onClick: () => { setSelectedProvider(p); setApiKeyInput(""); setKeyError(""); setPhase("api-key-input"); },
      })),
      { shortcut: "n", label: undefined, desc: "완료 — 문서 시작하기", dimShortcut: true, onClick: () => setPhase("doc-select") },
    ];

    return (
      <div className="flex flex-col gap-2">
        <Prompt>hwpx-studio --setup</Prompt>
        <Divider />
        <ProviderChips savedProviders={savedProviders} />
        <CliLine green>
          <span className="mr-1.5">✓</span>
          {savedProviders.length}개 공급자 설정 완료
        </CliLine>
        {remaining.length > 0 ? (
          <>
            <Divider />
            <CliLine dim>추가 키를 설정할까요? ({remaining.length}개 남음)</CliLine>
            <div className="mt-1 flex flex-col gap-0.5">
              {options.map((opt, i) => (
                <OptionRow
                  key={opt.shortcut}
                  shortcut={opt.shortcut}
                  label={opt.label}
                  desc={opt.desc}
                  active={cursor === i}
                  dimShortcut={opt.dimShortcut}
                  onClick={opt.onClick}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <CliLine dim>모든 공급자가 설정되었습니다.</CliLine>
            <button
              type="button"
              onClick={() => setPhase("doc-select")}
              className="mt-2 self-start rounded-md px-4 py-1.5 text-sm bg-[var(--color-cli-btn-save)] text-white hover:bg-[var(--color-cli-btn-save-hover)] transition-colors font-code cursor-pointer"
            >
              문서 시작하기 →
            </button>
          </>
        )}
        <KeyHints hints={["↑↓ 이동", "Enter 선택", "n 건너뛰기"]} />
      </div>
    );
  }

  function renderDocSelect() {
    const options = DOC_OPTIONS.map((opt, i) => ({
      shortcut: String(i + 1),
      label: opt.label,
      desc: opt.desc,
      onClick: () => {
        if (opt.key === "blank") onStartBlank();
        else if (opt.key === "upload") { setUploadContext("generic"); setPhase("upload"); }
        else if (opt.key === "hwpx") { setUploadContext("hwpx"); setPhase("upload"); }
        else if (opt.key === "template") setPhase("template");
        else if (opt.key === "recent") setPhase("recent");
      },
    }));

    return (
      <div className="flex flex-col gap-2">
        <Prompt>hwpx-studio</Prompt>
        <Divider />
        {savedProviders.length > 0 ? (
          <ProviderChips savedProviders={savedProviders} />
        ) : (
          <div className="flex items-center gap-2">
            <CliLine dim>
              <span className="text-[var(--color-cli-yellow)] mr-1">!</span>
              API 키 미설정
            </CliLine>
            <button
              type="button"
              onClick={() => setPhase("api-setup")}
              className="text-[var(--color-cli-blue)] text-xs underline font-code hover:no-underline cursor-pointer"
            >
              지금 설정
            </button>
          </div>
        )}
        <Divider />
        <CliLine dim>문서 시작 방법을 선택하세요:</CliLine>
        <div className="mt-1 flex flex-col gap-0.5">
          {options.map((opt, i) => (
            <OptionRow
              key={opt.shortcut}
              shortcut={opt.shortcut}
              label={opt.label}
              desc={opt.desc}
              active={cursor === i}
              onClick={opt.onClick}
            />
          ))}
        </div>
        <KeyHints hints={["↑↓ 이동", "Enter 선택"]} />
      </div>
    );
  }

  function renderUpload() {
    const isHwpx = uploadContext === "hwpx";
    return (
      <div className="flex flex-col gap-2">
        <Prompt>{isHwpx ? "hwpx-studio --hwpx-edit" : "hwpx-studio --open"}</Prompt>
        <Divider />
        {isHwpx && (
          <>
            <CliLine blue>HWPX 기반 작업 모드</CliLine>
            <Indent>기존 HWPX 문서를 불러와 AI로 보완 · 재편집합니다.</Indent>
            <Divider />
          </>
        )}
        <CliLine dim>파일을 선택하거나 끌어다 놓으세요:</CliLine>
        <div
          className={[
            "mt-2 flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-10 text-center cursor-pointer transition-all duration-200",
            dragActive
              ? "border-[var(--color-cli-green)] bg-[var(--color-cli-surface)] scale-[1.01]"
              : "border-[var(--color-cli-border)] hover:border-[var(--color-cli-dim)] hover:bg-[var(--color-cli-surface)]",
          ].join(" ")}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); handleDroppedFile(e.dataTransfer.files?.[0]); }}
        >
          <svg
            className={["w-8 h-8 transition-colors", dragActive ? "text-[var(--color-cli-green)]" : "text-[var(--color-cli-dim)]"].join(" ")}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="mt-3 text-[var(--color-cli-text)] font-code text-sm">
            {dragActive ? "놓으세요!" : "클릭하거나 파일을 끌어놓기"}
          </p>
          <p className="mt-1 text-[var(--color-cli-dim)] font-code text-xs">
            {isHwpx ? "HWP · HWPX 권장" : "HWP · HWPX · DOCX · PPTX"}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".hwp,.hwpx,.docx,.pptx"
          className="hidden"
          onChange={(e) => { handleDroppedFile(e.target.files?.[0]); e.target.value = ""; }}
        />
        <BackBtn onClick={() => setPhase("doc-select")} />
        <KeyHints hints={["Esc 뒤로"]} />
      </div>
    );
  }

  function renderTemplate() {
    const templateOptions = DOCUMENT_TEMPLATES.map((t, i) => ({
      shortcut: String(i + 1),
      label: t.name,
      desc: t.description,
      badge: t.icon,
      onClick: () => onStartFromTemplate(t),
    }));
    const options = [
      ...templateOptions,
      { shortcut: "b", label: undefined, desc: "문서 선택으로 돌아가기", badge: undefined, onClick: () => setPhase("doc-select") },
    ];

    return (
      <div className="flex flex-col gap-2">
        <Prompt>hwpx-studio --template</Prompt>
        <Divider />
        <CliLine dim>템플릿을 선택하세요:</CliLine>
        <div className="mt-1 flex flex-col gap-0.5">
          {options.map((opt, i) => (
            <OptionRow
              key={opt.shortcut}
              shortcut={opt.shortcut}
              label={opt.label}
              desc={opt.desc}
              badge={opt.badge}
              active={cursor === i}
              dimShortcut={opt.shortcut === "b"}
              onClick={opt.onClick}
            />
          ))}
        </div>
        <BackBtn onClick={() => setPhase("doc-select")} />
        <KeyHints hints={["↑↓ 이동", "Enter 선택", "Esc 뒤로"]} />
      </div>
    );
  }

  function renderRecent() {
    const snapshots = recentSnapshots.slice(0, 8);

    if (snapshots.length === 0) {
      return (
        <div className="flex flex-col gap-2">
          <Prompt>hwpx-studio --recent</Prompt>
          <Divider />
          <CliLine dim>최근 작업 내역이 없습니다.</CliLine>
          <Indent>파일을 열거나 템플릿으로 시작하면 여기에 표시됩니다.</Indent>
          <div className="mt-4 flex flex-col gap-0.5">
            <OptionRow
              shortcut="1"
              label="파일 가져오기"
              desc="HWP · HWPX · DOCX · PPTX"
              active={cursor === 0}
              onClick={() => { setUploadContext("generic"); setPhase("upload"); }}
            />
            <OptionRow
              shortcut="b"
              desc="문서 선택으로 돌아가기"
              active={cursor === 1}
              dimShortcut
              onClick={() => setPhase("doc-select")}
            />
          </div>
          <BackBtn onClick={() => setPhase("doc-select")} />
          <KeyHints hints={["Esc 뒤로"]} />
        </div>
      );
    }

    const options = [
      ...snapshots.map((s, i) => ({
        shortcut: String(i + 1),
        label: s.name,
        desc: formatTime(s.savedAt),
        badge: formatSize(s.size),
        onClick: () => onLoadRecentSnapshot(s.id),
      })),
      { shortcut: "b", label: undefined, desc: "문서 선택으로 돌아가기", badge: undefined, onClick: () => setPhase("doc-select") },
    ];

    return (
      <div className="flex flex-col gap-2">
        <Prompt>hwpx-studio --recent</Prompt>
        <Divider />
        <CliLine dim>{snapshots.length}개의 최근 작업이 있습니다:</CliLine>
        <div className="mt-1 flex flex-col gap-0.5">
          {options.map((opt, i) => (
            <OptionRow
              key={opt.shortcut}
              shortcut={opt.shortcut}
              label={opt.label}
              desc={opt.desc}
              badge={opt.badge}
              active={cursor === i}
              dimShortcut={opt.shortcut === "b"}
              onClick={opt.onClick}
            />
          ))}
        </div>
        <BackBtn onClick={() => setPhase("doc-select")} />
        <KeyHints hints={["↑↓ 이동", "Enter 선택", "Esc 뒤로"]} />
      </div>
    );
  }

  function renderProcessing() {
    return (
      <div className="flex flex-col gap-3">
        <Prompt>hwpx-studio --open</Prompt>
        <Divider />
        <Spinner text={status || "문서를 준비하는 중입니다..."} />
        <Indent>잠시만 기다려 주세요.</Indent>
      </div>
    );
  }

  function renderPhase() {
    switch (phase) {
      case "api-setup":     return renderApiSetup();
      case "api-key-input": return renderKeyInput();
      case "api-add-more":  return renderAddMore();
      case "doc-select":    return renderDocSelect();
      case "upload":        return renderUpload();
      case "template":      return renderTemplate();
      case "recent":        return renderRecent();
      case "processing":    return renderProcessing();
    }
  }

  const showCursor = phase !== "api-key-input" && phase !== "processing";

  return (
    <div className="h-full w-full flex items-center justify-center p-6 lg:p-10">
      {/* Terminal window */}
      <div className="w-full max-w-2xl flex flex-col max-h-[85vh] rounded-xl overflow-hidden border border-[var(--color-cli-border)] shadow-[0_0_60px_rgba(63,185,80,0.06),0_25px_50px_rgba(0,0,0,0.5)]">
        {/* Title bar */}
        <div className="shrink-0 flex items-center gap-1.5 px-4 py-3 bg-[var(--color-cli-surface)] border-b border-[var(--color-cli-border)]">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="h-3 w-3 rounded-full bg-[#ff5f57] hover:opacity-75 transition-opacity cursor-pointer"
              title="닫기"
            />
          ) : (
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          )}
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-auto text-[var(--color-cli-dim)] text-xs select-none tracking-wide">
            hwpx-studio — zsh
          </span>
        </div>

        {/* Terminal body */}
        <div className="flex-1 overflow-y-auto p-6 font-code text-sm leading-[1.8] text-[var(--color-cli-text)] bg-[var(--color-cli-bg)]">
          {renderPhase()}
          {showCursor && <Cursor />}
        </div>
      </div>
    </div>
  );
}
