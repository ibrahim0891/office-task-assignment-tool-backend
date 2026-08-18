import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as knowledgeService from "./knowledge.service";

export const getArticles = async (req: Request, res: Response) => {
    const { teamId } = req.query;
    if (!teamId) return sendResponse(res, 400, { error: "teamId required" });

    try {
        const articles = await knowledgeService.getArticlesByTeamId(String(teamId));
        sendResponse(res, 200, articles);
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to fetch articles" });
    }
};

export const createArticle = async (req: Request, res: Response) => {
    const { teamId, title, content, createdById } = req.body;
    if (!teamId || !title || !createdById) {
        return sendResponse(res, 400, { error: "teamId, title, createdById required" });
    }

    try {
        const article = await knowledgeService.createArticleItem({
            teamId,
            title,
            content,
            createdById,
        });
        sendResponse(res, 200, article);
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to create article" });
    }
};

export const updateArticle = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, content } = req.body;

    try {
        const article = await knowledgeService.updateArticleItem(id, {
            title,
            content,
        });
        sendResponse(res, 200, article);
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to update article" });
    }
};

export const deleteArticle = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await knowledgeService.deleteArticleItem(id);
        sendResponse(res, 200, { success: true });
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message || "Failed to delete article" });
    }
};
