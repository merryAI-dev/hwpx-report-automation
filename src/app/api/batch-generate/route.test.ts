// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const {
  inspectTemplateMock,
  runBatchPipelineMock,
  runPlaceholderBatchPipelineMock,
} = vi.hoisted(() => ({
  inspectTemplateMock: vi.fn(),
  runBatchPipelineMock: vi.fn(),
  runPlaceholderBatchPipelineMock: vi.fn(),
}));

vi.mock("@/lib/batch/batch-pipeline", () => ({
  DEFAULT_COLUMN_MAPPING: {
    status: "status",
    title: "title",
    company: "company",
    service: "service",
    product: "product",
    note: "note",
    keyword: "keyword",
    reason: "reason",
  },
  inspectTemplate: inspectTemplateMock,
  runBatchPipeline: runBatchPipelineMock,
  runPlaceholderBatchPipeline: runPlaceholderBatchPipelineMock,
}));

const { GET, POST } = await import("@/app/api/batch-generate/route");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  inspectTemplateMock.mockReset();
  runBatchPipelineMock.mockReset();
  runPlaceholderBatchPipelineMock.mockReset();
});

describe("batch generate route", () => {
  it("rejects GET inspection and requires POST multipart calls", async () => {
    const response = await GET();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      error: "multipart inspection은 POST 요청에서 action=inspect로 호출해야 합니다.",
    });
  });

  it("rejects unauthenticated batch generation", async () => {
    const formData = new FormData();
    formData.set("csv", new File(["status\n완료"], "rows.csv", { type: "text/csv" }));
    formData.set("template", new File(["template"], "template.hwpx", { type: "application/zip" }));

    const response = await POST(new Request("http://localhost/api/batch-generate", { method: "POST", body: formData }));

    expect(response.status).toBe(401);
  });

  it("supports authenticated template inspection over POST", async () => {
    process.env.AUTH_SECRET = "test-secret";
    inspectTemplateMock.mockResolvedValue("title,company");

    const token = await createSessionToken("admin@example.com");
    const formData = new FormData();
    formData.set("action", "inspect");
    formData.set("template", new File(["template"], "template.hwpx", { type: "application/zip" }));

    const response = await POST(new Request("http://localhost/api/batch-generate", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: formData,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ fields: "title,company" });
    expect(inspectTemplateMock).toHaveBeenCalledOnce();
  });

  it("returns a zip attachment for authenticated batch runs", async () => {
    process.env.AUTH_SECRET = "test-secret";
    runBatchPipelineMock.mockResolvedValue(new Blob(["zip-bytes"], { type: "application/zip" }));

    const token = await createSessionToken("admin@example.com");
    const formData = new FormData();
    formData.set("mode", "simple");
    formData.set("csv", new File(["status,title\n완료,보고서"], "rows.csv", { type: "text/csv" }));
    formData.set("template", new File(["template"], "template.hwpx", { type: "application/zip" }));

    const response = await POST(new Request("http://localhost/api/batch-generate", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: formData,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("attachment; filename=\"hwpx_batch_simple_");
    expect(runBatchPipelineMock).toHaveBeenCalledOnce();
  });
});
