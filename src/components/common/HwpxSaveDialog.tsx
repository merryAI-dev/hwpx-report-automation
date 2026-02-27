"use client";

import { useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import styles from "./HwpxSaveDialog.module.css";

type HwpxSaveDialogProps = {
  open: boolean;
  defaultFileName: string;
  sourceFormat: "hwpx" | "docx" | "pptx";
  editorDoc: JSONContent | null;
  onClose: () => void;
  onConfirm: (fileName: string) => void;
};

function countDocContent(doc: JSONContent | null): {
  headings: number;
  paragraphs: number;
  tables: number;
} {
  let headings = 0;
  let paragraphs = 0;
  let tables = 0;

  function walk(node: JSONContent): void {
    if (node.type === "heading") headings++;
    else if (node.type === "paragraph") paragraphs++;
    else if (node.type === "table") tables++;
    for (const child of node.content ?? []) walk(child);
  }

  if (doc) walk(doc);
  return { headings, paragraphs, tables };
}

export function HwpxSaveDialog({
  open,
  defaultFileName,
  sourceFormat,
  editorDoc,
  onClose,
  onConfirm,
}: HwpxSaveDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const { headings, paragraphs, tables } = countDocContent(editorDoc);
  const isConverting = sourceFormat === "docx" || sourceFormat === "pptx";
  const sourceLabel = sourceFormat.toUpperCase();

  const handleConfirm = () => {
    const raw = inputRef.current?.value ?? "";
    const trimmed = raw.trim() || defaultFileName;
    const finalName = trimmed.toLowerCase().endsWith(".hwpx") ? trimmed : `${trimmed}.hwpx`;
    onConfirm(finalName);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 타이틀 바 */}
        <div className={styles.titleBar}>
          <span>다른 이름으로 저장</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {/* 포맷 변환 경고 배너 */}
          {isConverting && (
            <div className={styles.conversionBanner}>
              <span className={styles.conversionBadge}>{sourceLabel} → HWPX</span>
              <span className={styles.conversionNote}>
                {sourceLabel} 파일을 HWPX 형식으로 변환합니다. 일부 서식이 손실될 수 있습니다.
              </span>
            </div>
          )}

          {/* 파일 이름 입력 */}
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="hwpx-save-name">
              파일 이름
            </label>
            <input
              id="hwpx-save-name"
              type="text"
              className={styles.fileNameInput}
              ref={inputRef}
              defaultValue={defaultFileName}
              onKeyDown={handleKeyDown}
              autoFocus
              spellCheck={false}
            />
          </div>

          {/* 문서 요약 */}
          <fieldset className={styles.summaryBox}>
            <legend>문서 내용</legend>
            <div className={styles.summaryRow}>
              <SummaryItem count={headings} label="제목" />
              <SummaryItem count={paragraphs} label="문단" />
              <SummaryItem count={tables} label="표" />
            </div>
          </fieldset>

          {/* 저장 형식 */}
          <div className={styles.formatNote}>
            <span className={styles.hwpxBadge}>HWPX</span>
            저장 형식: 한글 문서 (*.hwpx)
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.saveBtn} onClick={handleConfirm}>
            저장
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ count, label }: { count: number; label: string }) {
  return (
    <div className={styles.summaryItem}>
      <span className={styles.summaryCount}>{count}</span>
      <span className={styles.summaryLabel}>{label}</span>
    </div>
  );
}
