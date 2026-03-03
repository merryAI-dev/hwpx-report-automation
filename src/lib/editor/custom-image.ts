import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";

function parsePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const CustomImage = Image.extend({
  name: "image",
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => parsePositiveInt(element.getAttribute("width")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const width = parsePositiveInt(attributes.width);
          return width ? { width: String(width) } : {};
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => parsePositiveInt(element.getAttribute("height")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const height = parsePositiveInt(attributes.height);
          return height ? { height: String(height) } : {};
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
      mimeType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-mime-type"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.mimeType) {
            return {};
          }
          return { "data-mime-type": String(attributes.mimeType) };
        },
      },
      // HWPX roundtrip metadata — preserved from import, used on export
      binItemId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-bin-item-id"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.binItemId) return {};
          return { "data-bin-item-id": String(attributes.binItemId) };
        },
      },
      hwpunitWidth: {
        default: null,
        parseHTML: (element: HTMLElement) => parsePositiveInt(element.getAttribute("data-hwpunit-width")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const v = parsePositiveInt(attributes.hwpunitWidth);
          return v ? { "data-hwpunit-width": String(v) } : {};
        },
      },
      hwpunitHeight: {
        default: null,
        parseHTML: (element: HTMLElement) => parsePositiveInt(element.getAttribute("data-hwpunit-height")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const v = parsePositiveInt(attributes.hwpunitHeight);
          return v ? { "data-hwpunit-height": String(v) } : {};
        },
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },
});
