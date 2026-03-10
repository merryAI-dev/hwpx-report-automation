import type { JSONContent } from "@tiptap/core";
import { parseHwpxToProseMirror } from "@/lib/editor/hwpx-to-prosemirror";

export type HwpxPreviewOptions = {
  maxSections?: number;
  includeStyles?: boolean;
};

export type HwpxPreviewResult = {
  html: string;
  sectionCount: number;
  wordCount: number;
  truncated: boolean;
};

// ── HTML generation from TipTap JSONContent ──────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractTextFromNode(node: JSONContent): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (!node.content) return "";
  return node.content.map(extractTextFromNode).join("");
}

function renderTextNode(node: JSONContent): string {
  if (node.type !== "text") return "";
  const raw = escapeHtml(node.text ?? "");
  const marks = node.marks ?? [];
  let result = raw;
  for (const mark of marks) {
    if (mark.type === "bold") {
      result = `<strong>${result}</strong>`;
    } else if (mark.type === "italic") {
      result = `<em>${result}</em>`;
    } else if (mark.type === "underline") {
      result = `<u>${result}</u>`;
    } else if (mark.type === "strike") {
      result = `<s>${result}</s>`;
    } else if (mark.type === "code") {
      result = `<code>${result}</code>`;
    } else if (mark.type === "textStyle" && mark.attrs?.color) {
      result = `<span style="color:${escapeHtml(String(mark.attrs.color))}">${result}</span>`;
    }
  }
  return result;
}

export function jsonToHtml(content: JSONContent): string {
  if (!content) return "";

  switch (content.type) {
    case "doc": {
      const children = (content.content ?? []).map(jsonToHtml).join("");
      return children;
    }

    case "paragraph": {
      const inner = (content.content ?? []).map((child) =>
        child.type === "text" ? renderTextNode(child) : jsonToHtml(child),
      ).join("");
      const align = content.attrs?.textAlign as string | undefined;
      const style = align && align !== "left" ? ` style="text-align:${escapeHtml(align)}"` : "";
      return `<p${style}>${inner || "&nbsp;"}</p>\n`;
    }

    case "heading": {
      const level = Number(content.attrs?.level ?? 1);
      const tag = `h${Math.min(Math.max(level, 1), 6)}`;
      const inner = (content.content ?? []).map((child) =>
        child.type === "text" ? renderTextNode(child) : jsonToHtml(child),
      ).join("");
      return `<${tag}>${inner}</${tag}>\n`;
    }

    case "bulletList": {
      const items = (content.content ?? []).map(jsonToHtml).join("");
      return `<ul>\n${items}</ul>\n`;
    }

    case "orderedList": {
      const items = (content.content ?? []).map(jsonToHtml).join("");
      return `<ol>\n${items}</ol>\n`;
    }

    case "listItem": {
      const inner = (content.content ?? []).map(jsonToHtml).join("");
      return `<li>${inner}</li>\n`;
    }

    case "blockquote": {
      const inner = (content.content ?? []).map(jsonToHtml).join("");
      return `<blockquote>${inner}</blockquote>\n`;
    }

    case "codeBlock": {
      const inner = escapeHtml(extractTextFromNode(content));
      return `<pre><code>${inner}</code></pre>\n`;
    }

    case "horizontalRule": {
      return `<hr />\n`;
    }

    case "hardBreak": {
      return `<br />`;
    }

    case "table": {
      const rows = (content.content ?? []).map(jsonToHtml).join("");
      return `<table>\n<tbody>\n${rows}</tbody>\n</table>\n`;
    }

    case "tableRow": {
      const cells = (content.content ?? []).map(jsonToHtml).join("");
      return `<tr>\n${cells}</tr>\n`;
    }

    case "tableHeader": {
      const inner = (content.content ?? []).map(jsonToHtml).join("");
      const colspan = content.attrs?.colspan as number | undefined;
      const rowspan = content.attrs?.rowspan as number | undefined;
      const colAttr = colspan && colspan > 1 ? ` colspan="${colspan}"` : "";
      const rowAttr = rowspan && rowspan > 1 ? ` rowspan="${rowspan}"` : "";
      return `<th${colAttr}${rowAttr}>${inner}</th>\n`;
    }

    case "tableCell": {
      const inner = (content.content ?? []).map(jsonToHtml).join("");
      const colspan = content.attrs?.colspan as number | undefined;
      const rowspan = content.attrs?.rowspan as number | undefined;
      const colAttr = colspan && colspan > 1 ? ` colspan="${colspan}"` : "";
      const rowAttr = rowspan && rowspan > 1 ? ` rowspan="${rowspan}"` : "";
      return `<td${colAttr}${rowAttr}>${inner}</td>\n`;
    }

    case "text": {
      return renderTextNode(content);
    }

    default: {
      // Fallback: recurse into children
      if (content.content) {
        return content.content.map(jsonToHtml).join("");
      }
      return "";
    }
  }
}

function getInlineStyles(): string {
  return `
    body {
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 24px 32px;
      line-height: 1.6;
      color: #1a202c;
      background: #ffffff;
    }
    h1 { font-size: 2em; font-weight: 700; margin: 1.2em 0 0.6em; color: #111827; }
    h2 { font-size: 1.6em; font-weight: 700; margin: 1.1em 0 0.5em; color: #1f2937; }
    h3 { font-size: 1.3em; font-weight: 600; margin: 1em 0 0.4em; color: #374151; }
    h4 { font-size: 1.1em; font-weight: 600; margin: 0.9em 0 0.4em; color: #4b5563; }
    h5, h6 { font-size: 1em; font-weight: 600; margin: 0.8em 0 0.4em; color: #6b7280; }
    p { margin: 0 0 0.8em; }
    ul, ol { margin: 0.5em 0 0.8em 1.5em; padding: 0; }
    li { margin: 0.3em 0; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.95em;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 8px 12px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f3f4f6; font-weight: 700; }
    blockquote {
      border-left: 4px solid #d1d5db;
      margin: 1em 0;
      padding: 0.5em 1em;
      color: #6b7280;
    }
    pre {
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px 16px;
      overflow-x: auto;
      font-family: "Courier New", monospace;
      font-size: 0.9em;
    }
    code {
      background: #f1f5f9;
      border-radius: 3px;
      padding: 2px 5px;
      font-family: "Courier New", monospace;
      font-size: 0.9em;
    }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
    strong { font-weight: 700; }
    em { font-style: italic; }
  `.trim();
}

function countWords(doc: JSONContent): number {
  const text = extractTextFromNode(doc);
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// ── Top-level sections (doc children that are block-level) ────────────────────

function splitDocIntoSections(doc: JSONContent): JSONContent[] {
  return doc.content ?? [];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateHwpxHtmlPreview(
  buffer: ArrayBuffer,
  options?: HwpxPreviewOptions,
): Promise<HwpxPreviewResult> {
  const maxSections = options?.maxSections ?? 10;
  const includeStyles = options?.includeStyles !== false;

  const parsed = await parseHwpxToProseMirror(buffer);
  const doc = parsed.doc;

  const allSections = splitDocIntoSections(doc);
  const totalSectionCount = allSections.length;
  const truncated = totalSectionCount > maxSections;
  const visibleSections = allSections.slice(0, maxSections);

  const visibleDoc: JSONContent = { type: "doc", content: visibleSections };
  const wordCount = countWords({ type: "doc", content: allSections });

  const bodyHtml = jsonToHtml(visibleDoc);

  const html = includeStyles
    ? `<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n<style>\n${getInlineStyles()}\n</style>\n</head>\n<body>\n${bodyHtml}</body>\n</html>`
    : bodyHtml;

  return {
    html,
    sectionCount: totalSectionCount,
    wordCount,
    truncated,
  };
}
