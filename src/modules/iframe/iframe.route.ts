import { Router } from "express";
import * as iframeController from "./iframe.controller";

const router = Router();

router.get("/iframe-proxy", iframeController.proxy);

export default router;
