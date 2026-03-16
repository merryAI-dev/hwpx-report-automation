-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "draftJson" TEXT NOT NULL,
    "evaluationJson" TEXT NOT NULL DEFAULT '{}',
    "model" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationRun_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ReportFamily" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HumanFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationRunId" TEXT,
    "feedbackType" TEXT NOT NULL,
    "sectionId" TEXT,
    "aiContentJson" TEXT,
    "humanContentJson" TEXT,
    "diffJson" TEXT,
    "correctionPatternJson" TEXT,
    "qualityScore" INTEGER,
    "reviewerEmail" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HumanFeedback_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PreferenceData" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL,
    "chosenJson" TEXT NOT NULL,
    "rejectedJson" TEXT NOT NULL,
    "correctionPatternJson" TEXT NOT NULL,
    "sourceFeedbackId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "GenerationRun_familyId_status_idx" ON "GenerationRun"("familyId", "status");

-- CreateIndex
CREATE INDEX "GenerationRun_createdAt_idx" ON "GenerationRun"("createdAt");

-- CreateIndex
CREATE INDEX "HumanFeedback_generationRunId_createdAt_idx" ON "HumanFeedback"("generationRunId", "createdAt");

-- CreateIndex
CREATE INDEX "HumanFeedback_sectionId_feedbackType_idx" ON "HumanFeedback"("sectionId", "feedbackType");

-- CreateIndex
CREATE INDEX "HumanFeedback_createdAt_idx" ON "HumanFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "PreferenceData_familyId_sectionType_idx" ON "PreferenceData"("familyId", "sectionType");

-- CreateIndex
CREATE INDEX "PreferenceData_createdAt_idx" ON "PreferenceData"("createdAt");
