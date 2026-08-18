import { prisma } from "../../config/prisma";

export const getBookmarksByTeamId = async (teamId: string) => {
    return prisma.bookmark.findMany({
        where: { teamId },
        include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: "desc" },
    });
};

export const createBookmarkItem = async (data: {
    teamId: string;
    title: string;
    url: string;
    description?: string;
    createdById: string;
}) => {
    return prisma.bookmark.create({
        data,
        include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
};

export const updateBookmarkItem = async (
    id: string,
    data: {
        title: string;
        url: string;
        description?: string;
    }
) => {
    return prisma.bookmark.update({
        where: { id },
        data,
        include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
};

export const deleteBookmarkItem = async (id: string) => {
    return prisma.bookmark.delete({
        where: { id },
    });
};
