import fs from "node:fs/promises";
import path from "node:path";
import { resolveBlobStorageRoot } from "@/lib/server/blob-store";

const WORKSPACE_ROOT_DIR = "workspace";
const TENANTS_DIR = "tenants";
const DOCUMENTS_DIR = "documents";
const TEMPLATES_DIR = "templates";
const VERSIONS_DIR = "versions";
const QUOTA_FILE = "quota.json";

const DEFAULT_MAX_DOCUMENTS = 100;
const DEFAULT_MAX_TEMPLATES = 20;
const DEFAULT_MAX_BLOB_BYTES = 5 * 1024 * 1024 * 1024;

export type TenantQuotaConfig = {
  maxDocuments: number;
  maxTemplates: number;
  maxBlobBytes: number;
};

export type TenantUsage = {
  documentCount: number;
  templateCount: number;
  blobBytes: number;
};

export type TenantQuotaSummary = TenantQuotaConfig & TenantUsage & {
  tenantId: string;
  documentsOverLimit: boolean;
  templatesOverLimit: boolean;
  blobOverLimit: boolean;
};

function sanitizeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function tenantRoot(tenantId: string, env?: Partial<NodeJS.ProcessEnv>): string {
  const blobRoot = resolveBlobStorageRoot(env);
  return path.join(blobRoot, WORKSPACE_ROOT_DIR, TENANTS_DIR, sanitizeId(tenantId));
}

function quotaFilePath(tenantId: string, env?: Partial<NodeJS.ProcessEnv>): string {
  return path.join(tenantRoot(tenantId, env), QUOTA_FILE);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listChildDirectories(rootPath: string): Promise<string[]> {
  try {
    const rows = await fs.readdir(rootPath, { withFileTypes: true });
    return rows.filter((row) => row.isDirectory()).map((row) => row.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const rows = await fs.readdir(dirPath);
    return rows.filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function getTenantQuotaConfig(
  tenantId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<TenantQuotaConfig> {
  const stored = await readJsonFile<Partial<TenantQuotaConfig>>(quotaFilePath(tenantId, env));
  const resolvedEnv = env || process.env;

  const maxDocuments =
    stored?.maxDocuments ??
    (resolvedEnv.QUOTA_MAX_DOCUMENTS ? parseInt(resolvedEnv.QUOTA_MAX_DOCUMENTS, 10) : DEFAULT_MAX_DOCUMENTS);
  const maxTemplates =
    stored?.maxTemplates ??
    (resolvedEnv.QUOTA_MAX_TEMPLATES ? parseInt(resolvedEnv.QUOTA_MAX_TEMPLATES, 10) : DEFAULT_MAX_TEMPLATES);
  const maxBlobBytes =
    stored?.maxBlobBytes ??
    (resolvedEnv.QUOTA_MAX_BLOB_BYTES ? parseInt(resolvedEnv.QUOTA_MAX_BLOB_BYTES, 10) : DEFAULT_MAX_BLOB_BYTES);

  return { maxDocuments, maxTemplates, maxBlobBytes };
}

export async function setTenantQuotaConfig(
  tenantId: string,
  config: Partial<TenantQuotaConfig>,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<TenantQuotaConfig> {
  const existing = await getTenantQuotaConfig(tenantId, env);
  const next: TenantQuotaConfig = {
    maxDocuments: config.maxDocuments ?? existing.maxDocuments,
    maxTemplates: config.maxTemplates ?? existing.maxTemplates,
    maxBlobBytes: config.maxBlobBytes ?? existing.maxBlobBytes,
  };
  const filePath = quotaFilePath(tenantId, env);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function getTenantUsage(
  tenantId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<TenantUsage> {
  const root = tenantRoot(tenantId, env);
  const documentsDir = path.join(root, DOCUMENTS_DIR);
  const templatesDir = path.join(root, TEMPLATES_DIR);

  const [documentIds, templateIds] = await Promise.all([
    listChildDirectories(documentsDir),
    listChildDirectories(templatesDir),
  ]);

  // Sum blob bytes from document versions
  let blobBytes = 0;

  await Promise.all(
    documentIds.map(async (docId) => {
      const versionsDir = path.join(documentsDir, docId, VERSIONS_DIR);
      const versionFiles = await listJsonFiles(versionsDir);
      for (const versionFile of versionFiles) {
        const versionPath = path.join(versionsDir, versionFile);
        const data = await readJsonFile<{ blob?: { byteLength?: number } }>(versionPath);
        if (data?.blob?.byteLength) {
          blobBytes += data.blob.byteLength;
        }
      }
    }),
  );

  await Promise.all(
    templateIds.map(async (tplId) => {
      const versionsDir = path.join(templatesDir, tplId, VERSIONS_DIR);
      const versionFiles = await listJsonFiles(versionsDir);
      for (const versionFile of versionFiles) {
        const versionPath = path.join(versionsDir, versionFile);
        const data = await readJsonFile<{ blob?: { byteLength?: number } }>(versionPath);
        if (data?.blob?.byteLength) {
          blobBytes += data.blob.byteLength;
        }
      }
    }),
  );

  return {
    documentCount: documentIds.length,
    templateCount: templateIds.length,
    blobBytes,
  };
}

export async function getTenantQuotaSummary(
  tenantId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<TenantQuotaSummary> {
  const [config, usage] = await Promise.all([
    getTenantQuotaConfig(tenantId, env),
    getTenantUsage(tenantId, env),
  ]);
  return {
    tenantId,
    ...config,
    ...usage,
    documentsOverLimit: usage.documentCount >= config.maxDocuments,
    templatesOverLimit: usage.templateCount >= config.maxTemplates,
    blobOverLimit: usage.blobBytes >= config.maxBlobBytes,
  };
}

export async function assertDocumentQuota(
  tenantId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  const [config, usage] = await Promise.all([
    getTenantQuotaConfig(tenantId, env),
    getTenantUsage(tenantId, env),
  ]);
  if (usage.documentCount >= config.maxDocuments) {
    throw new Error(
      `Document quota exceeded: ${usage.documentCount} / ${config.maxDocuments} documents used.`,
    );
  }
}

export async function assertTemplateQuota(
  tenantId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  const [config, usage] = await Promise.all([
    getTenantQuotaConfig(tenantId, env),
    getTenantUsage(tenantId, env),
  ]);
  if (usage.templateCount >= config.maxTemplates) {
    throw new Error(
      `Template quota exceeded: ${usage.templateCount} / ${config.maxTemplates} templates used.`,
    );
  }
}
