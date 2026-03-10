"use client";

import { memo, useEffect, useRef, useState } from "react";
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

const HWP_FONTS = [
  "바탕",
  "바탕체",
  "궁서",
  "궁서체",
  "굴림",
  "굴림체",
  "돋움",
  "돋움체",
  "맑은 고딕",
  "나눔고딕",
  "나눔명조",
  "Arial",
  "Times New Roman",
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 54, 60, 72];

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
  /** Optional: called when user exports from the ExportModal with format + options */
  onExportWithOptions?: (format: ExportFormat, options: ExportOptions) => void;
  /** Current document file name (used as default in ExportModal) */
  currentFileName?: string;
  onSave: () => void;
  sessionContext: {
    email: string;
    displayName: string;
    providerDisplayName: string;
    activeTenantId: string;
    memberships: Array<{
      tenantId: string;
      tenantName: string;
      role: string;
    }>;
  } | null;
  tenantSwitching: boolean;
  onSwitchTenant: (tenantId: string) => void;
  onLogout: () => void;
  formMode: boolean;
  onToggleFormMode: () => void;
  onToggleSidebar?: () => void;
};

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
  if (!editor) {
    return 0;
  }
  const paragraphAttrs = editor.getAttributes("paragraph") as { letterSpacing?: number | string };
  const headingAttrs = editor.getAttributes("heading") as { letterSpacing?: number | string };
  const raw = paragraphAttrs.letterSpacing ?? headingAttrs.letterSpacing;
  const parsed = Number.parseInt(String(raw ?? 0), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRecentKindLabel(kind: RecentFileSnapshotMeta["kind"]): string {
  if (kind === "auto-save") {
    return "자동저장";
  }
  if (kind === "manual-save") {
    return "수동저장";
  }
  return "열기";
}

function formatRecentSnapshotLabel(snapshot: RecentFileSnapshotMeta): string {
  const time = new Date(snapshot.savedAt).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${getRecentKindLabel(snapshot.kind)} | ${time} | ${snapshot.name}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
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
      const width = Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth : 320;
      const height = Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight : 180;
      resolve({ width, height });
    };
    image.onerror = () => resolve({ width: 320, height: 180 });
    image.src = src;
  });
}

export const EditorToolbar = memo(function EditorToolbar({
  editor,
  sidebarCollapsed,
  activeSidebarTab,
  disabled: globalDisabled,
  hasDocument,
  downloadUrl,
  downloadName,
  onSetSidebarTab,
  onAiCommand,
  recentSnapshots,
  selectedRecentSnapshotId,
  onSelectRecentSnapshot,
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
  onLogout,
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

  const isTabActive = (tab: SidebarTab) => !sidebarCollapsed && activeSidebarTab === tab;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();

      if (key === "o") {
        event.preventDefault();
        if (!globalDisabled) {
          fileInputRef.current?.click();
        }
        return;
      }

      if (key === "s") {
        event.preventDefault();
        if (!globalDisabled && hasDocument) {
          onSave();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [globalDisabled, hasDocument, onSave]);

  const updateLetterSpacing = (delta: number) => {
    if (!editor) {
      return;
    }
    const next = Math.max(-50, Math.min(50, currentLetterSpacing + delta));
    const attrs = { letterSpacing: next };
    if (editor.isActive("heading")) {
      editor.chain().focus().updateAttributes("heading", attrs).run();
      return;
    }
    editor.chain().focus().updateAttributes("paragraph", attrs).run();
  };

  const onPickImage = async (file: File) => {
    if (!editor) {
      return;
    }
    setImageUploading(true);
    try {
      const src = await readFileAsDataUrl(file);
      const { width, height } = await readImageSize(src);
      editor.chain().focus().setImage({
        src,
        alt: file.name,
        title: file.name,
        width,
        height,
        fileName: file.name,
        mimeType: file.type || "image/png",
      } as never).run();
    } catch (error) {
      log.error("이미지 삽입 실패", error instanceof Error ? { message: error.message } : undefined);
    } finally {
      setImageUploading(false);
    }
  };

  return (
    <>
      <div className={styles.toolbar}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".hwp,.hwpx,.docx,.pptx"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickFile(file);
            e.target.value = "";
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          data-image-input=""
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void onPickImage(file);
            }
            e.target.value = "";
          }}
        />
        {/* ── 1행: 열기~저장 + 패널 토글 ── */}
        <div className={styles.toolbarRow}>
          <div className={styles.group}>
            <button
              type="button"
              className={styles.btn}
              disabled={globalDisabled}
              onClick={() => fileInputRef.current?.click()}
              title="열기 (Ctrl/Cmd+O)"
            >
              열기
            </button>
            <div className={styles.recentGroup}>
              <select
                className={styles.recentSelect}
                value={selectedRecentSnapshotId}
                disabled={globalDisabled || !recentSnapshots.length}
                title="최근 파일"
                onChange={(event) => onSelectRecentSnapshot(event.target.value)}
              >
                <option value="">
                  {recentSnapshots.length ? "최근 파일 선택" : "최근 파일 없음"}
                </option>
                {recentSnapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {formatRecentSnapshotLabel(snapshot)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.btn}
                disabled={globalDisabled || !selectedRecentSnapshotId}
                onClick={() => onLoadRecentSnapshot(selectedRecentSnapshotId)}
                title="선택한 최근 파일 불러오기"
              >
                최근열기
              </button>
            </div>
            {onExportWithOptions ? (
              <button
                type="button"
                className={styles.btn}
                disabled={globalDisabled || !hasDocument}
                onClick={() => setExportModalOpen(true)}
                title="내보내기 옵션"
              >
                내보내기
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={globalDisabled || !hasDocument}
                  onClick={onExport}
                  title="내보내기"
                >
                  내보내기
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={globalDisabled || !hasDocument}
                  onClick={onExportPdf}
                  title="PDF 내보내기"
                >
                  PDF
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={globalDisabled || !hasDocument}
                  onClick={onExportDocx}
                  title="DOCX 내보내기"
                >
                  DOCX
                </button>
              </>
            )}
            <a
              href="/pilot"
              target="_blank"
              rel="noreferrer"
              className={`${styles.btn} ${styles.linkButton}`}
              title="파일럿 대시보드"
            >
              파일럿
            </a>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={downloadName}
                className={styles.downloadLink}
                title="다운로드"
              >
                ↓
              </a>
            )}
          </div>

          <div className={styles.sep} />

          <div className={styles.group}>
            {sessionContext ? (
              <>
                <select
                  className={styles.tenantSelect}
                  value={sessionContext.activeTenantId}
                  disabled={globalDisabled || tenantSwitching || sessionContext.memberships.length <= 1}
                  title="활성 테넌트"
                  onChange={(event) => onSwitchTenant(event.target.value)}
                >
                  {sessionContext.memberships.map((membership) => (
                    <option key={membership.tenantId} value={membership.tenantId}>
                      {`${membership.tenantName} · ${membership.role}`}
                    </option>
                  ))}
                </select>
                <span className={styles.sessionBadge}>{sessionContext.providerDisplayName}</span>
                <span className={styles.sessionMeta} title={sessionContext.email}>
                  {sessionContext.displayName}
                </span>
              </>
            ) : null}
            <div className={styles.navShortcuts}>
              <Link className={styles.navShortcut} href="/dashboard">
                홈
              </Link>
              <Link className={styles.navShortcut} href="/search" title="전체 검색">
                🔍
              </Link>
              <Link className={styles.navShortcut} href="/documents">
                문서함
              </Link>
              <Link className={styles.navShortcut} href="/templates">
                템플릿함
              </Link>
              <Link className={styles.navShortcut} href="/pilot">
                KPI
              </Link>
              <Link className={styles.navShortcut} href="/onboarding" title="기능 안내">
                ?
              </Link>
              <Link className={styles.navShortcut} href="/batch" title="배치 문서 생성 (양식+CSV)">
                배치
              </Link>
            </div>
            <Btn
              label="저장"
              title="다른 이름으로 저장 (Ctrl/Cmd+S)"
              active={false}
              disabled={globalDisabled || !hasDocument}
              onClick={onSave}
            />
            <Btn
              label="로그아웃"
              title="세션 종료"
              active={false}
              disabled={globalDisabled}
              onClick={onLogout}
            />
          </div>

          {/* ── 우측 패널 토글 (flex push) ── */}
          <div className={styles.panelToggles}>
            <Btn
              label={sidebarCollapsed ? "패널+" : "패널-"}
              title="사이드 패널 토글"
              active={!sidebarCollapsed}
              disabled={false}
              onClick={() => onToggleSidebar?.()}
            />
            <Btn
              label="개요"
              title="문서 개요"
              active={isTabActive("outline")}
              disabled={false}
              onClick={() => onSetSidebarTab("outline")}
            />
            <Btn
              label="AI"
              title="AI 제안"
              active={isTabActive("ai")}
              disabled={false}
              onClick={() => onSetSidebarTab("ai")}
            />
            <Btn
              label="채팅"
              title="AI 채팅"
              active={isTabActive("chat")}
              disabled={false}
              onClick={() => onSetSidebarTab("chat")}
            />
            <Btn
              label="분석"
              title="문서 분석"
              active={isTabActive("analysis")}
              disabled={false}
              onClick={() => onSetSidebarTab("analysis")}
            />
            <Btn
              label="이력"
              title="수정 이력"
              active={isTabActive("history")}
              disabled={false}
              onClick={() => onSetSidebarTab("history")}
            />
          </div>
        </div>

        {/* ── 2행: 뒤로가기~AI 수정 ── */}
        <div className={styles.toolbarRow}>
          <div className={styles.group}>
            <Btn
              label="←"
              title="실행 취소 (Ctrl+Z)"
              active={false}
              disabled={editorDisabled || !(editor?.can().undo() ?? false)}
              onClick={() => editor?.chain().focus().undo().run()}
            />
            <Btn
              label="→"
              title="다시 실행 (Ctrl+Y)"
              active={false}
              disabled={editorDisabled || !(editor?.can().redo() ?? false)}
              onClick={() => editor?.chain().focus().redo().run()}
            />
          </div>

          <div className={styles.sep} />

          <div className={styles.group}>
            <select
              className={styles.fontSelect}
              disabled={editorDisabled}
              value={currentFont}
              onChange={(e) => {
                editor?.chain().focus().setFontFamily(e.target.value).run();
              }}
              title="글꼴"
            >
              {HWP_FONTS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>

            <select
              className={styles.sizeSelect}
              disabled={editorDisabled}
              value={currentSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                editor?.chain().focus().setMark("textStyle", { fontSize: `${size}pt` }).run();
              }}
              title="글자 크기"
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.sep} />

          <div className={styles.group}>
            <Btn
              label={<b>가</b>}
              title="굵게 (Ctrl+B)"
              active={editor?.isActive("bold") ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            />
            <Btn
              label={<i>가</i>}
              title="기울임 (Ctrl+I)"
              active={editor?.isActive("italic") ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            />
            <Btn
              label={<u>가</u>}
              title="밑줄 (Ctrl+U)"
              active={editor?.isActive("underline") ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
            />
            <Btn
              label={<s>가</s>}
              title="취소선"
              active={editor?.isActive("strike") ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleStrike().run()}
            />
            <Btn
              label="x²"
              title="위첨자"
              active={editor?.isActive("superscript") ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleSuperscript().run()}
            />
            <Btn
              label="x₂"
              title="아래첨자"
              active={editor?.isActive("subscript") ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleSubscript().run()}
            />
            <Btn
              label="가"
              title="글자 모양 (Alt+L)"
              active={false}
              disabled={editorDisabled}
              onClick={() => setCharModalOpen(true)}
            />
            <Btn
              label="자간-"
              title="자간 줄이기"
              active={false}
              disabled={editorDisabled}
              onClick={() => updateLetterSpacing(-1)}
            />
            <button
              type="button"
              className={styles.btn}
              title="현재 자간"
              disabled
              aria-label="현재 자간"
            >
              {`자간 ${currentLetterSpacing}`}
            </button>
            <Btn
              label="자간+"
              title="자간 늘리기"
              active={false}
              disabled={editorDisabled}
              onClick={() => updateLetterSpacing(1)}
            />
          </div>

          <div className={styles.sep} />

          <div className={styles.group}>
            <Btn
              label="≡←"
              title="왼쪽 정렬 (Ctrl+L)"
              active={editor?.isActive({ textAlign: "left" }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().setTextAlign("left").run()}
            />
            <Btn
              label="≡↔"
              title="가운데 정렬 (Ctrl+E)"
              active={editor?.isActive({ textAlign: "center" }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().setTextAlign("center").run()}
            />
            <Btn
              label="≡→"
              title="오른쪽 정렬 (Ctrl+R)"
              active={editor?.isActive({ textAlign: "right" }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().setTextAlign("right").run()}
            />
            <Btn
              label="≡≡"
              title="양쪽 정렬 (Ctrl+J)"
              active={editor?.isActive({ textAlign: "justify" }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().setTextAlign("justify").run()}
            />
            <Btn
              label="문단"
              title="문단 모양 (Alt+T)"
              active={false}
              disabled={editorDisabled}
              onClick={() => setParaModalOpen(true)}
            />
          </div>

          <div className={styles.sep} />

          <div className={styles.group}>
            <Btn
              label="H1"
              title="제목 필드 지정 (H1)"
              active={editor?.isActive("heading", { level: 1 }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).updateAttributes("heading", { fieldType: "title" }).run()}
            />
            <Btn
              label="H2"
              title="받는 사람 필드 지정 (H2)"
              active={editor?.isActive("heading", { level: 2 }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).updateAttributes("heading", { fieldType: "recipient" }).run()}
            />
            <Btn
              label="H3"
              title="보내는 사람 필드 지정 (H3)"
              active={editor?.isActive("heading", { level: 3 }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).updateAttributes("heading", { fieldType: "sender" }).run()}
            />
            <Btn
              label="H4"
              title="본문 필드 지정 (H4)"
              active={editor?.isActive("heading", { level: 4 }) ?? false}
              disabled={editorDisabled}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).updateAttributes("heading", { fieldType: "body" }).run()}
            />
          </div>

          <div className={styles.sep} />

          <TableControls
            editor={editor}
            groupClassName={styles.group}
            buttonClassName={styles.btn}
          />

          <div className={styles.group}>
            <button
              type="button"
              className={styles.btn}
              disabled={editorDisabled || imageUploading}
              onClick={() => imageInputRef.current?.click()}
              title="이미지 삽입"
            >
              {imageUploading ? "이미지..." : "이미지"}
            </button>
          </div>

          <div className={styles.sep} />

          <div className={styles.group}>
            <Btn
              label="양식 모드"
              title="양식 입력 모드 토글"
              active={formMode}
              disabled={editorDisabled}
              onClick={onToggleFormMode}
            />
            <button type="button" className={styles.btn} disabled={editorDisabled} onClick={onAiCommand}>
              AI 수정
            </button>
          </div>

        </div>

        <div className={styles.panelToggleRow}>
          <div className={`${styles.group} ${styles.panelToggleGroup}`}>
            <Btn
              label="개요"
              title="문서 개요"
              active={isTabActive("outline")}
              disabled={false}
              onClick={() => onSetSidebarTab("outline")}
            />
            <Btn
              label="AI"
              title="AI 제안"
              active={isTabActive("ai")}
              disabled={false}
              onClick={() => onSetSidebarTab("ai")}
            />
            <Btn
              label="채팅"
              title="AI 채팅"
              active={isTabActive("chat")}
              disabled={false}
              onClick={() => onSetSidebarTab("chat")}
            />
            <Btn
              label="분석"
              title="문서 분석"
              active={isTabActive("analysis")}
              disabled={false}
              onClick={() => onSetSidebarTab("analysis")}
            />
            <Btn
              label="이력"
              title="수정 이력"
              active={isTabActive("history")}
              disabled={false}
              onClick={() => onSetSidebarTab("history")}
            />
          </div>
        </div>
      </div>

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
          onExport={(format: ExportFormat, options: ExportOptions) => {
            onExportWithOptions(format, options);
          }}
        />
      )}
    </>
  );
});

/* ── Small helpers ── */

function Btn({
  label,
  title,
  active,
  disabled,
  onClick,
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
