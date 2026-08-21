import { prisma } from "../../config/prisma";
import { deleteFromCloudinary, uploadImageAttachment } from "../../cloudinary";
import { parseLocalDate, getLocalDateString } from "../../utils/date";
import { runCarryForwardAndRecurring } from "./taskEngine";
import { APP_CONFIG } from "../../config/appConfig";
import { createNotification, notifyTeamLeader } from "../notifications/notifications.service";

export const getTasksList = async (query: any, actingUserId?: string, userRole?: string) => {
    const { teamId, date, userId, search, isSoftDeleted, isArchived, archivedOrDeleted, clientToday } = query;
    if (!teamId) {
        throw new Error("teamId is required.");
    }

    if (date) {
        const requestedDate = parseLocalDate(date);
        
        let referenceTodayDate: Date;
        if (clientToday && typeof clientToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)) {
            referenceTodayDate = parseLocalDate(clientToday);
        } else {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const day = String(now.getDate()).padStart(2, "0");
            const todayStr = `${year}-${month}-${day}`;
            referenceTodayDate = parseLocalDate(todayStr);
        }

        if (requestedDate.getTime() <= referenceTodayDate.getTime()) {
            await runCarryForwardAndRecurring(teamId, date);
        }
    }

    const whereClause: any = { teamId };

    const isFetchingArchivedOrDeleted =
        archivedOrDeleted === "true" ||
        isSoftDeleted === "true" ||
        isArchived === "true";

    if (archivedOrDeleted === "true") {
        whereClause.OR = [{ isSoftDeleted: true }, { isArchived: true }];
    } else {
        whereClause.isSoftDeleted = isSoftDeleted === "true";
        whereClause.isArchived = isArchived === "true";
    }

    if (date) {
        const [year, month, day] = date.split("-").map(Number);
        const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        whereClause.date = {
            gte: startOfDay,
            lte: endOfDay,
        };
    }

    if (userId) {
        whereClause.assignedToId = userId;
    }

    if (search) {
        whereClause.OR = [
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
        ];
    }

    const isLeader = userRole === "LEADER";

    let memberFilter = null;
    if (isFetchingArchivedOrDeleted) {
        if (!isLeader && actingUserId) {
            memberFilter = {
                createdById: actingUserId
            };
        }
    } else {
        if (userRole === "MEMBER" && actingUserId) {
            memberFilter = {
                assignedToId: actingUserId
            };
        }
    }

    if (memberFilter) {
        if (whereClause.OR) {
            const existingOR = whereClause.OR;
            delete whereClause.OR;
            whereClause.AND = [
                { OR: existingOR },
                memberFilter
            ];
        } else if (whereClause.AND) {
            whereClause.AND.push(memberFilter);
        } else {
            whereClause.AND = [memberFilter];
        }
    }

    return prisma.task.findMany({
        where: whereClause,
        include: {
            column: true,
            createdBy: {
                select: { id: true, name: true, avatarUrl: true }
            },
            assignedTo: {
                select: { id: true, name: true, avatarUrl: true }
            },
            checklist: true,
            _count: {
                select: { comments: true, attachments: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });
};

export const createTaskItem = async (body: any, isMember: boolean) => {
    const {
        teamId,
        title,
        description,
        columnId,
        priority,
        dueDate,
        date,
        estimatedTime,
        assignedToId,
        createdById,
        isRecurring,
        recurrence,
    } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
        throw new Error("Task title is required.");
    }
    if (title.trim().length > APP_CONFIG.MAX_TASK_TITLE_LENGTH) {
        throw new Error(`Task title must not exceed ${APP_CONFIG.MAX_TASK_TITLE_LENGTH} characters.`);
    }

    if (isMember && assignedToId && assignedToId !== createdById) {
        throw new Error("Standard members can only assign tasks to themselves.");
    }

    const { clientToday } = body;
    const dateStr =
        date ||
        (clientToday &&
        typeof clientToday === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
            ? clientToday
            : getLocalDateString(new Date()));
    const taskDate = parseLocalDate(dateStr);
    const finalAssignedToId = assignedToId || createdById;

    const task = await prisma.task.create({
        data: {
            teamId,
            title,
            description,
            columnId,
            priority: priority || "MEDIUM",
            dueDate: dueDate ? new Date(dueDate) : null,
            date: taskDate,
            originalDate: taskDate,
            estimatedTime: estimatedTime ? parseFloat(estimatedTime) : null,
            actualTime: 0,
            assignedToId: finalAssignedToId,
            createdById,
            isRecurring: isRecurring || false,
            recurrence: recurrence || null,
        },
        include: {
            column: true,
            createdBy: {
                select: { id: true, name: true, avatarUrl: true }
            },
            assignedTo: {
                select: { id: true, name: true, avatarUrl: true }
            },
            checklist: true,
            _count: {
                select: { comments: true, attachments: true },
            },
        },
    });

    await prisma.taskActivity.create({
        data: {
            taskId: task.id,
            userId: createdById,
            actionType: "CREATE",
            details: JSON.stringify({ title }),
        },
    });

    const creatorName = task.createdBy?.name || "Someone";
    await notifyTeamLeader(
        teamId,
        `${creatorName} created task: "${title}".`,
        "TASK_CREATED",
        task.id,
        createdById
    );

    if (finalAssignedToId !== createdById) {
        await createNotification({
            userId: finalAssignedToId,
            content: `You have been assigned a new task: "${title}".`,
            type: "TASK_ASSIGNED",
            taskId: task.id,
        });
    }

    return task;
};

export const updateTaskItem = async (taskId: string, body: any, actingUserId: string, isMember: boolean) => {
    const {
        title,
        description,
        columnId,
        priority,
        dueDate,
        estimatedTime,
        actualTime,
        assignedToId,
    } = body;

    const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { column: true },
    });

    if (!task) {
        throw new Error("Task not found.");
    }

    const changingStatus = columnId && columnId !== task.columnId;

    const updateData: any = {};
    const detailsChanges: any = {};

    if (title !== undefined && title !== task.title) {
        if (actingUserId !== task.createdById) {
            throw new Error("Only the task creator can update the task title.");
        }
        if (!title.trim()) {
            throw new Error("Task title cannot be empty.");
        }
        if (title.trim().length > APP_CONFIG.MAX_TASK_TITLE_LENGTH) {
            throw new Error(`Task title must not exceed ${APP_CONFIG.MAX_TASK_TITLE_LENGTH} characters.`);
        }
        updateData.title = title;
        detailsChanges.title = { from: task.title, to: title };
    }

    if (description !== undefined && description !== task.description) {
        const finalDesc = (description && description.trim() !== "" && description !== "<p></p>") ? description : null;
        updateData.description = finalDesc;
        detailsChanges.description = {
            from: task.description || "None",
            to: finalDesc || "None",
        };
    }
    if (priority !== undefined && priority !== task.priority) {
        updateData.priority = priority;
        detailsChanges.priority = { from: task.priority, to: priority };
    }
    if (dueDate !== undefined) {
        const newDue = dueDate ? new Date(dueDate) : null;
        updateData.dueDate = newDue;
        detailsChanges.dueDate = {
            from: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "None",
            to: newDue ? newDue.toLocaleDateString() : "None",
        };
    }
    if (estimatedTime !== undefined && estimatedTime !== task.estimatedTime) {
        const parsedEst = estimatedTime ? Math.max(0, parseFloat(estimatedTime)) : null;
        updateData.estimatedTime = parsedEst;
        detailsChanges.estimatedTime = {
            from: task.estimatedTime ?? 0,
            to: parsedEst ?? 0,
        };
    }
    if (actualTime !== undefined && actualTime !== task.actualTime) {
        const parsedAct = actualTime ? Math.max(0, parseFloat(actualTime)) : null;
        updateData.actualTime = parsedAct;
        detailsChanges.actualTime = {
            from: task.actualTime ?? 0,
            to: parsedAct ?? 0,
        };
    }

    let newUser: { name: string } | null = null;
    if (assignedToId !== undefined && assignedToId !== task.assignedToId) {
        if (isMember && assignedToId !== actingUserId) {
            throw new Error("Standard members can only assign tasks to themselves.");
        }
        updateData.assignedToId = assignedToId;
        const [oldUser, fetchedNewUser] = await Promise.all([
            prisma.user.findUnique({ where: { id: task.assignedToId }, select: { name: true } }),
            prisma.user.findUnique({ where: { id: assignedToId }, select: { name: true } }),
        ]);
        newUser = fetchedNewUser;
        detailsChanges.assignedTo = {
            from: oldUser?.name || "Unassigned",
            to: newUser?.name || "Unassigned",
        };
    }

    if (columnId !== undefined && columnId !== task.columnId) {
        updateData.columnId = columnId;
        const oldColName = task.column?.name || "Previous Column";
        const newCol = await prisma.taskColumn.findUnique({ where: { id: columnId } });
        detailsChanges.status = {
            from: oldColName,
            to: newCol?.name || "New Column",
        };

        if (newCol && newCol.wipLimit) {
            const count = await prisma.task.count({
                where: { columnId: newCol.id, isSoftDeleted: false, date: task.date },
            });
            if (count >= newCol.wipLimit) {
                detailsChanges.wipLimitWarning = `WIP limit of ${newCol.wipLimit} exceeded for column "${newCol.name}"!`;
            }
        }
    }

    const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: updateData,
        include: {
            column: true,
            createdBy: {
                select: { id: true, name: true, avatarUrl: true }
            },
            assignedTo: {
                select: { id: true, name: true, avatarUrl: true }
            },
            checklist: true,
            _count: {
                select: { comments: true, attachments: true },
            },
        }
    });

    if (Object.keys(detailsChanges).length > 0) {
        const actionType = changingStatus ? "STATUS_CHANGE" : "EDIT";
        const actor = await prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } });
        const actorName = actor?.name || "Someone";

        const postUpdatePromises: Promise<any>[] = [
            prisma.taskActivity.create({
                data: {
                    taskId,
                    userId: actingUserId,
                    actionType,
                    details: JSON.stringify(detailsChanges),
                },
            }),
        ];

        if (assignedToId && assignedToId !== task.assignedToId) {
            postUpdatePromises.push(
                notifyTeamLeader(
                    task.teamId,
                    `${actorName} reassigned task "${updatedTask.title}" to ${newUser?.name || 'Unassigned'}.`,
                    "TASK_REASSIGNED",
                    taskId,
                    actingUserId
                )
            );
        }

        await Promise.all(postUpdatePromises);
    }

    if (assignedToId && assignedToId !== task.assignedToId) {
        await createNotification({
            userId: assignedToId,
            content: `Task "${updatedTask.title}" has been reassigned to you.`,
            type: "TASK_REASSIGNED",
            taskId: updatedTask.id,
        });
    }

    return updatedTask;
};

export const softDeleteTaskItem = async (taskId: string, actingUserId: string) => {
    const [task, membership, actor] = await Promise.all([
        prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true, teamId: true, createdById: true, title: true },
        }),
        prisma.userTeam.findFirst({
            where: { userId: actingUserId },
            select: { role: true, teamId: true },
        }),
        prisma.user.findUnique({
            where: { id: actingUserId },
            select: { name: true },
        }),
    ]);

    if (!task) {
        throw new Error("Task not found.");
    }

    const isLeader = membership?.role === "LEADER" && membership?.teamId === task.teamId;
    const isCreator = task.createdById === actingUserId;

    if (!isLeader && !isCreator) {
        throw new Error("Only the task creator or workspace leader can delete this task.");
    }

    const [deletedTask] = await Promise.all([
        prisma.task.update({
            where: { id: taskId },
            data: { isSoftDeleted: true },
        }),
        prisma.taskActivity.create({
            data: {
                taskId,
                userId: actingUserId,
                actionType: "DELETE",
                details: JSON.stringify({ note: "Task soft deleted." }),
            },
        }),
        notifyTeamLeader(
            task.teamId,
            `${actor?.name || "Someone"} deleted task "${task.title}".`,
            "TASK_DELETED",
            undefined,
            actingUserId
        ),
    ]);

    return deletedTask;
};

export const restoreTaskItem = async (taskId: string, actingUserId: string) => {
    const [task, deleteActivity] = await Promise.all([
        prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true, teamId: true, createdById: true },
        }),
        prisma.taskActivity.findFirst({
            where: {
                taskId,
                userId: actingUserId,
                actionType: "DELETE",
            },
            select: { id: true },
        }),
    ]);

    if (!task) {
        throw new Error("Task not found.");
    }

    const membership = await prisma.userTeam.findUnique({
        where: { userId_teamId: { userId: actingUserId, teamId: task.teamId } },
        select: { role: true },
    });

    const isLeader = membership?.role === "LEADER";
    const isCreator = task.createdById === actingUserId;
    const isDeleter = Boolean(deleteActivity);

    if (!isLeader && !isCreator && !isDeleter) {
        throw new Error("Access denied. Only the user who deleted/created the task or a workspace leader/co-leader can restore this task.");
    }

    const [restoredTask] = await Promise.all([
        prisma.task.update({
            where: { id: taskId },
            data: { isSoftDeleted: false, isArchived: false },
        }),
        prisma.taskActivity.create({
            data: {
                taskId,
                userId: actingUserId,
                actionType: "EDIT",
                details: JSON.stringify({ note: "Task restored from trash." }),
            },
        }),
    ]);

    return restoredTask;
};

export const permanentDeleteTaskItem = async (taskId: string) => {
    const attachments = await prisma.attachment.findMany({
        where: { taskId },
        select: { url: true },
    });

    const urlsToDelete = attachments.filter((a) => a.url).map((a) => a.url);
    if (urlsToDelete.length > 0) {
        await Promise.allSettled(
            urlsToDelete.map((url) =>
                deleteFromCloudinary(url).catch((e) =>
                    console.error("Failed to delete Cloudinary asset:", url, e)
                )
            )
        );
    }

    // PostgreSQL foreign key cascade automatically cleans up checklist, comments, attachments, activities, notifications
    await prisma.task.delete({
        where: { id: taskId },
    });
};

export const createChecklist = async (taskId: string, title: string) => {
    return prisma.checklistItem.create({
        data: { taskId, title },
    });
};

export const updateChecklist = async (itemId: string, isCompleted: boolean) => {
    return prisma.checklistItem.update({
        where: { id: itemId },
        data: { isCompleted },
    });
};

export const deleteChecklist = async (itemId: string) => {
    return prisma.checklistItem.delete({
        where: { id: itemId },
    });
};

export const createTaskComment = async (taskId: string, userId: string, content: string) => {
    const comment = await prisma.comment.create({
        data: { taskId, userId, content },
        include: {
            user: { select: { id: true, name: true, avatarUrl: true } }
        },
    });

    // Notify explicitly @mentioned users
    const mentions = content.match(/@(\w+)/g);
    const [task, commenter] = await Promise.all([
        prisma.task.findUnique({
            where: { id: taskId },
            select: { title: true, teamId: true, assignedToId: true, createdById: true },
        }),
        prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true },
        }),
    ]);

    if (!task) return comment;

    const mentionedUserIds = new Set<string>();
    if (mentions && mentions.length > 0) {
        const uniqueNames = Array.from(new Set(mentions.map((m) => m.substring(1))));
        const mentionedUsers = await prisma.user.findMany({
            where: {
                OR: uniqueNames.map((name) => ({
                    name: { contains: name, mode: "insensitive" },
                })),
            },
            select: { id: true },
        });

        for (const u of mentionedUsers) {
            if (u.id !== userId) {
                mentionedUserIds.add(u.id);
            }
        }
    }

    const commenterName = commenter?.name || "Someone";
    const snippet = content.length > 40 ? `${content.substring(0, 40)}...` : content;
    const notificationContent = `${commenterName} commented on task "${task.title}": "${snippet}"`;

    // Direct recipients (assignee + creator), excluding commenter & already-mentioned
    const directRecipients = new Set<string>();
    if (task.assignedToId && task.assignedToId !== userId && !mentionedUserIds.has(task.assignedToId)) {
        directRecipients.add(task.assignedToId);
    }
    if (task.createdById && task.createdById !== userId && !mentionedUserIds.has(task.createdById)) {
        directRecipients.add(task.createdById);
    }

    const notificationPromises: Promise<any>[] = [
        prisma.taskActivity.create({
            data: {
                taskId,
                userId,
                actionType: "COMMENT",
                details: JSON.stringify({ note: "Added comment." }),
            },
        }),
    ];

    for (const mentionedId of mentionedUserIds) {
        notificationPromises.push(
            createNotification({
                userId: mentionedId,
                content: `You were mentioned in a comment on task: "${content.substring(0, 40)}..."`,
                type: "COMMENT_MENTION",
                taskId,
                teamId: task.teamId,
            })
        );
    }

    for (const recipientId of directRecipients) {
        notificationPromises.push(
            createNotification({
                userId: recipientId,
                content: notificationContent,
                type: "COMMENT_MENTION",
                taskId,
                teamId: task.teamId,
            })
        );
    }

    notificationPromises.push(
        notifyTeamLeader(
            task.teamId,
            notificationContent,
            "COMMENT_MENTION",
            taskId,
            userId,
            Array.from(new Set([...directRecipients, ...mentionedUserIds]))
        )
    );

    await Promise.all(notificationPromises);

    return comment;
};

export const deleteTaskComment = async (taskId: string, commentId: string, actingUserId: string) => {
    await prisma.comment.delete({
        where: { id: commentId },
    });

    if (actingUserId) {
        await prisma.taskActivity.create({
            data: {
                taskId,
                userId: actingUserId,
                actionType: "COMMENT",
                details: JSON.stringify({ note: "Deleted comment." }),
            },
        });
    }
};

export const resolveTaskComment = async (taskId: string, commentId: string, actingUserId: string) => {
    const updatedComment = await prisma.comment.update({
        where: { id: commentId },
        data: { resolved: true },
        include: {
            user: { select: { id: true, name: true, avatarUrl: true } }
        },
    });

    if (actingUserId) {
        const [task, user] = await Promise.all([
            prisma.task.findUnique({
                where: { id: taskId },
                select: { title: true, teamId: true },
            }),
            prisma.user.findUnique({
                where: { id: actingUserId },
                select: { name: true },
            }),
            prisma.taskActivity.create({
                data: {
                    taskId,
                    userId: actingUserId,
                    actionType: "COMMENT",
                    details: JSON.stringify({ note: "Resolved comment." }),
                },
            }),
        ]);

        if (task) {
            const userName = user?.name || "Someone";
            await notifyTeamLeader(
                task.teamId,
                `${userName} resolved a comment on task "${task.title}".`,
                "COMMENT_MENTION",
                taskId,
                actingUserId
            );
        }
    }

    return updatedComment;
};

export const reopenTaskComment = async (taskId: string, commentId: string, actingUserId: string) => {
    const updatedComment = await prisma.comment.update({
        where: { id: commentId },
        data: { resolved: false },
        include: {
            user: { select: { id: true, name: true, avatarUrl: true } }
        },
    });

    if (actingUserId) {
        const [task, user] = await Promise.all([
            prisma.task.findUnique({
                where: { id: taskId },
                select: { title: true, teamId: true },
            }),
            prisma.user.findUnique({
                where: { id: actingUserId },
                select: { name: true },
            }),
            prisma.taskActivity.create({
                data: {
                    taskId,
                    userId: actingUserId,
                    actionType: "COMMENT",
                    details: JSON.stringify({ note: "Reopened comment." }),
                },
            }),
        ]);

        if (task) {
            const userName = user?.name || "Someone";
            await notifyTeamLeader(
                task.teamId,
                `${userName} reopened a comment on task "${task.title}".`,
                "COMMENT_MENTION",
                taskId,
                actingUserId
            );
        }
    }

    return updatedComment;
};

export const createAttachmentItem = async (taskId: string, name: string, url: string, type: string, actingUserId: string) => {
    const attachment = await prisma.attachment.create({
        data: { taskId, name, url, type },
    });

    await prisma.taskActivity.create({
        data: {
            taskId,
            userId: actingUserId || "system",
            actionType: "ATTACHMENT",
            details: JSON.stringify({ name }),
        },
    });

    return attachment;
};

export const uploadAttachmentImage = async (taskId: string, imageBase64: string, filename: string, userId: string) => {
    if (!imageBase64) {
        throw new Error("imageBase64 is required.");
    }

    const task = await prisma.task.findUnique({
        where: { id: taskId },
    });
    if (!task) {
        throw new Error("Task not found.");
    }

    const imageUrl = await uploadImageAttachment(imageBase64, "task_attachments");

    const attachment = await prisma.attachment.create({
        data: {
            taskId,
            name: filename || "Compressed Image",
            url: imageUrl,
            type: "IMAGE",
        },
    });

    await prisma.taskActivity.create({
        data: {
            taskId,
            userId: userId || task.createdById,
            actionType: "ATTACHMENT",
            details: JSON.stringify({
                name: attachment.name,
                url: attachment.url,
            }),
        },
    });

    return attachment;
};

export const deleteAttachmentItem = async (attachmentId: string, actingUserId: string) => {
    const attachment = await prisma.attachment.findUnique({
        where: { id: attachmentId },
    });

    if (!attachment) {
        throw new Error("Attachment not found.");
    }

    if (attachment.url) {
        await deleteFromCloudinary(attachment.url);
    }

    await prisma.attachment.deleteMany({
        where: { id: attachmentId },
    });

    if (attachment.taskId && actingUserId) {
        await prisma.taskActivity.create({
            data: {
                taskId: attachment.taskId,
                userId: actingUserId,
                actionType: "ATTACHMENT",
                details: JSON.stringify({
                    note: `Deleted attachment: ${attachment.name}`,
                }),
            },
        });
    }
};

export const getTaskItem = async (taskId: string) => {
    const [task, checklist, attachments] = await Promise.all([
        prisma.task.findUnique({
            where: { id: taskId },
            include: {
                column: true,
                createdBy: {
                    select: { id: true, name: true, avatarUrl: true }
                },
                assignedTo: {
                    select: { id: true, name: true, avatarUrl: true }
                },
                _count: {
                    select: { comments: true, attachments: true },
                },
            },
        }),
        prisma.checklistItem.findMany({
            where: { taskId },
            orderBy: { createdAt: "asc" },
        }),
        prisma.attachment.findMany({
            where: { taskId },
            orderBy: { createdAt: "desc" },
        }),
    ]);

    if (!task) return null;

    return {
        ...task,
        checklist: checklist || [],
        attachments: attachments || [],
    };
};

export const clearTaskActivities = async (taskId: string, actingUserId: string) => {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
    });

    if (!task) {
        throw new Error("Task not found.");
    }

    const membership = await prisma.userTeam.findUnique({
        where: { userId_teamId: { userId: actingUserId, teamId: task.teamId } },
    });

    const isLeader = membership?.role === "LEADER";
    const isCreator = task.createdById === actingUserId;

    if (!isCreator && !isLeader) {
        throw new Error("Only the task creator or workspace leader can clear the activity log.");
    }

    await prisma.taskActivity.deleteMany({
        where: { taskId },
    });

    return {
        success: true,
        message: "Activity logs cleared successfully."
    };
};

export const getTaskActivities = async (taskId: string, page = 1, limit = 15) => {
    const [activities, totalCount] = await Promise.all([
        prisma.taskActivity.findMany({
            where: { taskId },
            include: {
                user: {
                    select: { id: true, name: true, avatarUrl: true },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.taskActivity.count({ where: { taskId } }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
        activities,
        totalCount,
        hasMore,
        page,
    };
};

export const getTaskComments = async (taskId: string, page = 1, limit = 15) => {
    const [comments, totalCount] = await Promise.all([
        prisma.comment.findMany({
            where: { taskId },
            include: {
                user: {
                    select: { id: true, name: true, avatarUrl: true },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.comment.count({ where: { taskId } }),
    ]);

    const hasMore = page * limit < totalCount;

    return {
        comments: comments.reverse(),
        hasMore,
    };
};
