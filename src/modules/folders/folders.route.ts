import { Router } from "express";
import * as foldersController from "./folders.controller";
import { resolveWorkspaceContext } from "../../middleware/auth";

const router = Router();

router.get("/folders", resolveWorkspaceContext, foldersController.getFolders);
router.post("/folders", resolveWorkspaceContext, foldersController.createFolder);
router.put("/folders/:id", resolveWorkspaceContext, foldersController.updateFolder);
router.delete("/folders/:id", resolveWorkspaceContext, foldersController.deleteFolder);

export default router;
