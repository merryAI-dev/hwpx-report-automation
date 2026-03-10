import path from "node:path";
import { parseArgs } from "node:util";
import { formatHancomRegressionReport, runHancomRegression } from "../src/lib/node/hancom-regression";

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", multiple: true },
      outputDir: { type: "string" },
      marker: { type: "string" },
    },
  });

  const inputValues = values.input?.length ? values.input : ["../examples/input-sample.hwpx"];
  const outputDir = values.outputDir ? path.resolve(process.cwd(), values.outputDir) : undefined;

  let failed = 0;
  for (const [index, inputValue] of inputValues.entries()) {
    const fixturePath = path.resolve(process.cwd(), inputValue);
    const report = await runHancomRegression(fixturePath, {
      outputDir,
      markerText: values.marker,
    });

    if (index > 0) {
      console.log("");
    }
    console.log(formatHancomRegressionReport(report));
    if (report.issues.length) {
      failed += 1;
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
