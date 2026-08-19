import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as notificationsService from "./notifications.service";

export const getNotifications = async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"] as string;
    const teamId = req.query.teamId as string;
    const page = parseInt(req.query.page as string || "1", 10);
    const limit = parseInt(req.query.limit as string || "10", 10);

    if (!teamId) {
        return sendResponse(res, 400, { error: "teamId is required" });
    }

    try {
        // Purge notifications archived over 30 days ago
        await notificationsService.purgeOldArchivedNotifications(userId);

        // Fetch remaining notifications
        const notifications = await notificationsService.getNotificationsByUserId(userId, teamId, page, limit);
        sendResponse(res, 200, notifications);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const clearAll = async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"] as string;

    try {
        await notificationsService.clearAllNotifications(userId);
        sendResponse(res, 200, {
            message: "All notifications cleared and archived for 30 days.",
        });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const deleteArchived = async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"] as string;

    try {
        await notificationsService.deleteArchivedNotifications(userId);
        sendResponse(res, 200, {
            message: "Archived notifications permanently deleted.",
        });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const archive = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const notification = await notificationsService.archiveNotification(id);
        sendResponse(res, 200, notification);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const markAsRead = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const notification = await notificationsService.markNotificationAsRead(id);
        sendResponse(res, 200, notification);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};
