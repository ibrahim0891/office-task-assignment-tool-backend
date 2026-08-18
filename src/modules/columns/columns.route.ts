import { Router } from "express";
import * as columnsController from "./columns.controller";

const router = Router();

router.get("/teams/:teamId/columns", columnsController.getColumns);
router.post("/teams/:teamId/columns", columnsController.sync);
router.delete("/teams/:teamId/columns/:columnId", columnsController.deleteColumn);

export default router;
