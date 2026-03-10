// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const { listWorkspaceDocumentsMock, listWorkspaceTemplatesMock } = vi.hoisted(() => ({
  listWorkspaceDocumentsMock: vi.fn(),
  listWorkspaceTemplatesMock: vi.fn(),
}));

const { getTenantQuotaSummaryMock } = vi.hoisted(() => ({
  getTenantQuotaSummaryMock: vi.fn(),
}));

const { listJobsMock } = vi.hoisted(() => ({
  listJobsMock: vi.fn(),
}));

vi.mock("@/lib/server/workspace-store", () => ({
  listWorkspaceDocuments: listWorkspaceDocumentsMock,
  listWorkspaceTemplates: listWorkspaceTemplatesMock,
}));

vi.mock("@/lib/server/quota-store", () => ({
  getTenantQuotaSummary: getTenantQuotaSummaryMock,
}));

vi.mock("@/lib/server/batch-jobs", () => ({
  getBatchJobManager: vi.fn(() => ({
    listJobs: listJobsMock,
  })),
}));

const { GET } = await import("@/app/api/dashboard/route");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  listWorkspaceDocumentsMock.mockReset();
  listWorkspaceTemplatesMock.mockReset();
  getTenantQuotaSummaryMock.mockReset();
  listJobsMock.mockReset();
});

const mockQuota = {
  tenantId: "default",
  maxDocuments: 100,
  maxTemplates: 20,
  maxBlobBytes: 5 * 1024 * 1024 * 1024,
  documentCount: 3,
  templateCount: 2,
  blobBytes: 1024,
  documentsOverLimit: false,
  templatesOverLimit: false,
  blobOverLimit: false,
};

describe("GET /api/dashboard", () => {
  it("returns full dashboard summary for authenticated tenant", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");

    listWorkspaceDocumentsMock.mockResolvedValue([
      { id: "doc-1", title: "문서 1", status: "draft", updatedAt: "2026-03-10T00:00:00.000Z" },
      { id: "doc-2", title: "문서 2", status: "ready", updatedAt: "2026-03-09T00:00:00.000Z" },
    ]);
    listWorkspaceTemplatesMock.mockResolvedValue([
      { id: "tpl-1", name: "템플릿 1", status: "approved", updatedAt: "2026-03-10T00:00:00.000Z" },
      { id: "tpl-2", name: "템플릿 2", status: "draft", updatedAt: "2026-03-09T00:00:00.000Z" },
    ]);
    getTenantQuotaSummaryMock.mockResolvedValue(mockQuota);
    listJobsMock.mockReturnValue([
      {
        id: "job-1",
        status: "completed",
        instruction: "배치 작업 1",
        itemCount: 10,
        resultCount: 10,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "job-2",
        status: "running",
        instruction: "배치 작업 2",
        itemCount: 5,
        resultCount: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/dashboard", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
      }) as never,
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      summary: {
        documentCount: number;
        templateCount: number;
        approvedTemplateCount: number;
        activeJobCount: number;
        completedJobCount: number;
        quota: typeof mockQuota;
        recentDocuments: unknown[];
        recentTemplates: unknown[];
        recentJobs: unknown[];
      };
    };
    expect(data.summary).toBeDefined();
    expect(data.summary.documentCount).toBe(2);
    expect(data.summary.templateCount).toBe(2);
    expect(data.summary.approvedTemplateCount).toBe(1);
    expect(data.summary.activeJobCount).toBe(1);
    expect(data.summary.completedJobCount).toBe(1);
    expect(data.summary.quota).toMatchObject({ tenantId: "default" });
    expect(Array.isArray(data.summary.recentDocuments)).toBe(true);
    expect(Array.isArray(data.summary.recentTemplates)).toBe(true);
    expect(Array.isArray(data.summary.recentJobs)).toBe(true);
  });

  it("returns empty arrays when no documents or templates exist", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");

    listWorkspaceDocumentsMock.mockResolvedValue([]);
    listWorkspaceTemplatesMock.mockResolvedValue([]);
    getTenantQuotaSummaryMock.mockResolvedValue({ ...mockQuota, documentCount: 0, templateCount: 0 });
    listJobsMock.mockReturnValue([]);

    const response = await GET(
      new NextRequest("http://localhost/api/dashboard", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
      }) as never,
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      summary: {
        documentCount: number;
        templateCount: number;
        recentDocuments: unknown[];
        recentTemplates: unknown[];
        recentJobs: unknown[];
      };
    };
    expect(data.summary.documentCount).toBe(0);
    expect(data.summary.templateCount).toBe(0);
    expect(data.summary.recentDocuments).toEqual([]);
    expect(data.summary.recentTemplates).toEqual([]);
    expect(data.summary.recentJobs).toEqual([]);
  });

  it("limits recent documents to 5 and templates to 3", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");

    const manyDocs = Array.from({ length: 10 }, (_, i) => ({
      id: `doc-${i}`,
      title: `문서 ${i}`,
      status: "draft",
      updatedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
    const manyTemplates = Array.from({ length: 8 }, (_, i) => ({
      id: `tpl-${i}`,
      name: `템플릿 ${i}`,
      status: "approved",
      updatedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));

    listWorkspaceDocumentsMock.mockResolvedValue(manyDocs);
    listWorkspaceTemplatesMock.mockResolvedValue(manyTemplates);
    getTenantQuotaSummaryMock.mockResolvedValue(mockQuota);
    listJobsMock.mockReturnValue([]);

    const response = await GET(
      new NextRequest("http://localhost/api/dashboard", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
      }) as never,
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      summary: {
        recentDocuments: unknown[];
        recentTemplates: unknown[];
      };
    };
    expect(data.summary.recentDocuments.length).toBe(5);
    expect(data.summary.recentTemplates.length).toBe(3);
  });

  it("returns 401 when not authenticated", async () => {
    process.env.AUTH_SECRET = "test-secret";

    const response = await GET(
      new NextRequest("http://localhost/api/dashboard", {
        method: "GET",
      }) as never,
    );

    expect(response.status).toBe(401);
  });
});
