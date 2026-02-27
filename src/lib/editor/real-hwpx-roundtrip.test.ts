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
    // Use hwpxDocumentModel for the new para-snapshot path
    const result = await applyProseMirrorDocToHwpx(
      inputBuffer,
      editedDoc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    const outBuffer = await result.blob.arrayBuffer();
    const inspected = await inspectHwpx(outBuffer);
    expect(inspected.integrityIssues).toEqual([]);
    const node = inspected.textNodes.find(
      (row) => row.fileName === target.fileName && row.textIndex === target.textIndex,
    );
    expect(node?.text).toBe(marker);
  }, 120000);

  integrationTest("preserves bold marks through HWPX round-trip", async () => {
    const input = await fsp.readFile(REAL_FIXTURE_PATH);
    const inputBuffer = Uint8Array.from(input).buffer;
    const parsed = await parseHwpxToProseMirror(inputBuffer);
    if (!parsed.hwpxDocumentModel) return;

    // Find a paragraph node with paraId and non-empty text
    const findParaWithParaId = (node: JSONContent): JSONContent | null => {
      if (
        (node.type === "paragraph" || node.type === "heading") &&
        (node.attrs as Record<string, unknown>)?.paraId
      ) {
        const firstText = node.content?.find((n) => n.type === "text");
        if (firstText?.text && firstText.text.trim().length > 0) return node;
      }
      for (const child of node.content ?? []) {
        const found = findParaWithParaId(child);
        if (found) return found;
      }
      return null;
    };
    const target = findParaWithParaId(parsed.doc);
    if (!target) return;

    const targetText = target.content!.find((n) => n.type === "text")!.text!;

    // Apply bold to the first text node
    const editedDoc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const targetInEdit = findParaWithParaId(editedDoc);
    if (!targetInEdit?.content) return;
    for (const inline of targetInEdit.content) {
      if (inline.type === "text") {
        inline.marks = [{ type: "bold" }];
        break;
      }
    }

    const result = await applyProseMirrorDocToHwpx(
      inputBuffer,
      editedDoc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    // Re-parse and verify bold is present via segment styleHints
    const outBuffer = await result.blob.arrayBuffer();
    const reparsed = await parseHwpxToProseMirror(outBuffer);
    expect(reparsed.integrityIssues).toEqual([]);

    // Find the segment with matching text and check hwpxBold styleHint
    const boldSeg = reparsed.segments.find((s) => s.text === targetText);
    expect(boldSeg).toBeTruthy();
    expect(boldSeg?.styleHints.hwpxBold).toBe("true");
  }, 120000);
});
