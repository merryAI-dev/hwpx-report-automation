/**
 * CSV 파싱 유틸리티.
 * - RFC 4180 quoted fields 지원 (셀 내 쉼표, 줄바꿈, 큰따옴표 처리)
 */

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.every((v) => v.trim() === "")) continue; // 빈 행 스킵

    const row: CsvRow = {};
    headers.forEach((header, idx) => {
      row[header.trim()] = values[idx]?.trim() ?? "";
    });
    rows.push(row);
  }

  return rows;
}

/** 따옴표 안의 줄바꿈을 보존하며 행 분리 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** 단일 CSV 행을 필드 배열로 파싱 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }
    if (line[i] === '"') {
      // quoted field
      let field = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i];
          i++;
        }
      }
      fields.push(field);
      if (line[i] === ",") i++; // skip comma
    } else {
      // unquoted field
      const end = line.indexOf(",", i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }

  return fields;
}

/** CSV 컬럼명 목록 반환 */
export function getCsvHeaders(text: string): string[] {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  return parseCsvLine(firstLine).map((h) => h.trim());
}
