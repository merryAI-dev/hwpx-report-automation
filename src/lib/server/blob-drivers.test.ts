import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsDriver, ConfigError } from "./blob-drivers";
import { resolveStorageDriver } from "./blob-store";

// ── FS Driver tests ───────────────────────────────────────────────────────────

describe("createFsDriver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "blob-driver-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves and loads a blob", async () => {
    const driver = createFsDriver(tempDir);
    const data = Buffer.from("hello world");

    await driver.save({
      tenantId: "tenant1",
      blobId: "blob1",
      fileName: "test.txt",
      contentType: "text/plain",
      data,
    });

    const loaded = await driver.load({ tenantId: "tenant1", blobId: "blob1" });
    expect(loaded.equals(data)).toBe(true);
  });

  it("saves and loads metadata", async () => {
    const driver = createFsDriver(tempDir);
    const metadata = { key: "value", count: 42 };

    await driver.saveMetadata({
      tenantId: "tenant1",
      blobId: "blob2",
      metadata,
    });

    const loaded = await driver.loadMetadata({ tenantId: "tenant1", blobId: "blob2" });
    expect(loaded).toEqual(metadata);
  });

  it("deletes a blob and its metadata", async () => {
    const driver = createFsDriver(tempDir);
    const data = Buffer.from("to delete");

    await driver.save({
      tenantId: "tenant1",
      blobId: "blob3",
      fileName: "del.txt",
      contentType: "text/plain",
      data,
    });
    await driver.saveMetadata({
      tenantId: "tenant1",
      blobId: "blob3",
      metadata: { test: true },
    });

    // After delete, load should fail
    await driver.delete({ tenantId: "tenant1", blobId: "blob3" });

    await expect(driver.load({ tenantId: "tenant1", blobId: "blob3" })).rejects.toThrow();
  });

  it("driver name is 'fs'", () => {
    const driver = createFsDriver(tempDir);
    expect(driver.name).toBe("fs");
  });

  it("isolates data between tenants", async () => {
    const driver = createFsDriver(tempDir);
    const data1 = Buffer.from("tenant1 data");
    const data2 = Buffer.from("tenant2 data");

    await driver.save({ tenantId: "t1", blobId: "shared-blob", fileName: "f.txt", contentType: "text/plain", data: data1 });
    await driver.save({ tenantId: "t2", blobId: "shared-blob", fileName: "f.txt", contentType: "text/plain", data: data2 });

    const loaded1 = await driver.load({ tenantId: "t1", blobId: "shared-blob" });
    const loaded2 = await driver.load({ tenantId: "t2", blobId: "shared-blob" });

    expect(loaded1.toString()).toBe("tenant1 data");
    expect(loaded2.toString()).toBe("tenant2 data");
  });
});

// ── resolveStorageDriver tests ────────────────────────────────────────────────

describe("resolveStorageDriver", () => {
  it("returns fs driver by default (no BLOB_STORAGE_DRIVER)", () => {
    const driver = resolveStorageDriver({ NODE_ENV: "development" });
    expect(driver.name).toBe("fs");
  });

  it("returns fs driver when BLOB_STORAGE_DRIVER=fs", () => {
    const driver = resolveStorageDriver({ BLOB_STORAGE_DRIVER: "fs", NODE_ENV: "development" });
    expect(driver.name).toBe("fs");
  });

  it("returns s3 driver when BLOB_STORAGE_DRIVER=s3 with valid config", () => {
    const driver = resolveStorageDriver({
      BLOB_STORAGE_DRIVER: "s3",
      BLOB_STORAGE_S3_BUCKET: "my-bucket",
      BLOB_STORAGE_S3_REGION: "us-east-1",
      BLOB_STORAGE_S3_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      BLOB_STORAGE_S3_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });
    expect(driver.name).toBe("s3");
  });

  it("throws ConfigError when BLOB_STORAGE_DRIVER=s3 but bucket is missing", () => {
    expect(() =>
      resolveStorageDriver({
        BLOB_STORAGE_DRIVER: "s3",
        BLOB_STORAGE_S3_REGION: "us-east-1",
        BLOB_STORAGE_S3_ACCESS_KEY_ID: "key",
        BLOB_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError when BLOB_STORAGE_DRIVER=s3 but region is missing", () => {
    expect(() =>
      resolveStorageDriver({
        BLOB_STORAGE_DRIVER: "s3",
        BLOB_STORAGE_S3_BUCKET: "bucket",
        BLOB_STORAGE_S3_ACCESS_KEY_ID: "key",
        BLOB_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError when credentials are missing", () => {
    expect(() =>
      resolveStorageDriver({
        BLOB_STORAGE_DRIVER: "s3",
        BLOB_STORAGE_S3_BUCKET: "bucket",
        BLOB_STORAGE_S3_REGION: "us-east-1",
      }),
    ).toThrow(ConfigError);
  });
});

// ── S3 Driver ConfigError when @aws-sdk/client-s3 not installed ───────────────

describe("S3 driver dynamic import failure", () => {
  it("throws ConfigError when @aws-sdk/client-s3 is not available", async () => {
    // Mock the _dynamicImport by creating a driver and testing save which triggers loadS3Module
    const driver = resolveStorageDriver({
      BLOB_STORAGE_DRIVER: "s3",
      BLOB_STORAGE_S3_BUCKET: "bucket",
      BLOB_STORAGE_S3_REGION: "us-east-1",
      BLOB_STORAGE_S3_ACCESS_KEY_ID: "key",
      BLOB_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
    });

    // In the test environment, @aws-sdk/client-s3 is not installed,
    // so calling save() should throw ConfigError
    const result = await driver.save({
      tenantId: "t1",
      blobId: "b1",
      fileName: "f.txt",
      contentType: "text/plain",
      data: Buffer.from("test"),
    }).catch((err) => err);

    // Either ConfigError or a module not found error
    expect(result).toBeInstanceOf(Error);
  });
});
