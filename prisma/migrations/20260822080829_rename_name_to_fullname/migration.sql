/*
  Warnings:

  - You are about to drop the column `name` on the `User` table. All the data in the column will be lost.
  - Added the required column `fullName` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" RENAME COLUMN "name" TO "fullName";

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "ChecklistItem_taskId_isCompleted_idx" ON "ChecklistItem"("taskId", "isCompleted");

-- CreateIndex
CREATE INDEX "Comment_taskId_createdAt_idx" ON "Comment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_teamId_assignedToId_date_isSoftDeleted_isArchived_idx" ON "Task"("teamId", "assignedToId", "date", "isSoftDeleted", "isArchived");

-- CreateIndex
CREATE INDEX "Task_teamId_createdById_date_isSoftDeleted_isArchived_idx" ON "Task"("teamId", "createdById", "date", "isSoftDeleted", "isArchived");

-- CreateIndex
CREATE INDEX "Task_originalDate_idx" ON "Task"("originalDate");

-- CreateIndex
CREATE INDEX "TaskColumn_teamId_order_idx" ON "TaskColumn"("teamId", "order");

-- CreateIndex
CREATE INDEX "UserTeam_teamId_role_idx" ON "UserTeam"("teamId", "role");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
