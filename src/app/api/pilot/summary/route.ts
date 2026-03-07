import { NextResponse } from "next/server";
import { getBatchJobManager } from "@/lib/server/batch-jobs";

export const runtime = "nodejs";

export async function GET() {
  const jobs = getBatchJobManager().listJobs(20);
  const stats = jobs.reduce(
    (acc, job) => {
      acc[job.status] += 1;
      return acc;
    },
    { queued: 0, running: 0, completed: 0, failed: 0 },
  );

  return NextResponse.json({
    generatedAt: Date.now(),
    stats,
    jobs,
  });
}
