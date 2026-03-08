/**
 * HWPX 양식 XML의 특정 셀(colAddr, rowAddr)에 텍스트를 주입한다.
 *
 * 핵심 설계:
 * - 멀티라인 텍스트를 <hp:p> 여러 개로 만들면 셀 높이가 N배로 확장됨
 * - 대신 단일 <hp:p> + <hp:t> 안에 \n을 그대로 포함 (HWPX가 자체 처리)
 * - 이 방식은 prosemirror-to-hwpx.ts의 hardBreak → "\n" 변환과 동일
 */

function escapeXml(text: string): string {
  // \n은 HWPX가 줄바꿈으로 처리하므로 이스케이프하지 않음
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitTcBlocks(sectionXml: string): { before: string; tcs: string[]; after: string } {
  const tcStart = "<hp:tc ";
  const tcEnd = "</hp:tc>";
  const results: string[] = [];
  let pos = 0;
  let firstTcPos = -1;
  let lastTcEndPos = -1;

  while (pos < sectionXml.length) {
    const startIdx = sectionXml.indexOf(tcStart, pos);
    if (startIdx === -1) break;
    if (firstTcPos === -1) firstTcPos = startIdx;

    const endIdx = sectionXml.indexOf(tcEnd, startIdx);
    if (endIdx === -1) break;
    const endPos = endIdx + tcEnd.length;

    results.push(sectionXml.slice(startIdx, endPos));
    lastTcEndPos = endPos;
    pos = endPos;
  }

  return {
    before: firstTcPos !== -1 ? sectionXml.slice(0, firstTcPos) : sectionXml,
    tcs: results,
    after: lastTcEndPos !== -1 ? sectionXml.slice(lastTcEndPos) : "",
  };
}

function parseCellAddr(tcXml: string): { col: number; row: number } | null {
  const m = tcXml.match(/colAddr="(\d+)"\s+rowAddr="(\d+)"/);
  if (!m) return null;
  return { col: parseInt(m[1], 10), row: parseInt(m[2], 10) };
}

function buildSubListWithText(tcXml: string, text: string, paraIdBase: number): string {
  const subListMatch = tcXml.match(/<hp:subList\b[^>]*>([\s\S]*?)<\/hp:subList>/);
  if (!subListMatch) return tcXml;

  const subListOpen = tcXml.match(/<hp:subList\b[^>]*/)?.[0] ?? "<hp:subList";
  const subListInner = subListMatch[1];

  const pMatch = subListInner.match(/<hp:p\b[\s\S]*?<\/hp:p>/);
  if (!pMatch) return tcXml;

  const templatePara = pMatch[0];

  const charPrMatch = templatePara.match(/<hp:run\s+charPrIDRef="(\d+)"/);
  const charPrIDRef = charPrMatch ? charPrMatch[1] : "0";

  const paraPrMatch = templatePara.match(/paraPrIDRef="(\d+)"/);
  const paraPrIDRef = paraPrMatch ? paraPrMatch[1] : "0";

  const styleMatch = templatePara.match(/styleIDRef="(\d+)"/);
  const styleIDRef = styleMatch ? styleMatch[1] : "0";

  const linesegarrayMatch = templatePara.match(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/);
  const linesegarray = linesegarrayMatch ? linesegarrayMatch[0] : "<hp:linesegarray/>";

  // ── 핵심 변경: <hp:p> 하나에 전체 텍스트를 \n 포함해서 넣기 ──
  // HWPX는 <hp:t> 안의 \n을 줄바꿈으로 처리 (prosemirror-to-hwpx.ts의 hardBreak 처리와 동일)
  // 여러 <hp:p>를 만들면 셀 높이가 N배로 확장되므로 단일 단락 방식 사용
  const escapedText = escapeXml(text);
  const newPara =
    `<hp:p id="${paraIdBase}" paraPrIDRef="${paraPrIDRef}" styleIDRef="${styleIDRef}" ` +
    `pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${charPrIDRef}"><hp:t>${escapedText}</hp:t></hp:run>` +
    linesegarray +
    `</hp:p>`;

  const newSubList = `${subListOpen}>${newPara}</hp:subList>`;
  return tcXml.replace(/<hp:subList\b[^>]*>[\s\S]*?<\/hp:subList>/, newSubList);
}

export type CellInjection = {
  col: number;
  row: number;
  text: string;
};

export function injectMultipleCells(
  sectionXml: string,
  injections: CellInjection[],
  paraIdBase = 10000,
): string {
  const { before, tcs, after } = splitTcBlocks(sectionXml);

  let nextParaId = paraIdBase;
  const newTcs = tcs.map((tc) => {
    const addr = parseCellAddr(tc);
    if (!addr) return tc;

    const injection = injections.find((inj) => inj.col === addr.col && inj.row === addr.row);
    if (!injection || !injection.text.trim()) return tc;

    const lineCount = injection.text.split("\n").length;
    const result = buildSubListWithText(tc, injection.text, nextParaId);
    nextParaId += lineCount + 10; // 다음 셀과 ID 공간 확보
    return result;
  });

  return before + newTcs.join("") + after;
}
