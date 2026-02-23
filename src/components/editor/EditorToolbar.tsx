"use client";

import { useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { SidebarTab } from "@/store/document-store";
import { TableControls } from "./TableControls";
import { ParagraphStyleModal } from "./ParagraphStyleModal";
import { CharStyleModal } from "./CharStyleModal";
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
  onToggleSidebar: () => void;
  onSetSidebarTab: (tab: SidebarTab) => void;
  onAiCommand: () => void;
  onPickFile: (file: File) => void;
  onExport: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
  onSave: () => void;
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

export function EditorToolbar({
  editor,
  sidebarCollapsed,
  activeSidebarTab,
  disabled: globalDisabled,
  hasDocument,
  downloadUrl,
  downloadName,
  onToggleSidebar,
  onSetSidebarTab,
  onAiCommand,
  onPickFile,
  onExport,
  onExportPdf,
  onExportDocx,
  onSave,
}: EditorToolbarProps) {
  const editorDisabled = !editor;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [paraModalOpen, setParaModalOpen] = useState(false);
  const [charModalOpen, setCharModalOpen] = useState(false);

  const currentFont = getCurrentFontFamily(editor);
  const currentSize = getCurrentFontSize(editor);
  const currentLetterSpacing = getCurrentLetterSpacing(editor);

  const isTabActive = (tab: SidebarTab) => !sidebarCollapsed && activeSidebarTab === tab;

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

  return (
    <>
      <div className={styles.toolbar}>
        {/* ── 파일 열기/내보내기 ── */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".hwpx,.docx,.pptx"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickFile(file);
            e.target.value = "";
          }}
        />
        <div className={styles.group}>
          <button
            type="button"
            className={styles.btn}
            disabled={globalDisabled}
            onClick={() => fileInputRef.current?.click()}
            title="열기"
          >
            열기
          </button>
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

        {/* ── 실행 취소/다시 실행/저장 ── */}
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
          <Btn
            label="저장"
            title="저장 (Ctrl+S)"
            active={false}
            disabled={globalDisabled || !hasDocument}
            onClick={onSave}
          />
        </div>

        <div className={styles.sep} />

        {/* ── 글꼴 ── */}
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

        {/* ── 글자 스타일 ── */}
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

        {/* ── 문단 정렬 ── */}
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

        {/* ── 제목 ── */}
        <div className={styles.group}>
          <Btn
            label="H1"
            title="제목 1"
            active={editor?.isActive("heading", { level: 1 }) ?? false}
            disabled={editorDisabled}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <Btn
            label="H2"
            title="제목 2"
            active={editor?.isActive("heading", { level: 2 }) ?? false}
            disabled={editorDisabled}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <Btn
            label="H3"
            title="제목 3"
            active={editor?.isActive("heading", { level: 3 }) ?? false}
            disabled={editorDisabled}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          />
        </div>

        <div className={styles.sep} />

        {/* ── 표 ── */}
        <TableControls editor={editor} />

        <div className={styles.sep} />

        {/* ── AI ── */}
        <div className={styles.group}>
          <button type="button" className={styles.btn} disabled={editorDisabled} onClick={onAiCommand}>
            AI 수정
          </button>
        </div>

        {/* ── 우측 패널 토글 (flex push) ── */}
        <div className={styles.panelToggles}>
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

      {paraModalOpen && editor && (
        <ParagraphStyleModal editor={editor} onClose={() => setParaModalOpen(false)} />
      )}
      {charModalOpen && editor && (
        <CharStyleModal editor={editor} onClose={() => setCharModalOpen(false)} />
      )}
    </>
  );
}

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
