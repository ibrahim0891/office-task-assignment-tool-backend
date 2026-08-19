import { prisma, Role } from "../../config/prisma";
import { APP_CONFIG } from "../../config/appConfig";
import { getIO } from "../../config/socket";

export const purgeOldArchivedNotifications = async (userId: string) => {
    const thirtyDaysAgo = new Date(Date.now() - APP_CONFIG.NOTIFICATION_PURGE_DAYS * 24 * 60 * 60 * 1000);
    return prisma.notification.deleteMany({
        where: {
            userId,
            isArchived: true,
            archivedAt: { lt: thirtyDaysAgo },
        },
    });
};

export const createNotification = async (data: {
    userId: string;
    content: string;
    type: string;
    taskId?: string;
    teamId?: string;
}) => {
    const notification = await prisma.notification.create({ data });
    const io = getIO();
    if (io) {
        console.log(`[Socket Server] Emitting notification to user:${data.userId}`, notification);
        io.to(`user:${data.userId}`).emit("new_notification", notification);
    }
    return notification;
};

export const notifyTeamLeader = async (
    teamId: string,
    content: string,
    type: string,
    taskId?: string,
    actingUserId?: string,
    excludeUserIds: string[] = []
) => {
    const leaders = await prisma.userTeam.findMany({
        where: {
            teamId,
            role: Role.LEADER,
        },
        select: { userId: true },
    });

    for (const leader of leaders) {
        if (actingUserId && leader.userId === actingUserId) continue;
        if (excludeUserIds.includes(leader.userId)) continue;
        
        await createNotification({
            userId: leader.userId,
            content,
            type,
            taskId,
            teamId
        });
    }
};

export const getNotificationsByUserId = async (userId: string, teamId: string, page = 1, limit = 10) => {
    return prisma.notification.findMany({
        where: { 
            userId,
            OR: [
                { teamId },
                { teamId: null }
            ]
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
    });
};

export const clearAllNotifications = async (userId: string) => {
    return prisma.notification.updateMany({
        where: { userId, isArchived: false },
        data: { isArchived: true, archivedAt: new Date(), isRead: true },
    });
};

export const deleteArchivedNotifications = async (userId: string) => {
    return prisma.notification.deleteMany({
        where: { userId, isArchived: true },
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
