"use client";

import { useState, useRef, useCallback } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { TableMap } from "prosemirror-tables";
import { getCsvHeaders, parseCsv, type CsvRow } from "@/lib/batch/csv-parser";

// ── 타입 ──────────────────────────────────────────────────────────────────────

/** AI가 반환하는 매핑 추천 한 건 */
type Suggestion = {
  placeholder: string;
  csvColumn: string;
  targetGridCol: number;
  targetGridRow: number;
  reason: string;
};

/** 에디터에서 추출한 셀 정보 — AI에게 그대로 전달 */
type CellDump = {
  gridCol: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  text: string;
};

type ApplyState =
  | "idle"
  | "loading"
  | "review"
  | "applied"   // 플레이스홀더 삽입 완료 → 행 선택 UI
  | "filled"    // CSV 행 데이터로 채워진 상태 → 사람이 확인/저장
  | "error";

// ── TableMap 기반 셀 추출 ─────────────────────────────────────────────────────

type GridCell = CellDump & {
  cellOffset: number;
  absPos: number;
};

function buildGridCells(tableNode: PmNode, tableStart: number): GridCell[] {
  const map = TableMap.get(tableNode);
  const cells: GridCell[] = [];
  const seen = new Set<number>();

  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const cellOffset = map.map[row * map.width + col];
      if (seen.has(cellOffset)) continue;
      seen.add(cellOffset);

      const rect = map.findCell(cellOffset);
      const cellNode = tableNode.nodeAt(cellOffset);
      if (!cellNode) continue;

      cells.push({
        gridCol: rect.left,
        gridRow: rect.top,
        colSpan: rect.right - rect.left,
        rowSpan: rect.bottom - rect.top,
        text: cellNode.textContent.trim(),
        cellOffset,
        absPos: tableStart + cellOffset,
      });
    }
  }

  return cells;
}

function extractAllCells(editor: Editor): { cells: GridCell[]; tableStart: number } | null {
  const { doc } = editor.state;
  let result: { cells: GridCell[]; tableStart: number } | null = null;

  doc.forEach((node, offset) => {
    if (node.type.name !== "table" || result) return;
    const tableStart = offset + 1;
    result = { cells: buildGridCells(node, tableStart), tableStart };
  });

  return result;
}

function insertPlaceholdersIntoEditor(
  editor: Editor,
  suggestions: Suggestion[],
): void {
  const tableInfo = extractAllCells(editor);
  if (!tableInfo) return;

  const { cells } = tableInfo;
  const { state, view } = editor;
  const { tr } = state;
  let changed = false;
  const inserted = new Set<number>();

  for (const s of suggestions) {
    if (!s.placeholder) continue;

    const target = cells.find(
      (c) => c.gridCol === s.targetGridCol && c.gridRow === s.targetGridRow,
    );
    if (!target || inserted.has(target.absPos)) continue;

    const insertPos = tr.mapping.map(target.absPos + 1);
    tr.insertText(s.placeholder, insertPos, insertPos);
    inserted.add(target.absPos);
    changed = true;
  }

  if (changed) {
    view.dispatch(tr);
  }
}

/**
 * 에디터 문서에서 {{KEY}} 패턴을 찾아 CSV 데이터로 치환한다.
 * mapping: placeholder key(중괄호 제외) → CSV 컬럼명
 * row: CSV 행 데이터
 */
function fillPlaceholders(
  editor: Editor,
  mapping: Record<string, string>,
  row: CsvRow,
): void {
  const { state, view } = editor;
  const { tr, doc } = state;
  let changed = false;

  // 문서에서 모든 텍스트 노드의 {{KEY}} 패턴을 수집 (역순으로 처리하여 위치 밀림 방지)
  const replacements: { from: number; to: number; text: string }[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const regex = /\{\{([^}]+)\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(node.text)) !== null) {
      const key = match[1];
      const csvCol = mapping[key];
      if (!csvCol) continue;
      const value = row[csvCol] ?? "";
      replacements.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length,
        text: value,
      });
    }
  });

  // 역순으로 치환 (뒤에서부터 바꿔야 앞의 위치가 밀리지 않음)
  replacements.sort((a, b) => b.from - a.from);
  for (const r of replacements) {
    if (r.text) {
      tr.replaceWith(r.from, r.to, editor.state.schema.text(r.text));
    } else {
      // 빈 값: 플레이스홀더를 삭제만 함 (빈 텍스트 노드는 ProseMirror에서 허용 안 됨)
      tr.delete(r.from, r.to);
    }
    changed = true;
  }

  if (changed) {
    view.dispatch(tr);
  }
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

type BatchTemplatePanelProps = {
  editor: Editor | null;
  /** 행 저장 콜백 — 행 번호가 포함된 파일명으로 HWPX를 다운로드한다 */
  onSaveRow?: (rowIdx: number, totalRows: number) => Promise<void>;
};

export function BatchTemplatePanel({ editor, onSaveRow }: BatchTemplatePanelProps) {
  const [state, setState] = useState<ApplyState>("idle");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [editedSuggestions, setEditedSuggestions] = useState<Suggestion[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 플레이스홀더 템플릿 스냅샷 (행 채우기 전 상태)
  const templateSnapshotRef = useRef<JSONContent | null>(null);
  const [currentRowIdx, setCurrentRowIdx] = useState(-1);
  const [completedRows, setCompletedRows] = useState<Set<number>>(new Set());

  // placeholder key → CSV 컬럼명 매핑
  const mappingRef = useRef<Record<string, string>>({});

  // ── CSV 업로드 → AI 추천 요청 ──────────────────────────────────────────────

  const handleCsvUpload = useCallback(
    async (file: File) => {
      if (!editor) return;

      setState("loading");
      setErrorMsg("");

      try {
        const text = await file.text();
        const headers = getCsvHeaders(text);
        const rows = parseCsv(text);

        setCsvHeaders(headers);
        setCsvRows(rows);

        const tableInfo = extractAllCells(editor);
        if (!tableInfo || !tableInfo.cells.length) {
          setErrorMsg("문서에서 표를 찾을 수 없습니다. 표가 있는 양식을 열어주세요.");
          setState("error");
          return;
        }

        const cellDump: CellDump[] = tableInfo.cells.map(
          ({ gridCol, gridRow, colSpan, rowSpan, text: t }) => ({
            gridCol, gridRow, colSpan, rowSpan, text: t,
          }),
        );

        const sample = rows[0] ?? {};

        const res = await fetch("/api/batch-template-suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csvHeaders: headers,
            csvSample: sample,
            templateCells: cellDump,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "알 수 없는 오류" }));
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as { suggestions: Suggestion[] };
        setSuggestions(data.suggestions);
        setEditedSuggestions(data.suggestions.map((s) => ({ ...s })));
        setState("review");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    },
    [editor],
  );

  // ── 플레이스홀더 적용 ───────────────────────────────────────────────────────

  const handleApply = useCallback(() => {
    if (!editor) return;
    insertPlaceholdersIntoEditor(editor, editedSuggestions);

    // 매핑 저장
    const m: Record<string, string> = {};
    for (const s of editedSuggestions) {
      if (s.placeholder && s.csvColumn) {
        const key = s.placeholder.replace(/^\{\{|\}\}$/g, "").trim();
        m[key] = s.csvColumn;
      }
    }
    mappingRef.current = m;

    // 플레이스홀더가 삽입된 에디터 상태를 스냅샷으로 저장 (dispatch는 동기)
    templateSnapshotRef.current = editor.getJSON();

    setCurrentRowIdx(-1);
    setCompletedRows(new Set());
    setState("applied");
  }, [editor, editedSuggestions]);

  // ── CSV 행으로 채우기 ─────────────────────────────────────────────────────

  const handleFillRow = useCallback((rowIdx: number) => {
    if (!editor || !templateSnapshotRef.current) return;

    // 템플릿 스냅샷 복원 후 플레이스홀더 치환 (setContent, dispatch 모두 동기)
    editor.commands.setContent(templateSnapshotRef.current);
    fillPlaceholders(editor, mappingRef.current, csvRows[rowIdx]);
    setCurrentRowIdx(rowIdx);
    setState("filled");
  }, [editor, csvRows]);

  // ── 현재 행 확인 완료 → 다음 행 ─────────────────────────────────────────

  const handleMarkDone = useCallback(() => {
    setCompletedRows((prev) => new Set(prev).add(currentRowIdx));
    setState("applied");
  }, [currentRowIdx]);

  // ── 현재 행 저장 후 → 다음 행 ────────────────────────────────────────────

  const handleSaveAndNext = useCallback(async () => {
    if (!onSaveRow) return;
    setIsSaving(true);
    setErrorMsg("");
    try {
      await onSaveRow(currentRowIdx, csvRows.length);
      setCompletedRows((prev) => new Set(prev).add(currentRowIdx));
      setState("applied");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [onSaveRow, currentRowIdx, csvRows.length]);

  // ── 템플릿 복원 (채우기 취소) ──────────────────────────────────────────────

  const handleRestoreTemplate = useCallback(() => {
    if (!editor || !templateSnapshotRef.current) return;
    editor.commands.setContent(templateSnapshotRef.current);
    setState("applied");
  }, [editor]);

  // ── 렌더 ───────────────────────────────────────────────────────────────────

  if (!editor) {
    return (
      <div className="p-4 text-sm text-[var(--color-notion-text-secondary)]">
        문서를 열면 활성화됩니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-700">
        <p className="font-medium mb-1">배치 템플릿</p>
        <p>CSV를 업로드하면 AI가 양식을 분석하여 플레이스홀더를 추천하고, 행별로 데이터를 채워 확인/저장할 수 있습니다.</p>
      </div>

      {/* STEP 1: CSV 업로드 */}
      {(state === "idle" || state === "error") && (
        <div>
          <p className="mb-2 font-medium text-[var(--color-notion-text)]">CSV 파일 업로드</p>
          <button
            type="button"
            className="w-full rounded-lg border-2 border-dashed border-[var(--color-notion-border)] p-4 text-center text-xs text-[var(--color-notion-text-secondary)] hover:border-[var(--color-notion-accent)] hover:bg-[var(--color-notion-accent-light)] transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            클릭하여 CSV 선택
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCsvUpload(f);
              e.target.value = "";
            }}
          />
          {state === "error" && errorMsg && (
            <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
          )}
        </div>
      )}

      {/* 로딩 */}
      {state === "loading" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-notion-border)] border-t-[var(--color-notion-accent)]" />
          <p className="text-xs text-[var(--color-notion-text-secondary)]">AI가 양식과 CSV를 분석 중...</p>
        </div>
      )}

      {/* STEP 2: 추천 검토 */}
      {state === "review" && (
        <>
          <div>
            <p className="mb-1 font-medium text-[var(--color-notion-text)]">AI 추천 매핑</p>
            <p className="text-xs text-[var(--color-notion-text-secondary)] mb-3">
              확인 후 수정하고 적용하세요. 플레이스홀더가 해당 셀에 삽입됩니다.
            </p>

            <div className="space-y-2">
              {editedSuggestions.map((s, idx) => (
                <div
                  key={idx}
                  className="rounded-md border border-[var(--color-notion-border)] bg-white p-2.5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <code className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-mono text-blue-700">
                      {s.placeholder}
                    </code>
                    <span className="text-xs text-[var(--color-notion-text-tertiary)]">
                      → 셀({s.targetGridCol},{s.targetGridRow})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-1.5">
                    <label className="text-xs text-[var(--color-notion-text-secondary)] shrink-0">
                      플레이스홀더
                    </label>
                    <input
                      type="text"
                      className="flex-1 rounded border border-[var(--color-notion-border)] px-2 py-1 text-xs font-mono focus:border-[var(--color-notion-accent)] focus:outline-none"
                      value={s.placeholder}
                      onChange={(e) =>
                        setEditedSuggestions((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, placeholder: e.target.value } : item
                          )
                        )
                      }
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[var(--color-notion-text-secondary)] shrink-0">
                      CSV 컬럼
                    </label>
                    <select
                      className="flex-1 rounded border border-[var(--color-notion-border)] px-2 py-1 text-xs focus:border-[var(--color-notion-accent)] focus:outline-none"
                      value={s.csvColumn}
                      onChange={(e) =>
                        setEditedSuggestions((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, csvColumn: e.target.value } : item
                          )
                        )
                      }
                    >
                      <option value="">(연결 안 함)</option>
                      {csvHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {s.reason && (
                    <p className="mt-1.5 text-xs text-[var(--color-notion-text-tertiary)] italic">
                      {s.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-md border border-[var(--color-notion-border)] px-3 py-2 text-xs hover:bg-[var(--color-notion-bg-hover)]"
              onClick={() => {
                setState("idle");
                setSuggestions([]);
                setEditedSuggestions([]);
              }}
            >
              다시 선택
            </button>
            <button
              type="button"
              className="flex-1 rounded-md bg-[var(--color-notion-accent)] px-3 py-2 text-xs font-medium text-white hover:opacity-90"
              onClick={handleApply}
            >
              문서에 적용
            </button>
          </div>
        </>
      )}

      {/* STEP 3: 행 선택 (플레이스홀더 삽입 완료 후) */}
      {state === "applied" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md bg-green-50 p-3 text-xs text-green-700">
            <p className="font-medium mb-1">플레이스홀더 삽입 완료</p>
            <p>아래에서 CSV 행을 선택하면 데이터가 채워집니다. 확인 후 저장하세요.</p>
          </div>

          {/* 진행 상황 */}
          <div className="flex items-center gap-2 text-xs text-[var(--color-notion-text-secondary)]">
            <span className="font-medium text-[var(--color-notion-text)]">
              {completedRows.size} / {csvRows.length}
            </span>
            <span>행 완료</span>
            {completedRows.size > 0 && (
              <div className="ml-auto h-1.5 flex-1 max-w-[100px] rounded-full bg-[var(--color-notion-bg-hover)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-notion-green)] transition-all"
                  style={{ width: `${(completedRows.size / csvRows.length) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* CSV 행 목록 */}
          <div className="max-h-[400px] overflow-y-auto space-y-1.5">
            {csvRows.map((row, idx) => {
              const done = completedRows.has(idx);
              // 첫 두 컬럼 값을 미리보기로 표시
              const preview = csvHeaders.slice(0, 3).map((h) => row[h] ?? "").filter(Boolean).join(" / ");
              return (
                <button
                  key={idx}
                  type="button"
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    done
                      ? "border-[var(--color-notion-green)] bg-green-50 text-[var(--color-notion-text-secondary)]"
                      : "border-[var(--color-notion-border)] bg-white hover:border-[var(--color-notion-accent)] hover:bg-[var(--color-notion-accent-light)]"
                  }`}
                  onClick={() => handleFillRow(idx)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                      done
                        ? "bg-[var(--color-notion-green)] text-white"
                        : "bg-[var(--color-notion-bg-hover)] text-[var(--color-notion-text-tertiary)]"
                    }`}>
                      {done ? "✓" : idx + 1}
                    </span>
                    <span className="truncate">{preview || `행 ${idx + 1}`}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {completedRows.size === csvRows.length && csvRows.length > 0 && (
            <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-700 font-medium">
              모든 행 처리 완료!
            </div>
          )}

          <button
            type="button"
            className="w-full rounded-md border border-[var(--color-notion-border)] px-3 py-2 text-xs hover:bg-[var(--color-notion-bg-hover)]"
            onClick={() => {
              if (templateSnapshotRef.current && editor) {
                editor.commands.setContent(templateSnapshotRef.current);
              }
              setState("idle");
              setSuggestions([]);
              setEditedSuggestions([]);
              setCsvHeaders([]);
              setCsvRows([]);
              templateSnapshotRef.current = null;
              setCurrentRowIdx(-1);
              setCompletedRows(new Set());
            }}
          >
            처음부터
          </button>
        </div>
      )}

      {/* STEP 4: 채워진 상태 — 사람이 확인/저장 */}
      {state === "filled" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-medium mb-1">
              행 {currentRowIdx + 1} / {csvRows.length} 채움
            </p>
            <p>에디터에서 내용을 확인하고 HWPX로 저장하세요.</p>
          </div>

          {/* 채워진 데이터 요약 */}
          <div className="rounded-md border border-[var(--color-notion-border)] bg-white p-2.5 space-y-1">
            {Object.entries(mappingRef.current).map(([key, csvCol]) => {
              const value = csvRows[currentRowIdx]?.[csvCol] ?? "";
              return (
                <div key={key} className="flex items-start gap-2 text-xs">
                  <code className="shrink-0 rounded bg-blue-50 px-1 py-0.5 font-mono text-blue-700">
                    {key}
                  </code>
                  <span className="text-[var(--color-notion-text-tertiary)]">→</span>
                  <span className="text-[var(--color-notion-text)] break-all line-clamp-2">
                    {value || "(빈 값)"}
                  </span>
                </div>
              );
            })}
          </div>

          {errorMsg && (
            <p className="text-xs text-red-600">{errorMsg}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-md border border-[var(--color-notion-border)] px-3 py-2 text-xs hover:bg-[var(--color-notion-bg-hover)]"
              disabled={isSaving}
              onClick={handleRestoreTemplate}
            >
              취소
            </button>
            {onSaveRow ? (
              <button
                type="button"
                className="flex-1 rounded-md bg-[var(--color-notion-accent)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                disabled={isSaving}
                onClick={handleSaveAndNext}
              >
                {isSaving ? "저장 중..." : "저장 후 다음 →"}
              </button>
            ) : (
              <button
                type="button"
                className="flex-1 rounded-md bg-[var(--color-notion-accent)] px-3 py-2 text-xs font-medium text-white hover:opacity-90"
                onClick={handleMarkDone}
              >
                완료 → 다음 행
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
