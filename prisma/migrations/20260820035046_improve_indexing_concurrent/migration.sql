-- prisma-transaction-off

-- CreateIndex CONCURRENTLY
CREATE INDEX CONCURRENTLY IF NOT EXISTS "KnowledgeArticle_teamId_idx" ON "KnowledgeArticle"("teamId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "KnowledgeArticle_createdById_idx" ON "KnowledgeArticle"("createdById");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Bookmark_teamId_idx" ON "Bookmark"("teamId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Bookmark_createdById_idx" ON "Bookmark"("createdById");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attachment_taskId_idx" ON "Attachment"("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChecklistItem_taskId_idx" ON "ChecklistItem"("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Comment_taskId_idx" ON "Comment"("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Comment_userId_idx" ON "Comment"("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_userId_isArchived_createdAt_idx" ON "Notification"("userId", "isArchived", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_teamId_idx" ON "Notification"("teamId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_taskId_idx" ON "Notification"("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_teamId_date_isSoftDeleted_isArchived_idx" ON "Task"("teamId", "date", "isSoftDeleted", "isArchived");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_columnId_isSoftDeleted_date_idx" ON "Task"("columnId", "isSoftDeleted", "date");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_assignedToId_isSoftDeleted_isArchived_idx" ON "Task"("assignedToId", "isSoftDeleted", "isArchived");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_parentTaskId_idx" ON "Task"("parentTaskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_teamId_isSoftDeleted_isArchived_date_idx" ON "Task"("teamId", "isSoftDeleted", "isArchived", "date");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_teamId_isRecurring_isSoftDeleted_idx" ON "Task"("teamId", "isRecurring", "isSoftDeleted");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TaskActivity_taskId_createdAt_idx" ON "TaskActivity"("taskId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TaskActivity_userId_idx" ON "TaskActivity"("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserTeam_teamId_idx" ON "UserTeam"("teamId");

-- Partial Index: recurring active task templates
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_recurring_active_idx" ON "Task"("teamId", "isRecurring", "isSoftDeleted") WHERE "isRecurring" = true AND "isSoftDeleted" = false;
