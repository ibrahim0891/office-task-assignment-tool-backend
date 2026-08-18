import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as usersService from "./users.service";
import * as authService from "../auth/auth.service";
import { prisma } from "../../config/prisma";

export const getExcludeTeam = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    try {
        const users = await usersService.getUsersExcludeTeam(teamId);
        sendResponse(res, 200, users);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const getUsers = async (req: Request, res: Response) => {
    const { search } = req.query;
    try {
        const users = await usersService.queryUsers(search as string);
        sendResponse(res, 200, users);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const getProfile = async (req: Request, res: Response) => {
    try {
        const user = await usersService.getUserProfileById(req.params.userId);
        sendResponse(res, 200, user);
    } catch (error: any) {
        if (error.message === "User not found.") {
            return sendResponse(res, 404, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const updateProfile = async (req: Request, res: Response) => {
    const { userId } = req.params;
    try {
        const updatedUser = await usersService.updateUserProfileById(
            userId,
            req.body,
        );
        sendResponse(res, 200, updatedUser);
    } catch (error: any) {
        if (error.message === "User not found") {
            return sendResponse(res, 404, { error: error.message });
        }
        console.error("Error updating user profile:", error);
        sendResponse(res, 500, {
            error: error.message || "Failed to update profile",
        });
    }
};

export const getTeams = async (req: Request, res: Response) => {
    const userId =
        (req.query.userId as string) || (req.headers["x-user-id"] as string);
    try {
        const teams = await usersService.getUserTeams(userId);
        sendResponse(res, 200, teams);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const removeMember = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { userId } = req.body;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        const reassignedCount = await usersService.removeMember(
            teamId,
            userId,
            actingUserId,
        );
        sendResponse(res, 200, {
            message:
                "Member removed successfully, and active tasks reassigned.",
            reassignedCount,
        });
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const addMember = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { userId, role } = req.body;

    try {
        const membership = await usersService.addMember(teamId, userId, role);
        sendResponse(res, 200, membership);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const inviteMember = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { email, role } = req.body;

    try {
        const result = await usersService.inviteByEmail(teamId, email, role);
        sendResponse(res, 200, {
            message: "User invited successfully.",
            membership: result.membership,
            user: result.user,
        });
    } catch (error: any) {
        if (
            error.message === "Email address is required." ||
            error.message === "User is already a member of this workspace." ||
            error.message.includes("No registered account")
        ) {
            return sendResponse(res, 400, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const createTeam = async (req: Request, res: Response) => {
    const { name, creatorId } = req.body;
    try {
        const team = await usersService.createNewTeam(name, creatorId);

        // Refresh token to include the new workspace/role
        const user = await prisma.user.findUnique({ where: { id: creatorId } });
        if (user) {
            const token = await authService.generateToken(user);
            res.setHeader("x-refresh-token", token);
            res.setHeader("Access-Control-Expose-Headers", "x-refresh-token");
        }

        sendResponse(res, 200, team);
    } catch (error: any) {
        sendResponse(res, 500, { error: error.message });
    }
};

export const updateTeamName = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { name } = req.body;

    try {
        const updatedTeam = await usersService.updateTeam(teamId, name);
        sendResponse(res, 200, updatedTeam);
    } catch (error: any) {
        if (error.message === "Team name is required.") {
            return sendResponse(res, 400, { error: error.message });
        }
        sendResponse(res, 500, {
            error: error.message || "Failed to update workspace name",
        });
    }
};

export const deleteTeam = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { password, confirmationText } = req.body;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        await usersService.deleteTeamCascading(
            teamId,
            password,
            confirmationText,
            actingUserId,
        );

        // Refresh token to exclude the deleted workspace
        const user = await prisma.user.findUnique({
            where: { id: actingUserId },
        });
        if (user) {
            const token = await authService.generateToken(user);
            res.setHeader("x-refresh-token", token);
            res.setHeader("Access-Control-Expose-Headers", "x-refresh-token");
        }

        sendResponse(res, 200, {
            success: true,
            message: "Workspace deleted successfully.",
        });
    } catch (error: any) {
        if (
            error.message === "User authentication required." ||
            error.message === "Incorrect password. Workspace deletion aborted."
        ) {
            return sendResponse(res, 401, { error: error.message });
        }
        if (
            error.message ===
            'Confirmation text must match "I know what I\'m doing" exactly.'
        ) {
            return sendResponse(res, 400, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const updateMemberRole = async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { userId, role } = req.body;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        const updatedMembership = await usersService.updateMemberRole(
            teamId,
            userId,
            role,
            actingUserId,
        );
        sendResponse(res, 200, updatedMembership);
    } catch (error: any) {
        if (error.message === "You cannot change your own role.") {
            return sendResponse(res, 403, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};
