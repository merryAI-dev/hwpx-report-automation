export type PdfExportOptions = {
  /** Add a cover page with title, date, and author */
  includeCover?: boolean;
  /** Author name shown on cover page */
  author?: string;
  /** Add CSS page-number counter in footer */
  includePageNumbers?: boolean;
};

/**
 * Export editor content to PDF via the browser's native print dialog.
 * Opens a styled print window with A4 layout and triggers window.print().
 * The user can then "Save as PDF" from the system dialog.
 *
 * Original signature preserved for backward compatibility.
 */
export function exportToPdf(editorElement: HTMLElement, fileName: string): void {
  exportToPdfWithOptions(editorElement, fileName, {});
}

/**
 * Export with additional options (cover page, page numbers, author).
 */
export function exportToPdfWithOptions(
  editorElement: HTMLElement,
  fileName: string,
  options: PdfExportOptions,
): void {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("팝업이 차단되었습니다. 팝업 차단을 해제해주세요.");
    return;
  }

  // Clone only the ProseMirror content
  const proseMirror = editorElement.querySelector(".ProseMirror");
  const contentHtml = proseMirror ? proseMirror.innerHTML : editorElement.innerHTML;

  const title = fileName.replace(/\.(hwpx|docx)$/i, "");
  const author = options.author ?? "";
  const includePageNumbers = options.includePageNumbers ?? false;
  const includeCover = options.includeCover ?? false;

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const coverHtml = includeCover
    ? `<div class="cover-page">
    <div class="cover-title">${escapeHtml(title)}</div>
    ${author ? `<div class="cover-author">${escapeHtml(author)}</div>` : ""}
    <div class="cover-date">${today}</div>
  </div>`
    : "";

  const pageNumberCss = includePageNumbers
    ? `
  @page {
    @bottom-center {
      content: counter(page) " / " counter(pages);
      font-size: 9pt;
      color: #666;
    }
  }
  body::after {
    counter-reset: page;
  }
  .page-number-footer {
    position: fixed;
    bottom: 8mm;
    width: 100%;
    text-align: center;
    font-size: 9pt;
    color: #666;
  }
`
    : "";

  printWindow.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
  @page {
    size: A4;
    margin: 20mm 15mm 25mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Noto Sans KR", "맑은 고딕", "Malgun Gothic", "바탕", "Batang", serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #000;
    background: #fff;
  }
  /* Cover page */
  .cover-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 240mm;
    text-align: center;
    page-break-after: always;
  }
  .cover-title {
    font-size: 28pt;
    font-weight: 700;
    margin-bottom: 24pt;
    line-height: 1.3;
  }
  .cover-author {
    font-size: 14pt;
    color: #333;
    margin-bottom: 12pt;
  }
  .cover-date {
    font-size: 12pt;
    color: #555;
  }
  /* Headings */
  h1, h2, h3, h4, h5, h6 {
    page-break-after: avoid;
    font-family: "Noto Sans KR", "맑은 고딕", sans-serif;
  }
  h1 {
    font-size: 20pt;
    font-weight: 700;
    margin-top: 1.6em;
    margin-bottom: 0.6em;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 0.2em;
  }
  h2 {
    font-size: 16pt;
    font-weight: 700;
    margin-top: 1.3em;
    margin-bottom: 0.5em;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 0.15em;
  }
  h3 {
    font-size: 13pt;
    font-weight: 700;
    margin-top: 1.1em;
    margin-bottom: 0.4em;
  }
  h4, h5, h6 {
    font-size: 11pt;
    font-weight: 700;
    margin-top: 0.9em;
    margin-bottom: 0.3em;
  }
  p {
    margin-bottom: 0.6em;
    text-align: justify;
    orphans: 3;
    widows: 3;
  }
  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    page-break-inside: avoid;
    font-size: 10pt;
  }
  thead {
    display: table-header-group;
  }
  td, th {
    border: 1.5px solid #334155;
    padding: 6px 8px;
    vertical-align: top;
  }
  th {
    background: #1e293b;
    color: #fff;
    font-weight: 700;
    text-align: left;
  }
  tr:nth-child(even) td {
    background: #f8fafc;
  }
  /* Lists */
  ul, ol {
    margin: 0.5em 0 0.5em 1.5em;
  }
  li {
    margin-bottom: 0.3em;
  }
  /* Horizontal rule */
  hr {
    border: none;
    border-top: 1.5px solid #94a3b8;
    margin: 1.2em 0;
  }
  /* Blockquote */
  blockquote {
    border-left: 4px solid #6366f1;
    padding-left: 1em;
    margin: 0.8em 0;
    color: #475569;
  }
  /* Code */
  code, pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9pt;
    background: #f1f5f9;
    border-radius: 4px;
  }
  pre {
    padding: 8px 12px;
    overflow: auto;
    page-break-inside: avoid;
  }
  code {
    padding: 1px 4px;
  }
  /* Remove editor artifacts */
  .diff-pending, .diff-accepted, .diff-rejected {
    border-left: none !important;
    background: none !important;
    padding-left: 0 !important;
  }
  ${pageNumberCss}
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
${coverHtml}
${contentHtml}
<script>
  window.onafterprint = function() { window.close(); };
  setTimeout(function() { window.print(); }, 400);
<\/script>
</body>
</html>`);
  printWindow.document.close();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
