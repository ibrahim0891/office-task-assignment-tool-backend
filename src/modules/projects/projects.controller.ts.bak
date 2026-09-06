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
        const deleted = await projectsService.deleteProject(projectId);

        notifyTeam(deleted.teamId, "project_deleted", {
            projectId: deleted.id,
            timestamp: Date.now(),
        });

        sendResponse(res, 200, { message: "Project deleted successfully." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
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
        sendResponse(res, 200, member);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function removeMember(req: Request, res: Response) {
    try {
        const { memberId } = req.params;
        const actingUserId = (req.headers["x-user-id"] as string) || (req as any).user?.id;
        await projectsService.removeProjectMember(memberId, actingUserId);
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
        sendResponse(res, 201, task);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function updateTask(req: Request, res: Response) {
    try {
        const { taskId } = req.params;
        const task = await projectsService.updateProjectTask(taskId, req.body);
        sendResponse(res, 200, task);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteTask(req: Request, res: Response) {
    try {
        const { taskId } = req.params;
        await projectsService.deleteProjectTask(taskId);
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
        await projectsService.deleteProjectSubtask(subtaskId, actingUserId);
        sendResponse(res, 200, { message: "Subtask deleted." });
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
        sendResponse(res, 201, dependency);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteDependency(req: Request, res: Response) {
    try {
        const { dependencyId } = req.params;
        await projectsService.deleteTaskDependency(dependencyId);
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
        sendResponse(res, 200, column);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
}

export async function deleteColumn(req: Request, res: Response) {
    try {
        const { columnId } = req.params;
        const result = await projectsService.deleteProjectColumn(columnId);
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
