import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { inspectHwpx } from "../hwpx";
import { parseHwpxToProseMirror } from "./hwpx-to-prosemirror";
import { applyProseMirrorDocToHwpx } from "./prosemirror-to-hwpx";

const REAL_FIXTURE_PATH = path.resolve(process.cwd(), "../examples/input-sample.hwpx");
const integrationTest = fs.existsSync(REAL_FIXTURE_PATH) ? it : it.skip;

function buildInlineContent(text: string): JSONContent[] {
  const chunks = text.split(/\r\n|\r|\n/);
  const out: JSONContent[] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) {
      out.push({ type: "hardBreak" });
    }
    if (!chunk.length) {
      continue;
    }
    out.push({ type: "text", text: chunk });
  }
  return out;
}

function replaceSegmentInDoc(doc: JSONContent, segmentId: string, nextText: string): JSONContent {
  const clone = JSON.parse(JSON.stringify(doc)) as JSONContent;

  const walk = (node: JSONContent): boolean => {
    if (node.type === "paragraph" || node.type === "heading") {
      const attrs = (node.attrs || {}) as { segmentId?: string };
      if (attrs.segmentId === segmentId) {
        node.content = buildInlineContent(nextText);
        return true;
      }
    }
    if (!node.content?.length) {
      return false;
    }
    for (const child of node.content) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  };

  walk(clone);
  return clone;
}

describe("real hwpx roundtrip", () => {
  integrationTest("parses, edits and exports actual fixture without archive corruption", async () => {
    const input = await fsp.readFile(REAL_FIXTURE_PATH);
    const inputBuffer = Uint8Array.from(input).buffer;
    const parsed = await parseHwpxToProseMirror(inputBuffer);
    expect(parsed.integrityIssues).toEqual([]);

    const target = parsed.segments.find((segment) => segment.text.trim().length > 0);
    expect(target).toBeTruthy();
    if (!target) {
      return;
    }

    const marker = `[E2E] ${target.text.slice(0, 24)} / ${Date.now().toString(36)}`;
    const editedDoc = replaceSegmentInDoc(parsed.doc, target.segmentId, marker);
    const result = await applyProseMirrorDocToHwpx(inputBuffer, editedDoc, parsed.segments);
    expect(result.integrityIssues).toEqual([]);
    expect(result.edits.some((edit) => edit.id === target.segmentId)).toBe(true);

    const outBuffer = await result.blob.arrayBuffer();
    const inspected = await inspectHwpx(outBuffer);
    expect(inspected.integrityIssues).toEqual([]);
    const node = inspected.textNodes.find(
      (row) => row.fileName === target.fileName && row.textIndex === target.textIndex,
    );
    expect(node?.text).toBe(marker);
  });
});
