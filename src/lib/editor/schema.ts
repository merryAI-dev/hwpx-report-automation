import { Extension } from "@tiptap/core";

/** 1 HWPUNIT = 1/7200 inch = 25.4/7200 mm. */
const HWPUNIT_PER_MM = 7200 / 25.4; // ≈ 283.465

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
          fieldType: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-field-type"),
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.fieldType) {
                return {};
              }
              return { "data-field-type": String(attributes.fieldType) };
            },
          },
          paraId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-para-id") ?? null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.paraId) return {};
              return { "data-para-id": String(attributes.paraId) };
            },
          },
          hwpxParaPrId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-hwpx-para-pr-id") ?? null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.hwpxParaPrId) return {};
              return { "data-hwpx-para-pr-id": String(attributes.hwpxParaPrId) };
            },
          },
          hwpxLineSpacing: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.getAttribute("data-hwpx-line-spacing");
              return v === null ? null : Number(v);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.hwpxLineSpacing === null || attributes.hwpxLineSpacing === undefined) return {};
              const pct = Number(attributes.hwpxLineSpacing);
              return {
                "data-hwpx-line-spacing": String(pct),
                style: `line-height: ${(pct / 100).toFixed(2)}`,
              };
            },
          },
          hwpxAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-hwpx-align") ?? null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.hwpxAlign) return {};
              return { "data-hwpx-align": String(attributes.hwpxAlign) };
            },
          },
          hwpxLeftIndent: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.getAttribute("data-hwpx-left-indent");
              return v === null ? null : Number(v);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.hwpxLeftIndent) return {};
              const mm = (Number(attributes.hwpxLeftIndent) / HWPUNIT_PER_MM).toFixed(2);
              return { "data-hwpx-left-indent": String(attributes.hwpxLeftIndent), style: `margin-left: ${mm}mm` };
            },
          },
          hwpxRightIndent: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.getAttribute("data-hwpx-right-indent");
              return v === null ? null : Number(v);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.hwpxRightIndent) return {};
              const mm = (Number(attributes.hwpxRightIndent) / HWPUNIT_PER_MM).toFixed(2);
              return { "data-hwpx-right-indent": String(attributes.hwpxRightIndent), style: `margin-right: ${mm}mm` };
            },
          },
          hwpxFirstLineIndent: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.getAttribute("data-hwpx-first-line-indent");
              return v === null ? null : Number(v);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (attributes.hwpxFirstLineIndent === null || attributes.hwpxFirstLineIndent === undefined) return {};
              const mm = (Number(attributes.hwpxFirstLineIndent) / HWPUNIT_PER_MM).toFixed(2);
              return { "data-hwpx-first-line-indent": String(attributes.hwpxFirstLineIndent), style: `text-indent: ${mm}mm` };
            },
          },
          hwpxSpaceBefore: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.getAttribute("data-hwpx-space-before");
              return v === null ? null : Number(v);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.hwpxSpaceBefore) return {};
              // 1 HWPUNIT = 1/100 pt → convert to px (1pt = 1.333px)
              const px = ((Number(attributes.hwpxSpaceBefore) / 100) * 1.333).toFixed(1);
              return { "data-hwpx-space-before": String(attributes.hwpxSpaceBefore), style: `margin-top: ${px}px` };
            },
          },
          hwpxSpaceAfter: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const v = element.getAttribute("data-hwpx-space-after");
              return v === null ? null : Number(v);
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.hwpxSpaceAfter) return {};
              const px = ((Number(attributes.hwpxSpaceAfter) / 100) * 1.333).toFixed(1);
              return { "data-hwpx-space-after": String(attributes.hwpxSpaceAfter), style: `margin-bottom: ${px}px` };
            },
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
