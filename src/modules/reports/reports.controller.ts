import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import { getLocalDateString } from "../../utils/date";
import * as reportsService from "./reports.service";

export const getReport = async (req: Request, res: Response) => {
    const { teamId, startDate, endDate, daysFromToday, memberId } = req.query;
    const clientToday = req.headers["x-client-today"] as string || (req.query.clientToday as string);

    if (!teamId) {
        return sendResponse(res, 400, { error: "teamId is required." });
    }

    try {
        const report = await reportsService.generateReport(
            teamId as string,
            daysFromToday as string,
            startDate as string,
            endDate as string,
            memberId as string,
            clientToday
        );
        sendResponse(res, 200, report);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const exportCsv = async (req: Request, res: Response) => {
    const { teamId, startDate, endDate, daysFromToday, memberId } = req.query;
    const clientToday = req.headers["x-client-today"] as string || (req.query.clientToday as string);

    if (!teamId) {
        return sendResponse(res, 400, { error: "teamId is required." });
    }

    try {
        const csv = await reportsService.generateCsvExport(
            teamId as string,
            daysFromToday as string,
            startDate as string,
            endDate as string,
            memberId as string,
            clientToday
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

