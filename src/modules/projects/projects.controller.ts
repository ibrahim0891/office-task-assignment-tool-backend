import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { sendResponse } from "../../utils/response";
import * as projectsService from "./projects.service";
import { notifyTeam } from "../../config/socket";

export async function getProjects(req: Request, res: Response) {
    try {
        const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string);
        const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isWorkspaceLeader = (req as any).userRole === "LEADER" || (req as any).user?.role === "LEADER";

        const projects = await projectsService.getProjectsList(teamId, userId, isWorkspaceLeader);
        sendResponse(res, 200, projects);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function getPortfolioSummary(req: Request, res: Response) {
    try {
        const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string);
        const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isWorkspaceLeader = (req as any).userRole === "LEADER" || (req as any).user?.role === "LEADER";

        const summary = await projectsService.getPortfolioSummary(teamId, userId, isWorkspaceLeader);
        sendResponse(res, 200, summary);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function getProject(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const project = await projectsService.getProjectDetail(projectId);
        sendResponse(res, 200, project);
    } catch (error: any) {
        if (error.message === "Project not found.") {
            return sendResponse(res, 404, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
}

export async function createProject(req: Request, res: Response) {
    try {
        const userId = req.headers["x-user-id"] as string;
        const teamId = (req.body.teamId as string) || (req.headers["x-team-id"] as string);
        const project = await projectsService.createProject({ ...req.body, teamId }, userId);

        notifyTeam(project.teamId, "project_created", {
            projectId: project.id,
            title: project.title,
            creatorId: userId,
            timestamp: Date.now(),
        });
        notifyTeam(project.teamId, "project_updated", {
            projectId: project.id,
            action: "project_create",
            timestamp: Date.now(),
        });

        sendResponse(res, 201, project);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateProject(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const project = await projectsService.updateProject(projectId, req.body);

        notifyTeam(project.teamId, "project_updated", {
            projectId: project.id,
            action: "project_update",
            timestamp: Date.now(),
        });

        sendResponse(res, 200, project);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteProject(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const deleted = await projectsService.softDeleteProject(projectId, userId);

        notifyTeam(deleted.teamId, "project_archived", {
            projectId: deleted.id,
            timestamp: Date.now(),
        });
        notifyTeam(deleted.teamId, "project_updated", {
            projectId: deleted.id,
            action: "project_archive",
            timestamp: Date.now(),
        });

        sendResponse(res, 200, { message: "Project moved to archive successfully.", project: deleted });
    } catch (error: any) {
        const status = error.message?.includes("Only the project manager") ? 403 : 400;
        sendResponse(res, status, { error: error.message });
    }
}

export async function getArchivedProjects(req: Request, res: Response) {
    try {
        const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string);
        const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isWorkspaceLeader = (req as any).userRole === "LEADER" || (req as any).user?.role === "LEADER";

        if (!teamId) {
            return sendResponse(res, 400, { error: "teamId is required." });
        }

        const projects = await projectsService.getArchivedProjects(teamId, userId, isWorkspaceLeader);
        sendResponse(res, 200, projects);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function restoreProject(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isWorkspaceLeader = (req as any).userRole === "LEADER" || (req as any).user?.role === "LEADER";

        const restored = await projectsService.restoreProject(projectId, userId, isWorkspaceLeader);

        notifyTeam(restored.teamId, "project_restored", {
            projectId: restored.id,
            timestamp: Date.now(),
        });
        notifyTeam(restored.teamId, "project_updated", {
            projectId: restored.id,
            action: "project_restore",
            timestamp: Date.now(),
        });

        sendResponse(res, 200, { message: "Project restored successfully.", project: restored });
    } catch (error: any) {
        const status = error.message?.includes("Only the project manager or workspace owner") ? 403 : 400;
        sendResponse(res, status, { error: error.message });
    }
}

export async function permanentlyDeleteProject(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isWorkspaceLeader = (req as any).userRole === "LEADER" || (req as any).user?.role === "LEADER";

        const deleted = await projectsService.permanentlyDeleteProject(projectId, userId, isWorkspaceLeader);

        notifyTeam(deleted.teamId, "project_deleted", {
            projectId: deleted.id,
            timestamp: Date.now(),
        });
        notifyTeam(deleted.teamId, "project_updated", {
            projectId: deleted.id,
            action: "project_delete",
            timestamp: Date.now(),
        });

        sendResponse(res, 200, { message: "Project permanently deleted." });
    } catch (error: any) {
        const status = error.message?.includes("Only the project manager or workspace owner") ? 403 : 400;
        sendResponse(res, status, { error: error.message });
    }
}

export async function getProjectAnalytics(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const startDate = req.query.startDate as string | undefined;
        const analytics = await projectsService.getProjectAnalytics(projectId, startDate);
        sendResponse(res, 200, analytics);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

// ----------------------------------------------------
// MEMBERS
// ----------------------------------------------------

export async function addMember(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const member = await projectsService.addProjectMember(projectId, req.body);

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                memberId: member.id,
                action: "member_add",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, member);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateMember(req: Request, res: Response) {
    try {
        const { projectId, memberId } = req.params;
        const actingUserId = (req.headers["x-user-id"] as string) || (req as any).user?.id;

        if (actingUserId && projectId) {
            const project = await prisma.project.findUnique({
                where: { id: projectId },
                include: {
                    members: { where: { userId: actingUserId } },
                },
            });
            const isManager = project?.managerId === actingUserId;
            const isLeader = project?.members?.some((m) => m.role === "LEADER" || m.role === "MANAGER");
            const isWorkspaceLeader = (req as any).userRole === "LEADER" || (req as any).user?.role === "LEADER";

            if (!isManager && !isLeader && !isWorkspaceLeader) {
                return sendResponse(res, 403, { error: "Only project managers and leaders can update member roles." });
            }
        }

        const member = await projectsService.updateProjectMember(memberId, req.body, actingUserId);

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                memberId: member.id,
                action: "member_update",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, member);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function removeMember(req: Request, res: Response) {
    try {
        const { memberId } = req.params;
        const actingUserId = (req.headers["x-user-id"] as string) || (req as any).user?.id;
        const existing = await prisma.projectMember.findUnique({
            where: { id: memberId },
            select: { projectId: true, project: { select: { teamId: true } } },
        });

        await projectsService.removeProjectMember(memberId, actingUserId);

        if (existing?.project?.teamId) {
            notifyTeam(existing.project.teamId, "project_updated", {
                projectId: existing.projectId,
                memberId,
                action: "member_remove",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, { message: "Member removed." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ----------------------------------------------------
// PROJECT TASKS
// ----------------------------------------------------

export async function createTask(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = req.headers["x-user-id"] as string;
        const task = await projectsService.createProjectTask(projectId, req.body, userId);

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                taskId: task.id,
                action: "task_create",
                actingUserId: userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, task);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateTask(req: Request, res: Response) {
    try {
        const { taskId } = req.params;
        const actingUserId = (req.headers["x-user-id"] as string) || (req as any).user?.id;
        const task = await projectsService.updateProjectTask(taskId, req.body);

        const project = await prisma.project.findUnique({
            where: { id: task.projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId: task.projectId,
                taskId: task.id,
                action: "task_update",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, task);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteTask(req: Request, res: Response) {
    try {
        const { taskId } = req.params;
        const actingUserId = (req.headers["x-user-id"] as string) || (req as any).user?.id;
        const existing = await prisma.projectTask.findUnique({
            where: { id: taskId },
            select: { projectId: true, project: { select: { teamId: true } } },
        });

        await projectsService.deleteProjectTask(taskId);

        if (existing?.project?.teamId) {
            notifyTeam(existing.project.teamId, "project_updated", {
                projectId: existing.projectId,
                taskId,
                action: "task_delete",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, { message: "Task deleted." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function reworkTask(req: Request, res: Response) {
    try {
        const { taskId } = req.params;
        const userId = req.headers["x-user-id"] as string;
        const task = await projectsService.reworkProjectTask(taskId, req.body, userId);

        const project = await prisma.project.findUnique({
            where: { id: task.projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId: task.projectId,
                taskId: task.id,
                action: "task_rework",
                actingUserId: userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, task);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ----------------------------------------------------
// SUBTASKS
// ----------------------------------------------------

export async function createSubtask(req: Request, res: Response) {
    try {
        const { taskId } = req.params;
        const actingUserId = (req as any).user?.userId || (req.headers["x-user-id"] as string);
        const subtask = await projectsService.createProjectSubtask(taskId, req.body, actingUserId);

        const parentTask = await prisma.projectTask.findUnique({
            where: { id: taskId },
            select: { projectId: true, project: { select: { teamId: true } } },
        });
        if (parentTask?.project?.teamId) {
            notifyTeam(parentTask.project.teamId, "project_updated", {
                projectId: parentTask.projectId,
                taskId,
                subtaskId: subtask.id,
                action: "subtask_create",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, subtask);
    } catch (error: any) {
        if (error.message?.includes("Access denied")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateSubtask(req: Request, res: Response) {
    try {
        const { subtaskId } = req.params;
        const actingUserId = (req as any).user?.userId || (req.headers["x-user-id"] as string);
        const subtask = await projectsService.updateProjectSubtask(subtaskId, req.body, actingUserId);

        const existing = await prisma.projectSubtask.findUnique({
            where: { id: subtaskId },
            select: { parentTaskId: true, parentTask: { select: { projectId: true, project: { select: { teamId: true } } } } },
        });
        if (existing?.parentTask?.project?.teamId) {
            notifyTeam(existing.parentTask.project.teamId, "project_updated", {
                projectId: existing.parentTask.projectId,
                taskId: existing.parentTaskId,
                subtaskId,
                action: "subtask_update",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, subtask);
    } catch (error: any) {
        if (error.message?.includes("Access denied")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteSubtask(req: Request, res: Response) {
    try {
        const { subtaskId } = req.params;
        const actingUserId = (req as any).user?.userId || (req.headers["x-user-id"] as string);
        const existing = await prisma.projectSubtask.findUnique({
            where: { id: subtaskId },
            select: { parentTaskId: true, parentTask: { select: { projectId: true, project: { select: { teamId: true } } } } },
        });

        await projectsService.deleteProjectSubtask(subtaskId, actingUserId);

        if (existing?.parentTask?.project?.teamId) {
            notifyTeam(existing.parentTask.project.teamId, "project_updated", {
                projectId: existing.parentTask.projectId,
                taskId: existing.parentTaskId,
                subtaskId,
                action: "subtask_delete",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, { message: "Subtask deleted." });
    } catch (error: any) {
        if (error.message?.includes("Access denied")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 400, { error: error.message });
    }
}

export async function uploadSubtaskAttachment(req: Request, res: Response) {
    try {
        const { taskId, subtaskId } = req.params;
        const { imageBase64, filename, userId } = req.body;
        const actingUserId = userId || (req as any).user?.userId || (req.headers["x-user-id"] as string);

        if (!imageBase64 || !filename) {
            return sendResponse(res, 400, { error: "Image data and filename are required." });
        }

        const attachment = await projectsService.uploadProjectSubtaskAttachment(
            taskId,
            subtaskId,
            imageBase64,
            filename,
            actingUserId
        );

        const existing = await prisma.projectSubtask.findUnique({
            where: { id: subtaskId },
            select: { parentTaskId: true, parentTask: { select: { projectId: true, project: { select: { teamId: true } } } } },
        });
        if (existing?.parentTask?.project?.teamId) {
            notifyTeam(existing.parentTask.project.teamId, "project_updated", {
                projectId: existing.parentTask.projectId,
                taskId: existing.parentTaskId,
                subtaskId,
                action: "subtask_attachment_upload",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, attachment);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteSubtaskAttachment(req: Request, res: Response) {
    try {
        const { subtaskId, attachmentId } = req.params;
        const actingUserId = (req as any).user?.userId || (req.headers["x-user-id"] as string);

        const result = await projectsService.deleteProjectSubtaskAttachment(
            subtaskId,
            attachmentId,
            actingUserId
        );

        const existing = await prisma.projectSubtask.findUnique({
            where: { id: subtaskId },
            select: { parentTaskId: true, parentTask: { select: { projectId: true, project: { select: { teamId: true } } } } },
        });
        if (existing?.parentTask?.project?.teamId) {
            notifyTeam(existing.parentTask.project.teamId, "project_updated", {
                projectId: existing.parentTask.projectId,
                taskId: existing.parentTaskId,
                subtaskId,
                action: "subtask_attachment_delete",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function reorderSubtasks(req: Request, res: Response) {
    try {
        const { projectId, taskId } = req.params;
        const { subtaskOrders } = req.body;
        const actingUserId = (req as any).user?.userId || (req.headers["x-user-id"] as string);

        if (!Array.isArray(subtaskOrders)) {
            return sendResponse(res, 400, { error: "subtaskOrders array is required." });
        }

        const subtasks = await projectsService.reorderProjectSubtasks(taskId, subtaskOrders);

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { teamId: true },
        });

        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                taskId,
                action: "subtask_reorder",
                actingUserId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, subtasks);
    } catch (error: any) {
        if (error.message?.includes("Access denied")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 400, { error: error.message });
    }
}

// ----------------------------------------------------
// DEPENDENCIES
// ----------------------------------------------------

export async function createDependency(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const dependency = await projectsService.createTaskDependency(projectId, req.body);

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "dependency_create",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, dependency);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteDependency(req: Request, res: Response) {
    try {
        const { dependencyId } = req.params;
        const existing = await prisma.taskDependency.findUnique({
            where: { id: dependencyId },
            select: { projectId: true, project: { select: { teamId: true } } },
        });

        await projectsService.deleteTaskDependency(dependencyId);

        if (existing?.project?.teamId) {
            notifyTeam(existing.project.teamId, "project_updated", {
                projectId: existing.projectId,
                action: "dependency_delete",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, { message: "Dependency deleted." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ----------------------------------------------------
// INCIDENTS
// ----------------------------------------------------

export async function resolveIncident(req: Request, res: Response) {
    try {
        const { incidentId } = req.params;
        const userId = req.headers["x-user-id"] as string;
        const incident = await projectsService.resolveProjectIncident(incidentId, userId);

        const existing = await prisma.projectIncident.findUnique({
            where: { id: incidentId },
            select: { projectId: true, project: { select: { teamId: true } } },
        });
        if (existing?.project?.teamId) {
            notifyTeam(existing.project.teamId, "project_updated", {
                projectId: existing.projectId,
                action: "incident_resolve",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, incident);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function reassignIncident(req: Request, res: Response) {
    try {
        const { incidentId } = req.params;
        const userId = req.headers["x-user-id"] as string;
        const { newAssigneeId } = req.body;
        if (!newAssigneeId) {
            return sendResponse(res, 400, { error: "newAssigneeId is required." });
        }
        const incident = await projectsService.reassignIncidentTask(incidentId, newAssigneeId, userId);

        const existing = await prisma.projectIncident.findUnique({
            where: { id: incidentId },
            select: { projectId: true, project: { select: { teamId: true } } },
        });
        if (existing?.project?.teamId) {
            notifyTeam(existing.project.teamId, "project_updated", {
                projectId: existing.projectId,
                action: "incident_reassign",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, incident);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ----------------------------------------------------
// PROJECT INVITATIONS
// ----------------------------------------------------

export async function sendInvitation(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const senderId = (req.headers["x-user-id"] as string) || (req as any).user?.id || (req as any).user?.userId;
        if (!senderId) return sendResponse(res, 401, { error: "Authentication required." });

        const invitation = await projectsService.sendProjectInvitation(projectId, senderId, req.body);
        sendResponse(res, 201, invitation);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function getReceivedInvitations(req: Request, res: Response) {
    try {
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.id || (req as any).user?.userId;
        const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string) || (req as any).workspaceTeamId;
        if (!userId) return sendResponse(res, 401, { error: "Authentication required." });

        const invitations = await projectsService.getReceivedProjectInvitations(userId, teamId);
        sendResponse(res, 200, invitations);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function getSentInvitations(req: Request, res: Response) {
    try {
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.id || (req as any).user?.userId;
        const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string) || (req as any).workspaceTeamId;
        const isWorkspaceLeader = (req as any).userRole === "LEADER" || (req as any).user?.role === "LEADER";
        if (!userId) return sendResponse(res, 401, { error: "Authentication required." });

        const invitations = await projectsService.getSentProjectInvitations(userId, teamId, isWorkspaceLeader);
        sendResponse(res, 200, invitations);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function getPendingInvitationsCount(req: Request, res: Response) {
    try {
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.id || (req as any).user?.userId;
        const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string) || (req as any).workspaceTeamId;
        if (!userId) return sendResponse(res, 401, { error: "Authentication required." });

        const result = await projectsService.getPendingInvitationsCount(userId, teamId);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function acceptInvitation(req: Request, res: Response) {
    try {
        const { invitationId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.id || (req as any).user?.userId;
        if (!userId) return sendResponse(res, 401, { error: "Authentication required." });

        const result = await projectsService.acceptProjectInvitation(invitationId, userId);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function rejectInvitation(req: Request, res: Response) {
    try {
        const { invitationId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.id || (req as any).user?.userId;
        if (!userId) return sendResponse(res, 401, { error: "Authentication required." });

        const result = await projectsService.rejectProjectInvitation(invitationId, userId);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function cancelInvitation(req: Request, res: Response) {
    try {
        const { invitationId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.id || (req as any).user?.userId;
        if (!userId) return sendResponse(res, 401, { error: "Authentication required." });

        const result = await projectsService.cancelProjectInvitation(invitationId, userId);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ----------------------------------------------------
// PROJECT COLUMNS
// ----------------------------------------------------

export async function createColumn(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const { name, type, isComplete } = req.body;
        if (!name) return sendResponse(res, 400, { error: "Column name is required." });

        const column = await projectsService.createProjectColumn(projectId, name, type, isComplete);

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                columnId: column.id,
                action: "column_create",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, column);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateColumn(req: Request, res: Response) {
    try {
        const { columnId } = req.params;
        const { name, type, isComplete } = req.body;

        const column = await projectsService.updateProjectColumn(columnId, name, type, isComplete);

        const project = await prisma.project.findUnique({
            where: { id: column.projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId: column.projectId,
                columnId,
                action: "column_update",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, column);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteColumn(req: Request, res: Response) {
    try {
        const { columnId } = req.params;
        const existing = await prisma.projectColumn.findUnique({
            where: { id: columnId },
            select: { projectId: true, project: { select: { teamId: true } } },
        });

        const result = await projectsService.deleteProjectColumn(columnId);

        if (existing?.project?.teamId) {
            notifyTeam(existing.project.teamId, "project_updated", {
                projectId: existing.projectId,
                columnId,
                action: "column_delete",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function reorderColumns(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const { columnOrders } = req.body;
        if (!Array.isArray(columnOrders)) {
            return sendResponse(res, 400, { error: "columnOrders array is required." });
        }

        const columns = await projectsService.reorderProjectColumns(projectId, columnOrders);

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { teamId: true },
        });
        if (project?.teamId) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "column_reorder",
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, columns);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ----------------------------------------------------
// PROJECT TASK & SUBTASK COMMENTS CONTROLLER
// ----------------------------------------------------

export async function getComments(req: Request, res: Response) {
    try {
        const { taskId } = req.params;
        const { subtaskId } = req.query;
        const comments = await projectsService.getProjectTaskComments(taskId, subtaskId as string | undefined);
        sendResponse(res, 200, comments);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function createComment(req: Request, res: Response) {
    try {
        const { projectId, taskId } = req.params;
        const { content, subtaskId } = req.body;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;

        if (!userId) {
            return sendResponse(res, 401, { error: "User authentication required." });
        }

        const result = await projectsService.createProjectTaskComment(
            projectId,
            taskId,
            userId,
            content,
            subtaskId
        );
        sendResponse(res, 201, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteComment(req: Request, res: Response) {
    try {
        const { commentId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;

        if (!userId) {
            return sendResponse(res, 401, { error: "User authentication required." });
        }

        const result = await projectsService.deleteProjectTaskComment(commentId, userId);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateComment(req: Request, res: Response) {
    try {
        const { commentId } = req.params;
        const { content } = req.body;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;

        if (!userId) {
            return sendResponse(res, 401, { error: "User authentication required." });
        }

        const result = await projectsService.updateProjectTaskComment(commentId, userId, content);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function toggleResolveComment(req: Request, res: Response) {
    try {
        const { commentId } = req.params;
        const { isResolved } = req.body;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;

        if (!userId) {
            return sendResponse(res, 401, { error: "User authentication required." });
        }

        const result = await projectsService.toggleResolveProjectTaskComment(
            commentId,
            userId,
            isResolved !== undefined ? Boolean(isResolved) : undefined
        );
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}


// ==========================================
// PROJECT ASSETS & DOCUMENTATION CONTROLLERS
// ==========================================

export async function getAssets(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const { category, type, isPinned, search } = req.query;
        const assets = await projectsService.getProjectAssets(projectId, {
            category: category as string,
            type: type as string,
            isPinned: isPinned !== undefined ? isPinned === "true" : undefined,
            search: search as string,
        });
        sendResponse(res, 200, assets);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function createAsset(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const asset = await projectsService.createProjectAsset(projectId, req.body, userId);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "asset_created",
                assetId: asset.id,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, asset);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateAsset(req: Request, res: Response) {
    try {
        const { projectId, assetId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);

        const asset = await projectsService.updateProjectAsset(projectId, assetId, req.body, userId, isLeaderOrManager);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "asset_updated",
                assetId,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, asset);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteAsset(req: Request, res: Response) {
    try {
        const { projectId, assetId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);

        await projectsService.deleteProjectAsset(projectId, assetId, userId, isLeaderOrManager);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "asset_deleted",
                assetId,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, { message: "Asset deleted successfully." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function togglePinAsset(req: Request, res: Response) {
    try {
        const { projectId, assetId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);

        const asset = await projectsService.togglePinAsset(projectId, assetId, userId, isLeaderOrManager);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "asset_pinned",
                assetId,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, asset);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ==========================================
// PROJECT CATEGORIES CONTROLLERS
// ==========================================

export async function getCategories(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const categories = await projectsService.getProjectCategories(projectId);
        sendResponse(res, 200, categories);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function createCategory(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const isViewer = Boolean((req as any).isProjectViewer);
        if (isViewer) {
            return sendResponse(res, 403, { error: "Viewers have read-only access and cannot create categories." });
        }

        const category = await projectsService.createProjectCategory(projectId, req.body);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "category_created",
                categoryId: category.id,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, category);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateCategory(req: Request, res: Response) {
    try {
        const { projectId, categoryId } = req.params;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);
        const isViewer = Boolean((req as any).isProjectViewer);

        if (isViewer || !isLeaderOrManager) {
            return sendResponse(res, 403, { error: "Only project leaders and managers can manage custom categories." });
        }

        const category = await projectsService.updateProjectCategory(projectId, categoryId, req.body);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "category_updated",
                categoryId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, category);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteCategory(req: Request, res: Response) {
    try {
        const { projectId, categoryId } = req.params;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);
        const isViewer = Boolean((req as any).isProjectViewer);

        if (isViewer || !isLeaderOrManager) {
            return sendResponse(res, 403, { error: "Only project leaders and managers can delete custom categories." });
        }

        const result = await projectsService.deleteProjectCategory(projectId, categoryId);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "category_deleted",
                categoryId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ==========================================
// PROJECT DOCUMENTS CONTROLLERS
// ==========================================

export async function getDocs(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const { categoryId, search } = req.query;
        const docs = await projectsService.getProjectDocs(projectId, {
            categoryId: categoryId as string,
            search: search as string,
        });
        sendResponse(res, 200, docs);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function createDoc(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isViewer = Boolean((req as any).isProjectViewer);

        if (!userId) {
            return sendResponse(res, 401, { error: "Authentication required." });
        }
        if (isViewer) {
            return sendResponse(res, 403, { error: "Viewers have read-only access and cannot create documents." });
        }

        const doc = await projectsService.createProjectDoc(projectId, req.body, userId);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "doc_created",
                docId: doc.id,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, doc);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateDoc(req: Request, res: Response) {
    try {
        const { projectId, docId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);
        const isViewer = Boolean((req as any).isProjectViewer);

        if (!userId) {
            return sendResponse(res, 401, { error: "Authentication required." });
        }
        if (isViewer) {
            return sendResponse(res, 403, { error: "Viewers have read-only access and cannot edit documents." });
        }

        const doc = await projectsService.updateProjectDoc(projectId, docId, req.body, userId, isLeaderOrManager);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "doc_updated",
                docId,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, doc);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteDoc(req: Request, res: Response) {
    try {
        const { projectId, docId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);
        const isViewer = Boolean((req as any).isProjectViewer);

        if (!userId) {
            return sendResponse(res, 401, { error: "Authentication required." });
        }
        if (isViewer) {
            return sendResponse(res, 403, { error: "Viewers have read-only access and cannot delete documents." });
        }

        await projectsService.deleteProjectDoc(projectId, docId, userId, isLeaderOrManager);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "doc_deleted",
                docId,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, { message: "Document deleted successfully." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

// ==========================================
// PROJECT LINKS CONTROLLERS
// ==========================================

export async function getLinks(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const { categoryId, search } = req.query;
        const links = await projectsService.getProjectLinks(projectId, {
            categoryId: categoryId as string,
            search: search as string,
        });
        sendResponse(res, 200, links);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function createLink(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isViewer = Boolean((req as any).isProjectViewer);

        if (!userId) {
            return sendResponse(res, 401, { error: "Authentication required." });
        }
        if (isViewer) {
            return sendResponse(res, 403, { error: "Viewers have read-only access and cannot add links." });
        }

        const link = await projectsService.createProjectLink(projectId, req.body, userId);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "link_created",
                linkId: link.id,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 201, link);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateLink(req: Request, res: Response) {
    try {
        const { projectId, linkId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);
        const isViewer = Boolean((req as any).isProjectViewer);

        if (!userId) {
            return sendResponse(res, 401, { error: "Authentication required." });
        }
        if (isViewer) {
            return sendResponse(res, 403, { error: "Viewers have read-only access and cannot edit links." });
        }

        const link = await projectsService.updateProjectLink(projectId, linkId, req.body, userId, isLeaderOrManager);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "link_updated",
                linkId,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, link);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteLink(req: Request, res: Response) {
    try {
        const { projectId, linkId } = req.params;
        const userId = (req.headers["x-user-id"] as string) || (req as any).user?.userId || (req as any).user?.id;
        const isLeaderOrManager = Boolean((req as any).isProjectManager || (req as any).isProjectLeader || (req as any).isWorkspaceLeader);
        const isViewer = Boolean((req as any).isProjectViewer);

        if (!userId) {
            return sendResponse(res, 401, { error: "Authentication required." });
        }
        if (isViewer) {
            return sendResponse(res, 403, { error: "Viewers have read-only access and cannot delete links." });
        }

        await projectsService.deleteProjectLink(projectId, linkId, userId, isLeaderOrManager);

        const project = (req as any).project || await prisma.project.findUnique({ where: { id: projectId } });
        if (project) {
            notifyTeam(project.teamId, "project_updated", {
                projectId,
                action: "link_deleted",
                linkId,
                userId,
                timestamp: Date.now(),
            });
        }

        sendResponse(res, 200, { message: "Link deleted successfully." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

