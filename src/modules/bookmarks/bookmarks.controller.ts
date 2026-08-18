import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as bookmarkService from "./bookmarks.service";

export const getBookmarks = async (req: Request, res: Response) => {
    const { teamId } = req.query;
    if (!teamId) return sendResponse(res, 400, { error: "teamId required" });

    try {
        const bookmarks = await bookmarkService.getBookmarksByTeamId(String(teamId));
        sendResponse(res, 200, bookmarks);
    } catch (e) {
        sendResponse(res, 500, { error: "Failed to fetch bookmarks" });
    }
};

export const createBookmark = async (req: Request, res: Response) => {
    const { teamId, title, url, description, createdById } = req.body;
    if (!teamId || !title || !url || !createdById) {
        return sendResponse(res, 400, { error: "teamId, title, url, createdById required" });
    }

    try {
        const bookmark = await bookmarkService.createBookmarkItem({
            teamId,
            title,
            url,
            description,
            createdById,
        });
        sendResponse(res, 200, bookmark);
    } catch (e) {
        sendResponse(res, 500, { error: "Failed to create bookmark" });
    }
};

export const updateBookmark = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, url, description } = req.body;

    try {
        const bookmark = await bookmarkService.updateBookmarkItem(id, {
            title,
            url,
            description,
        });
        sendResponse(res, 200, bookmark);
    } catch (e) {
        sendResponse(res, 500, { error: "Failed to update bookmark" });
    }
};

export const deleteBookmark = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await bookmarkService.deleteBookmarkItem(id);
        sendResponse(res, 200, { success: true });
    } catch (e) {
        sendResponse(res, 500, { error: "Failed to delete bookmark" });
    }
};
