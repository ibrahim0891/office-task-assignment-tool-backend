import { prisma } from "../../config/prisma";

export const purgeOldArchivedNotifications = async (userId: string) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return prisma.notification.deleteMany({
        where: {
            userId,
            isArchived: true,
            archivedAt: { lt: thirtyDaysAgo },
        },
    });
};

export const getNotificationsByUserId = async (userId: string) => {
    return prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
    });
};

export const clearAllNotifications = async (userId: string) => {
    return prisma.notification.updateMany({
        where: { userId, isArchived: false },
        data: { isArchived: true, archivedAt: new Date(), isRead: true },
    });
};

export const archiveNotification = async (id: string) => {
    return prisma.notification.update({
        where: { id },
        data: {
            isArchived: true,
            archivedAt: new Date(),
            isRead: true,
        },
    });
};

export const markNotificationAsRead = async (id: string) => {
    return prisma.notification.update({
        where: { id },
        data: { isRead: true },
    });
};
