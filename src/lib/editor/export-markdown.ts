import type { JSONContent } from "@tiptap/core";

function extractText(nodes: JSONContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.text ?? "";
      if (n.content) return extractText(n.content);
      return "";
    })
    .join("");
}

function nodeToMarkdown(node: JSONContent, listDepth = 0): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((c) => nodeToMarkdown(c)).join("\n\n").trim();

    case "heading": {
      const level = (node.attrs as { level?: number } | undefined)?.level ?? 1;
      const prefix = "#".repeat(Math.min(level, 6));
      return `${prefix} ${extractText(node.content ?? [])}`;
    }

    case "paragraph": {
      const text = extractText(node.content ?? []);
      return text || "";
    }

    case "bulletList":
    case "orderedList": {
      const items = (node.content ?? []).map((item, i) => {
        const marker = node.type === "orderedList" ? `${i + 1}.` : "-";
        const inner = (item.content ?? [])
          .map((c) => nodeToMarkdown(c, listDepth + 1))
          .join("\n")
          .trim();
        const indent = "  ".repeat(listDepth);
        return `${indent}${marker} ${inner}`;
      });
      return items.join("\n");
    }

    case "listItem": {
      const inner = (node.content ?? [])
        .map((c) => nodeToMarkdown(c, listDepth))
        .join("\n")
        .trim();
      return inner;
    }

    case "table": {
      const rows = node.content ?? [];
      const mdRows = rows.map((row) =>
        "| " +
        (row.content ?? [])
          .map((cell) => extractText(cell.content ?? []).replace(/\|/g, "\\|"))
          .join(" | ") +
        " |",
      );
      if (mdRows.length === 0) return "";
      // Insert separator after header row
      const colCount = (rows[0]?.content ?? []).length;
      const separator = "| " + Array(colCount).fill("---").join(" | ") + " |";
      return [mdRows[0], separator, ...mdRows.slice(1)].join("\n");
    }

    case "blockquote": {
      const inner = (node.content ?? []).map((c) => nodeToMarkdown(c)).join("\n");
      return inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }

    case "hardBreak":
      return "  \n";

    default:
      if (node.content) {
        return (node.content ?? []).map((c) => nodeToMarkdown(c)).join("\n");
      }
      return "";
  }
}

export function exportToMarkdown(doc: JSONContent, fileNameStem: string): void {
  const md = nodeToMarkdown(doc);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileNameStem.replace(/\.hwpx$/i, "")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** ReportFamilyDraft를 마크다운 문자열로 직접 변환 (에디터 없이 위저드에서 사용) */
export function draftToMarkdown(params: {
  familyName: string;
  sections: Array<{
    title: string;
    paragraphs: string[];
    table?: { headers: string[]; rows: string[][] } | null;
  }>;
}): string {
  const lines: string[] = [`# ${params.familyName}`, ""];

  for (const section of params.sections) {
    lines.push(`## ${section.title}`, "");
    for (const p of section.paragraphs) {
      if (p.trim()) lines.push(p.trim(), "");
    }
    if (section.table && section.table.headers.length > 0) {
      const sep = section.table.headers.map(() => "---");
      lines.push(
        "| " + section.table.headers.join(" | ") + " |",
        "| " + sep.join(" | ") + " |",
        ...section.table.rows.map((row) => "| " + row.join(" | ") + " |"),
        "",
      );
    }
  }

  return lines.join("\n");
}

export function downloadMarkdown(content: string, fileNameStem: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileNameStem.replace(/\.[^.]+$/, "")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
