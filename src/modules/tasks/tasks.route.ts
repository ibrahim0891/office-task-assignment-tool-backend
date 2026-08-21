import { Router } from "express";
import * as tasksController from "./tasks.controller";
import {
    resolveWorkspaceContext,
    requireTaskOwnerOrLeaderOrAssignee,
    requireCommentOwner,
    requireCommentOwnerOrTaskOwnerOrAssignee
} from "../../middleware/auth";

const router = Router();

router.get("/tasks", resolveWorkspaceContext, tasksController.getTasks);
router.get("/tasks/:taskId", resolveWorkspaceContext, tasksController.getTask);
router.post("/tasks", resolveWorkspaceContext, tasksController.createTask);
router.put("/tasks/:taskId", requireTaskOwnerOrLeaderOrAssignee, tasksController.updateTask);
router.delete("/tasks/:taskId", requireTaskOwnerOrLeaderOrAssignee, tasksController.softDeleteTask);
router.post("/tasks/:taskId/restore", requireTaskOwnerOrLeaderOrAssignee, tasksController.restoreTask);
router.post("/tasks/:taskId/checklist", requireTaskOwnerOrLeaderOrAssignee, tasksController.createChecklistItem);
router.put("/tasks/:taskId/checklist/:itemId", requireTaskOwnerOrLeaderOrAssignee, tasksController.updateChecklistItem);
router.delete("/tasks/:taskId/checklist/:itemId", requireTaskOwnerOrLeaderOrAssignee, tasksController.deleteChecklistItem);
router.get("/tasks/:taskId/activities", requireTaskOwnerOrLeaderOrAssignee, tasksController.getTaskActivities);
router.get("/tasks/:taskId/comments", requireTaskOwnerOrLeaderOrAssignee, tasksController.getComments);
router.post("/tasks/:taskId/comments", requireTaskOwnerOrLeaderOrAssignee, tasksController.createComment);
router.delete("/tasks/:taskId/comments/:commentId", requireCommentOwner, tasksController.deleteComment);
router.put("/tasks/:taskId/comments/:commentId/resolve", requireCommentOwnerOrTaskOwnerOrAssignee, tasksController.resolveComment);
router.put("/tasks/:taskId/comments/:commentId/reopen", requireCommentOwnerOrTaskOwnerOrAssignee, tasksController.reopenComment);
router.post("/tasks/:taskId/attachments", requireTaskOwnerOrLeaderOrAssignee, tasksController.createAttachment);
router.post("/tasks/:taskId/upload-image", requireTaskOwnerOrLeaderOrAssignee, tasksController.uploadImage);
router.delete("/tasks/:taskId/attachments/:attachmentId", requireTaskOwnerOrLeaderOrAssignee, tasksController.deleteAttachment);

export default router;
