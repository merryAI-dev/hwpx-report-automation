-- CreateTable
CREATE TABLE "PromptMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT,
    "sectionType" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "sourceFeedbackIds" TEXT NOT NULL DEFAULT '[]',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PromptMemory_familyId_sectionType_status_idx" ON "PromptMemory"("familyId", "sectionType", "status");

-- CreateIndex
CREATE INDEX "PromptMemory_memoryType_status_idx" ON "PromptMemory"("memoryType", "status");
