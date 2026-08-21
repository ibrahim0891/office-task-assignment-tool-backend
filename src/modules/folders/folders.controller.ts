import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as foldersService from "./folders.service";

export const getFolders = async (req: Request, res: Response) => {
    const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string);
    if (!teamId) return sendResponse(res, 400, { error: "teamId required" });

    try {
        const folders = await foldersService.getFoldersByTeamId(teamId);
        sendResponse(res, 200, folders);
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to fetch folders" });
    }
};

export const createFolder = async (req: Request, res: Response) => {
    const teamId = (req.body.teamId as string) || (req.headers["x-team-id"] as string);
    const { name, emoji } = req.body;
    if (!teamId || !name) {
        return sendResponse(res, 400, { error: "teamId and name required" });
    }

    try {
        const folder = await foldersService.createFolderItem(teamId, name, emoji);
        sendResponse(res, 200, folder);
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to create folder" });
    }
};

export const updateFolder = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, emoji } = req.body;
    if (!id || (name === undefined && emoji === undefined)) {
        return sendResponse(res, 400, { error: "folder ID and at least name or emoji required" });
    }

    try {
        const folder = await foldersService.updateFolderItem(id, name, emoji);
        sendResponse(res, 200, folder);
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to update folder" });
    }
};

export const deleteFolder = async (req: Request, res: Response) => {
    const { id } = req.params;
    const teamId = (req.query.teamId as string) || (req.headers["x-team-id"] as string);
    if (!id || !teamId) {
        return sendResponse(res, 400, { error: "folder ID and teamId required" });
    }

    try {
        const deleted = await foldersService.deleteFolderItem(id, teamId);
        sendResponse(res, 200, deleted);
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to delete folder" });
    }
};
