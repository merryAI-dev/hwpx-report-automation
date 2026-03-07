// @vitest-environment node

import { describe, expect, it, vi, afterEach } from "vitest";

const { createJobMock, getJobMock } = vi.hoisted(() => ({
  createJobMock: vi.fn(),
  getJobMock: vi.fn(),
}));

vi.mock("@/lib/server/batch-jobs", () => ({
  getBatchJobManager: () => ({
    createJob: createJobMock,
    getJob: getJobMock,
  }),
}));

import { POST } from "./route";
import { GET } from "./[jobId]/route";

afterEach(() => {
  createJobMock.mockReset();
  getJobMock.mockReset();
});

describe("/api/batch-jobs", () => {
  it("creates a batch job and returns 202", async () => {
    createJobMock.mockReturnValue({
      id: "job-1",
      status: "queued",
      instruction: "rewrite",
      itemCount: 2,
      totalChunks: 1,
      completedChunks: 0,
      resultCount: 0,
      createdAt: 1,
      updatedAt: 1,
      error: null,
      results: [],
    });

    const response = await POST(
      new Request("http://localhost/api/batch-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: "rewrite",
          items: [
            { id: "a", text: "one" },
            { id: "b", text: "two" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ job: { id: "job-1", status: "queued" } });
  });

  it("returns 404 when the batch job is not found", async () => {
    getJobMock.mockReturnValue(null);

    const response = await GET(new Request("http://localhost/api/batch-jobs/job-404"), {
      params: Promise.resolve({ jobId: "job-404" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "batch job not found" });
  });
});
