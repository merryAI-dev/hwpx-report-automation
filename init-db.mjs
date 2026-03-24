/**
 * Lightweight DB init script for production.
 * Creates SQLite tables if they don't exist — no Prisma CLI dependency.
 */
import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";

const url = process.env.DATABASE_URL || "file:/data/prod.db";
console.log(`[init-db] DATABASE_URL=${url}`);

const client = createClient({ url });

const schema = `
CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "hwpxBlob" BLOB NOT NULL,
  "docJson" TEXT NOT NULL,
  "segments" TEXT NOT NULL,
  "extraSegmentsMap" TEXT NOT NULL DEFAULT '{}',
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "Document_updatedAt_idx" ON "Document"("updatedAt");

CREATE TABLE IF NOT EXISTS "DocumentVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "docJson" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'save',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DocumentVersion_documentId_createdAt_idx" ON "DocumentVersion"("documentId", "createdAt");

CREATE TABLE IF NOT EXISTS "ApiKeyConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userEmail" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKeyConfig_userEmail_provider_key" ON "ApiKeyConfig"("userEmail", "provider");

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userEmail" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "details" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AuditLog_userEmail_createdAt_idx" ON "AuditLog"("userEmail", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- Prisma migration tracking (needed for @prisma/client to work)
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
`;

try {
  await client.executeMultiple(schema);
  console.log("[init-db] Schema applied successfully");
} catch (err) {
  console.error("[init-db] Error:", err);
  process.exit(1);
}
