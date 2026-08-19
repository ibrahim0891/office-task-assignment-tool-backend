import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as tasksService from "./tasks.service";
import { prisma } from "../../config/prisma";

export const getTasks = async (req: Request, res: Response) => {
    const actingUserId = req.headers["x-user-id"] as string;
    const userRole = (req as any).userRole;
    const isMember = userRole === "MEMBER";

    try {
        const tasks = await tasksService.getTasksList(req.query, actingUserId, userRole);
        sendResponse(res, 200, tasks);
    } catch (error: any) {
        if (error.message === "teamId is required.") {
            return sendResponse(res, 400, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

import { notifyTeam, notifyTeamExclude } from "../../config/socket";

export const createTask = async (req: Request, res: Response) => {
    const userRole = (req as any).userRole;
    const isMember = userRole === "MEMBER";

    try {
        const task = await tasksService.createTaskItem(req.body, isMember);
        const creatingUserId = req.body.createdById || (req.headers["x-user-id"] as string);
        notifyTeam(task.teamId, "task_updated", {
            action: "create",
            taskId: task.id,
            actingUserId: creatingUserId,
            clientId: req.body.clientId,
            timestamp: Date.now(),
        });
        sendResponse(res, 201, task);
    } catch (error: any) {
        if (error.message.includes("Standard members can only assign tasks")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const updateTask = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;
    const userRole = (req as any).userRole;
    const isMember = userRole === "MEMBER";

    try {
        const task = await tasksService.updateTaskItem(taskId, req.body, actingUserId, isMember);
        notifyTeam(task.teamId, "task_updated", {
            action: "update",
            taskId: task.id,
            columnId: task.columnId,
            actingUserId,
            clientId: req.body.clientId,
            timestamp: Date.now(),
        });
        sendResponse(res, 200, task);
    } catch (error: any) {
        if (error.message === "Task not found.") {
            return sendResponse(res, 404, { error: error.message });
        }
        if (error.message.includes("Only the task creator") || error.message.includes("assign tasks to themselves")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const softDeleteTask = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const actingUserId = (req.headers["x-user-id"] as string) || (req as any).user?.userId;

    try {
        const result = await tasksService.softDeleteTaskItem(taskId, actingUserId);
        const workspaceTeamId = (req as any).workspaceTeamId || result.teamId;
        if (workspaceTeamId) {
            notifyTeam(workspaceTeamId, "task_updated", {
                action: "delete",
                taskId,
                actingUserId,
                clientId: req.body.clientId,
                timestamp: Date.now(),
            });
        }
        sendResponse(res, 200, result);
    } catch (error: any) {
        if (error.message === "Task not found.") {
            return sendResponse(res, 404, { error: error.message });
        }
        if (error.message.includes("Only") || error.message.includes("Access denied")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const restoreTask = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const actingUserId = (req.headers["x-user-id"] as string) || (req as any).user?.userId;

    try {
        const task = await tasksService.restoreTaskItem(taskId, actingUserId);
        sendResponse(res, 200, task);
    } catch (error: any) {
        if (error.message.includes("Access denied")) {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const permanentDeleteTask = async (req: Request, res: Response) => {
    const { taskId } = req.params;

    try {
        await tasksService.permanentDeleteTaskItem(taskId);
        sendResponse(res, 200, { message: "Task permanently deleted." });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const createChecklistItem = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const { title } = req.body;

    try {
        const item = await tasksService.createChecklist(taskId, title);
        sendResponse(res, 201, item);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const updateChecklistItem = async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const { isCompleted } = req.body;

    try {
        const item = await tasksService.updateChecklist(itemId, isCompleted);
        sendResponse(res, 200, item);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const deleteChecklistItem = async (req: Request, res: Response) => {
    const { itemId } = req.params;

    try {
        await tasksService.deleteChecklist(itemId);
        sendResponse(res, 200, { message: "Checklist item deleted." });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const getComments = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const page = parseInt(req.query.page as string || "1", 10);
    const limit = parseInt(req.query.limit as string || "15", 10);

    try {
        const result = await tasksService.getTaskComments(taskId, page, limit);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const createComment = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const { userId, content } = req.body;

    try {
        const comment = await tasksService.createTaskComment(taskId, userId, content);
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { teamId: true } });
        if (task) {
            notifyTeam(task.teamId, "task_updated", {
                action: "comment_created",
                taskId,
                actingUserId: userId,
                timestamp: Date.now(),
            });
        }
        sendResponse(res, 201, comment);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const deleteComment = async (req: Request, res: Response) => {
    const { taskId, commentId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        await tasksService.deleteTaskComment(taskId, commentId, actingUserId);
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { teamId: true } });
        if (task) {
            notifyTeam(task.teamId, "task_updated", {
                action: "comment_deleted",
                taskId,
                actingUserId,
                timestamp: Date.now(),
            });
        }
        sendResponse(res, 200, { message: "Comment deleted." });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const resolveComment = async (req: Request, res: Response) => {
    const { taskId, commentId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        const comment = await tasksService.resolveTaskComment(taskId, commentId, actingUserId);
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { teamId: true } });
        if (task) {
            notifyTeam(task.teamId, "task_updated", {
                action: "comment_resolved",
                taskId,
                actingUserId,
                timestamp: Date.now(),
            });
        }
        sendResponse(res, 200, comment);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const reopenComment = async (req: Request, res: Response) => {
    const { taskId, commentId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        const comment = await tasksService.reopenTaskComment(taskId, commentId, actingUserId);
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { teamId: true } });
        if (task) {
            notifyTeam(task.teamId, "task_updated", {
                action: "comment_reopened",
                taskId,
                actingUserId,
                timestamp: Date.now(),
            });
        }
        sendResponse(res, 200, comment);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const createAttachment = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const { name, url, type } = req.body;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        const attachment = await tasksService.createAttachmentItem(taskId, name, url, type, actingUserId);
        sendResponse(res, 201, attachment);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const uploadImage = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const { imageBase64, filename, userId } = req.body;

    try {
        const attachment = await tasksService.uploadAttachmentImage(taskId, imageBase64, filename, userId);
        sendResponse(res, 201, attachment);
    } catch (error: any) {
        if (error.message === "imageBase64 is required.") {
            return sendResponse(res, 400, { error: error.message });
        }
        if (error.message === "Task not found.") {
            return sendResponse(res, 404, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const deleteAttachment = async (req: Request, res: Response) => {
    const { attachmentId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        await tasksService.deleteAttachmentItem(attachmentId, actingUserId);
        sendResponse(res, 200, { message: "Attachment deleted successfully." });
    } catch (error: any) {
        if (error.message === "Attachment not found.") {
            return sendResponse(res, 404, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const getTask = async (req: Request, res: Response) => {
    const { taskId } = req.params;
    try {
        const task = await tasksService.getTaskItem(taskId);
        if (!task) {
            return sendResponse(res, 404, { error: "Task not found." });
        }
        sendResponse(res, 200, task);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};
