import type { TextEdit, TextNodeRecord } from "./hwpx";

export type QueueHistory = {
  past: TextEdit[][];
  present: TextEdit[];
  future: TextEdit[][];
};

export const MAX_BATCH_SELECT = 40;

export function createQueueHistory(initial: TextEdit[] = []): QueueHistory {
  return { past: [], present: initial, future: [] };
}

function areEditsEqual(a: TextEdit[], b: TextEdit[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].id !== b[i].id ||
      a[i].fileName !== b[i].fileName ||
      a[i].textIndex !== b[i].textIndex ||
      a[i].newText !== b[i].newText ||
      a[i].oldText !== b[i].oldText
    ) {
      return false;
    }
  }
  return true;
}

export function commitQueueHistory(history: QueueHistory, next: TextEdit[]): QueueHistory {
  if (areEditsEqual(history.present, next)) {
    return history;
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  };
}

export function undoQueueHistory(history: QueueHistory): QueueHistory {
  if (!history.past.length) {
    return history;
  }
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoQueueHistory(history: QueueHistory): QueueHistory {
  if (!history.future.length) {
    return history;
  }
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}

export function upsertEdit(existing: TextEdit[], node: TextNodeRecord, newText: string): TextEdit[] {
  const rest = existing.filter((item) => item.id !== node.id);
  if (newText === node.text) {
    return rest;
  }
  return [
    ...rest,
    {
      id: node.id,
      fileName: node.fileName,
      textIndex: node.textIndex,
      oldText: node.text,
      newText,
    },
  ];
}

function looksLikeHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }
  const numeric = /^(\d+(\.\d+){0,2}|[IVXLC]+|[가-힣A-Za-z])[\.\)]\s+/.test(trimmed);
  const chapter = /^제\s*\d+\s*(장|절|항)(\s|$)/.test(trimmed);
  const plainTitle =
    /^[A-Z][A-Za-z0-9\s]{1,40}$/.test(trimmed) ||
    /^[가-힣]{2,20}$/.test(trimmed);
  return numeric || chapter || plainTitle;
}

export function autoSelectSectionByHeading(
  nodes: TextNodeRecord[],
  selectedId: string,
  maxCount: number = MAX_BATCH_SELECT,
): string[] {
  const selected = nodes.find((node) => node.id === selectedId);
  if (!selected) {
    return [];
  }
  const sameFile = nodes
    .filter((node) => node.fileName === selected.fileName)
    .sort((a, b) => a.textIndex - b.textIndex);
  if (!sameFile.length) {
    return [];
  }
  const currentPos = sameFile.findIndex((node) => node.id === selectedId);
  if (currentPos < 0) {
    return [];
  }
  const headingPositions = sameFile
    .map((node, idx) => ({ idx, isHeading: looksLikeHeading(node.text) }))
    .filter((row) => row.isHeading)
    .map((row) => row.idx);

  let start = 0;
  let end = sameFile.length;
  for (const pos of headingPositions) {
    if (pos <= currentPos) {
      start = pos;
    }
    if (pos > currentPos) {
      end = pos;
      break;
    }
  }
  return sameFile.slice(start, end).slice(0, maxCount).map((node) => node.id);
}
