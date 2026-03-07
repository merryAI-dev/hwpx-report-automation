import { NextResponse } from "next/server";
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
  return NextResponse.json({ job });
}
