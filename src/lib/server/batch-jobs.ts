import { randomUUID } from "node:crypto";
import {
  generateBatchSuggestions,
  MAX_BATCH_ITEMS,
  type BatchItem,
  type BatchSuggestionResponse,
} from "./batch-suggestion-service";

export type BatchJobStatus = "queued" | "running" | "completed" | "failed";

export type BatchJobRecord = {
  id: string;
  status: BatchJobStatus;
  instruction: string;
  model?: string;
  itemCount: number;
  totalChunks: number;
  completedChunks: number;
  resultCount: number;
  createdAt: number;
  updatedAt: number;
  error: string | null;
  results: BatchSuggestionResponse["results"];
};

type CreateBatchJobParams = {
  items: BatchItem[];
  instruction: string;
  model?: string;
};

type BatchJobRunner = (params: {
  items: BatchItem[];
  instruction: string;
  model?: string;
}) => Promise<BatchSuggestionResponse>;

type BatchJobManagerOptions = {
  runChunk?: BatchJobRunner;
  now?: () => number;
  idFactory?: () => string;
  chunkSize?: number;
  maxJobs?: number;
};

function cloneJob(job: BatchJobRecord): BatchJobRecord {
  return {
    ...job,
    results: [...job.results],
  };
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export class BatchJobManager {
  private readonly jobs = new Map<string, BatchJobRecord>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly runChunk: BatchJobRunner;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly chunkSize: number;
  private readonly maxJobs: number;

  constructor(options: BatchJobManagerOptions = {}) {
    this.runChunk = options.runChunk ?? generateBatchSuggestions;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? randomUUID;
    this.chunkSize = options.chunkSize ?? MAX_BATCH_ITEMS;
    this.maxJobs = options.maxJobs ?? 50;
  }

  createJob(params: CreateBatchJobParams): BatchJobRecord {
    const createdAt = this.now();
    const id = this.idFactory();
    const chunks = chunkItems(params.items, this.chunkSize);
    const job: BatchJobRecord = {
      id,
      status: "queued",
      instruction: params.instruction,
      model: params.model,
      itemCount: params.items.length,
      totalChunks: chunks.length,
      completedChunks: 0,
      resultCount: 0,
      createdAt,
      updatedAt: createdAt,
      error: null,
      results: [],
    };

    this.jobs.set(id, job);
    this.pruneJobs();

    const runPromise = Promise.resolve()
      .then(() => this.runJob(job.id, chunks, params))
      .finally(() => {
      this.runs.delete(job.id);
      });
    this.runs.set(job.id, runPromise);
    return cloneJob(job);
  }

  getJob(jobId: string): BatchJobRecord | null {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : null;
  }

  async waitForJob(jobId: string): Promise<BatchJobRecord | null> {
    await this.runs.get(jobId);
    return this.getJob(jobId);
  }

  private async runJob(jobId: string, chunks: BatchItem[][], params: CreateBatchJobParams): Promise<void> {
    const running = this.jobs.get(jobId);
    if (!running) {
      return;
    }
    running.status = "running";
    running.updatedAt = this.now();

    try {
      const accumulated: BatchSuggestionResponse["results"] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const response = await this.runChunk({
          items: chunks[index],
          instruction: params.instruction,
          model: params.model,
        });
        accumulated.push(...response.results);
        const next = this.jobs.get(jobId);
        if (!next) {
          return;
        }
        next.results = [...accumulated];
        next.completedChunks = index + 1;
        next.resultCount = next.results.length;
        next.updatedAt = this.now();
      }

      const completed = this.jobs.get(jobId);
      if (!completed) {
        return;
      }
      completed.status = "completed";
      completed.updatedAt = this.now();
    } catch (error) {
      const failed = this.jobs.get(jobId);
      if (!failed) {
        return;
      }
      failed.status = "failed";
      failed.error = error instanceof Error ? error.message : "Unknown batch job error";
      failed.updatedAt = this.now();
    }
  }

  private pruneJobs(): void {
    if (this.jobs.size <= this.maxJobs) {
      return;
    }
    const sorted = [...this.jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    while (sorted.length && this.jobs.size > this.maxJobs) {
      const oldest = sorted.shift();
      if (!oldest) {
        break;
      }
      if (this.runs.has(oldest.id)) {
        continue;
      }
      this.jobs.delete(oldest.id);
    }
  }
}

declare global {
  var __hwpxBatchJobManager: BatchJobManager | undefined;
}

export function getBatchJobManager(): BatchJobManager {
  if (!globalThis.__hwpxBatchJobManager) {
    globalThis.__hwpxBatchJobManager = new BatchJobManager();
  }
  return globalThis.__hwpxBatchJobManager;
}
