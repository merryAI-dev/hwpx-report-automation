import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchWorkspace } from "./search-store";
import type { WorkspaceActor } from "./workspace-store";
import type { WorkspaceDocumentSummary, WorkspaceTemplateSummary } from "@/lib/workspace-types";

vi.mock("./workspace-store", () => ({
  listWorkspaceDocuments: vi.fn(),
  listWorkspaceTemplates: vi.fn(),
}));

import { listWorkspaceDocuments, listWorkspaceTemplates } from "./workspace-store";

const mockListDocs = vi.mocked(listWorkspaceDocuments);
const mockListTemplates = vi.mocked(listWorkspaceTemplates);

const actor: WorkspaceActor = {
  userId: "user-1",
  email: "user@example.com",
  displayName: "Test User",
  tenantId: "tenant-1",
  tenantName: "Test Tenant",
  tenantRole: "owner",
};

const baseDoc: WorkspaceDocumentSummary = {
  id: "doc-1",
  tenantId: "tenant-1",
  title: "분기별 보고서",
  status: "ready",
  sourceFormat: "hwpx",
  currentVersionId: "v-1",
  currentVersionNumber: 3,
  templateCatalogVersion: "1.0",
  templateFieldCount: 12,
  validationSummary: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-06-15T10:00:00.000Z",
  createdBy: "user-1",
  createdByDisplayName: "Test User",
  updatedBy: "user-1",
  updatedByDisplayName: "Test User",
};

const baseTemplate: WorkspaceTemplateSummary = {
  id: "tmpl-1",
  tenantId: "tenant-1",
  name: "월간 보고 템플릿",
  documentType: "report",
  status: "approved",
  currentVersionId: "tv-1",
  currentVersionNumber: 2,
  catalogVersion: "2.1",
  fieldCount: 8,
  issueCount: 0,
  blockingIssueCount: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-06-10T08:00:00.000Z",
  createdBy: "user-1",
  createdByDisplayName: "Test User",
  updatedBy: "user-1",
  updatedByDisplayName: "Test User",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListDocs.mockResolvedValue([baseDoc]);
  mockListTemplates.mockResolvedValue([baseTemplate]);
});

describe("searchWorkspace", () => {
  it("returns empty results for empty query", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "" });
    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(mockListDocs).not.toHaveBeenCalled();
    expect(mockListTemplates).not.toHaveBeenCalled();
  });

  it("returns score 1.0 for exact title match", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "분기별 보고서" });
    expect(result.results.length).toBeGreaterThan(0);
    const docResult = result.results.find((r) => r.type === "document");
    expect(docResult).toBeDefined();
    expect(docResult!.score).toBe(1.0);
  });

  it("returns score 0.7 for contains match", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "보고서" });
    const docResult = result.results.find((r) => r.type === "document");
    expect(docResult).toBeDefined();
    expect(docResult!.score).toBe(0.7);
  });

  it("returns empty results when no match", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "xyz_no_match_9999" });
    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it("filters documents only when type=document", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "보고", types: ["document"] });
    expect(mockListTemplates).not.toHaveBeenCalled();
    expect(result.results.every((r) => r.type === "document")).toBe(true);
  });

  it("filters templates only when type=template", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "보고", types: ["template"] });
    expect(mockListDocs).not.toHaveBeenCalled();
    expect(result.results.every((r) => r.type === "template")).toBe(true);
  });

  it("returns both documents and templates by default", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "보고" });
    const types = new Set(result.results.map((r) => r.type));
    expect(types.has("document")).toBe(true);
    expect(types.has("template")).toBe(true);
  });

  it("respects limit parameter", async () => {
    const manyDocs: WorkspaceDocumentSummary[] = Array.from({ length: 30 }, (_, i) => ({
      ...baseDoc,
      id: `doc-${i}`,
      title: "보고서",
      updatedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
    mockListDocs.mockResolvedValue(manyDocs);
    mockListTemplates.mockResolvedValue([]);

    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "보고서", limit: 5 });
    expect(result.results.length).toBeLessThanOrEqual(5);
  });

  it("includes query and durationMs in response", async () => {
    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "보고" });
    expect(result.query).toBe("보고");
    expect(typeof result.durationMs).toBe("number");
  });

  it("sorts by score descending", async () => {
    mockListDocs.mockResolvedValue([
      { ...baseDoc, id: "doc-contains", title: "중간 보고서 항목" },
      { ...baseDoc, id: "doc-exact", title: "보고서" },
    ]);
    mockListTemplates.mockResolvedValue([]);

    const result = await searchWorkspace({ tenantId: "tenant-1", actor, query: "보고서" });
    expect(result.results[0].score).toBeGreaterThanOrEqual(result.results[result.results.length - 1].score);
  });
});
