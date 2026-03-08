# HWPX Compatibility Matrix

Date: 2026-03-07
Scope: current `feat/hwpx-editor-improvements` line

## Purpose

This document defines the current export support contract for the HWPX editor.

The goal is to make three things explicit:

1. what is fully supported
2. what is only partially supported
3. what is currently warned and skipped during export

Warnings emitted by the editor/export pipeline should map to the codes below.

## Export Policy

| Area | Case | Status | Export behavior | Warning code |
| --- | --- | --- | --- | --- |
| Text | Metadata-bound source segment | Supported | preserve | - |
| Text | New text block without metadata | Unsupported | warn and skip | `HWPX-TEXT-NO-METADATA` |
| Text | Unknown segmentId text | Unsupported | warn and skip | `HWPX-TEXT-UNKNOWN-SEGMENT` |
| Table | Existing table with source `tableId` | Partial | patch existing table only | - |
| Table | New table without source `tableId` | Unsupported | warn and skip | `HWPX-TABLE-NO-ID` |
| Table | Invalid `tableId` format | Unsupported | warn and skip | `HWPX-TABLE-INVALID-ID` |
| Paragraph style | Letter spacing change without `charPrIDRef` | Partial | warn and skip | `HWPX-CHARPR-MISSING` |

## Interpretation

- `Supported`: current branch can preserve or export this case in the current HWPX path.
- `Partial`: current branch can handle only the source-linked path, not all free-form authoring cases.
- `Unsupported`: current branch does not safely emit this into HWPX and must warn.

## Product Contract

For the current product line, the contract is:

1. Existing source-linked text edits are supported.
2. Existing source-linked tables are patchable, but new free-form tables are not guaranteed.
3. Export must fail loud through warnings when the user creates content that cannot be mapped back to source-linked HWPX structures.

## Implementation Reference

- Source contract: `src/lib/editor/hwpx-compatibility.ts`
- Warning producer: `src/lib/editor/prosemirror-to-hwpx.ts`
