import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSignedBlobDownload,
  readBlobObject,
  saveBlobObject,
  toContentDisposition,
  verifyBlobDownloadSignature,
} from "./blob-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "blob-store-test-"));
  tempRoots.push(root);
  return root;
}

describe("blob store", () => {
  it("saves a blob to the filesystem and reads it back", async () => {
    const root = await createTempRoot();
    const descriptor = await saveBlobObject({
      fileName: "report.hwpx",
      contentType: "application/zip",
      buffer: new TextEncoder().encode("hello blob"),
      env: {
        BLOB_STORAGE_FS_ROOT: root,
        NODE_ENV: "test",
      },
      now: new Date("2026-03-07T00:00:00.000Z"),
    });

    expect(descriptor.fileName).toBe("report.hwpx");
    expect(descriptor.byteLength).toBe(10);

    const loaded = await readBlobObject(descriptor.blobId, {
      env: {
        BLOB_STORAGE_FS_ROOT: root,
        NODE_ENV: "test",
      },
    });

    expect(loaded.metadata).toEqual(descriptor);
    expect(loaded.buffer.toString("utf8")).toBe("hello blob");
  });

  it("creates and verifies signed download URLs", () => {
    const signed = createSignedBlobDownload({
      descriptor: {
        blobId: "blob-123",
        provider: "fs",
        fileName: "팀 보고서.hwpx",
        contentType: "application/zip",
        byteLength: 128,
        createdAt: "2026-03-07T00:00:00.000Z",
      },
      env: {
        BLOB_SIGNING_SECRET: "test-secret",
        NODE_ENV: "test",
      },
      now: Date.parse("2026-03-07T00:00:00.000Z"),
      ttlSeconds: 60,
    });

    expect(signed.url).toContain("/api/blob/download/blob-123?");
    const verification = verifyBlobDownloadSignature({
      blobId: "blob-123",
      expires: signed.expires,
      signature: signed.signature,
      env: {
        BLOB_SIGNING_SECRET: "test-secret",
        NODE_ENV: "test",
      },
      now: Date.parse("2026-03-07T00:00:30.000Z"),
    });
    expect(verification).toEqual({ ok: true });
  });

  it("rejects expired or mismatched signatures", () => {
    expect(
      verifyBlobDownloadSignature({
        blobId: "blob-123",
        expires: String(Date.parse("2026-03-07T00:00:30.000Z")),
        signature: "bad-signature",
        env: {
          BLOB_SIGNING_SECRET: "test-secret",
          NODE_ENV: "test",
        },
        now: Date.parse("2026-03-07T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "invalid" });

    const signed = createSignedBlobDownload({
      descriptor: {
        blobId: "blob-123",
        provider: "fs",
        fileName: "report.hwpx",
        contentType: "application/zip",
        byteLength: 128,
        createdAt: "2026-03-07T00:00:00.000Z",
      },
      env: {
        BLOB_SIGNING_SECRET: "test-secret",
        NODE_ENV: "test",
      },
      now: Date.parse("2026-03-07T00:00:00.000Z"),
      ttlSeconds: 5,
    });

    expect(
      verifyBlobDownloadSignature({
        blobId: "blob-123",
        expires: signed.expires,
        signature: signed.signature,
        env: {
          BLOB_SIGNING_SECRET: "test-secret",
          NODE_ENV: "test",
        },
        now: Date.parse("2026-03-07T00:00:10.000Z"),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("formats a UTF-8 content disposition header", () => {
    const header = toContentDisposition("팀 보고서.hwpx");
    expect(header).toContain("attachment;");
    expect(header).toContain("filename*=UTF-8''");
  });
});
