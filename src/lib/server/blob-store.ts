/**
 * Blob Storage Configuration
 *
 * Environment variables:
 *
 * Filesystem driver (default):
 *   BLOB_STORAGE_FS_ROOT        - Root directory for blob storage (default: .blob-storage)
 *   BLOB_SIGNING_SECRET         - HMAC secret for signed download URLs (required in production)
 *   BLOB_SIGNED_URL_TTL_SECONDS - Signed URL time-to-live in seconds (default: 900)
 *   NODE_ENV                    - "production" requires BLOB_SIGNING_SECRET to be set
 *
 * S3-compatible driver (BLOB_STORAGE_DRIVER=s3):
 *   BLOB_STORAGE_DRIVER                    - Set to "s3" to use S3-compatible storage
 *   BLOB_STORAGE_S3_BUCKET                 - S3 bucket name (required for S3 driver)
 *   BLOB_STORAGE_S3_REGION                 - AWS region (required for S3 driver)
 *   BLOB_STORAGE_S3_ENDPOINT               - Custom endpoint URL (for MinIO, Cloudflare R2, etc.)
 *   BLOB_STORAGE_S3_ACCESS_KEY_ID          - AWS access key ID (required for S3 driver)
 *   BLOB_STORAGE_S3_SECRET_ACCESS_KEY      - AWS secret access key (required for S3 driver)
 *   BLOB_STORAGE_S3_FORCE_PATH_STYLE       - Set to "true" for MinIO/path-style endpoints
 *
 * Note: S3 driver requires @aws-sdk/client-s3 to be installed.
 *       Run: npm install @aws-sdk/client-s3
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BlobDriver } from "./blob-drivers";
import { createFsDriver, createS3Driver, ConfigError } from "./blob-drivers";

const DEFAULT_STORAGE_DIR = ".blob-storage";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;
const TENANTS_DIR = "tenants";
const OBJECTS_DIR = "objects";
const METADATA_DIR = "metadata";

export type StoredBlobDescriptor = {
  blobId: string;
  tenantId: string;
  provider: "fs";
  fileName: string;
  contentType: string;
  byteLength: number;
  createdAt: string;
};

export type BlobDownloadPayload = {
  metadata: StoredBlobDescriptor;
  buffer: Buffer;
};

export type SignedBlobDownload = {
  url: string;
  expiresAt: string;
  expires: string;
  signature: string;
};

export type BlobStoreEnv = Partial<Pick<
  NodeJS.ProcessEnv,
  "BLOB_STORAGE_FS_ROOT" | "BLOB_SIGNING_SECRET" | "BLOB_SIGNED_URL_TTL_SECONDS" | "NODE_ENV"
>>;

function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName || "document.hwpx").trim();
  const sanitized = baseName.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/\s+/g, " ");
  return sanitized || "document.hwpx";
}

function sanitizeTenantId(tenantId: string): string {
  const normalized = tenantId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!normalized) {
    throw new Error("tenantId is required");
  }
  return normalized;
}

function ensureBuffer(input: ArrayBuffer | Uint8Array): Buffer {
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return Buffer.from(input);
}

function buildSignaturePayload(blobId: string, tenantId: string, expires: string): string {
  return `${blobId}:${tenantId}:${expires}`;
}

function tenantRootPath(rootDir: string, tenantId: string): string {
  return path.join(rootDir, TENANTS_DIR, sanitizeTenantId(tenantId));
}

function objectPath(rootDir: string, tenantId: string, blobId: string): string {
  return path.join(tenantRootPath(rootDir, tenantId), OBJECTS_DIR, blobId);
}

function metadataPath(rootDir: string, tenantId: string, blobId: string): string {
  return path.join(tenantRootPath(rootDir, tenantId), METADATA_DIR, `${blobId}.json`);
}

export function resolveBlobStorageRoot(env: BlobStoreEnv = process.env): string {
  const configured = (env.BLOB_STORAGE_FS_ROOT || "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), DEFAULT_STORAGE_DIR);
}

export function resolveBlobSigningSecret(env: BlobStoreEnv = process.env): string {
  const configured = (env.BLOB_SIGNING_SECRET || "").trim();
  if (configured) {
    return configured;
  }
  if (env.NODE_ENV !== "production") {
    return "dev-blob-signing-secret";
  }
  throw new Error("BLOB_SIGNING_SECRET must be configured in production.");
}

export function resolveSignedUrlTtlSeconds(env: BlobStoreEnv = process.env): number {
  const raw = Number.parseInt((env.BLOB_SIGNED_URL_TTL_SECONDS || "").trim(), 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_SIGNED_URL_TTL_SECONDS;
}

export async function saveBlobObject(params: {
  tenantId: string;
  fileName: string;
  contentType?: string;
  buffer: ArrayBuffer | Uint8Array;
  env?: BlobStoreEnv;
  now?: Date;
}): Promise<StoredBlobDescriptor> {
  const env = params.env ?? process.env;
  const rootDir = resolveBlobStorageRoot(env);
  const tenantId = sanitizeTenantId(params.tenantId);
  const blobId = crypto.randomUUID();
  const now = params.now ?? new Date();
  const fileName = sanitizeFileName(params.fileName);
  const contentType = (params.contentType || "application/octet-stream").trim() || "application/octet-stream";
  const data = ensureBuffer(params.buffer);
  const descriptor: StoredBlobDescriptor = {
    blobId,
    tenantId,
    provider: "fs",
    fileName,
    contentType,
    byteLength: data.byteLength,
    createdAt: now.toISOString(),
  };

  await fs.mkdir(path.join(tenantRootPath(rootDir, tenantId), OBJECTS_DIR), { recursive: true });
  await fs.mkdir(path.join(tenantRootPath(rootDir, tenantId), METADATA_DIR), { recursive: true });
  await fs.writeFile(objectPath(rootDir, tenantId, blobId), data);
  await fs.writeFile(metadataPath(rootDir, tenantId, blobId), JSON.stringify(descriptor, null, 2), "utf8");

  return descriptor;
}

export async function readBlobObject(
  blobId: string,
  options: { env?: BlobStoreEnv; tenantId: string },
): Promise<BlobDownloadPayload> {
  const rootDir = resolveBlobStorageRoot(options.env ?? process.env);
  const tenantId = sanitizeTenantId(options.tenantId);
  const metadataRaw = await fs.readFile(metadataPath(rootDir, tenantId, blobId), "utf8");
  const metadata = JSON.parse(metadataRaw) as StoredBlobDescriptor;
  const buffer = await fs.readFile(objectPath(rootDir, tenantId, blobId));
  return { metadata, buffer };
}

export function signBlobDownload(params: {
  blobId: string;
  tenantId: string;
  expires: string;
  env?: BlobStoreEnv;
}): string {
  const secret = resolveBlobSigningSecret(params.env ?? process.env);
  return crypto
    .createHmac("sha256", secret)
    .update(buildSignaturePayload(params.blobId, sanitizeTenantId(params.tenantId), params.expires))
    .digest("hex");
}

export function verifyBlobDownloadSignature(params: {
  blobId: string;
  tenantId: string;
  expires: string;
  signature: string;
  env?: BlobStoreEnv;
  now?: number;
}): { ok: true } | { ok: false; reason: "expired" | "invalid" } {
  const expiresAt = Number.parseInt(params.expires, 10);
  if (!Number.isFinite(expiresAt)) {
    return { ok: false, reason: "invalid" };
  }
  if ((params.now ?? Date.now()) > expiresAt) {
    return { ok: false, reason: "expired" };
  }
  const expected = signBlobDownload({
    blobId: params.blobId,
    tenantId: params.tenantId,
    expires: params.expires,
    env: params.env,
  });
  const provided = params.signature.trim();
  if (!provided) {
    return { ok: false, reason: "invalid" };
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, reason: "invalid" };
  }
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}

export function createSignedBlobDownload(params: {
  descriptor: StoredBlobDescriptor;
  basePath?: string;
  env?: BlobStoreEnv;
  ttlSeconds?: number;
  now?: number;
}): SignedBlobDownload {
  const env = params.env ?? process.env;
  const ttlSeconds = params.ttlSeconds ?? resolveSignedUrlTtlSeconds(env);
  const expiresAt = (params.now ?? Date.now()) + ttlSeconds * 1000;
  const expires = String(expiresAt);
  const signature = signBlobDownload({
    blobId: params.descriptor.blobId,
    tenantId: params.descriptor.tenantId,
    expires,
    env,
  });
  const query = new URLSearchParams({
    expires,
    sig: signature,
    name: sanitizeFileName(params.descriptor.fileName),
  });
  const basePath = params.basePath ?? "/api/blob/download";

  return {
    url: `${basePath}/${params.descriptor.blobId}?${query.toString()}`,
    expiresAt: new Date(expiresAt).toISOString(),
    expires,
    signature,
  };
}

export function toContentDisposition(fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  const asciiFallback = safeName.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(safeName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

// ── Extended env type and storage driver resolution ───────────────────────────

export type ExtendedBlobStoreEnv = BlobStoreEnv &
  Partial<{
    BLOB_STORAGE_DRIVER: string;
    BLOB_STORAGE_S3_BUCKET: string;
    BLOB_STORAGE_S3_REGION: string;
    BLOB_STORAGE_S3_ENDPOINT: string;
    BLOB_STORAGE_S3_ACCESS_KEY_ID: string;
    BLOB_STORAGE_S3_SECRET_ACCESS_KEY: string;
    BLOB_STORAGE_S3_FORCE_PATH_STYLE: string;
  }>;

export function resolveStorageDriver(env?: ExtendedBlobStoreEnv): BlobDriver {
  const resolvedEnv = env ?? (process.env as ExtendedBlobStoreEnv);
  const driver = (resolvedEnv.BLOB_STORAGE_DRIVER || "fs").trim().toLowerCase();

  if (driver !== "s3") {
    return createFsDriver(resolveBlobStorageRoot(resolvedEnv));
  }

  const bucket = (resolvedEnv.BLOB_STORAGE_S3_BUCKET || "").trim();
  const region = (resolvedEnv.BLOB_STORAGE_S3_REGION || "").trim();
  const accessKeyId = (resolvedEnv.BLOB_STORAGE_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (resolvedEnv.BLOB_STORAGE_S3_SECRET_ACCESS_KEY || "").trim();

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new ConfigError(
      "S3 드라이버를 사용하려면 BLOB_STORAGE_S3_BUCKET, BLOB_STORAGE_S3_REGION, " +
        "BLOB_STORAGE_S3_ACCESS_KEY_ID, BLOB_STORAGE_S3_SECRET_ACCESS_KEY 환경 변수를 설정하세요.",
    );
  }

  const endpoint = (resolvedEnv.BLOB_STORAGE_S3_ENDPOINT || "").trim() || undefined;
  const forcePathStyle =
    (resolvedEnv.BLOB_STORAGE_S3_FORCE_PATH_STYLE || "").trim().toLowerCase() === "true";

  return createS3Driver({
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  });
}

export { ConfigError } from "./blob-drivers";
export type { BlobDriver } from "./blob-drivers";
