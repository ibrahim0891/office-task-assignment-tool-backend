import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as pushService from "./push.service";

export const subscribe = async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"] as string;
    const { subscription } = req.body;

    if (!userId) {
        return sendResponse(res, 401, { error: "Unauthorized. x-user-id header is missing." });
    }

    if (!subscription) {
        return sendResponse(res, 400, { error: "Subscription object is required." });
    }

    try {
        await pushService.subscribeUser(userId, subscription);
        sendResponse(res, 200, { success: true });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const unsubscribe = async (req: Request, res: Response) => {
    const { endpoint } = req.body;

    if (!endpoint) {
        return sendResponse(res, 400, { error: "Endpoint string is required." });
    }

    try {
        await pushService.unsubscribeUser(endpoint);
        sendResponse(res, 200, { success: true });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};
