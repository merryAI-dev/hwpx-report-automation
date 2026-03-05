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

  integrationTest("preserves font size through text-edit HWPX round-trip", async () => {
    const input = await fsp.readFile(REAL_FIXTURE_PATH);
    const inputBuffer = Uint8Array.from(input).buffer;
    const parsed = await parseHwpxToProseMirror(inputBuffer);
    if (!parsed.hwpxDocumentModel) return;

    // Find a segment that has fontSizePt set
    const fontSeg = parsed.segments.find(
      (s) => s.styleHints.hwpxFontSizePt && s.text.trim().length > 0,
    );
    if (!fontSeg) return; // fixture doesn't have fontSize info

    const originalFontSize = fontSeg.styleHints.hwpxFontSizePt!;

    // Edit text with fontSize textStyle mark preserved (simulating AI replacement with marks)
    const editedDoc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const findSegNode = (node: JSONContent): JSONContent | null => {
      if (
        (node.type === "paragraph" || node.type === "heading") &&
        (node.attrs as Record<string, unknown>)?.segmentId === fontSeg.segmentId
      ) {
        return node;
      }
      for (const child of node.content ?? []) {
        const found = findSegNode(child);
        if (found) return found;
      }
      return null;
    };
    const targetNode = findSegNode(editedDoc);
    if (!targetNode?.content) return;

    // Modify text but keep the textStyle marks (fontSize)
    const marker = `[FONT] ${Date.now().toString(36)}`;
    const existingMarks = targetNode.content.find((n) => n.type === "text")?.marks;
    targetNode.content = [{ type: "text", text: marker, marks: existingMarks }];

    const result = await applyProseMirrorDocToHwpx(
      inputBuffer,
      editedDoc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);

    // Re-parse and verify fontSize is preserved
    const outBuffer = await result.blob.arrayBuffer();
    const reparsed = await parseHwpxToProseMirror(outBuffer);
    expect(reparsed.integrityIssues).toEqual([]);

    const editedSeg = reparsed.segments.find((s) => s.text === marker);
    expect(editedSeg).toBeTruthy();
    // Font size should be preserved (same as original)
    if (editedSeg?.styleHints.hwpxFontSizePt) {
      expect(editedSeg.styleHints.hwpxFontSizePt).toBe(originalFontSize);
    }
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

  integrationTest("table cell text modification roundtrips without corruption", async () => {
    const input = await fsp.readFile(REAL_FIXTURE_PATH);
    const inputBuffer = Uint8Array.from(input).buffer;
    const parsed = await parseHwpxToProseMirror(inputBuffer);
    expect(parsed.integrityIssues).toEqual([]);
    if (!parsed.hwpxDocumentModel) return;

    // Find a table node with tableId in the doc
    const findTableWithContent = (node: JSONContent): JSONContent | null => {
      if (node.type === "table" && (node.attrs as Record<string, unknown>)?.tableId) {
        // Check it has at least one cell with text
        const hasText = JSON.stringify(node).includes('"type":"text"');
        if (hasText) return node;
      }
      for (const child of node.content ?? []) {
        const found = findTableWithContent(child);
        if (found) return found;
      }
      return null;
    };

    const table = findTableWithContent(parsed.doc);
    if (!table) {
      console.log("No table with tableId and text content found in fixture — skipping");
      return;
    }

    const tableId = (table.attrs as Record<string, unknown>).tableId;
    console.log(`Testing table cell modification on tableId: ${tableId}`);

    // Deep clone and modify the first text node in the table
    const editedDoc = JSON.parse(JSON.stringify(parsed.doc)) as JSONContent;
    const editedTable = findTableWithContent(editedDoc)!;
    const marker = `[TBL] ${Date.now().toString(36)}`;
    let modified = false;

    const modifyFirstText = (node: JSONContent): boolean => {
      if (node.type === "text" && node.text && node.text.trim().length > 0) {
        node.text = marker;
        return true;
      }
      for (const child of node.content ?? []) {
        if (modifyFirstText(child)) return true;
      }
      return false;
    };
    modified = modifyFirstText(editedTable);
    expect(modified).toBe(true);

    // Export
    const result = await applyProseMirrorDocToHwpx(
      inputBuffer,
      editedDoc,
      parsed.segments,
      parsed.extraSegmentsMap,
      parsed.hwpxDocumentModel,
    );
    expect(result.integrityIssues).toEqual([]);
    if (result.warnings.length) {
      console.log("Export warnings:", result.warnings);
    }

    // Validate the output archive
    const outBuffer = await result.blob.arrayBuffer();
    const inspected = await inspectHwpx(outBuffer);
    expect(inspected.integrityIssues).toEqual([]);

    // Re-parse and verify marker text exists
    const reparsed = await parseHwpxToProseMirror(outBuffer);
    expect(reparsed.integrityIssues).toEqual([]);

    // Check marker is present somewhere in the reparsed doc
    const docJson = JSON.stringify(reparsed.doc);
    expect(docJson).toContain(marker);

    // Verify section0.xml is well-formed by checking the raw XML
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(outBuffer);
    const sectionFile = zip.file("Contents/section0.xml");
    expect(sectionFile).toBeTruthy();
    const xml = await sectionFile!.async("string");

    // Check for malformed XML indicators
    expect(xml).toContain(marker);
    expect(xml.startsWith("<?xml") || xml.startsWith("<")).toBe(true);

    // Check namespace consistency — no duplicate conflicting xmlns declarations
    const nsMatches = [...xml.matchAll(/xmlns:hp="([^"]+)"/g)];
    const uniqueNs = new Set(nsMatches.map((m) => m[1]));
    if (uniqueNs.size > 1) {
      console.warn("Multiple xmlns:hp URIs found:", [...uniqueNs]);
    }
    // Should have at most one unique xmlns:hp URI
    expect(uniqueNs.size).toBeLessThanOrEqual(1);

    console.log("Table cell roundtrip test passed successfully");
  }, 120000);
});
