-- CreateTable
CREATE TABLE "Document" (
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

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "docJson" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'save',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKeyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReportFamily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FamilySchemaVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tocSchemaJson" TEXT NOT NULL,
    "slideTypePatternsJson" TEXT NOT NULL DEFAULT '[]',
    "transformationRulesJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FamilySchemaVersion_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ReportFamily" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingPacket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "sourceArtifactsJson" TEXT NOT NULL,
    "slideClassificationsJson" TEXT NOT NULL DEFAULT '[]',
    "reportSectionClassificationsJson" TEXT NOT NULL DEFAULT '[]',
    "transformationPairsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewerEmail" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingPacket_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ReportFamily" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Document_updatedAt_idx" ON "Document"("updatedAt");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_createdAt_idx" ON "DocumentVersion"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyConfig_userEmail_provider_key" ON "ApiKeyConfig"("userEmail", "provider");

-- CreateIndex
CREATE INDEX "AuditLog_userEmail_createdAt_idx" ON "AuditLog"("userEmail", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFamily_name_key" ON "ReportFamily"("name");

-- CreateIndex
CREATE INDEX "ReportFamily_name_idx" ON "ReportFamily"("name");

-- CreateIndex
CREATE INDEX "FamilySchemaVersion_familyId_status_idx" ON "FamilySchemaVersion"("familyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FamilySchemaVersion_familyId_version_key" ON "FamilySchemaVersion"("familyId", "version");

-- CreateIndex
CREATE INDEX "TrainingPacket_familyId_status_idx" ON "TrainingPacket"("familyId", "status");

-- CreateIndex
CREATE INDEX "TrainingPacket_createdAt_idx" ON "TrainingPacket"("createdAt");
