"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Editor } from "@tiptap/core";
import type { SidebarTab } from "@/store/document-store";
import type { RecentFileSnapshotMeta } from "@/lib/recent-files";
import { log } from "@/lib/logger";
import { TableControls } from "./TableControls";
import { ParagraphStyleModal } from "./ParagraphStyleModal";
import { CharStyleModal } from "./CharStyleModal";
import { ExportModal } from "./ExportModal";
import type { ExportFormat, ExportOptions } from "./ExportModal";
import styles from "./EditorToolbar.module.css";

// ── Constants ─────────────────────────────────────────────────────────────────

const HWP_FONTS = [
  "바탕", "바탕체", "궁서", "궁서체", "굴림", "굴림체", "돋움", "돋움체",
  "맑은 고딕", "나눔고딕", "나눔명조", "Arial", "Times New Roman",
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 54, 60, 72];

const NAV_ITEMS = [
  { href: "/dashboard", label: "홈" },
  { href: "/search",    label: "검색" },
  { href: "/documents", label: "문서함" },
  { href: "/templates", label: "템플릿함" },
  { href: "/pilot",     label: "KPI" },
  { href: "/batch/jobs",label: "배치" },
  { href: "/onboarding",label: "도움말" },
];

// ── Utilities ─────────────────────────────────────────────────────────────────

function getCurrentFontFamily(editor: Editor | null): string {
  if (!editor) return "바탕";
  const attrs = editor.getAttributes("textStyle") as { fontFamily?: string };
  return attrs.fontFamily || "바탕";
}

function getCurrentFontSize(editor: Editor | null): number {
  if (!editor) return 10;
  const attrs = editor.getAttributes("textStyle") as { fontSize?: string };
  const raw = attrs.fontSize || "";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function getCurrentLetterSpacing(editor: Editor | null): number {
  if (!editor) return 0;
  const paragraphAttrs = editor.getAttributes("paragraph") as { letterSpacing?: number | string };
  const headingAttrs = editor.getAttributes("heading") as { letterSpacing?: number | string };
  const raw = paragraphAttrs.letterSpacing ?? headingAttrs.letterSpacing;
  const parsed = Number.parseInt(String(raw ?? 0), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRecentTime(savedAt: number): string {
  return new Date(savedAt).toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatRecentSnapshotLabel(snapshot: RecentFileSnapshotMeta): string {
  const kind = snapshot.kind === "auto-save" ? "자동" : snapshot.kind === "manual-save" ? "저장" : "열기";
  return `${kind} | ${formatRecentTime(snapshot.savedAt)} | ${snapshot.name}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") { resolve(result); return; }
      reject(new Error("이미지 데이터를 읽지 못했습니다."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("이미지 로드 실패"));
    reader.readAsDataURL(file);
  });
}

function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      const w = Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth : 320;
      const h = Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight : 180;
      resolve({ width: w, height: h });
    };
    image.onerror = () => resolve({ width: 320, height: 180 });
    image.src = src;
  });
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose, enabled]);
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function IcoUndo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </svg>
  );
}

function IcoRedo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
    </svg>
  );
}

function IcoAlignLeft() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="10" y2="8" />
      <line x1="2" y1="12" x2="12" y2="12" />
    </svg>
  );
}

function IcoAlignCenter() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="4" y1="8" x2="12" y2="8" />
      <line x1="3" y1="12" x2="13" y2="12" />
    </svg>
  );
}

function IcoAlignRight() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="6" y1="8" x2="14" y2="8" />
      <line x1="4" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function IcoAlignJustify() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function IcoPhoto() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function IcoDotsH() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function IcoPanelOpen() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function IcoPanelClose() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <path d="M18 9l-3 3 3 3" />
    </svg>
  );
}

// ── Dropdown sub-components ───────────────────────────────────────────────────

function OpenDropdown({
  disabled,
  recentSnapshots,
  selectedId,
  onLoadSnapshot,
  fileInputRef,
}: {
  disabled: boolean;
  recentSnapshots: RecentFileSnapshotMeta[];
  selectedId: string;
  onLoadSnapshot: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  return (
    <div ref={ref} className={styles.dropdown}>
      <button
        type="button"
        className={styles.btn}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="파일 열기 (Ctrl+O)"
      >
        열기 <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.dropdownMenu}>
          <button
            type="button"
            className={styles.dropdownItem}
            onClick={() => { fileInputRef.current?.click(); setOpen(false); }}
          >
            <span>파일 열기...</span>
            <span className={styles.dropdownShortcut}>⌘O</span>
          </button>
          {recentSnapshots.length > 0 && (
            <>
              <div className={styles.dropdownDivider} />
              <div className={styles.dropdownLabel}>최근 파일</div>
              {recentSnapshots.slice(0, 6).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.dropdownItem} ${selectedId === s.id ? styles.dropdownItemActive : ""}`}
                  onClick={() => { onLoadSnapshot(s.id); setOpen(false); }}
                >
                  <span className={styles.dropdownItemName}>{s.name}</span>
                  <span className={styles.dropdownItemMeta}>{formatRecentTime(s.savedAt)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NavOverflow() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  return (
    <div ref={ref} className={styles.dropdown}>
      <button
        type="button"
        className={styles.btn}
        onClick={() => setOpen((v) => !v)}
        title="메뉴"
      >
        <IcoDotsH />
      </button>
      {open && (
        <div className={`${styles.dropdownMenu} ${styles.dropdownMenuRight}`}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.dropdownItem}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionChip({
  context,
  tenantSwitching,
  onSwitchTenant,
}: {
  context: NonNullable<EditorToolbarProps["sessionContext"]>;
  tenantSwitching: boolean;
  onSwitchTenant: (id: string) => void;
}) {
  return (
    <div className={styles.sessionChip}>
      {context.memberships.length > 1 ? (
        <select
          className={styles.tenantSelect}
          value={context.activeTenantId}
          disabled={tenantSwitching || context.memberships.length <= 1}
          title="조직 전환"
          onChange={(e) => onSwitchTenant(e.target.value)}
        >
          {context.memberships.map((m) => (
            <option key={m.tenantId} value={m.tenantId}>
              {m.tenantName}
            </option>
          ))}
        </select>
      ) : (
        <span className={styles.sessionOrg}>{context.memberships[0]?.tenantName}</span>
      )}
      <span className={styles.sessionMeta} title={context.email}>
        {context.displayName}
      </span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

type EditorToolbarProps = {
  editor: Editor | null;
  sidebarCollapsed: boolean;
  activeSidebarTab: SidebarTab;
  disabled: boolean;
  hasDocument: boolean;
  downloadUrl: string;
  downloadName: string;
  onSetSidebarTab: (tab: SidebarTab) => void;
  onAiCommand: () => void;
  recentSnapshots: RecentFileSnapshotMeta[];
  selectedRecentSnapshotId: string;
  onSelectRecentSnapshot: (snapshotId: string) => void;
  onLoadRecentSnapshot: (snapshotId: string) => void;
  onPickFile: (file: File) => void;
  onExport: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
  onExportWithOptions?: (format: ExportFormat, options: ExportOptions) => void;
  currentFileName?: string;
  onSave: () => void;
  sessionContext: {
    email: string;
    displayName: string;
    providerDisplayName: string;
    activeTenantId: string;
    memberships: Array<{ tenantId: string; tenantName: string; role: string }>;
  } | null;
  tenantSwitching: boolean;
  onSwitchTenant: (tenantId: string) => void;
  formMode: boolean;
  onToggleFormMode: () => void;
  onToggleSidebar?: () => void;
  onOpenStartWizard?: () => void;
  onExportMarkdown?: () => void;
};

// ── Main ──────────────────────────────────────────────────────────────────────

export const EditorToolbar = memo(function EditorToolbar({
  editor,
  sidebarCollapsed,
  disabled: globalDisabled,
  hasDocument,
  downloadUrl,
  downloadName,
  onAiCommand,
  recentSnapshots,
  selectedRecentSnapshotId,
  onLoadRecentSnapshot,
  onPickFile,
  onExport,
  onExportPdf,
  onExportDocx,
  onExportWithOptions,
  currentFileName,
  onSave,
  sessionContext,
  tenantSwitching,
  onSwitchTenant,
  formMode,
  onToggleFormMode,
  onToggleSidebar,
}: EditorToolbarProps) {
  const editorDisabled = !editor;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [paraModalOpen, setParaModalOpen] = useState(false);
  const [charModalOpen, setCharModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  const currentFont = getCurrentFontFamily(editor);
  const currentSize = getCurrentFontSize(editor);
  const currentLetterSpacing = getCurrentLetterSpacing(editor);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        if (!globalDisabled) fileInputRef.current?.click();
        return;
      }
      if (key === "s") {
        event.preventDefault();
        if (!globalDisabled && hasDocument) onSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [globalDisabled, hasDocument, onSave]);

  const updateLetterSpacing = (delta: number) => {
    if (!editor) return;
    const next = Math.max(-50, Math.min(50, currentLetterSpacing + delta));
    const attrs = { letterSpacing: next };
    if (editor.isActive("heading")) {
      editor.chain().focus().updateAttributes("heading", attrs).run();
      return;
    }
    editor.chain().focus().updateAttributes("paragraph", attrs).run();
  };

  const onPickImage = async (file: File) => {
    if (!editor) return;
    setImageUploading(true);
    try {
      const src = await readFileAsDataUrl(file);
      const { width, height } = await readImageSize(src);
      editor.chain().focus().setImage({
        src, alt: file.name, title: file.name, width, height,
        fileName: file.name, mimeType: file.type || "image/png",
      } as never).run();
    } catch (error) {
      log.error("이미지 삽입 실패", error instanceof Error ? { message: error.message } : undefined);
    } finally {
      setImageUploading(false);
    }
  };

  const handleExportClick = () => {
    if (onExportWithOptions) {
      setExportModalOpen(true);
    } else {
      onExport();
    }
  };

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".hwp,.hwpx,.docx,.pptx"
        className={styles.hiddenInput}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        data-image-input=""
        className={styles.hiddenInput}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(f); e.target.value = ""; }}
      />

      <div className={styles.toolbar}>
        {/* ── Row 1: 파일 · 파일명 · 세션 · 저장 · 패널 ── */}
        <div className={styles.toolbarRow}>
          {/* Left: open + export */}
          <div className={styles.group}>
            <OpenDropdown
              disabled={globalDisabled}
              recentSnapshots={recentSnapshots}
              selectedId={selectedRecentSnapshotId}
              onLoadSnapshot={onLoadRecentSnapshot}
              fileInputRef={fileInputRef}
            />
            <button
              type="button"
              className={styles.btn}
              disabled={globalDisabled || !hasDocument}
              onClick={handleExportClick}
              title="내보내기"
            >
              내보내기
            </button>
            {!onExportWithOptions && (
              <>
                <button type="button" className={styles.btn} disabled={globalDisabled || !hasDocument} onClick={onExportPdf} title="PDF 내보내기">PDF</button>
                <button type="button" className={styles.btn} disabled={globalDisabled || !hasDocument} onClick={onExportDocx} title="DOCX 내보내기">DOCX</button>
              </>
            )}
            {downloadUrl && (
              <a href={downloadUrl} download={downloadName} className={styles.downloadLink} title="다운로드">↓</a>
            )}
          </div>

          {/* Center: file name */}
          <div className={styles.fileName}>
            {currentFileName && (
              <span className={styles.fileNameText} title={currentFileName}>{currentFileName}</span>
            )}
          </div>

          {/* Right: nav overflow + session + save + panel toggle */}
          <div className={styles.rowRight}>
            <NavOverflow />
            {sessionContext && (
              <SessionChip
                context={sessionContext}
                tenantSwitching={tenantSwitching}
                onSwitchTenant={onSwitchTenant}
              />
            )}
            <div className={styles.sep} />
            <button
              type="button"
              className={styles.btn}
              disabled={globalDisabled || !hasDocument}
              onClick={onSave}
              title="다른 이름으로 저장 (Ctrl/Cmd+S)"
            >
              저장
            </button>
            <div className={styles.sep} />
            <button
              type="button"
              className={styles.iconBtn}
              title={sidebarCollapsed ? "패널 열기" : "패널 닫기"}
              onClick={() => onToggleSidebar?.()}
            >
              {sidebarCollapsed ? <IcoPanelOpen /> : <IcoPanelClose />}
            </button>
          </div>
        </div>

        {/* ── Row 2: 편집 도구 ── */}
        <div className={styles.toolbarRow}>
          {/* Undo / Redo */}
          <div className={styles.group}>
            <button
              type="button"
              className={styles.iconBtn}
              disabled={editorDisabled || !(editor?.can().undo() ?? false)}
              onClick={() => editor?.chain().focus().undo().run()}
              title="실행 취소 (Ctrl+Z)"
            >
              <IcoUndo />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              disabled={editorDisabled || !(editor?.can().redo() ?? false)}
              onClick={() => editor?.chain().focus().redo().run()}
              title="다시 실행 (Ctrl+Y)"
            >
              <IcoRedo />
            </button>
          </div>

          <div className={styles.sep} />

          {/* Font + Size */}
          <div className={styles.group}>
            <select
              className={styles.fontSelect}
              disabled={editorDisabled}
              value={currentFont}
              onChange={(e) => editor?.chain().focus().setFontFamily(e.target.value).run()}
              title="글꼴"
            >
              {HWP_FONTS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
            <select
              className={styles.sizeSelect}
              disabled={editorDisabled}
              value={currentSize}
              onChange={(e) => editor?.chain().focus().setMark("textStyle", { fontSize: `${Number(e.target.value)}pt` }).run()}
              title="글자 크기"
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className={styles.sep} />

          {/* Text formatting */}
          <div className={styles.group}>
            <Btn label={<b>B</b>} title="굵게 (Ctrl+B)" active={editor?.isActive("bold") ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleBold().run()} />
            <Btn label={<i>I</i>}  title="기울임 (Ctrl+I)" active={editor?.isActive("italic") ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleItalic().run()} />
            <Btn label={<u>U</u>} title="밑줄 (Ctrl+U)" active={editor?.isActive("underline") ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
            <Btn label={<s>S</s>} title="취소선" active={editor?.isActive("strike") ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleStrike().run()} />
            <Btn label="x²" title="위첨자" active={editor?.isActive("superscript") ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleSuperscript().run()} />
            <Btn label="x₂" title="아래첨자" active={editor?.isActive("subscript") ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleSubscript().run()} />
            <Btn label="Aa" title="글자 모양 (Alt+L)" active={false} disabled={editorDisabled} onClick={() => setCharModalOpen(true)} />

            {/* 자간 spinner */}
            <div className={styles.spinnerGroup} title="자간 조정">
              <button type="button" className={styles.spinnerBtn} disabled={editorDisabled} onClick={() => updateLetterSpacing(-1)} aria-label="자간 줄이기">−</button>
              <span className={styles.spinnerValue} aria-label="현재 자간">{currentLetterSpacing}</span>
              <button type="button" className={styles.spinnerBtn} disabled={editorDisabled} onClick={() => updateLetterSpacing(1)} aria-label="자간 늘리기">+</button>
            </div>
          </div>

          <div className={styles.sep} />

          {/* Alignment */}
          <div className={styles.group}>
            <button type="button" className={`${styles.iconBtn} ${(editor?.isActive({ textAlign: "left" }) ?? false) ? styles.iconBtnActive : ""}`} disabled={editorDisabled} onClick={() => editor?.chain().focus().setTextAlign("left").run()} title="왼쪽 정렬 (Ctrl+L)"><IcoAlignLeft /></button>
            <button type="button" className={`${styles.iconBtn} ${(editor?.isActive({ textAlign: "center" }) ?? false) ? styles.iconBtnActive : ""}`} disabled={editorDisabled} onClick={() => editor?.chain().focus().setTextAlign("center").run()} title="가운데 정렬 (Ctrl+E)"><IcoAlignCenter /></button>
            <button type="button" className={`${styles.iconBtn} ${(editor?.isActive({ textAlign: "right" }) ?? false) ? styles.iconBtnActive : ""}`} disabled={editorDisabled} onClick={() => editor?.chain().focus().setTextAlign("right").run()} title="오른쪽 정렬 (Ctrl+R)"><IcoAlignRight /></button>
            <button type="button" className={`${styles.iconBtn} ${(editor?.isActive({ textAlign: "justify" }) ?? false) ? styles.iconBtnActive : ""}`} disabled={editorDisabled} onClick={() => editor?.chain().focus().setTextAlign("justify").run()} title="양쪽 정렬 (Ctrl+J)"><IcoAlignJustify /></button>
            <Btn label="¶" title="문단 모양 (Alt+T)" active={false} disabled={editorDisabled} onClick={() => setParaModalOpen(true)} />
          </div>

          <div className={styles.sep} />

          {/* Headings */}
          <div className={styles.group}>
            <Btn label="H1" title="제목 필드 (H1)" active={editor?.isActive("heading", { level: 1 }) ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).updateAttributes("heading", { fieldType: "title" }).run()} />
            <Btn label="H2" title="받는 사람 필드 (H2)" active={editor?.isActive("heading", { level: 2 }) ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).updateAttributes("heading", { fieldType: "recipient" }).run()} />
            <Btn label="H3" title="보내는 사람 필드 (H3)" active={editor?.isActive("heading", { level: 3 }) ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).updateAttributes("heading", { fieldType: "sender" }).run()} />
            <Btn label="H4" title="본문 필드 (H4)" active={editor?.isActive("heading", { level: 4 }) ?? false} disabled={editorDisabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).updateAttributes("heading", { fieldType: "body" }).run()} />
          </div>

          <div className={styles.sep} />

          {/* Table + Image */}
          <TableControls editor={editor} groupClassName={styles.group} buttonClassName={styles.btn} />
          <div className={styles.group}>
            <button
              type="button"
              className={styles.iconBtn}
              disabled={editorDisabled || imageUploading}
              onClick={() => imageInputRef.current?.click()}
              title="이미지 삽입"
            >
              {imageUploading ? <span className={styles.spinnerInline} /> : <IcoPhoto />}
            </button>
          </div>

          <div className={styles.sep} />

          {/* Form mode + AI */}
          <div className={styles.group}>
            <Btn
              label={formMode ? "양식 ●" : "양식 ○"}
              title="양식 입력 모드 토글"
              active={formMode}
              disabled={editorDisabled}
              onClick={onToggleFormMode}
            />
            <button
              type="button"
              className={styles.btnAi}
              disabled={editorDisabled}
              onClick={onAiCommand}
              title="AI 문서 편집"
            >
              AI 수정
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {paraModalOpen && editor && (
        <ParagraphStyleModal editor={editor} onClose={() => setParaModalOpen(false)} />
      )}
      {charModalOpen && editor && (
        <CharStyleModal editor={editor} onClose={() => setCharModalOpen(false)} />
      )}
      {exportModalOpen && onExportWithOptions && (
        <ExportModal
          isOpen={exportModalOpen}
          onClose={() => setExportModalOpen(false)}
          defaultFileName={currentFileName ?? "document"}
          onExport={(format: ExportFormat, options: ExportOptions) => onExportWithOptions(format, options)}
        />
      )}
    </>
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function Btn({
  label, title, active, disabled, onClick,
}: {
  label: React.ReactNode;
  title: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? `${styles.btn} ${styles.btnActive}` : styles.btn}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
