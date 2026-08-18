import { Router } from "express";
import * as bookmarkController from "./bookmarks.controller";
import { resolveWorkspaceContext, requireBookmarkOwnerOrLeader } from "../../middleware/auth";

const router = Router();

router.get("/bookmarks", resolveWorkspaceContext, bookmarkController.getBookmarks);
router.post("/bookmarks", resolveWorkspaceContext, bookmarkController.createBookmark);
router.put("/bookmarks/:id", requireBookmarkOwnerOrLeader, bookmarkController.updateBookmark);
router.delete("/bookmarks/:id", requireBookmarkOwnerOrLeader, bookmarkController.deleteBookmark);

export default router;
