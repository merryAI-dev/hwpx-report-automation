// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

// ── mocked functions declared with vi.hoisted ──────────────────────────────

const mocks = vi.hoisted(() => {
  const loadAsync = vi.fn();

  return {
    getWorkspaceTemplate: vi.fn(),
    readBlobObject: vi.fn(),
    parseHwpxTemplate: vi.fn(),
    buildFieldCoordMap: vi.fn(),
    injectMultipleCells: vi.fn(),
    loadAsync,
  };
});

vi.mock("@/lib/server/workspace-store", () => ({
  getWorkspaceTemplate: mocks.getWorkspaceTemplate,
}));

vi.mock("@/lib/server/blob-store", () => ({
  readBlobObject: mocks.readBlobObject,
  resolveBlobStorageRoot: vi.fn(() => "/tmp/blob-root"),
}));

vi.mock("@/lib/batch/hwpx-template-parser", () => ({
  parseHwpxTemplate: mocks.parseHwpxTemplate,
  buildFieldCoordMap: mocks.buildFieldCoordMap,
  describeTemplate: vi.fn(() => ""),
}));

vi.mock("@/lib/batch/hwpx-cell-injector", () => ({
  injectMultipleCells: mocks.injectMultipleCells,
}));

vi.mock("jszip", () => {
  // output zip instance returned by `new JSZip()`
  const outputZip = {
    file: vi.fn(),
    generateAsync: vi.fn().mockResolvedValue(new Uint8Array([5, 6, 7, 8])),
  };

  function MockJSZip(this: unknown) {
    return outputZip;
  }
  MockJSZip.loadAsync = mocks.loadAsync;

  return { default: MockJSZip };
});

// ── import route under test ─────────────────────────────────────────────────

const { POST } = await import("@/app/api/generate/route");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mocks.getWorkspaceTemplate.mockReset();
  mocks.readBlobObject.mockReset();
  mocks.parseHwpxTemplate.mockReset();
  mocks.buildFieldCoordMap.mockReset();
  mocks.injectMultipleCells.mockReset();
  mocks.loadAsync.mockReset();
});

// ── helpers ─────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    tenantId: "default",
    name: "테스트 템플릿",
    documentType: "report",
    status: "approved",
    currentVersionId: "ver-1",
    currentVersionNumber: 1,
    catalogVersion: "tpl-abc",
    fieldCount: 2,
    issueCount: 0,
    blockingIssueCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-1",
    createdByDisplayName: "User",
    updatedBy: "user-1",
    updatedByDisplayName: "User",
    currentVersion: {
      id: "ver-1",
      templateId: "tpl-1",
      versionNumber: 1,
      fileName: "template.hwpx",
      blob: {
        blobId: "blob-1",
        provider: "fs",
        fileName: "template.hwpx",
        contentType: "application/zip",
        byteLength: 100,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      catalogVersion: "tpl-abc",
      fieldCount: 2,
      issueCount: 0,
      blockingIssueCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user-1",
      createdByDisplayName: "User",
      catalog: {
        version: "tpl-abc",
        fieldCount: 2,
        rawTagCount: 2,
        fields: [],
        issues: [],
      },
    },
    ...overrides,
  };
}

function setupJSZipMock() {
  const sectionXml = "<xml/>";
  const mockZip = {
    file: vi.fn().mockImplementation((name: string) => {
      if (name === "Contents/section0.xml") {
        return { async: vi.fn().mockResolvedValue(sectionXml) };
      }
      return null;
    }),
    files: {
      "Contents/section0.xml": {
        dir: false,
        async: vi.fn().mockResolvedValue(new Uint8Array()),
      },
    },
    generateAsync: vi.fn().mockResolvedValue(new Uint8Array([5, 6, 7, 8])),
  };
  mocks.loadAsync.mockResolvedValue(mockZip);
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("POST /api/generate", () => {
  it("returns 400 when templateId is missing", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");

    const response = await POST(
      new NextRequest("http://localhost/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({ values: {} }),
      }) as never,
    );

    expect(response.status).toBe(400);
    const data = await response.json() as { error: string };
    expect(data.error).toMatch(/templateId/i);
  });

  it("returns 404 when template is not found", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    mocks.getWorkspaceTemplate.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({ templateId: "nonexistent" }),
      }) as never,
    );

    expect(response.status).toBe(404);
    const data = await response.json() as { error: string };
    expect(data.error).toMatch(/not found/i);
  });

  it("generates HWPX and returns octet-stream", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");

    mocks.getWorkspaceTemplate.mockResolvedValue(makeTemplate());
    mocks.readBlobObject.mockResolvedValue({
      metadata: {
        blobId: "blob-1",
        tenantId: "default",
        provider: "fs",
        fileName: "template.hwpx",
        contentType: "application/zip",
        byteLength: 100,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      buffer: Buffer.from("fake hwpx zip content"),
    });

    mocks.parseHwpxTemplate.mockReturnValue({ fields: [], cellMap: new Map() });
    mocks.buildFieldCoordMap.mockReturnValue(new Map([["topic", { col: 1, row: 0 }]]));
    mocks.injectMultipleCells.mockReturnValue("<patched xml/>");
    setupJSZipMock();

    const response = await POST(
      new NextRequest("http://localhost/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({
          templateId: "tpl-1",
          values: { topic: "테스트 주제" },
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(mocks.readBlobObject).toHaveBeenCalledWith("blob-1", { tenantId: "default" });
  });

  it("returns 401 when not authenticated", async () => {
    process.env.AUTH_SECRET = "test-secret";

    const response = await POST(
      new NextRequest("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "tpl-1" }),
      }) as never,
    );

    expect(response.status).toBe(401);
  });
});
