import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";
import { formatHwpxValidationReport, validateHwpxForNode } from "../src/lib/node/hwpx-validator";

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
    },
  });

  const inputValue = values.input;
  if (!inputValue) {
    throw new Error("Usage: npm run validate:hwpx -- --input ../examples/input-sample.hwpx");
  }

  const dom = new JSDOM("");
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
  (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

  const inputPath = path.resolve(process.cwd(), inputValue);
  const input = await fs.readFile(inputPath);
  const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);

  const report = await validateHwpxForNode(buffer);
  console.log(formatHwpxValidationReport(path.basename(inputPath), report));

  if (report.issues.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
