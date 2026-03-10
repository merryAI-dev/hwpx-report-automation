import fs from "node:fs/promises";
import path from "node:path";

// ── Driver interface ──────────────────────────────────────────────────────────

export type BlobDriver = {
  name: string; // "fs" | "s3"
  save(params: {
    tenantId: string;
    blobId: string;
    fileName: string;
    contentType: string;
    data: Buffer;
  }): Promise<void>;
  load(params: {
    tenantId: string;
    blobId: string;
  }): Promise<Buffer>;
  saveMetadata(params: {
    tenantId: string;
    blobId: string;
    metadata: object;
  }): Promise<void>;
  loadMetadata(params: {
    tenantId: string;
    blobId: string;
  }): Promise<object>;
  delete(params: {
    tenantId: string;
    blobId: string;
  }): Promise<void>;
};

// ── S3 driver config ──────────────────────────────────────────────────────────

export type S3DriverConfig = {
  bucket: string;
  region: string;
  endpoint?: string; // for MinIO/R2
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

// ── ConfigError ───────────────────────────────────────────────────────────────

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ── FS Driver ─────────────────────────────────────────────────────────────────

const TENANTS_DIR = "tenants";
const OBJECTS_DIR = "objects";
const METADATA_DIR = "metadata";

function fsTenantRoot(rootDir: string, tenantId: string): string {
  return path.join(rootDir, TENANTS_DIR, tenantId);
}

function fsObjectPath(rootDir: string, tenantId: string, blobId: string): string {
  return path.join(fsTenantRoot(rootDir, tenantId), OBJECTS_DIR, blobId);
}

function fsMetadataPath(rootDir: string, tenantId: string, blobId: string): string {
  return path.join(fsTenantRoot(rootDir, tenantId), METADATA_DIR, `${blobId}.json`);
}

export function createFsDriver(rootDir: string): BlobDriver {
  return {
    name: "fs",

    async save({ tenantId, blobId, data }) {
      const objPath = fsObjectPath(rootDir, tenantId, blobId);
      const metaDir = path.join(fsTenantRoot(rootDir, tenantId), METADATA_DIR);
      await fs.mkdir(path.dirname(objPath), { recursive: true });
      await fs.mkdir(metaDir, { recursive: true });
      await fs.writeFile(objPath, data);
    },

    async load({ tenantId, blobId }) {
      const objPath = fsObjectPath(rootDir, tenantId, blobId);
      return fs.readFile(objPath);
    },

    async saveMetadata({ tenantId, blobId, metadata }) {
      const metaPath = fsMetadataPath(rootDir, tenantId, blobId);
      await fs.mkdir(path.dirname(metaPath), { recursive: true });
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf8");
    },

    async loadMetadata({ tenantId, blobId }) {
      const metaPath = fsMetadataPath(rootDir, tenantId, blobId);
      const raw = await fs.readFile(metaPath, "utf8");
      return JSON.parse(raw) as object;
    },

    async delete({ tenantId, blobId }) {
      const objPath = fsObjectPath(rootDir, tenantId, blobId);
      const metaPath = fsMetadataPath(rootDir, tenantId, blobId);
      await Promise.allSettled([
        fs.unlink(objPath),
        fs.unlink(metaPath),
      ]);
    },
  };
}

// ── S3 Driver (dynamic import of @aws-sdk/client-s3) ─────────────────────────

type S3Client = {
  send(command: unknown): Promise<unknown>;
};

type S3ClientConstructor = new (config: {
  region: string;
  endpoint?: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle?: boolean;
}) => S3Client;

type S3Module = {
  S3Client: S3ClientConstructor;
  PutObjectCommand: new (params: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType?: string;
  }) => unknown;
  GetObjectCommand: new (params: { Bucket: string; Key: string }) => unknown;
  DeleteObjectCommand: new (params: { Bucket: string; Key: string }) => unknown;
};

function s3ObjectKey(tenantId: string, blobId: string): string {
  return `tenants/${tenantId}/objects/${blobId}`;
}

function s3MetadataKey(tenantId: string, blobId: string): string {
  return `tenants/${tenantId}/metadata/${blobId}.json`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicImportFn = (specifier: string) => Promise<any>;

// Store a reference to the native dynamic importer that TypeScript won't analyze
const _dynamicImport: DynamicImportFn = (specifier: string) =>
  // Using Function constructor to prevent TS from resolving the specifier at compile time
  (new Function("s", "return import(s)") as DynamicImportFn)(specifier);

async function loadS3Module(): Promise<S3Module> {
  try {
    // Dynamic import via runtime function — avoids compile-time resolution
    const mod = (await _dynamicImport("@aws-sdk/client-s3")) as S3Module;
    return mod;
  } catch {
    throw new ConfigError(
      "S3 스토리지 드라이버를 사용하려면 @aws-sdk/client-s3 패키지를 설치하세요.\n" +
        "npm install @aws-sdk/client-s3",
    );
  }
}

export function createS3Driver(config: S3DriverConfig): BlobDriver {
  let clientPromise: Promise<{ client: S3Client; mod: S3Module }> | null = null;

  function getClient() {
    if (!clientPromise) {
      clientPromise = loadS3Module().then((mod) => {
        const client = new mod.S3Client({
          region: config.region,
          endpoint: config.endpoint,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
          forcePathStyle: config.forcePathStyle ?? false,
        });
        return { client, mod };
      });
    }
    return clientPromise;
  }

  return {
    name: "s3",

    async save({ tenantId, blobId, contentType, data }) {
      const { client, mod } = await getClient();
      const command = new mod.PutObjectCommand({
        Bucket: config.bucket,
        Key: s3ObjectKey(tenantId, blobId),
        Body: data,
        ContentType: contentType,
      });
      await client.send(command);
    },

    async load({ tenantId, blobId }) {
      const { client, mod } = await getClient();
      const command = new mod.GetObjectCommand({
        Bucket: config.bucket,
        Key: s3ObjectKey(tenantId, blobId),
      });
      const response = (await client.send(command)) as {
        Body?: { transformToByteArray?: () => Promise<Uint8Array> };
      };
      if (!response.Body?.transformToByteArray) {
        throw new Error("S3 GetObject response body is not readable");
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    },

    async saveMetadata({ tenantId, blobId, metadata }) {
      const { client, mod } = await getClient();
      const data = Buffer.from(JSON.stringify(metadata, null, 2), "utf8");
      const command = new mod.PutObjectCommand({
        Bucket: config.bucket,
        Key: s3MetadataKey(tenantId, blobId),
        Body: data,
        ContentType: "application/json",
      });
      await client.send(command);
    },

    async loadMetadata({ tenantId, blobId }) {
      const { client, mod } = await getClient();
      const command = new mod.GetObjectCommand({
        Bucket: config.bucket,
        Key: s3MetadataKey(tenantId, blobId),
      });
      const response = (await client.send(command)) as {
        Body?: { transformToByteArray?: () => Promise<Uint8Array> };
      };
      if (!response.Body?.transformToByteArray) {
        throw new Error("S3 GetObject response body is not readable");
      }
      const bytes = await response.Body.transformToByteArray();
      const text = Buffer.from(bytes).toString("utf8");
      return JSON.parse(text) as object;
    },

    async delete({ tenantId, blobId }) {
      const { client, mod } = await getClient();
      await Promise.allSettled([
        client.send(
          new mod.DeleteObjectCommand({
            Bucket: config.bucket,
            Key: s3ObjectKey(tenantId, blobId),
          }),
        ),
        client.send(
          new mod.DeleteObjectCommand({
            Bucket: config.bucket,
            Key: s3MetadataKey(tenantId, blobId),
          }),
        ),
      ]);
    },
  };
}
