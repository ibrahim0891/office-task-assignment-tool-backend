import { Router } from "express";
import * as projectsController from "./projects.controller";
import { resolveWorkspaceContext, requireLeader, requireProjectManagerOrLeader, resolveProjectAccess } from "../../middleware/auth";

const router = Router();

// Project Portfolio & Summary (Global / user-scoped across teams)
router.get("/projects", resolveWorkspaceContext, projectsController.getProjects);
router.get("/projects/summary", resolveWorkspaceContext, projectsController.getPortfolioSummary);

// Project Invitations (Cross-workspace operations, user-authenticated)
router.get("/projects/invitations/received", projectsController.getReceivedInvitations);
router.get("/projects/invitations/sent", projectsController.getSentInvitations);
router.get("/projects/invitations/count", projectsController.getPendingInvitationsCount);
router.post("/projects/invitations/:invitationId/accept", projectsController.acceptInvitation);
router.post("/projects/invitations/:invitationId/reject", projectsController.rejectInvitation);
router.post("/projects/invitations/:invitationId/cancel", projectsController.cancelInvitation);
router.post("/projects/:projectId/invitations", requireProjectManagerOrLeader, projectsController.sendInvitation);

// Single Project CRUD & Analytics
router.get("/projects/:projectId", resolveProjectAccess, projectsController.getProject);
router.post("/projects", requireLeader, projectsController.createProject);
router.put("/projects/:projectId", requireProjectManagerOrLeader, projectsController.updateProject);
router.delete("/projects/:projectId", requireProjectManagerOrLeader, projectsController.deleteProject);
router.get("/projects/:projectId/analytics", resolveProjectAccess, projectsController.getProjectAnalytics);

// Project Members
router.post("/projects/:projectId/members", requireProjectManagerOrLeader, projectsController.addMember);
router.put("/projects/:projectId/members/:memberId", requireProjectManagerOrLeader, projectsController.updateMember);
router.delete("/projects/:projectId/members/:memberId", requireProjectManagerOrLeader, projectsController.removeMember);

// Project Tasks (Super Tasks) - Restricted to Project Managers & Leaders
router.post("/projects/:projectId/tasks", requireProjectManagerOrLeader, projectsController.createTask);
router.put("/projects/:projectId/tasks/:taskId", requireProjectManagerOrLeader, projectsController.updateTask);
router.delete("/projects/:projectId/tasks/:taskId", requireProjectManagerOrLeader, projectsController.deleteTask);
router.post("/projects/:projectId/tasks/:taskId/rework", requireProjectManagerOrLeader, projectsController.reworkTask);

// Subtasks
router.post("/projects/:projectId/tasks/:taskId/subtasks", resolveProjectAccess, projectsController.createSubtask);
router.put("/projects/:projectId/tasks/:taskId/subtasks/reorder", resolveProjectAccess, projectsController.reorderSubtasks);
router.put("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId", resolveProjectAccess, projectsController.updateSubtask);
router.delete("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId", resolveProjectAccess, projectsController.deleteSubtask);
router.post("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments/upload", resolveProjectAccess, projectsController.uploadSubtaskAttachment);
router.delete("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId/attachments/:attachmentId", resolveProjectAccess, projectsController.deleteSubtaskAttachment);

// Task Dependencies (DAG)
router.post("/projects/:projectId/dependencies", requireProjectManagerOrLeader, projectsController.createDependency);
router.delete("/projects/:projectId/dependencies/:dependencyId", requireProjectManagerOrLeader, projectsController.deleteDependency);

// SLA Incidents
router.post("/projects/:projectId/incidents/:incidentId/resolve", resolveProjectAccess, projectsController.resolveIncident);
router.post("/projects/:projectId/incidents/:incidentId/reassign", resolveProjectAccess, projectsController.reassignIncident);

// Project Columns (Custom Kanban Columns)
router.post("/projects/:projectId/columns", requireProjectManagerOrLeader, projectsController.createColumn);
router.put("/projects/:projectId/columns/reorder", requireProjectManagerOrLeader, projectsController.reorderColumns);
router.put("/projects/:projectId/columns/:columnId", requireProjectManagerOrLeader, projectsController.updateColumn);
router.delete("/projects/:projectId/columns/:columnId", requireProjectManagerOrLeader, projectsController.deleteColumn);

// Task & Subtask Comments
router.get("/projects/:projectId/tasks/:taskId/comments", resolveProjectAccess, projectsController.getComments);
router.post("/projects/:projectId/tasks/:taskId/comments", resolveProjectAccess, projectsController.createComment);
router.put("/projects/:projectId/tasks/:taskId/comments/:commentId", resolveProjectAccess, projectsController.updateComment);
router.post("/projects/:projectId/tasks/:taskId/comments/:commentId/resolve", resolveProjectAccess, projectsController.toggleResolveComment);
router.delete("/projects/:projectId/tasks/:taskId/comments/:commentId", resolveProjectAccess, projectsController.deleteComment);

// Project Assets & Documentation (Links, Specs, Docs)
router.get("/projects/:projectId/assets", resolveProjectAccess, projectsController.getAssets);
router.post("/projects/:projectId/assets", resolveProjectAccess, projectsController.createAsset);
router.put("/projects/:projectId/assets/:assetId", resolveProjectAccess, projectsController.updateAsset);
router.delete("/projects/:projectId/assets/:assetId", resolveProjectAccess, projectsController.deleteAsset);
router.patch("/projects/:projectId/assets/:assetId/pin", resolveProjectAccess, projectsController.togglePinAsset);

// Project Custom Categories
router.get("/projects/:projectId/categories", resolveProjectAccess, projectsController.getCategories);
router.post("/projects/:projectId/categories", resolveProjectAccess, projectsController.createCategory);
router.put("/projects/:projectId/categories/:categoryId", resolveProjectAccess, projectsController.updateCategory);
router.delete("/projects/:projectId/categories/:categoryId", resolveProjectAccess, projectsController.deleteCategory);

// Project Documents (Rich-Text Docs)
router.get("/projects/:projectId/docs", resolveProjectAccess, projectsController.getDocs);
router.post("/projects/:projectId/docs", resolveProjectAccess, projectsController.createDoc);
router.put("/projects/:projectId/docs/:docId", resolveProjectAccess, projectsController.updateDoc);
router.delete("/projects/:projectId/docs/:docId", resolveProjectAccess, projectsController.deleteDoc);

// Project Links & External Resources
router.get("/projects/:projectId/links", resolveProjectAccess, projectsController.getLinks);
router.post("/projects/:projectId/links", resolveProjectAccess, projectsController.createLink);
router.put("/projects/:projectId/links/:linkId", resolveProjectAccess, projectsController.updateLink);
router.delete("/projects/:projectId/links/:linkId", resolveProjectAccess, projectsController.deleteLink);

export default router;
