import { prisma } from "../../config/prisma";

const ensureWorkspaceFolderSetup = async (teamId: string) => {
    const totalCount = await prisma.folder.count({ where: { teamId } });
    if (totalCount === 0) {
        // Create the initial default folder
        const defaultFolder = await prisma.folder.create({
            data: {
                teamId,
                name: "New Folder",
            },
        });
        // Associate all unparented projects of this team with the default folder
        await prisma.project.updateMany({
            where: { teamId, folderId: null },
            data: { folderId: defaultFolder.id },
        });
    } else {
        // Ensure any projects with null folderId are assigned to the oldest/default folder
        const orphanedProjectsCount = await prisma.project.count({
            where: { teamId, folderId: null },
        });
        if (orphanedProjectsCount > 0) {
            const defaultFolder = await prisma.folder.findFirst({
                where: { teamId },
                orderBy: { createdAt: "asc" },
            });
            if (defaultFolder) {
                await prisma.project.updateMany({
                    where: { teamId, folderId: null },
                    data: { folderId: defaultFolder.id },
                });
            }
        }
    }
};

export const getFoldersByTeamId = async (
    teamId: string,
    userId?: string,
    isWorkspaceLeader?: boolean
) => {
    await ensureWorkspaceFolderSetup(teamId);

    // If workspace leader or no specific user context, return all folders with all non-deleted projects
    if (isWorkspaceLeader || !userId) {
        return await prisma.folder.findMany({
            where: { teamId },
            include: {
                projects: {
                    where: { isDeleted: false },
                    include: { members: true },
                },
                creator: {
                    select: { id: true, name: true, fullName: true, avatarUrl: true },
                },
            },
            orderBy: { createdAt: "asc" },
        });
    }

    // Option 1 (Access-Scoped Visibility):
    // A regular member sees a folder IF:
    // 1. They created the folder (creatorId === userId), OR
    // 2. The folder contains at least 1 active non-deleted project accessible to them (as manager or assigned member).
    const userAccessibleProjectWhere = {
        isDeleted: false,
        OR: [
            { managerId: userId },
            { members: { some: { userId } } },
        ],
    };

    return await prisma.folder.findMany({
        where: {
            teamId,
            OR: [
                { creatorId: userId },
                {
                    projects: {
                        some: userAccessibleProjectWhere,
                    },
                },
            ],
        },
        include: {
            projects: {
                where: userAccessibleProjectWhere,
                include: { members: true },
            },
            creator: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
        orderBy: { createdAt: "asc" },
    });
};

export const createFolderItem = async (
    teamId: string,
    name: string,
    emoji?: string,
    creatorId?: string
) => {
    if (!name || !name.trim()) throw new Error("Folder name is required.");
    return prisma.folder.create({
        data: {
            teamId,
            name: name.trim(),
            emoji: emoji || "📁",
            creatorId: creatorId || null,
        },
        include: {
            projects: { where: { isDeleted: false } },
            creator: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
};

export const updateFolderItem = async (
    id: string,
    name?: string,
    emoji?: string,
    actingUserId?: string,
    isWorkspaceLeader?: boolean
) => {
    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder) throw new Error("Folder not found.");

    // Option 1 Rule: Only folder creator or workspace leader can rename/edit folder
    const canManage = isWorkspaceLeader || (actingUserId && folder.creatorId === actingUserId);
    if (!canManage) {
        throw new Error("Permission denied. Only the folder creator or workspace owner can rename or edit this folder.");
    }

    const updateData: any = {};
    if (name !== undefined) {
        if (!name.trim()) throw new Error("Folder name is required.");
        updateData.name = name.trim();
    }
    if (emoji !== undefined) {
        updateData.emoji = emoji;
    }
    return prisma.folder.update({
        where: { id },
        data: updateData,
        include: {
            projects: { where: { isDeleted: false } },
            creator: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
};

export const deleteFolderItem = async (
    id: string,
    teamId: string,
    actingUserId?: string,
    isWorkspaceLeader?: boolean
) => {
    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder) throw new Error("Folder not found.");

    // Option 1 Rule: Only folder creator or workspace leader can delete folder
    const canManage = isWorkspaceLeader || (actingUserId && folder.creatorId === actingUserId);
    if (!canManage) {
        throw new Error("Permission denied. Only the folder creator or workspace owner can delete this folder.");
    }

    const folders = await prisma.folder.findMany({
        where: { teamId },
        orderBy: { createdAt: "asc" },
    });

    if (folders.length <= 1) {
        throw new Error("Cannot delete the only folder in the workspace.");
    }

    const defaultFolder = folders[0];
    if (defaultFolder.id === id) {
        throw new Error("Cannot delete the default folder.");
    }

    // Move all projects in this folder to the default folder
    await prisma.project.updateMany({
        where: { folderId: id },
        data: { folderId: defaultFolder.id },
    });

    // Delete the folder
    return prisma.folder.delete({
        where: { id },
    });
};
