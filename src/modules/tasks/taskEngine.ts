import { prisma, Role } from "../../config/prisma";
import { parseLocalDate, getLocalDateString } from "../../utils/date";

// Set storing `${teamId}:${dateStr}` pairs that have already completed carry-forward for that calendar day
const processedDaySet = new Set<string>();

export function resetCarryForwardDailyLock(teamId?: string, dateStr?: string) {
    if (teamId && dateStr) {
        processedDaySet.delete(`${teamId}:${dateStr}`);
    } else if (teamId) {
        for (const key of processedDaySet) {
            if (key.startsWith(`${teamId}:`)) {
                processedDaySet.delete(key);
            }
        }
    } else {
        processedDaySet.clear();
    }
}

export async function runCarryForwardAndRecurring(teamId: string, dateStr: string) {
    const key = `${teamId}:${dateStr}`;
    if (processedDaySet.has(key)) {
        return; // Already completed for this workspace on this calendar day
    }

    // Mark as processed so concurrent requests don't duplicate work
    processedDaySet.add(key);

    try {
        const targetDate = parseLocalDate(dateStr);

    // 1. CARRY FORWARD LOGIC
    // Find all tasks in this team that are older than targetDate, are NOT complete (based on column),
    // belong to columns that trigger carry-forward, and are not soft-deleted/archived.
    const incompleteTasks = await prisma.task.findMany({
        where: {
            teamId,
            date: { lt: targetDate },
            isSoftDeleted: false,
            isArchived: false,
            column: {
                isComplete: false,
                triggersCarryForward: true,
            },
        },
        include: {
            column: true,
            team: {
                include: {
                    columns: true,
                    members: {
                        where: { role: Role.LEADER },
                    },
                },
            },
        },
    });

    if (incompleteTasks.length > 0) {
        const operations: any[] = [];
        const activitiesToCreate: any[] = [];
        const notificationsToCreate: any[] = [];

        const standardTaskIds: string[] = [];

        for (const task of incompleteTasks) {
            // Calculate calendar days elapsed since original date
            const daysElapsed = Math.floor(
                (targetDate.getTime() - task.originalDate.getTime()) /
                    (1000 * 60 * 60 * 24),
            );
            if (daysElapsed <= 0) {
                continue; // Safety: Never carry forward tasks on the same calendar day
            }

            // We get the "Need Attention Later" column or the fallback column
            const needAttentionCol =
                task.team.columns.find(
                    (c) => c.name.toLowerCase() === "need attention later",
                ) ||
                task.team.columns.find((c) =>
                    c.name.toLowerCase().includes("attention"),
                ) ||
                task.team.columns[0];

            const currentCarryCount = task.carryCount + 1;

            if (daysElapsed >= 3 || currentCarryCount >= 3) {
                // Auto-flag task as Need Attention Later
                operations.push(
                    prisma.task.update({
                        where: { id: task.id },
                        data: {
                            date: targetDate,
                            carryCount: currentCarryCount,
                            columnId: needAttentionCol.id,
                        },
                    }),
                );

                // Audit Log
                activitiesToCreate.push({
                    taskId: task.id,
                    userId: task.createdById,
                    actionType: "STATUS_CHANGE",
                    details: JSON.stringify({
                        from: task.column.name,
                        to: needAttentionCol.name,
                        reason: `Auto-flagged after carrying forward for ${currentCarryCount} days.`,
                    }),
                });

                // Notify Leader(s)
                for (const membership of task.team.members) {
                    notificationsToCreate.push({
                        userId: membership.userId,
                        content: `Task "${task.title}" has been carried forward for 3 days and auto-flagged as "${needAttentionCol.name}".`,
                        type: "NEED_ATTENTION",
                        taskId: task.id,
                        teamId: task.teamId,
                    });
                }
            } else {
                standardTaskIds.push(task.id);

                // Audit Log
                activitiesToCreate.push({
                    taskId: task.id,
                    userId: task.createdById,
                    actionType: "EDIT",
                    details: JSON.stringify({
                        action: "Carry forward",
                        from_date: getLocalDateString(task.date),
                        to_date: dateStr,
                        new_carry_count: currentCarryCount,
                    }),
                });
            }
        }

        // Single bulk update for all standard carried tasks
        if (standardTaskIds.length > 0) {
            operations.push(
                prisma.task.updateMany({
                    where: { id: { in: standardTaskIds } },
                    data: {
                        date: targetDate,
                        carryCount: { increment: 1 },
                    },
                }),
            );
        }

        if (activitiesToCreate.length > 0) {
            operations.push(
                prisma.taskActivity.createMany({
                    data: activitiesToCreate,
                }),
            );
        }

        if (notificationsToCreate.length > 0) {
            operations.push(
                prisma.notification.createMany({
                    data: notificationsToCreate,
                }),
            );
        }

        if (operations.length > 0) {
            await prisma.$transaction(operations);
        }
    }

    // 2. RECURRING TASKS GENERATION
    // Find task templates in this team. Templates are marked isRecurring = true
    const recurringTemplates = await prisma.task.findMany({
        where: {
            teamId,
            isRecurring: true,
            parentTaskId: null,
            isSoftDeleted: false,
        },
        include: {
            checklist: true,
        },
    });

    if (recurringTemplates.length > 0) {
        const dayOfWeek = targetDate.getUTCDay();
        const dayOfMonth = targetDate.getUTCDate();

        // Batch check existing instances in 1 single query instead of N queries
        const templateTitles = recurringTemplates.map((t) => t.title);
        const existingInstances = await prisma.task.findMany({
            where: {
                teamId,
                title: { in: templateTitles },
                date: targetDate,
                isRecurring: false,
                isSoftDeleted: false,
            },
            select: { title: true },
        });
        const existingSet = new Set(existingInstances.map((e) => e.title));

        for (const template of recurringTemplates) {
            let shouldSpawn = false;

            if (template.recurrence === "DAILY") {
                shouldSpawn = true;
            } else if (template.recurrence === "WEEKLY") {
                const templateDayOfWeek = new Date(template.originalDate).getUTCDay();
                shouldSpawn = dayOfWeek === templateDayOfWeek;
            } else if (template.recurrence === "MONTHLY") {
                const templateDayOfMonth = new Date(template.originalDate).getUTCDate();
                shouldSpawn = dayOfMonth === templateDayOfMonth;
            }

            if (shouldSpawn && !existingSet.has(template.title)) {
                const spawnedTask = await prisma.task.create({
                    data: {
                        teamId: template.teamId,
                        title: template.title,
                        description: template.description,
                        columnId: template.columnId,
                        priority: template.priority,
                        date: targetDate,
                        originalDate: targetDate,
                        dueDate: template.dueDate
                            ? new Date(
                                  targetDate.getTime() +
                                      (new Date(template.dueDate).getTime() -
                                          new Date(template.originalDate).getTime()),
                              )
                            : null,
                        createdById: template.createdById,
                        assignedToId: template.assignedToId,
                        estimatedTime: template.estimatedTime,
                        actualTime: 0,
                        isRecurring: false,
                    },
                });

                if (template.checklist && template.checklist.length > 0) {
                    await prisma.checklistItem.createMany({
                        data: template.checklist.map((item) => ({
                            taskId: spawnedTask.id,
                            title: item.title,
                            isCompleted: false,
                        })),
                    });
                }
            }
        }
    }
    } catch (err) {
        processedDaySet.delete(key);
        throw err;
    }
}
