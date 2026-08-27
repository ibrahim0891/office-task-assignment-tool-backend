import { Router } from "express";
import * as projectsController from "./projects.controller";
import { resolveWorkspaceContext, requireLeader, requireProjectManagerOrLeader } from "../../middleware/auth";

const router = Router();

// Project Portfolio & Summary
router.get("/projects", resolveWorkspaceContext, projectsController.getProjects);
router.get("/projects/summary", resolveWorkspaceContext, projectsController.getPortfolioSummary);

// Project Invitations (MUST be before :projectId)
router.get("/projects/invitations/received", resolveWorkspaceContext, projectsController.getReceivedInvitations);
router.get("/projects/invitations/sent", resolveWorkspaceContext, projectsController.getSentInvitations);
router.get("/projects/invitations/count", resolveWorkspaceContext, projectsController.getPendingInvitationsCount);
router.post("/projects/invitations/:invitationId/accept", resolveWorkspaceContext, projectsController.acceptInvitation);
router.post("/projects/invitations/:invitationId/reject", resolveWorkspaceContext, projectsController.rejectInvitation);
router.post("/projects/invitations/:invitationId/cancel", resolveWorkspaceContext, projectsController.cancelInvitation);
router.post("/projects/:projectId/invitations", requireProjectManagerOrLeader, projectsController.sendInvitation);

// Single Project CRUD & Analytics
router.get("/projects/:projectId", resolveWorkspaceContext, projectsController.getProject);
router.post("/projects", requireLeader, projectsController.createProject);
router.put("/projects/:projectId", requireProjectManagerOrLeader, projectsController.updateProject);
router.delete("/projects/:projectId", requireProjectManagerOrLeader, projectsController.deleteProject);
router.get("/projects/:projectId/analytics", resolveWorkspaceContext, projectsController.getProjectAnalytics);

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
router.post("/projects/:projectId/tasks/:taskId/subtasks", resolveWorkspaceContext, projectsController.createSubtask);
router.put("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId", resolveWorkspaceContext, projectsController.updateSubtask);
router.delete("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId", resolveWorkspaceContext, projectsController.deleteSubtask);

// Task Dependencies (DAG)
router.post("/projects/:projectId/dependencies", requireProjectManagerOrLeader, projectsController.createDependency);
router.delete("/projects/:projectId/dependencies/:dependencyId", requireProjectManagerOrLeader, projectsController.deleteDependency);

// SLA Incidents
router.post("/projects/:projectId/incidents/:incidentId/resolve", resolveWorkspaceContext, projectsController.resolveIncident);
router.post("/projects/:projectId/incidents/:incidentId/reassign", resolveWorkspaceContext, projectsController.reassignIncident);

// Project Columns (Custom Kanban Columns)
router.post("/projects/:projectId/columns", requireProjectManagerOrLeader, projectsController.createColumn);
router.put("/projects/:projectId/columns/reorder", requireProjectManagerOrLeader, projectsController.reorderColumns);
router.put("/projects/:projectId/columns/:columnId", requireProjectManagerOrLeader, projectsController.updateColumn);
router.delete("/projects/:projectId/columns/:columnId", requireProjectManagerOrLeader, projectsController.deleteColumn);


// Task & Subtask Comments
router.get("/projects/:projectId/tasks/:taskId/comments", resolveWorkspaceContext, projectsController.getComments);
router.post("/projects/:projectId/tasks/:taskId/comments", resolveWorkspaceContext, projectsController.createComment);
router.put("/projects/:projectId/tasks/:taskId/comments/:commentId", resolveWorkspaceContext, projectsController.updateComment);
router.post("/projects/:projectId/tasks/:taskId/comments/:commentId/resolve", resolveWorkspaceContext, projectsController.toggleResolveComment);
router.delete("/projects/:projectId/tasks/:taskId/comments/:commentId", resolveWorkspaceContext, projectsController.deleteComment);

export default router;

