import { prisma } from "../../config/prisma";

export const getFoldersByTeamId = async (teamId: string) => {
    let folders = await prisma.folder.findMany({
        where: { teamId },
        include: { projects: true },
        orderBy: { createdAt: "asc" },
    });

    if (folders.length === 0) {
        // Create the initial default folder
        const defaultFolder = await prisma.folder.create({
            data: {
                teamId,
                name: "New Folder",
            },
        });
        // Associate all existing projects of this team with this default folder
        await prisma.project.updateMany({
            where: { teamId, folderId: null },
            data: { folderId: defaultFolder.id },
        });

        // Re-fetch folders with projects included
        folders = await prisma.folder.findMany({
            where: { teamId },
            include: { projects: true },
            orderBy: { createdAt: "asc" },
        });
    } else {
        // Ensure projects with null folderId are assigned to the oldest/default folder
        const orphanedProjectsCount = await prisma.project.count({
            where: { teamId, folderId: null },
        });
        if (orphanedProjectsCount > 0) {
            const defaultFolder = folders[0];
            await prisma.project.updateMany({
                where: { teamId, folderId: null },
                data: { folderId: defaultFolder.id },
            });
            // Re-fetch folders with projects
            folders = await prisma.folder.findMany({
                where: { teamId },
                include: { projects: true },
                orderBy: { createdAt: "asc" },
            });
        }
    }
    return folders;
};

export const createFolderItem = async (teamId: string, name: string, emoji?: string) => {
    if (!name || !name.trim()) throw new Error("Folder name is required.");
    return prisma.folder.create({
        data: {
            teamId,
            name: name.trim(),
            emoji: emoji || "📁",
        },
        include: { projects: true },
    });
};

export const updateFolderItem = async (id: string, name?: string, emoji?: string) => {
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
        include: { projects: true },
    });
};

export const deleteFolderItem = async (id: string, teamId: string) => {
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
