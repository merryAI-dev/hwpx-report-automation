// @vitest-environment node

import { describe, expect, it } from "vitest";
import { BatchJobManager } from "./batch-jobs";
import type { QualityGateResult } from "@/lib/quality-gates";

const passedGate: QualityGateResult = {
  passed: true,
  requiresApproval: false,
  issues: [],
};

describe("BatchJobManager", () => {
  it("processes chunked jobs progressively and stores accumulated results", async () => {
    const manager = new BatchJobManager({
      chunkSize: 2,
      idFactory: () => "job-1",
      now: (() => {
        let tick = 0;
        return () => ++tick;
      })(),
      runChunk: async ({ items }) => ({
        results: items.map((item) => ({ id: item.id, suggestion: item.text.toUpperCase(), qualityGate: passedGate })),
      }),
    });

    const created = manager.createJob({
      instruction: "uppercase",
      items: [
        { id: "a", text: "one" },
        { id: "b", text: "two" },
        { id: "c", text: "three" },
      ],
    });

    expect(created.status).toBe("queued");
    expect(created.totalChunks).toBe(2);

    const completed = await manager.waitForJob(created.id);
    expect(completed).not.toBeNull();
    expect(completed?.status).toBe("completed");
    expect(completed?.completedChunks).toBe(2);
    expect(completed?.resultCount).toBe(3);
    expect(completed?.results).toEqual([
      { id: "a", suggestion: "ONE", qualityGate: passedGate },
      { id: "b", suggestion: "TWO", qualityGate: passedGate },
      { id: "c", suggestion: "THREE", qualityGate: passedGate },
    ]);
  });

  it("marks the job as failed when a chunk runner throws", async () => {
    let callCount = 0;
    const manager = new BatchJobManager({
      chunkSize: 1,
      idFactory: () => "job-2",
      runChunk: async ({ items }) => {
        callCount += 1;
        if (callCount === 2) {
          throw new Error("chunk failed");
        }
        return {
          results: items.map((item) => ({ id: item.id, suggestion: item.text, qualityGate: passedGate })),
        };
      },
    });

    const created = manager.createJob({
      instruction: "noop",
      items: [
        { id: "a", text: "one" },
        { id: "b", text: "two" },
      ],
    });

    const failed = await manager.waitForJob(created.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.completedChunks).toBe(1);
    expect(failed?.resultCount).toBe(1);
    expect(failed?.error).toBe("chunk failed");
  });
});
