import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getBatchJobManager } from "@/lib/server/batch-jobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getBatchJobManager().getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "batch job not found" }, { status: 404 });
  }

  const zip = new JSZip();

  if (job.results.length === 0) {
    return NextResponse.json({ error: "no results to download" }, { status: 400 });
  }

  for (let index = 0; index < job.results.length; index++) {
    const row = job.results[index];
    const passed = row.qualityGate.passed;
    const status = passed ? "done" : "failed";
    const fileName = `item-${index + 1}-${status}.txt`;
    const issuesSummary = row.qualityGate.issues.map((i) => `  - ${i.message}`).join("\n");
    const content = [
      `ID: ${row.id}`,
      `Status: ${status}`,
      issuesSummary ? `Issues:\n${issuesSummary}` : "",
      "",
      row.suggestion,
    ]
      .filter((line) => line !== "")
      .join("\n");
    zip.file(fileName, content);
  }

  const zipUint8 = await zip.generateAsync({ type: "uint8array" });
  const zipBuffer = zipUint8.buffer.slice(
    zipUint8.byteOffset,
    zipUint8.byteOffset + zipUint8.byteLength,
  ) as ArrayBuffer;

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="batch-${jobId.slice(0, 8)}.zip"`,
    },
  });
}
