export type PilotMetricEventType =
  | "document_loaded"
  | "manual_save_completed"
  | "autosave_completed"
  | "docx_export_completed"
  | "pdf_export_completed"
  | "single_suggestion_generated"
  | "single_suggestion_applied"
  | "batch_job_created"
  | "batch_job_completed"
  | "batch_job_failed"
  | "batch_suggestion_applied"
  | "quality_gate_blocked"
  | "quality_gate_approved";

export type PilotMetricEvent = {
  id: string;
  type: PilotMetricEventType;
  timestamp: number;
  detail: Record<string, string | number | boolean | null>;
};

export type PilotMetricSummary = {
  documentsLoaded: number;
  manualSaves: number;
  autosaves: number;
  docxExports: number;
  pdfExports: number;
  singleSuggestionsGenerated: number;
  singleSuggestionsApplied: number;
  batchJobsCreated: number;
  batchJobsCompleted: number;
  batchJobsFailed: number;
  batchSuggestionsApplied: number;
  qualityGateBlocks: number;
  qualityGateApprovals: number;
  approvalRate: number;
  blockedRate: number;
  recentEvents: PilotMetricEvent[];
};

export const PILOT_METRICS_STORAGE_KEY = "hwpx-pilot-metrics-v1";
export const PILOT_METRICS_UPDATED_EVENT = "hwpx-pilot-metrics-updated";
const MAX_EVENTS = 200;

function generateEventId(timestamp: number): string {
  return `evt-${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampEvents(events: PilotMetricEvent[]): PilotMetricEvent[] {
  return [...events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_EVENTS);
}

function eventWeight(event: PilotMetricEvent): number {
  const raw = event.detail.count;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function readPilotMetricEvents(storage: Storage | null | undefined): PilotMetricEvent[] {
  if (!storage) {
    return [];
  }
  const raw = storage.getItem(PILOT_METRICS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as PilotMetricEvent[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (event) =>
            !!event
            && typeof event.id === "string"
            && typeof event.type === "string"
            && typeof event.timestamp === "number"
            && typeof event.detail === "object"
            && !!event.detail,
        )
      : [];
  } catch {
    return [];
  }
}

export function writePilotMetricEvents(
  storage: Storage | null | undefined,
  events: PilotMetricEvent[],
): PilotMetricEvent[] {
  if (!storage) {
    return clampEvents(events);
  }
  const next = clampEvents(events);
  storage.setItem(PILOT_METRICS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function recordPilotMetricEvent(
  type: PilotMetricEventType,
  detail: Record<string, string | number | boolean | null> = {},
): PilotMetricEvent | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage;
  const event: PilotMetricEvent = {
    id: generateEventId(Date.now()),
    type,
    timestamp: Date.now(),
    detail,
  };
  const events = readPilotMetricEvents(storage);
  writePilotMetricEvents(storage, [event, ...events]);
  window.dispatchEvent(new CustomEvent(PILOT_METRICS_UPDATED_EVENT, { detail: event }));
  return event;
}

function countEvents(events: PilotMetricEvent[], type: PilotMetricEventType): number {
  return events.reduce((sum, event) => {
    if (event.type !== type) {
      return sum;
    }
    return sum + eventWeight(event);
  }, 0);
}

export function summarizePilotMetricEvents(events: PilotMetricEvent[]): PilotMetricSummary {
  const recentEvents = [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  const qualityGateBlocks = countEvents(events, "quality_gate_blocked");
  const qualityGateApprovals = countEvents(events, "quality_gate_approved");
  const approvalBase = qualityGateBlocks + qualityGateApprovals;

  return {
    documentsLoaded: countEvents(events, "document_loaded"),
    manualSaves: countEvents(events, "manual_save_completed"),
    autosaves: countEvents(events, "autosave_completed"),
    docxExports: countEvents(events, "docx_export_completed"),
    pdfExports: countEvents(events, "pdf_export_completed"),
    singleSuggestionsGenerated: countEvents(events, "single_suggestion_generated"),
    singleSuggestionsApplied: countEvents(events, "single_suggestion_applied"),
    batchJobsCreated: countEvents(events, "batch_job_created"),
    batchJobsCompleted: countEvents(events, "batch_job_completed"),
    batchJobsFailed: countEvents(events, "batch_job_failed"),
    batchSuggestionsApplied: countEvents(events, "batch_suggestion_applied"),
    qualityGateBlocks,
    qualityGateApprovals,
    approvalRate: approvalBase ? qualityGateApprovals / approvalBase : 0,
    blockedRate: approvalBase ? qualityGateBlocks / approvalBase : 0,
    recentEvents,
  };
}
