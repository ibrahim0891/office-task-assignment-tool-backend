import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as columnsService from "./columns.service";

export const getColumns = async (req: Request, res: Response) => {
    const { teamId } = req.params;

    try {
        const columns = await columnsService.getColumnsByTeamId(teamId);
        sendResponse(res, 200, columns);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const sync = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { columns } = req.body;

    try {
        const results = await columnsService.syncColumns(teamId, columns);
        sendResponse(res, 200, results);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const deleteColumn = async (req: Request, res: Response) => {
    const { teamId, columnId } = req.params;

    try {
        const fallbackColName = await columnsService.deleteColumnItem(teamId, columnId);
        sendResponse(res, 200, {
            message: "Column deleted. Existing tasks moved to " + fallbackColName,
        });
    } catch (error: any) {
        if (error.message === "Cannot delete the last column of a board.") {
            return sendResponse(res, 400, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};
