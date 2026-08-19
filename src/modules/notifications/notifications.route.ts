import { Router } from "express";
import * as notificationsController from "./notifications.controller";

const router = Router();

router.get("/notifications", notificationsController.getNotifications);
router.put("/notifications/clear-all", notificationsController.clearAll);
router.put("/notifications/:id/archive", notificationsController.archive);
router.put("/notifications/:id/read", notificationsController.markAsRead);
router.delete("/notifications/archived", notificationsController.deleteArchived);

export default router;
