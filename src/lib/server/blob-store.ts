import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
