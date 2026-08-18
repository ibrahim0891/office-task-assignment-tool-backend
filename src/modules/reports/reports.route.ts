import { Router } from "express";
import * as reportsController from "./reports.controller";

const router = Router();

router.get("/reports", reportsController.getReport);
router.get("/reports/export", reportsController.exportCsv);

export default router;
