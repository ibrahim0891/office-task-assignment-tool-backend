import { prisma, Role } from "../../config/prisma";
import { processAvatarUpload, deleteFromCloudinary } from "../../cloudinary";

export const getUsersExcludeTeam = async (teamId: string) => {
    return prisma.user.findMany({
        where: {
            NOT: {
                teamMemberships: {
                    some: { teamId },
                },
            },
        },
    });
};

export const queryUsers = async (search?: string) => {
    const whereClause: any = {};
    if (search) {
        whereClause.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { designation: { contains: search, mode: "insensitive" } },
        ];
    }
    return prisma.user.findMany({
        where: whereClause,
        include: {
            teamMemberships: {
                include: { team: true },
            },
        },
    });
};

export const getUserProfileById = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            secondaryEmail: true,
            primaryPhone: true,
            secondaryPhone: true,
            emergencyContact: true,
            telegram: true,
            whatsapp: true,
            github: true,
            bloodGroup: true,
            designation: true,
            bio: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    if (!user) throw new Error("User not found.");
    return user;
};

export const updateUserProfileById = async (userId: string, body: any) => {
    const existingUser = await prisma.user.findUnique({
        where: { id: userId },
    });
    if (!existingUser) {
        throw new Error("User not found");
    }

    const {
        name,
        avatarUrl,
        secondaryEmail,
        primaryPhone,
        secondaryPhone,
        emergencyContact,
        telegram,
        whatsapp,
        github,
        bloodGroup,
        designation,
        bio,
    } = body;

    let finalAvatarUrl = avatarUrl;
    if (avatarUrl !== undefined && avatarUrl !== existingUser.avatarUrl) {
        if (avatarUrl && avatarUrl.startsWith("data:image/")) {
            finalAvatarUrl = await processAvatarUpload(
                avatarUrl,
                existingUser.avatarUrl,
            );
        } else if (!avatarUrl && existingUser.avatarUrl) {
            await deleteFromCloudinary(existingUser.avatarUrl);
        }
    }

    return prisma.user.update({
        where: { id: userId },
        data: {
            ...(name !== undefined && { name }),
            ...(finalAvatarUrl !== undefined && { avatarUrl: finalAvatarUrl }),
            ...(secondaryEmail !== undefined && { secondaryEmail }),
            ...(primaryPhone !== undefined && { primaryPhone }),
            ...(secondaryPhone !== undefined && { secondaryPhone }),
            ...(emergencyContact !== undefined && { emergencyContact }),
            ...(telegram !== undefined && { telegram }),
            ...(whatsapp !== undefined && { whatsapp }),
            ...(github !== undefined && { github }),
            ...(bloodGroup !== undefined && { bloodGroup }),
            ...(designation !== undefined && { designation }),
            ...(bio !== undefined && { bio }),
        },
        select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            secondaryEmail: true,
            primaryPhone: true,
            secondaryPhone: true,
            emergencyContact: true,
            telegram: true,
            whatsapp: true,
            github: true,
            bloodGroup: true,
            designation: true,
            bio: true,
            createdAt: true,
            updatedAt: true,
        },
    });
};

export const getUserTeams = async (userId?: string) => {
    const whereClause = userId
        ? {
              members: {
                  some: { userId },
              },
          }
        : {};

    return prisma.team.findMany({
        where: whereClause,
        include: {
            members: {
                include: { user: true },
            },
            columns: true,
        },
    });
};

export const removeMember = async (
    teamId: string,
    userId: string,
    actingUserId: string,
) => {
    const leaders = await prisma.userTeam.findMany({
        where: { teamId, role: Role.LEADER },
    });
    const reassignedLeaderId = leaders[0]?.userId || actingUserId;

    const columns = await prisma.taskColumn.findMany({
        where: { teamId },
    });
    const needAttentionCol =
        columns.find((c) => c.name.toLowerCase() === "need attention later") ||
        columns.find((c) => c.name.toLowerCase().includes("attention")) ||
        columns[0];

    const memberTasks = await prisma.task.findMany({
        where: {
            teamId,
            assignedToId: userId,
            isSoftDeleted: false,
            column: { isComplete: false },
        },
    });

    for (const task of memberTasks) {
        await prisma.task.update({
            where: { id: task.id },
            data: {
                assignedToId: reassignedLeaderId,
                columnId: needAttentionCol.id,
            },
        });

        await prisma.taskActivity.create({
            data: {
                taskId: task.id,
                userId: actingUserId,
                actionType: "STATUS_CHANGE",
                details: JSON.stringify({
                    note: "Assignee left team. Task reassigned to leader and flagged as Need Attention.",
                    oldAssigneeId: userId,
                    newAssigneeId: reassignedLeaderId,
                    newColumn: needAttentionCol.name,
                }),
            },
        });

        await prisma.notification.create({
            data: {
                userId: reassignedLeaderId,
                content: `Task "${task.title}" reassigned to you because the assignee was removed from the team.`,
                type: "NEED_ATTENTION",
                taskId: task.id,
            },
        });
    }

    await prisma.userTeam.delete({
        where: { userId_teamId: { userId, teamId } },
    });

    return memberTasks.length;
};

export const addMember = async (
    teamId: string,
    userId: string,
    role?: Role,
) => {
    const membership = await prisma.userTeam.create({
        data: {
            userId,
            teamId,
            role: role || Role.MEMBER,
        },
        include: { user: true, team: true },
    });

    await prisma.notification.create({
        data: {
            userId,
            content: `You have been added to team workspace "${membership.team.name}" as a ${membership.role}.`,
            type: "REASSIGN",
        },
    });

    return membership;
};

export const inviteByEmail = async (
    teamId: string,
    email: string,
    role: string,
) => {
    if (!email || !email.trim()) {
        throw new Error("Email address is required.");
    }
    const cleanEmail = email.trim().toLowerCase();

    const targetUser = await prisma.user.findUnique({
        where: { email: cleanEmail },
    });

    if (!targetUser) {
        throw new Error("No registered account found with this email address.");
    }

    const existingMembership = await prisma.userTeam.findUnique({
        where: { userId_teamId: { userId: targetUser.id, teamId } },
    });

    if (existingMembership) {
        throw new Error("User is already a member of this workspace.");
    }

    const membership = await prisma.userTeam.create({
        data: {
            userId: targetUser.id,
            teamId,
            role: (role as Role) || Role.MEMBER,
        },
        include: { user: true, team: true },
    });

    await prisma.notification.create({
        data: {
            userId: targetUser.id,
            content: `You have been invited and added to workspace "${membership.team.name}" as a ${membership.role}.`,
            type: "REASSIGN",
        },
    });

    return { membership, user: targetUser };
};

export const createNewTeam = async (
    name: string,
    creatorId: string,
    emoji?: string,
) => {
    const team = await prisma.team.create({
        data: {
            name,
            emoji: emoji || "👤",
        },
    });

    const defaultCols = [
        {
            name: "To Do",
            order: 0,
            wipLimit: null,
            isComplete: false,
            triggersCarryForward: true,
        },
        {
            name: "Up Next",
            order: 1,
            wipLimit: null,
            isComplete: false,
            triggersCarryForward: true,
        },
        {
            name: "In Progress",
            order: 2,
            wipLimit: null,
            isComplete: false,
            triggersCarryForward: true,
        },
        {
            name: "Blocked",
            order: 3,
            wipLimit: null,
            isComplete: false,
            triggersCarryForward: true,
        },
        {
            name: "Need Attention Later",
            order: 4,
            wipLimit: null,
            isComplete: false,
            triggersCarryForward: true,
        },
        {
            name: "Done",
            order: 5,
            wipLimit: null,
            isComplete: true,
            triggersCarryForward: false,
        },
        {
            name: "Cancelled",
            order: 6,
            wipLimit: null,
            isComplete: false,
            triggersCarryForward: false,
        },
    ];

    await prisma.taskColumn.createMany({
        data: defaultCols.map((col) => ({
            teamId: team.id,
            name: col.name,
            order: col.order,
            wipLimit: col.wipLimit,
            isComplete: col.isComplete,
            triggersCarryForward: col.triggersCarryForward,
        })),
    });

    await prisma.userTeam.create({
        data: {
            userId: creatorId,
            teamId: team.id,
            role: Role.LEADER,
        },
    });

    return team;
};

export const updateTeam = async (
    teamId: string,
    name: string,
    emoji?: string,
) => {
    if (!name || !name.trim()) {
        throw new Error("Team name is required.");
    }

    const updateData: any = { name: name.trim() };
    if (emoji) {
        updateData.emoji = emoji;
    }

    return prisma.team.update({
        where: { id: teamId },
        data: updateData,
    });
};

export const deleteTeamCascading = async (
    teamId: string,
    passwordString: string,
    confirmationText: string,
    actingUserId: string,
) => {
    if (!actingUserId) {
        throw new Error("User authentication required.");
    }

    if (confirmationText !== "I know what I'm doing") {
        throw new Error(
            'Confirmation text must match "I know what I\'m doing" exactly.',
        );
    }

    const user = await prisma.user.findUnique({
        where: { id: actingUserId },
    });

    if (!user || user.password !== passwordString) {
        throw new Error("Incorrect password. Workspace deletion aborted.");
    }

    const attachments = await prisma.attachment.findMany({
        where: {
            task: {
                teamId: teamId,
            },
        },
    });

    for (const att of attachments) {
        if (att.url) {
            try {
                await deleteFromCloudinary(att.url);
            } catch (e) {
                console.error(
                    `Failed to delete Cloudinary asset for attachment ${att.id}:`,
                    e,
                );
            }
        }
    }

    await prisma.team.delete({
        where: { id: teamId },
    });
};

export const updateMemberRole = async (
    teamId: string,
    userId: string,
    role: Role,
    actingUserId: string,
) => {
    if (userId === actingUserId) {
        throw new Error("You cannot change your own role.");
    }

    const membership = await prisma.userTeam.update({
        where: { userId_teamId: { userId, teamId } },
        data: { role },
        include: { user: true, team: true },
    });

    await prisma.notification.create({
        data: {
            userId,
            content: `Your role in team workspace "${membership.team.name}" has been updated to ${membership.role}.`,
            type: "REASSIGN",
        },
    });

    return membership;
};
