-- CreateEnum
CREATE TYPE "ProjectAssetType" AS ENUM ('LINK', 'DOC');

-- CreateEnum
CREATE TYPE "ProjectAssetCategory" AS ENUM ('CODE', 'DESIGN', 'DOCS', 'SHEET', 'DEPLOYMENT', 'MEETING', 'GENERAL');

-- CreateTable
CREATE TABLE "ProjectAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ProjectAssetType" NOT NULL DEFAULT 'LINK',
    "category" "ProjectAssetCategory" NOT NULL DEFAULT 'GENERAL',
    "url" TEXT,
    "content" TEXT,
    "description" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectAsset_projectId_idx" ON "ProjectAsset"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAsset_createdById_idx" ON "ProjectAsset"("createdById");

-- CreateIndex
CREATE INDEX "ProjectAsset_projectId_category_idx" ON "ProjectAsset"("projectId", "category");

-- CreateIndex
CREATE INDEX "ProjectAsset_projectId_isPinned_idx" ON "ProjectAsset"("projectId", "isPinned");

-- CreateIndex
CREATE INDEX "ProjectAsset_projectId_type_idx" ON "ProjectAsset"("projectId", "type");

-- AddForeignKey
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
