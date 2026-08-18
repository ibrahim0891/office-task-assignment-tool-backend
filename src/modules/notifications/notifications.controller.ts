import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as notificationsService from "./notifications.service";

export const getNotifications = async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"] as string;

    try {
        // Purge notifications archived over 30 days ago
        await notificationsService.purgeOldArchivedNotifications(userId);

        // Fetch remaining notifications
        const notifications = await notificationsService.getNotificationsByUserId(userId);
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
