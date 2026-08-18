import { Router } from "express";
import * as knowledgeController from "./knowledge.controller";
import { requireLeader, requireArticleOwnerOrLeader, resolveWorkspaceContext } from "../../middleware/auth";

const router = Router();

router.get("/knowledge", resolveWorkspaceContext, knowledgeController.getArticles);
router.post("/knowledge", resolveWorkspaceContext, knowledgeController.createArticle);
router.put("/knowledge/:id", requireArticleOwnerOrLeader, knowledgeController.updateArticle);
router.delete("/knowledge/:id", requireArticleOwnerOrLeader, knowledgeController.deleteArticle);

export default router;
