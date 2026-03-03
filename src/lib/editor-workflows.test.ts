import { describe, expect, it } from "vitest";
import {
  autoSelectSectionByHeading,
  commitQueueHistory,
  createQueueHistory,
  redoQueueHistory,
  undoQueueHistory,
  upsertEdit,
} from "./editor-workflows";
import type { TextNodeRecord } from "./hwpx";

function makeNode(fileName: string, textIndex: number, text: string): TextNodeRecord {
  return {
    id: `${fileName}::${textIndex}`,
    fileName,
    textIndex,
    text,
    tag: "p",
    styleHints: {},
  };
}

describe("queue history", () => {
  it("supports undo/redo for queued edits", () => {
    const node = makeNode("Contents/section0.xml", 2, "원문");
    let history = createQueueHistory([]);
    history = commitQueueHistory(history, upsertEdit(history.present, node, "수정1"));
    history = commitQueueHistory(history, upsertEdit(history.present, node, "수정2"));

    expect(history.present).toHaveLength(1);
    expect(history.present[0].newText).toBe("수정2");

    history = undoQueueHistory(history);
    expect(history.present[0].newText).toBe("수정1");

    history = redoQueueHistory(history);
    expect(history.present[0].newText).toBe("수정2");
  });
});

describe("section selection", () => {
  it("selects nodes from current heading to before next heading", () => {
    const nodes = [
      makeNode("Contents/section0.xml", 0, "제1장 개요"),
      makeNode("Contents/section0.xml", 1, "문단 A"),
      makeNode("Contents/section0.xml", 2, "문단 B"),
      makeNode("Contents/section0.xml", 3, "2. 상세"),
      makeNode("Contents/section0.xml", 4, "문단 C"),
    ];

    const ids = autoSelectSectionByHeading(nodes, "Contents/section0.xml::2", 40);
    expect(ids).toEqual([
      "Contents/section0.xml::0",
      "Contents/section0.xml::1",
      "Contents/section0.xml::2",
    ]);
  });
});
