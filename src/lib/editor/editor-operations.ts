/**
 * Pure editor utility functions extracted from page.tsx.
 * These operate on TipTap Editor instances and ProseMirror data
 * but have no React/hook dependencies.
 */
import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, type Mark, type Node as PMNode } from "@tiptap/pm/model";

export type SegmentTextUpdate = {
  segmentId: string;
  text: string;
};

export function replaceSegmentText(editor: Editor, segmentId: string, nextText: string): boolean {
  let replaced = false;
  editor.state.doc.descendants((node, pos) => {
    const attrs = node.attrs as { segmentId?: string };
    if (!attrs.segmentId || attrs.segmentId !== segmentId) {
      return true;
    }
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    // Preserve marks from the first text child so AI replacements keep font/style
    const inheritedMarks = extractFirstTextMarks(node);
    const fragment = buildInlineFragment(editor, nextText, inheritedMarks);
    const tr = editor.state.tr.replaceWith(from, to, fragment);
    if (tr.docChanged) {
      editor.view.dispatch(tr);
    }
    replaced = true;
    return false;
  });
  return replaced;
}

export function focusSegment(editor: Editor, segmentId: string): boolean {
  let targetPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (targetPos !== null) {
      return false;
    }
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return true;
    }
    const attrs = node.attrs as { segmentId?: string };
    if (attrs.segmentId !== segmentId) {
      return true;
    }
    targetPos = pos + 1;
    return false;
  });

  if (targetPos === null) {
    return false;
  }
  editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
  return true;
}

/**
 * Extract ProseMirror Mark[] from the first text child of a block node.
 * Used to inherit formatting (font, size, color, etc.) when replacing text.
 */
function extractFirstTextMarks(blockNode: PMNode): readonly Mark[] | undefined {
  let found: readonly Mark[] | undefined;
  blockNode.descendants((child) => {
    if (found !== undefined) return false;
    if (child.isText && child.marks.length > 0) {
      found = child.marks;
      return false;
    }
    return true;
  });
  return found;
}

export function buildInlineFragment(
  editor: Editor,
  text: string,
  marks?: readonly Mark[],
): Fragment {
  const nodes: PMNode[] = [];
  const hardBreakNode = editor.schema.nodes.hardBreak;
  const chunks = text.split(/\r\n|\r|\n/);
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0 && hardBreakNode) {
      nodes.push(hardBreakNode.create());
    }
    if (!chunk.length) {
      continue;
    }
    nodes.push(marks ? editor.schema.text(chunk, marks) : editor.schema.text(chunk));
  }
  return Fragment.fromArray(nodes);
}

export function applyBatchSegmentTexts(editor: Editor, updates: SegmentTextUpdate[]): number {
  if (!updates.length) {
    return 0;
  }

  const textBySegment = new Map(updates.map((row) => [row.segmentId, row.text]));
  const ranges: Array<{ from: number; to: number; text: string; marks?: readonly Mark[] }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return true;
    }
    const attrs = node.attrs as { segmentId?: string };
    if (!attrs.segmentId || !textBySegment.has(attrs.segmentId)) {
      return true;
    }
    ranges.push({
      from: pos + 1,
      to: pos + node.nodeSize - 1,
      text: textBySegment.get(attrs.segmentId) || "",
      marks: extractFirstTextMarks(node),
    });
    return true;
  });
  if (!ranges.length) {
    return 0;
  }

  ranges.sort((a, b) => b.from - a.from);
  let tr = editor.state.tr;
  for (const range of ranges) {
    tr = tr.replaceWith(range.from, range.to, buildInlineFragment(editor, range.text, range.marks));
  }
  if (!tr.docChanged) {
    return 0;
  }
  editor.view.dispatch(tr.scrollIntoView());
  return ranges.length;
}

export function extractNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text || "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (!node.content?.length) {
    return "";
  }
  return node.content.map((child) => extractNodeText(child)).join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applySearchReplace(
  text: string,
  search: string,
  replace: string,
  caseSensitive: boolean,
): { nextText: string; replacements: number } {
  if (!search) {
    return { nextText: text, replacements: 0 };
  }

  if (caseSensitive) {
    let index = 0;
    let replacements = 0;
    while (true) {
      const found = text.indexOf(search, index);
      if (found === -1) {
        break;
      }
      replacements += 1;
      index = found + search.length;
    }
    if (!replacements) {
      return { nextText: text, replacements: 0 };
    }
    return {
      nextText: text.split(search).join(replace),
      replacements,
    };
  }

  const re = new RegExp(escapeRegExp(search), "gi");
  let replacements = 0;
  const nextText = text.replace(re, () => {
    replacements += 1;
    return replace;
  });
  return { nextText, replacements };
}

export function fillTableRows(
  editor: Editor,
  tableIndex: number,
  startRow: number,
  rows: Array<Record<string, string>>,
  headers: string[],
): string {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const headerToCol = new Map<string, number>();
  headers.forEach((h, i) => headerToCol.set(normalize(h), i));

  const docJson = editor.getJSON();
  const docContent = docJson.content ?? [];
  let tblCount = 0;
  let tableNodeJson: JSONContent | null = null;
  for (const node of docContent) {
    if (node.type === "table") {
      if (tblCount === tableIndex) { tableNodeJson = node; break; }
      tblCount++;
    }
  }
  if (!tableNodeJson) return "표를 찾지 못했습니다";

  let modified = 0;
  rows.forEach((rowData, i) => {
    const rowIdx = startRow + i;
    const rowNode = tableNodeJson!.content?.[rowIdx];
    if (!rowNode) return;
    for (const [headerName, cellText] of Object.entries(rowData)) {
      const colIdx = headerToCol.get(normalize(headerName));
      if (colIdx === undefined) continue;
      const cellNode = rowNode.content?.[colIdx];
      if (!cellNode) continue;
      const firstPara = cellNode.content?.[0];
      const text = String(cellText).trim();
      const paraContent: JSONContent[] = text
        ? [{ type: "text", text }]
        : [];
      cellNode.content = [{
        type: firstPara?.type ?? "paragraph",
        attrs: firstPara?.attrs ?? {},
        content: paraContent,
      }];
      modified++;
    }
  });

  if (modified === 0) {
    const keyList = [...headerToCol.keys()].join(", ");
    return `채울 셀을 찾지 못했습니다. 사용 가능한 헤더: ${keyList}`;
  }

  type FoundTable = { pos: number; nodeSize: number };
  let foundTable: FoundTable | null = null;
  let tblCnt2 = 0;
  editor.state.doc.descendants((node, pos) => {
    if (foundTable) return false;
    if (node.type.name === "table") {
      if (tblCnt2 === tableIndex) { foundTable = { pos, nodeSize: node.nodeSize }; return false; }
      tblCnt2++;
    }
    return true;
  });
  if (!foundTable) return "표 위치를 파악하지 못했습니다";

  try {
    const newTableNode = editor.schema.nodeFromJSON(tableNodeJson!);
    const tr = editor.state.tr.replaceWith(
      (foundTable as FoundTable).pos,
      (foundTable as FoundTable).pos + (foundTable as FoundTable).nodeSize,
      newTableNode,
    );
    if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView());
  } catch (e) {
    return `표 업데이트 오류: ${e instanceof Error ? e.message : String(e)}`;
  }

  return `${rows.length}행 데이터 채우기 완료`;
}

// ── File naming utilities ──

let uniqueSaveSequence = 0;

function toFileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").trim();
  return stem || "document";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function formatTimestampForFileName(ts: number): string {
  const date = new Date(ts);
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    "-",
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
    "-",
    pad3(date.getMilliseconds()),
  ].join("");
}

export function createUniqueHwpxFileName(fileName: string, label: string): string {
  const stem = toFileStem(fileName || "document.hwpx");
  uniqueSaveSequence += 1;
  return `${stem}-${label}-${formatTimestampForFileName(Date.now())}-${pad3(uniqueSaveSequence % 1000)}.hwpx`;
}

export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { toFileStem };
