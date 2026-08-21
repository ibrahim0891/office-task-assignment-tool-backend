import { Router } from "express";
import * as projectsController from "./projects.controller";
import { resolveWorkspaceContext, requireLeader } from "../../middleware/auth";

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
router.post("/projects/:projectId/invitations", resolveWorkspaceContext, projectsController.sendInvitation);

// Single Project CRUD & Analytics
router.get("/projects/:projectId", resolveWorkspaceContext, projectsController.getProject);
router.post("/projects", requireLeader, projectsController.createProject);
router.put("/projects/:projectId", resolveWorkspaceContext, projectsController.updateProject);
router.delete("/projects/:projectId", resolveWorkspaceContext, projectsController.deleteProject);
router.get("/projects/:projectId/analytics", resolveWorkspaceContext, projectsController.getProjectAnalytics);

// Project Members
router.post("/projects/:projectId/members", resolveWorkspaceContext, projectsController.addMember);
router.put("/projects/:projectId/members/:memberId", resolveWorkspaceContext, projectsController.updateMember);
router.delete("/projects/:projectId/members/:memberId", resolveWorkspaceContext, projectsController.removeMember);

// Project Tasks (Super Tasks)
router.post("/projects/:projectId/tasks", resolveWorkspaceContext, projectsController.createTask);
router.put("/projects/:projectId/tasks/:taskId", resolveWorkspaceContext, projectsController.updateTask);
router.delete("/projects/:projectId/tasks/:taskId", resolveWorkspaceContext, projectsController.deleteTask);
router.post("/projects/:projectId/tasks/:taskId/rework", resolveWorkspaceContext, projectsController.reworkTask);

// Subtasks
router.post("/projects/:projectId/tasks/:taskId/subtasks", resolveWorkspaceContext, projectsController.createSubtask);
router.put("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId", resolveWorkspaceContext, projectsController.updateSubtask);
router.delete("/projects/:projectId/tasks/:taskId/subtasks/:subtaskId", resolveWorkspaceContext, projectsController.deleteSubtask);

// Task Dependencies (DAG)
router.post("/projects/:projectId/dependencies", resolveWorkspaceContext, projectsController.createDependency);
router.delete("/projects/:projectId/dependencies/:dependencyId", resolveWorkspaceContext, projectsController.deleteDependency);

// SLA Incidents
router.post("/projects/:projectId/incidents/:incidentId/resolve", resolveWorkspaceContext, projectsController.resolveIncident);
router.post("/projects/:projectId/incidents/:incidentId/reassign", resolveWorkspaceContext, projectsController.reassignIncident);

export default router;
