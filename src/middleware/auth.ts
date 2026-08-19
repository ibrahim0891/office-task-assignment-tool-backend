import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma, Role } from "../config/prisma";
import { sendResponse } from "../utils/response";
import { APP_CONFIG } from "../config/appConfig";

export const JWT_SECRET = APP_CONFIG.JWT_SECRET;

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
    // Exclude authentication routes from token validation
    if (req.path.startsWith("/api/auth/")) {
        return next();
    }

    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return sendResponse(res, 401, { error: "Access token required." });
    }

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
        if (err) {
            return sendResponse(res, 403, { error: "Invalid or expired token." });
        }
        (req as any).user = decoded;
        // Store user ID in x-user-id header for backward compatibility with downstream code
        req.headers["x-user-id"] = decoded.userId;
        next();
    });
}

// Middleware to require one of the allowed roles
export function requireRole(allowedRoles: Role[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const decoded = (req as any).user;
        if (!decoded) return sendResponse(res, 401, { error: "Authentication required." });

        const teamId = (req.headers["x-team-id"] as string) || req.body.teamId || req.query.teamId as string || req.params.teamId;
        if (!teamId) {
            return sendResponse(res, 400, { error: "Workspace team context is required." });
        }

        try {
            const membership = await prisma.userTeam.findUnique({
                where: { userId_teamId: { userId: decoded.userId, teamId } },
            });

            if (!membership) {
                return sendResponse(res, 403, { error: "Access denied. You are not a member of this workspace." });
            }

            if (!allowedRoles.includes(membership.role)) {
                return sendResponse(res, 403, { error: `Access denied. Requires one of: ${allowedRoles.join(", ")}` });
            }

            (req as any).userRole = membership.role;
            (req as any).workspaceTeamId = teamId;
            next();
        } catch (error: any) {
            sendResponse(res, 500, { error: error.message });
        }
    };
}

export const requireLeader = requireRole([Role.LEADER]);
export const requireWorkspaceMember = requireRole([Role.LEADER, Role.MEMBER]);

export async function enforceObserverRole(req: Request, res: Response, next: NextFunction) {
    if (!["POST", "PUT", "DELETE"].includes(req.method)) {
        return next();
    }
    if (req.path.startsWith("/api/auth/")) {
        return next();
    }

    // Allow Observers to create Knowledge Articles and Bookmarks
    if (req.method === "POST" && (req.path === "/api/knowledge" || req.path === "/api/bookmarks")) {
        return next();
    }

    // Allow Observers to delete tasks if they are the creator (handled in task owner middleware/service)
    if (req.method === "DELETE" && req.path.startsWith("/api/tasks/")) {
        return next();
    }

    const decoded = (req as any).user;
    if (!decoded) return next();

    const teamId = (req.headers["x-team-id"] as string) || req.body.teamId || req.query.teamId as string || req.params.teamId;
    if (!teamId) return next();

    try {
        const membership = await prisma.userTeam.findUnique({
            where: { userId_teamId: { userId: decoded.userId, teamId } },
        });

        if (membership && membership.role === Role.OBSERVER) {
            return sendResponse(res, 403, {
                error: "Observers have read-only access for tasks/boards and cannot modify task or board data.",
            });
        }
        next();
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function requireArticleOwnerOrLeader(req: Request, res: Response, next: NextFunction) {
    const decoded = (req as any).user;
    if (!decoded) return sendResponse(res, 401, { error: "Authentication required." });

    const { id } = req.params;
    try {
        const article = await prisma.knowledgeArticle.findUnique({ where: { id } });
        if (!article) return sendResponse(res, 404, { error: "Article not found." });

        const membership = await prisma.userTeam.findUnique({
            where: { userId_teamId: { userId: decoded.userId, teamId: article.teamId } },
        });

        if (!membership) {
            return sendResponse(res, 403, { error: "Access denied. You are not a member of this workspace." });
        }

        const isLeader = membership.role === Role.LEADER;
        const isCreator = article.createdById === decoded.userId;

        if (!isLeader && !isCreator) {
            return sendResponse(res, 403, { error: "Only the workspace leaders or the article creator can modify this article." });
        }

        (req as any).userRole = membership.role;
        (req as any).workspaceTeamId = article.teamId;
        next();
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message });
    }
}

export async function requireBookmarkOwnerOrLeader(req: Request, res: Response, next: NextFunction) {
    const decoded = (req as any).user;
    if (!decoded) return sendResponse(res, 401, { error: "Authentication required." });

    const { id } = req.params;
    try {
        const bookmark = await prisma.bookmark.findUnique({ where: { id } });
        if (!bookmark) return sendResponse(res, 404, { error: "Bookmark not found." });

        const membership = await prisma.userTeam.findUnique({
            where: { userId_teamId: { userId: decoded.userId, teamId: bookmark.teamId } },
        });

        if (!membership) {
            return sendResponse(res, 403, { error: "Access denied. You are not a member of this workspace." });
        }

        const isLeader = membership.role === Role.LEADER;
        const isCreator = bookmark.createdById === decoded.userId;

        if (!isLeader && !isCreator) {
            return sendResponse(res, 403, { error: "Only the workspace leaders or the bookmark creator can modify this bookmark." });
        }

        (req as any).userRole = membership.role;
        (req as any).workspaceTeamId = bookmark.teamId;
        next();
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message });
    }
}

export async function requireTaskOwnerOrLeaderOrAssignee(req: Request, res: Response, next: NextFunction) {
    const decoded = (req as any).user;
    if (!decoded) return sendResponse(res, 401, { error: "Authentication required." });

    const { taskId } = req.params;
    try {
        const task = await prisma.task.findUnique({ where: { id: taskId } });
        if (!task) return sendResponse(res, 404, { error: "Task not found." });

        const membership = await prisma.userTeam.findUnique({
            where: { userId_teamId: { userId: decoded.userId, teamId: task.teamId } },
        });

        if (!membership) {
            return sendResponse(res, 403, { error: "Access denied. You are not a member of this workspace." });
        }

        const isLeader = membership.role === Role.LEADER;
        const isCreator = task.createdById === decoded.userId;
        const isAssignee = task.assignedToId === decoded.userId;

        if (!isLeader && !isCreator && !isAssignee) {
            return sendResponse(res, 403, { error: "Only the workspace leader, task creator, or assignee can modify this task." });
        }

        (req as any).userRole = membership.role;
        (req as any).workspaceTeamId = task.teamId;
        next();
    } catch (e: any) {
        sendResponse(res, 500, { error: e.message });
    }
}

export async function requireCommentOwner(req: Request, res: Response, next: NextFunction) {
    const decoded = (req as any).user;
    if (!decoded) return sendResponse(res, 401, { error: "Authentication required." });

    const { commentId } = req.params;
    try {
        const comment = await prisma.comment.findUnique({ where: { id: commentId } });
        if (!comment) {
            return sendResponse(res, 404, { error: "Comment not found." });
        }

        if (comment.userId !== decoded.userId) {
            return sendResponse(res, 403, { error: "Only the comment author can manage this comment." });
        }

        next();
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function requireCommentOwnerOrTaskOwnerOrAssignee(req: Request, res: Response, next: NextFunction) {
    const decoded = (req as any).user;
    if (!decoded) return sendResponse(res, 401, { error: "Authentication required." });

    const { taskId, commentId } = req.params;
    try {
        const comment = await prisma.comment.findUnique({ where: { id: commentId } });
        if (!comment) {
            return sendResponse(res, 404, { error: "Comment not found." });
        }

        const task = await prisma.task.findUnique({ where: { id: taskId } });
        if (!task) {
            return sendResponse(res, 404, { error: "Task not found." });
        }

        const isCommentOwner = comment.userId === decoded.userId;
        const isTaskOwner = task.createdById === decoded.userId;
        const isTaskAssignee = task.assignedToId === decoded.userId;

        if (!isCommentOwner && !isTaskOwner && !isTaskAssignee) {
            return sendResponse(res, 403, { error: "Only the comment author, task author, or task assignee can resolve/reopen this comment." });
        }

        next();
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}

export async function resolveWorkspaceContext(req: Request, res: Response, next: NextFunction) {
    const decoded = (req as any).user;
    if (!decoded) return sendResponse(res, 401, { error: "Authentication required." });

    const teamId = (req.headers["x-team-id"] as string) || req.body.teamId || req.query.teamId as string || req.params.teamId;
    if (!teamId) {
        return sendResponse(res, 400, { error: "Workspace team context is required." });
    }

    try {
        const membership = await prisma.userTeam.findUnique({
            where: { userId_teamId: { userId: decoded.userId, teamId } },
        });

        if (!membership) {
            return sendResponse(res, 403, { error: "Access denied. You are not a member of this workspace." });
        }

        (req as any).userRole = membership.role;
        (req as any).workspaceTeamId = teamId;
        next();
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
}
