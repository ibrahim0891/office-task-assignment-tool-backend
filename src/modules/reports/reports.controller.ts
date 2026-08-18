import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import { getLocalDateString } from "../../utils/date";
import * as reportsService from "./reports.service";

export const getReport = async (req: Request, res: Response) => {
    const { teamId, startDate, endDate, daysFromToday } = req.query;

    if (!teamId) {
        return sendResponse(res, 400, { error: "teamId is required." });
    }

    try {
        const report = await reportsService.generateReport(
            teamId as string,
            daysFromToday as string,
            startDate as string,
            endDate as string
        );
        sendResponse(res, 200, report);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const exportCsv = async (req: Request, res: Response) => {
    const { teamId, startDate, endDate, daysFromToday } = req.query;

    if (!teamId) {
        return sendResponse(res, 400, { error: "teamId is required." });
    }

    try {
        const csv = await reportsService.generateCsvExport(
            teamId as string,
            daysFromToday as string,
            startDate as string,
            endDate as string
        );

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="task-report-${getLocalDateString(new Date())}.csv"`
        );
        res.status(200).send(csv);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};
