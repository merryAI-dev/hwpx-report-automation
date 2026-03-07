import { describe, expect, it } from "vitest";
import {
  PILOT_METRICS_STORAGE_KEY,
  readPilotMetricEvents,
  summarizePilotMetricEvents,
  writePilotMetricEvents,
  type PilotMetricEvent,
} from "./pilot-metrics";

function makeEvent(type: PilotMetricEvent["type"], timestamp: number): PilotMetricEvent {
  return {
    id: `${type}-${timestamp}`,
    type,
    timestamp,
    detail: {},
  };
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("pilot metrics", () => {
  it("summarizes KPI counts and approval rates", () => {
    const summary = summarizePilotMetricEvents([
      makeEvent("document_loaded", 1),
      makeEvent("manual_save_completed", 2),
      makeEvent("batch_job_created", 3),
      makeEvent("batch_job_completed", 4),
      {
        ...makeEvent("quality_gate_blocked", 5),
        detail: { count: 3 },
      },
      {
        ...makeEvent("quality_gate_approved", 6),
        detail: { count: 1 },
      },
    ]);

    expect(summary.documentsLoaded).toBe(1);
    expect(summary.manualSaves).toBe(1);
    expect(summary.batchJobsCreated).toBe(1);
    expect(summary.batchJobsCompleted).toBe(1);
    expect(summary.qualityGateBlocks).toBe(3);
    expect(summary.qualityGateApprovals).toBe(1);
    expect(summary.approvalRate).toBe(0.25);
    expect(summary.blockedRate).toBe(0.75);
  });

  it("reads and writes events through storage", () => {
    const storage = createMemoryStorage();
    storage.removeItem(PILOT_METRICS_STORAGE_KEY);

    writePilotMetricEvents(storage, [makeEvent("document_loaded", 10)]);
    const events = readPilotMetricEvents(storage);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("document_loaded");
  });
});
