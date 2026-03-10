import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDocumentQuota,
  assertTemplateQuota,
  getTenantQuotaConfig,
  getTenantQuotaSummary,
  getTenantUsage,
  setTenantQuotaConfig,
} from "./quota-store";

const tempRoots: string[] = [];

async function createEnv() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quota-store-test-"));
  tempRoots.push(root);
  return { env: { BLOB_STORAGE_FS_ROOT: root }, root };
}

afterEach(async () => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true }).catch(() => null);
  }
});

// Helper to create fake workspace documents/templates dirs
async function createFakeDocuments(root: string, tenantId: string, count: number, blobBytes: number[] = []) {
  for (let i = 0; i < count; i++) {
    const docDir = path.join(root, "workspace", "tenants", tenantId, "documents", `doc-${i}`, "versions");
    await fs.mkdir(docDir, { recursive: true });
    const bytes = blobBytes[i] ?? 100;
    await fs.writeFile(
      path.join(docDir, "v1.json"),
      JSON.stringify({ blob: { byteLength: bytes } }),
    );
  }
}

async function createFakeTemplates(root: string, tenantId: string, count: number, blobBytes: number[] = []) {
  for (let i = 0; i < count; i++) {
    const tplDir = path.join(root, "workspace", "tenants", tenantId, "templates", `tpl-${i}`, "versions");
    await fs.mkdir(tplDir, { recursive: true });
    const bytes = blobBytes[i] ?? 200;
    await fs.writeFile(
      path.join(tplDir, "v1.json"),
      JSON.stringify({ blob: { byteLength: bytes } }),
    );
  }
}

describe("getTenantQuotaConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const { env } = await createEnv();
    const config = await getTenantQuotaConfig("t1", env);
    expect(config.maxDocuments).toBe(100);
    expect(config.maxTemplates).toBe(20);
    expect(config.maxBlobBytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it("reads from env vars when no config file", async () => {
    const { env } = await createEnv();
    const config = await getTenantQuotaConfig("t1", {
      ...env,
      QUOTA_MAX_DOCUMENTS: "50",
      QUOTA_MAX_TEMPLATES: "10",
      QUOTA_MAX_BLOB_BYTES: "1000000",
    });
    expect(config.maxDocuments).toBe(50);
    expect(config.maxTemplates).toBe(10);
    expect(config.maxBlobBytes).toBe(1000000);
  });

  it("reads from quota.json file overriding env vars", async () => {
    const { env, root } = await createEnv();
    const quotaDir = path.join(root, "workspace", "tenants", "t1");
    await fs.mkdir(quotaDir, { recursive: true });
    await fs.writeFile(
      path.join(quotaDir, "quota.json"),
      JSON.stringify({ maxDocuments: 25, maxTemplates: 5, maxBlobBytes: 500000 }),
    );
    const config = await getTenantQuotaConfig("t1", {
      ...env,
      QUOTA_MAX_DOCUMENTS: "50",
    });
    expect(config.maxDocuments).toBe(25);
    expect(config.maxTemplates).toBe(5);
    expect(config.maxBlobBytes).toBe(500000);
  });
});

describe("setTenantQuotaConfig", () => {
  it("writes quota config and reads it back", async () => {
    const { env } = await createEnv();
    const written = await setTenantQuotaConfig("t2", { maxDocuments: 30 }, env);
    expect(written.maxDocuments).toBe(30);
    expect(written.maxTemplates).toBe(20); // default
    const read = await getTenantQuotaConfig("t2", env);
    expect(read.maxDocuments).toBe(30);
  });

  it("merges partial updates with existing values", async () => {
    const { env } = await createEnv();
    await setTenantQuotaConfig("t3", { maxDocuments: 15, maxTemplates: 5 }, env);
    const second = await setTenantQuotaConfig("t3", { maxBlobBytes: 999 }, env);
    expect(second.maxDocuments).toBe(15);
    expect(second.maxTemplates).toBe(5);
    expect(second.maxBlobBytes).toBe(999);
  });
});

describe("getTenantUsage", () => {
  it("returns zeros for empty tenant", async () => {
    const { env } = await createEnv();
    const usage = await getTenantUsage("t1", env);
    expect(usage.documentCount).toBe(0);
    expect(usage.templateCount).toBe(0);
    expect(usage.blobBytes).toBe(0);
  });

  it("counts documents and templates correctly", async () => {
    const { env, root } = await createEnv();
    await createFakeDocuments(root, "t1", 3, [100, 200, 300]);
    await createFakeTemplates(root, "t1", 2, [500, 1000]);
    const usage = await getTenantUsage("t1", env);
    expect(usage.documentCount).toBe(3);
    expect(usage.templateCount).toBe(2);
    expect(usage.blobBytes).toBe(100 + 200 + 300 + 500 + 1000);
  });
});

describe("getTenantQuotaSummary", () => {
  it("combines config and usage with over-limit flags", async () => {
    const { env, root } = await createEnv();
    await setTenantQuotaConfig("t1", { maxDocuments: 3, maxTemplates: 2 }, env);
    await createFakeDocuments(root, "t1", 3);
    await createFakeTemplates(root, "t1", 1);
    const summary = await getTenantQuotaSummary("t1", env);
    expect(summary.tenantId).toBe("t1");
    expect(summary.documentsOverLimit).toBe(true);
    expect(summary.templatesOverLimit).toBe(false);
  });
});

describe("assertDocumentQuota", () => {
  it("does not throw when under limit", async () => {
    const { env, root } = await createEnv();
    await setTenantQuotaConfig("t1", { maxDocuments: 5 }, env);
    await createFakeDocuments(root, "t1", 3);
    await expect(assertDocumentQuota("t1", env)).resolves.toBeUndefined();
  });

  it("throws when at limit", async () => {
    const { env, root } = await createEnv();
    await setTenantQuotaConfig("t1", { maxDocuments: 2 }, env);
    await createFakeDocuments(root, "t1", 2);
    await expect(assertDocumentQuota("t1", env)).rejects.toThrow(/Document quota exceeded/);
  });

  it("throws when over limit", async () => {
    const { env, root } = await createEnv();
    await setTenantQuotaConfig("t1", { maxDocuments: 1 }, env);
    await createFakeDocuments(root, "t1", 3);
    await expect(assertDocumentQuota("t1", env)).rejects.toThrow(/Document quota exceeded/);
  });
});

describe("assertTemplateQuota", () => {
  it("does not throw when under limit", async () => {
    const { env, root } = await createEnv();
    await setTenantQuotaConfig("t1", { maxTemplates: 10 }, env);
    await createFakeTemplates(root, "t1", 5);
    await expect(assertTemplateQuota("t1", env)).resolves.toBeUndefined();
  });

  it("throws when at limit", async () => {
    const { env, root } = await createEnv();
    await setTenantQuotaConfig("t1", { maxTemplates: 3 }, env);
    await createFakeTemplates(root, "t1", 3);
    await expect(assertTemplateQuota("t1", env)).rejects.toThrow(/Template quota exceeded/);
  });
});
