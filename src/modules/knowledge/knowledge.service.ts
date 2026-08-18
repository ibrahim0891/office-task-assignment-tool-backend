import { prisma } from "../../config/prisma";

export const getArticlesByTeamId = async (teamId: string) => {
    return prisma.knowledgeArticle.findMany({
        where: { teamId },
        include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { updatedAt: "desc" },
    });
};

export const createArticleItem = async (data: {
    teamId: string;
    title: string;
    content?: string;
    createdById: string;
}) => {
    return prisma.knowledgeArticle.create({
        data: {
            teamId: data.teamId,
            title: data.title,
            content: data.content || "",
            createdById: data.createdById,
        },
        include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
};

export const updateArticleItem = async (
    id: string,
    data: {
        title: string;
        content?: string;
    }
) => {
    return prisma.knowledgeArticle.update({
        where: { id },
        data,
        include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
};

export const deleteArticleItem = async (id: string) => {
    return prisma.knowledgeArticle.delete({
        where: { id },
    });
};
