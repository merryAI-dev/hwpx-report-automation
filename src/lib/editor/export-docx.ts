import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Packer,
  AlignmentType,
  BorderStyle,
  Footer,
  PageNumber,
  NumberFormat,
} from "docx";
import type { JSONContent } from "@tiptap/core";

export type DocxExportOptions = {
  /** Author metadata embedded in the document */
  author?: string;
  /** Include a page number footer */
  includePageNumbers?: boolean;
};

/**
 * Convert TipTap JSONContent to a DOCX Blob.
 *
 * Original `exportToDocx(doc, fileName)` signature preserved for backward compatibility.
 */
export async function exportToDocx(
  doc: JSONContent,
  fileName: string,
  options?: DocxExportOptions,
): Promise<{ blob: Blob; fileName: string }> {
  const children = (doc.content || []).flatMap(convertNode);
  const title = fileName.replace(/\.(hwpx|docx|pptx)$/i, "");
  const author = options?.author ?? "HWPX Studio";
  const includePageNumbers = options?.includePageNumbers ?? false;

  const footers = includePageNumbers
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ children: [PageNumber.CURRENT] }),
                new TextRun(" / "),
                new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
              ],
            }),
          ],
        }),
      }
    : undefined;

  const document = new Document({
    creator: author,
    title,
    description: title,
    styles: {
      paragraphStyles: [],
    },
    numbering: {
      config: [],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch
            pageNumbers: includePageNumbers
              ? { start: 1, formatType: NumberFormat.DECIMAL }
              : undefined,
          },
        },
        footers,
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  const exportName = title + ".docx";
  return { blob, fileName: exportName };
}

type DocxChild = Paragraph | Table;

function convertNode(node: JSONContent): DocxChild[] {
  switch (node.type) {
    case "heading":
      return [convertHeading(node)];
    case "paragraph":
      return [convertParagraph(node)];
    case "table":
      return convertTable(node);
    case "horizontalRule":
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" } },
          spacing: { before: 200, after: 200 },
        }),
      ];
    default:
      // Fallback: try to extract text
      if (node.content) {
        return node.content.flatMap(convertNode);
      }
      return [];
  }
}

function convertHeading(node: JSONContent): Paragraph {
  const level = (node.attrs?.level as number) || 1;
  const headingLevel =
    level === 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3;

  return new Paragraph({
    heading: headingLevel,
    children: convertInlineContent(node.content || []),
    alignment: getAlignment(node.attrs?.textAlign as string),
  });
}

function convertParagraph(node: JSONContent): Paragraph {
  return new Paragraph({
    children: convertInlineContent(node.content || []),
    alignment: getAlignment(node.attrs?.textAlign as string),
    spacing: { line: 360 }, // 1.5 line spacing
  });
}

function convertInlineContent(content: JSONContent[]): TextRun[] {
  const runs: TextRun[] = [];

  for (const node of content) {
    if (node.type === "text") {
      const marks = node.marks || [];
      const bold = marks.some((m) => m.type === "bold");
      const italic = marks.some((m) => m.type === "italic");
      const underline = marks.some((m) => m.type === "underline");
      const strike = marks.some((m) => m.type === "strike");

      runs.push(
        new TextRun({
          text: node.text || "",
          bold,
          italics: italic,
          underline: underline ? {} : undefined,
          strike,
          font: "Malgun Gothic",
          size: 22, // 11pt
        }),
      );
    } else if (node.type === "hardBreak") {
      runs.push(new TextRun({ break: 1 }));
    }
  }

  return runs;
}

function convertTable(node: JSONContent): DocxChild[] {
  if (!node.content) return [];

  const rows = node.content
    .filter((row) => row.type === "tableRow")
    .map((row) => {
      const cells = (row.content || [])
        .filter((cell) => cell.type === "tableCell" || cell.type === "tableHeader")
        .map((cell) => {
          const isHeader = cell.type === "tableHeader";
          const colspan = (cell.attrs?.colspan as number) || 1;
          const rowspan = (cell.attrs?.rowspan as number) || 1;
          const innerContent = (cell.content || []).flatMap((p) =>
            convertInlineContent(p.content || []),
          );

          return new TableCell({
            columnSpan: colspan,
            rowSpan: rowspan,
            children: [
              new Paragraph({
                children:
                  innerContent.length > 0
                    ? innerContent.map(
                        (run) =>
                          new TextRun({
                            ...run,
                            bold: isHeader ? true : (run as unknown as { options: { bold?: boolean } }).options?.bold,
                          } as unknown as ConstructorParameters<typeof TextRun>[0]),
                      )
                    : [new TextRun({ text: "" })],
              }),
            ],
            width: { size: 100 / ((row.content || []).length || 1), type: WidthType.PERCENTAGE },
          });
        });

      return new TableRow({ children: cells });
    });

  if (rows.length === 0) return [];
  return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
}

function getAlignment(align: string | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    default:
      return undefined;
  }
}
