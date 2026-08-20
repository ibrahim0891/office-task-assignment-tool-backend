import { Router } from "express";
import * as pushController from "./push.controller";

const router = Router();

router.post("/push-subscriptions", pushController.subscribe);
router.post("/push-subscriptions/unsubscribe", pushController.unsubscribe);

export default router;
