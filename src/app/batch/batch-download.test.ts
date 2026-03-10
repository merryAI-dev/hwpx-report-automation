// @vitest-environment node

import { describe, expect, it, vi, afterEach } from "vitest";
import type { BatchJobRecord } from "@/lib/server/batch-jobs";
import type { QualityGateResult } from "@/lib/quality-gates";

/* ── shared mocks ── */

const { getJobMock, createJobMock } = vi.hoisted(() => ({
  getJobMock: vi.fn(),
  createJobMock: vi.fn(),
}));

vi.mock("@/lib/server/batch-jobs", () => ({
  getBatchJobManager: () => ({
    getJob: getJobMock,
    createJob: createJobMock,
  }),
}));

import { GET as downloadGET } from "@/app/api/batch-jobs/[jobId]/download/route";
import { POST as retryPOST } from "@/app/api/batch-jobs/[jobId]/retry/route";

const passedGate: QualityGateResult = {
  passed: true,
  requiresApproval: false,
  issues: [],
};

const failedGate: QualityGateResult = {
  passed: false,
  requiresApproval: true,
  issues: [{ code: "empty_suggestion", message: "quality too low", severity: "error" }],
};

function makeJob(overrides: Partial<BatchJobRecord> = {}): BatchJobRecord {
  return {
    id: "test-job-1",
    status: "completed",
    instruction: "test instruction",
    itemCount: 2,
    totalChunks: 1,
    completedChunks: 1,
    resultCount: 2,
    createdAt: 1000,
    updatedAt: 2000,
    error: null,
    results: [
      { id: "item-1", suggestion: "Result for item 1", qualityGate: passedGate },
      { id: "item-2", suggestion: "Result for item 2", qualityGate: passedGate },
    ],
    ...overrides,
  };
}

const makeParams = (jobId: string) => ({
  params: Promise.resolve({ jobId }),
});

afterEach(() => {
  getJobMock.mockReset();
  createJobMock.mockReset();
});

describe("GET /api/batch-jobs/[jobId]/download", () => {
  it("returns 404 when job is not found", async () => {
    getJobMock.mockReturnValue(null);

    const res = await downloadGET(
      new Request("http://localhost/api/batch-jobs/missing/download"),
      makeParams("missing"),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "batch job not found" });
  });

  it("returns 400 when job has no results", async () => {
    getJobMock.mockReturnValue(makeJob({ results: [], resultCount: 0 }));

    const res = await downloadGET(
      new Request("http://localhost/api/batch-jobs/test-job-1/download"),
      makeParams("test-job-1"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "no results to download" });
  });

  it("returns correct content-type header for ZIP download", async () => {
    getJobMock.mockReturnValue(makeJob());

    const res = await downloadGET(
      new Request("http://localhost/api/batch-jobs/test-job-1/download"),
      makeParams("test-job-1"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain(".zip");
  });

  it("returns a non-empty ZIP body with magic bytes PK", async () => {
    getJobMock.mockReturnValue(makeJob());

    const res = await downloadGET(
      new Request("http://localhost/api/batch-jobs/test-job-1/download"),
      makeParams("test-job-1"),
    );

    const buf = await res.arrayBuffer();
    // ZIP magic bytes: PK (0x50 0x4B)
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
  });
});

describe("POST /api/batch-jobs/[jobId]/retry — retry logic", () => {
  it("returns 404 when job not found", async () => {
    getJobMock.mockReturnValue(null);

    const res = await retryPOST(
      new Request("http://localhost/api/batch-jobs/none/retry", { method: "POST" }),
      makeParams("none"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 409 when job is still running", async () => {
    getJobMock.mockReturnValue(makeJob({ status: "running" }));

    const res = await retryPOST(
      new Request("http://localhost/api/batch-jobs/test-job-1/retry", { method: "POST" }),
      makeParams("test-job-1"),
    );

    expect(res.status).toBe(409);
  });

  it("returns 400 when there are no failed items to retry", async () => {
    // All results passed quality gate
    getJobMock.mockReturnValue(makeJob({ status: "completed" }));

    const res = await retryPOST(
      new Request("http://localhost/api/batch-jobs/test-job-1/retry", { method: "POST" }),
      makeParams("test-job-1"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "no failed items to retry" });
  });

  it("creates a new job with only the failed items and returns 202", async () => {
    const newJob: BatchJobRecord = {
      id: "new-job-1",
      status: "queued",
      instruction: "test instruction",
      itemCount: 1,
      totalChunks: 1,
      completedChunks: 0,
      resultCount: 0,
      createdAt: 3000,
      updatedAt: 3000,
      error: null,
      results: [],
    };

    getJobMock.mockReturnValue(
      makeJob({
        status: "failed",
        results: [
          { id: "item-1", suggestion: "Result for item 1", qualityGate: passedGate },
          { id: "item-2", suggestion: "Bad result", qualityGate: failedGate },
        ],
      }),
    );
    createJobMock.mockReturnValue(newJob);

    const res = await retryPOST(
      new Request("http://localhost/api/batch-jobs/test-job-1/retry", { method: "POST" }),
      makeParams("test-job-1"),
    );

    expect(res.status).toBe(202);

    // Verify createJob was called with only the failed item
    expect(createJobMock).toHaveBeenCalledOnce();
    const callArgs = createJobMock.mock.calls[0][0] as {
      items: Array<{ id: string }>;
      instruction: string;
    };
    expect(callArgs.instruction).toBe("test instruction");
    expect(callArgs.items).toHaveLength(1);
    expect(callArgs.items[0].id).toBe("item-2");

    const body = (await res.json()) as { job: BatchJobRecord };
    expect(body.job.id).toBe("new-job-1");
  });
});
