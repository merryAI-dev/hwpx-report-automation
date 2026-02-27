import { Extension } from "@tiptap/core";

function parseLetterSpacingValue(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLetterSpacingFromStyle(style: string | null): number | null {
  if (!style) {
    return null;
  }
  const match = style.match(/letter-spacing\s*:\s*(-?\d+(?:\.\d+)?)em/i);
  if (!match) {
    return null;
  }
  const em = Number.parseFloat(match[1]);
  if (!Number.isFinite(em)) {
    return null;
  }
  return Math.round(em * 100);
}

function renderLetterSpacingAttributes(value: unknown): Record<string, string> {
  const parsed = parseLetterSpacingValue(value === null || value === undefined ? null : String(value));
  if (parsed === null) {
    return {};
  }
  const em = (parsed / 100).toFixed(4);
  return {
    "data-letter-spacing": String(parsed),
    style: `letter-spacing: ${em}em`,
  };
}

export const HwpxMetadataExtension = Extension.create({
  name: "hwpxMetadata",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          segmentId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-segment-id"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.segmentId) {
                return {};
              }
              return { "data-segment-id": String(attributes.segmentId) };
            },
          },
          fileName: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-file-name"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.fileName) {
                return {};
              }
              return { "data-file-name": String(attributes.fileName) };
            },
          },
          textIndex: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-text-index");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.textIndex === null || attributes.textIndex === undefined) {
                return {};
              }
              return { "data-text-index": String(attributes.textIndex) };
            },
          },
          originalText: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-original-text"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.originalText) {
                return {};
              }
              return { "data-original-text": String(attributes.originalText) };
            },
          },
          letterSpacing: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const fromData = parseLetterSpacingValue(element.getAttribute("data-letter-spacing"));
              if (fromData !== null) {
                return fromData;
              }
              return parseLetterSpacingFromStyle(element.getAttribute("style"));
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              renderLetterSpacingAttributes(attributes.letterSpacing),
          },
        },
      },
      {
        types: ["table"],
        attributes: {
          tableId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-table-id"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.tableId) {
                return {};
              }
              return { "data-table-id": String(attributes.tableId) };
            },
          },
          sourceRowCount: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-source-row-count");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.sourceRowCount === null || attributes.sourceRowCount === undefined) {
                return {};
              }
              return { "data-source-row-count": String(attributes.sourceRowCount) };
            },
          },
          sourceColCount: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-source-col-count");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.sourceColCount === null || attributes.sourceColCount === undefined) {
                return {};
              }
              return { "data-source-col-count": String(attributes.sourceColCount) };
            },
          },
        },
      },
      {
        types: ["tableRow"],
        attributes: {
          rowIndex: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-row-index");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.rowIndex === null || attributes.rowIndex === undefined) {
                return {};
              }
              return { "data-row-index": String(attributes.rowIndex) };
            },
          },
          sourceCellCount: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-source-cell-count");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.sourceCellCount === null || attributes.sourceCellCount === undefined) {
                return {};
              }
              return { "data-source-cell-count": String(attributes.sourceCellCount) };
            },
          },
        },
      },
      {
        types: ["tableCell"],
        attributes: {
          cellId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-cell-id"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.cellId) {
                return {};
              }
              return { "data-cell-id": String(attributes.cellId) };
            },
          },
          rowIndex: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-row-index");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.rowIndex === null || attributes.rowIndex === undefined) {
                return {};
              }
              return { "data-row-index": String(attributes.rowIndex) };
            },
          },
          colIndex: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-col-index");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.colIndex === null || attributes.colIndex === undefined) {
                return {};
              }
              return { "data-col-index": String(attributes.colIndex) };
            },
          },
          sourceRowspan: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-source-rowspan");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.sourceRowspan === null || attributes.sourceRowspan === undefined) {
                return {};
              }
              return { "data-source-rowspan": String(attributes.sourceRowspan) };
            },
          },
          sourceColspan: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-source-colspan");
              return value === null ? null : Number(value);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.sourceColspan === null || attributes.sourceColspan === undefined) {
                return {};
              }
              return { "data-source-colspan": String(attributes.sourceColspan) };
            },
          },
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-bg-color"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.backgroundColor) {
                return {};
              }
              const color = String(attributes.backgroundColor);
              return {
                "data-bg-color": color,
                style: `background-color: ${color};`,
              };
            },
          },
        },
      },
    ];
  },
});
