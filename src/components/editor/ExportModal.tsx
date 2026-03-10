"use client";

import { useState } from "react";
import styles from "./ExportModal.module.css";

export type ExportFormat = "hwpx" | "docx" | "pdf";

export type ExportOptions = {
  fileName: string;
  author?: string;
  includeCover?: boolean;
  includePageNumbers?: boolean;
};

export type ExportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  defaultFileName: string;
  onExport: (format: ExportFormat, options: ExportOptions) => void;
};

type FormatTab = ExportFormat;

export function ExportModal({
  isOpen,
  onClose,
  defaultFileName,
  onExport,
}: ExportModalProps) {
  const [activeTab, setActiveTab] = useState<FormatTab>("hwpx");

  // Shared file name (stripped extension)
  const stem = defaultFileName.replace(/\.(hwpx|docx|pdf)$/i, "");
  const [fileName, setFileName] = useState(stem);

  // DOCX options
  const [docxAuthor, setDocxAuthor] = useState("");
  const [docxPageNumbers, setDocxPageNumbers] = useState(false);

  // PDF options
  const [pdfAuthor, setPdfAuthor] = useState("");
  const [pdfIncludeCover, setPdfIncludeCover] = useState(false);
  const [pdfPageNumbers, setPdfPageNumbers] = useState(false);

  if (!isOpen) return null;

  const handleExport = () => {
    const options: ExportOptions = {
      fileName: fileName.trim() || stem || "document",
    };

    if (activeTab === "docx") {
      if (docxAuthor.trim()) options.author = docxAuthor.trim();
      options.includePageNumbers = docxPageNumbers;
    } else if (activeTab === "pdf") {
      if (pdfAuthor.trim()) options.author = pdfAuthor.trim();
      options.includeCover = pdfIncludeCover;
      options.includePageNumbers = pdfPageNumbers;
    }

    onExport(activeTab, options);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="내보내기">
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>내보내기</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {/* Format selector */}
        <div className={styles.tabRow} role="tablist">
          {(["hwpx", "docx", "pdf"] as FormatTab[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="tab"
              aria-selected={activeTab === fmt}
              className={`${styles.tab} ${activeTab === fmt ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(fmt)}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>

        {/* File name (common) */}
        <div className={styles.fieldRow}>
          <label className={styles.label} htmlFor="export-filename">
            파일명
          </label>
          <input
            id="export-filename"
            type="text"
            className={styles.input}
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder={stem || "document"}
          />
        </div>

        {/* HWPX — no extra options */}
        {activeTab === "hwpx" && (
          <div className={styles.formatSection}>
            <div className={styles.formatHeader}>
              <span className={styles.formatBadge}>HWPX</span>
              <span className={styles.formatLabel}>한글 문서로 내보내기</span>
            </div>
          </div>
        )}

        {/* DOCX options */}
        {activeTab === "docx" && (
          <div className={styles.formatSection}>
            <div className={styles.formatHeader}>
              <span className={`${styles.formatBadge} ${styles.formatBadgeDocx}`}>DOCX</span>
              <span className={styles.formatLabel}>Word 문서로 내보내기</span>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label} htmlFor="docx-author">
                작성자
              </label>
              <input
                id="docx-author"
                type="text"
                className={styles.input}
                value={docxAuthor}
                onChange={(e) => setDocxAuthor(e.target.value)}
                placeholder="작성자 이름"
              />
            </div>
            <div className={styles.checkboxRow}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={docxPageNumbers}
                  onChange={(e) => setDocxPageNumbers(e.target.checked)}
                />
                페이지 번호 포함
              </label>
            </div>
          </div>
        )}

        {/* PDF options */}
        {activeTab === "pdf" && (
          <div className={styles.formatSection}>
            <div className={styles.formatHeader}>
              <span className={`${styles.formatBadge} ${styles.formatBadgePdf}`}>PDF</span>
              <span className={styles.formatLabel}>PDF로 내보내기</span>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.label} htmlFor="pdf-author">
                작성자
              </label>
              <input
                id="pdf-author"
                type="text"
                className={styles.input}
                value={pdfAuthor}
                onChange={(e) => setPdfAuthor(e.target.value)}
                placeholder="작성자 이름"
              />
            </div>
            <div className={styles.checkboxRow}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={pdfIncludeCover}
                  onChange={(e) => setPdfIncludeCover(e.target.checked)}
                />
                표지 포함
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={pdfPageNumbers}
                  onChange={(e) => setPdfPageNumbers(e.target.checked)}
                />
                페이지 번호 포함
              </label>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            취소
          </button>
          <button type="button" className={styles.exportBtn} onClick={handleExport}>
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}
