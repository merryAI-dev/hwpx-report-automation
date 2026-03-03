/**
 * Export editor content to PDF via the browser's native print dialog.
 * Opens a styled print window with A4 layout and triggers window.print().
 * The user can then "Save as PDF" from the system dialog.
 */
export function exportToPdf(editorElement: HTMLElement, fileName: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("팝업이 차단되었습니다. 팝업 차단을 해제해주세요.");
    return;
  }

  // Clone only the ProseMirror content
  const proseMirror = editorElement.querySelector(".ProseMirror");
  const contentHtml = proseMirror ? proseMirror.innerHTML : editorElement.innerHTML;

  const title = fileName.replace(/\.(hwpx|docx)$/i, "");

  printWindow.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: A4;
    margin: 20mm 15mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "바탕", "Batang", "Malgun Gothic", serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #000;
    background: #fff;
  }
  h1, h2, h3 {
    margin-top: 1.2em;
    margin-bottom: 0.4em;
    page-break-after: avoid;
  }
  h1 { font-size: 18pt; }
  h2 { font-size: 14pt; }
  h3 { font-size: 12pt; }
  p {
    margin-bottom: 0.5em;
    text-align: justify;
    orphans: 3;
    widows: 3;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8em 0;
    page-break-inside: avoid;
  }
  td, th {
    border: 1px solid #333;
    padding: 4px 6px;
    font-size: 10pt;
    vertical-align: top;
  }
  th { background: #f0f0f0; font-weight: bold; }
  hr { border: none; border-top: 1px solid #999; margin: 1em 0; }
  /* Remove editor artifacts */
  .diff-pending, .diff-accepted, .diff-rejected {
    border-left: none !important;
    background: none !important;
    padding-left: 0 !important;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
${contentHtml}
<script>
  window.onafterprint = function() { window.close(); };
  setTimeout(function() { window.print(); }, 300);
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
