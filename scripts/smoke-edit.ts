import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { applyTextEdits, inspectHwpx } from "../src/lib/hwpx";
import { formatHwpxValidationReport, validateHwpxForNode } from "../src/lib/node/hwpx-validator";

async function main() {
  const dom = new JSDOM("");
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
  (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

  const inputPath = path.resolve(process.cwd(), "../examples/input-sample.hwpx");
  const outputPath = path.resolve(process.cwd(), "../examples/edited-by-system.hwpx");

  const input = await fs.readFile(inputPath);
  const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const beforeReport = await validateHwpxForNode(inputBuffer);
  if (beforeReport.issues.length) {
    throw new Error(formatHwpxValidationReport("input", beforeReport));
  }

  const inspected = await inspectHwpx(inputBuffer);
  const target = inspected.textNodes.find((node) => node.text.trim().length > 0);
  if (!target) {
    throw new Error("수정 가능한 텍스트 노드를 찾지 못했습니다.");
  }

  const editedText = `${target.text} (AI 자동편집 검증 ${new Date().toISOString().slice(0, 10)})`;
  const blob = await applyTextEdits(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), [
    {
      id: target.id,
      fileName: target.fileName,
      textIndex: target.textIndex,
      oldText: target.text,
      newText: editedText,
    },
  ]);

  const outBuffer = new Uint8Array(await blob.arrayBuffer());
  const afterReport = await validateHwpxForNode(outBuffer.buffer);
  if (afterReport.issues.length) {
    throw new Error(formatHwpxValidationReport("output", afterReport));
  }
  await fs.writeFile(outputPath, outBuffer);
  console.log(`created: ${outputPath}`);
  console.log(`edited node: ${target.fileName} :: ${target.textIndex}`);
  console.log(`before: ${target.text}`);
  console.log(`after : ${editedText}`);
  console.log(formatHwpxValidationReport("output", afterReport));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
