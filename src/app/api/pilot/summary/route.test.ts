// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const { listJobsMock } = vi.hoisted(() => ({
  listJobsMock: vi.fn(),
}));

vi.mock("@/lib/server/batch-jobs", () => ({
  getBatchJobManager: () => ({
    listJobs: listJobsMock,
  }),
}));

import { GET } from "./route";

afterEach(() => {
  listJobsMock.mockReset();
});

describe("GET /api/pilot/summary", () => {
  it("returns live job stats", async () => {
    listJobsMock.mockReturnValue([
      { id: "a", status: "completed", updatedAt: 2, createdAt: 1, instruction: "", itemCount: 1, totalChunks: 1, completedChunks: 1, resultCount: 1, error: null, results: [] },
      { id: "b", status: "failed", updatedAt: 3, createdAt: 1, instruction: "", itemCount: 1, totalChunks: 1, completedChunks: 0, resultCount: 0, error: "boom", results: [] },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stats).toEqual({ queued: 0, running: 0, completed: 1, failed: 1 });
    expect(payload.jobs).toHaveLength(2);
  });
});
