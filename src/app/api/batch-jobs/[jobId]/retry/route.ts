import { NextResponse } from "next/server";
import { getBatchJobManager } from "@/lib/server/batch-jobs";

export const runtime = "nodejs";

/**
 * POST /api/batch-jobs/{jobId}/retry
 *
 * Creates a new batch job that re-processes items that failed quality gate
 * checks in the original job, plus any items that never received results
 * (if the job failed before completing all chunks).
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const manager = getBatchJobManager();
    const job = manager.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "batch job not found" }, { status: 404 });
    }

    if (job.status === "running" || job.status === "queued") {
      return NextResponse.json(
        { error: "job is still running; wait for it to finish before retrying" },
        { status: 409 },
      );
    }

    // Collect failed items (quality gate did not pass)
    const failedItems = job.results
      .filter((row) => !row.qualityGate.passed)
      .map((row) => ({
        id: row.id,
        text: row.suggestion, // re-submit the suggestion as new input
      }));

    if (failedItems.length === 0) {
      return NextResponse.json(
        { error: "no failed items to retry" },
        { status: 400 },
      );
    }

    const newJob = manager.createJob({
      items: failedItems,
      instruction: job.instruction,
      model: job.model,
    });

    return NextResponse.json({ job: newJob }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "retry failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
