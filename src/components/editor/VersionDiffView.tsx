"use client";

import type { JSONContent } from "@tiptap/core";
import type { WorkspaceDocumentVersionSummary } from "@/lib/workspace-types";
import styles from "./VersionDiffView.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VersionDiffViewProps = {
  leftVersion: WorkspaceDocumentVersionSummary & { editorDoc?: JSONContent | null };
  rightVersion: WorkspaceDocumentVersionSummary & { editorDoc?: JSONContent | null };
  onClose: () => void;
};

type DiffLine = {
  type: "unchanged" | "added" | "removed" | "empty";
  text: string;
};

type SideBySideDiff = {
  left: DiffLine[];
  right: DiffLine[];
  addedCount: number;
  removedCount: number;
};

// ── Text extraction from TipTap JSON ─────────────────────────────────────────

function extractLines(doc: JSONContent | null | undefined): string[] {
  if (!doc) return [];
  const lines: string[] = [];
  collectLines(doc, lines);
  return lines;
}

function collectLines(node: JSONContent, lines: string[]): void {
  if (node.type === "text") {
    const last = lines.length > 0 ? lines[lines.length - 1] : null;
    if (last !== null) {
      lines[lines.length - 1] = last + (node.text ?? "");
    } else {
      lines.push(node.text ?? "");
    }
    return;
  }

  const isBlock =
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "blockquote" ||
    node.type === "listItem" ||
    node.type === "codeBlock";

  if (isBlock) {
    lines.push("");
  }

  for (const child of node.content ?? []) {
    collectLines(child, lines);
  }

  if (isBlock && lines[lines.length - 1] === "") {
    // If we pushed a blank line and nothing was added, remove it
    // (empty paragraphs still count as a blank line — keep them)
  }
}

// ── LCS-based line diff ───────────────────────────────────────────────────────

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

export function computeLineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const dp = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];

  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "unchanged", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", text: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", text: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

function buildSideBySide(diff: DiffLine[]): SideBySideDiff {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;

  // Group consecutive removed/added into chunks for side-by-side pairing
  let idx = 0;
  while (idx < diff.length) {
    const line = diff[idx];
    if (line.type === "unchanged") {
      left.push(line);
      right.push(line);
      idx++;
    } else {
      // Collect consecutive removed lines
      const removedChunk: DiffLine[] = [];
      while (idx < diff.length && diff[idx].type === "removed") {
        removedChunk.push(diff[idx]);
        removedCount++;
        idx++;
      }
      // Collect consecutive added lines
      const addedChunk: DiffLine[] = [];
      while (idx < diff.length && diff[idx].type === "added") {
        addedChunk.push(diff[idx]);
        addedCount++;
        idx++;
      }
      // Pair them side-by-side
      const maxLen = Math.max(removedChunk.length, addedChunk.length);
      for (let k = 0; k < maxLen; k++) {
        left.push(removedChunk[k] ?? { type: "empty", text: "" });
        right.push(addedChunk[k] ?? { type: "empty", text: "" });
      }
    }
  }

  return { left, right, addedCount, removedCount };
}

// ── Metadata diff ─────────────────────────────────────────────────────────────

type MetaDiff = {
  label: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
};

function buildMetaDiff(
  left: WorkspaceDocumentVersionSummary,
  right: WorkspaceDocumentVersionSummary,
): MetaDiff[] {
  const items: MetaDiff[] = [];

  const fieldOld = String(left.templateFieldCount);
  const fieldNew = String(right.templateFieldCount);
  items.push({ label: "필드 수", oldValue: fieldOld, newValue: fieldNew, changed: fieldOld !== fieldNew });

  const warnOld = String(left.validationSummary?.warningCount ?? 0);
  const warnNew = String(right.validationSummary?.warningCount ?? 0);
  items.push({ label: "검증 경고", oldValue: warnOld, newValue: warnNew, changed: warnOld !== warnNew });

  const blockOld = String(left.validationSummary?.blockingCount ?? 0);
  const blockNew = String(right.validationSummary?.blockingCount ?? 0);
  items.push({ label: "차단 이슈", oldValue: blockOld, newValue: blockNew, changed: blockOld !== blockNew });

  const fileOld = left.fileName;
  const fileNew = right.fileName;
  items.push({ label: "파일명", oldValue: fileOld, newValue: fileNew, changed: fileOld !== fileNew });

  return items;
}

// ── Line rendering ────────────────────────────────────────────────────────────

function lineClassName(line: DiffLine): string {
  switch (line.type) {
    case "added": return styles.lineAdded ?? "";
    case "removed": return styles.lineRemoved ?? "";
    case "empty": return styles.lineEmpty ?? "";
    default: return styles.lineUnchanged ?? "";
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VersionDiffView({ leftVersion, rightVersion, onClose }: VersionDiffViewProps) {
  const leftLines = extractLines(leftVersion.editorDoc);
  const rightLines = extractLines(rightVersion.editorDoc);

  const diff = computeLineDiff(leftLines, rightLines);
  const { left, right, addedCount, removedCount } = buildSideBySide(diff);

  const metaDiff = buildMetaDiff(leftVersion, rightVersion);
  const hasTextDiff = leftLines.length > 0 || rightLines.length > 0;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>
              버전 비교: v{leftVersion.versionNumber} → v{rightVersion.versionNumber}
            </h2>
            {hasTextDiff && (
              <div className={styles.summary}>
                <span className={styles.added}>+{addedCount}줄</span>
                <span className={styles.removed}>-{removedCount}줄</span>
                <span>총 {left.length}행</span>
              </div>
            )}
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {hasTextDiff ? (
          <div className={styles.columns}>
            <div className={styles.column}>
              <div className={styles.columnHeader}>
                v{leftVersion.versionNumber} · {leftVersion.label} — {new Date(leftVersion.createdAt).toLocaleDateString("ko-KR")}
              </div>
              <div className={styles.lines}>
                {left.map((line, idx) => (
                  <div key={idx} className={`${styles.line} ${lineClassName(line)}`}>
                    {line.text || " "}
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.column}>
              <div className={styles.columnHeader}>
                v{rightVersion.versionNumber} · {rightVersion.label} — {new Date(rightVersion.createdAt).toLocaleDateString("ko-KR")}
              </div>
              <div className={styles.lines}>
                {right.map((line, idx) => (
                  <div key={idx} className={`${styles.line} ${lineClassName(line)}`}>
                    {line.text || " "}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "24px", color: "#64748b", fontSize: "14px" }}>
            텍스트 콘텐츠를 비교할 수 없습니다. 아래 메타데이터 요약을 참고하세요.
          </div>
        )}

        <div className={styles.metaSummary}>
          {metaDiff.map((item) => (
            <div key={item.label} className={styles.metaItem}>
              <span className={styles.metaLabel}>{item.label}:</span>
              {item.changed ? (
                <span className={styles.metaValueChanged}>{item.oldValue} → {item.newValue}</span>
              ) : (
                <span>{item.oldValue}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
