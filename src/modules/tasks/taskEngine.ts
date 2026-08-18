import { prisma, Role } from "../../config/prisma";
import { parseLocalDate, getLocalDateString } from "../../utils/date";

export async function runCarryForwardAndRecurring(teamId: string, dateStr: string) {
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

    for (const task of incompleteTasks) {
        // Calculate calendar days elapsed since original date
        const daysElapsed = Math.floor(
            (targetDate.getTime() - task.originalDate.getTime()) /
                (1000 * 60 * 60 * 24),
        );

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
            await prisma.task.update({
                where: { id: task.id },
                data: {
                    date: targetDate,
                    carryCount: currentCarryCount,
                    columnId: needAttentionCol.id,
                },
            });

            // Audit Log
            await prisma.taskActivity.create({
                data: {
                    taskId: task.id,
                    userId: task.createdById, // System action, log creator or a system identifier
                    actionType: "STATUS_CHANGE",
                    details: JSON.stringify({
                        from: task.column.name,
                        to: needAttentionCol.name,
                        reason: `Auto-flagged after carrying forward for ${currentCarryCount} days.`,
                    }),
                },
            });

            // Notify Leader(s)
            for (const membership of task.team.members) {
                await prisma.notification.create({
                    data: {
                        userId: membership.userId,
                        content: `Task "${task.title}" has been carried forward for 3 days and auto-flagged as "${needAttentionCol.name}".`,
                        type: "NEED_ATTENTION",
                        taskId: task.id,
                    },
                });
            }
        } else {
            // Move task to target date
            await prisma.task.update({
                where: { id: task.id },
                data: {
                    date: targetDate,
                    carryCount: currentCarryCount,
                },
            });

            // Audit Log
            await prisma.taskActivity.create({
                data: {
                    taskId: task.id,
                    userId: task.createdById,
                    actionType: "EDIT",
                    details: JSON.stringify({
                        action: "Carry forward",
                        from_date: getLocalDateString(task.date),
                        to_date: dateStr,
                        new_carry_count: currentCarryCount,
                    }),
                },
            });
        }
    }

    // 2. RECURRING TASKS GENERATION
    // Find task templates in this team. Templates are marked isRecurring = true
    // and we store them or identify them. Here, any task with isRecurring: true
    // acts as a template. If no instance of this recurring task exists on targetDate, we spawn one.
    const recurringTemplates = await prisma.task.findMany({
        where: {
            teamId,
            isRecurring: true,
            parentTaskId: null, // Templates don't have parent tasks
            isSoftDeleted: false,
        },
    });

    const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const dayOfMonth = targetDate.getDate();

    for (const template of recurringTemplates) {
        let shouldSpawn = false;

        if (template.recurrence === "DAILY") {
            shouldSpawn = true;
        } else if (template.recurrence === "WEEKLY") {
            // Spawn if targetDate matches originalTemplate day of week
            const templateDayOfWeek = new Date(template.originalDate).getDay();
            shouldSpawn = dayOfWeek === templateDayOfWeek;
        } else if (template.recurrence === "MONTHLY") {
            // Spawn if targetDate matches originalTemplate day of month
            const templateDayOfMonth = new Date(
                template.originalDate,
            ).getDate();
            shouldSpawn = dayOfMonth === templateDayOfMonth;
        }

        if (shouldSpawn) {
            // Check if instance already exists on this targetDate
            const existingInstance = await prisma.task.findFirst({
                where: {
                    teamId,
                    title: template.title,
                    date: targetDate,
                    isRecurring: false, // The instance is a regular task copy
                    isSoftDeleted: false,
                },
            });

            if (!existingInstance) {
                // Spawn instance!
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
                                          new Date(
                                              template.originalDate,
                                          ).getTime()),
                              )
                            : null,
                        createdById: template.createdById,
                        assignedToId: template.assignedToId,
                        estimatedTime: template.estimatedTime,
                        actualTime: 0,
                        isRecurring: false,
                        // Link back to template via parentTaskId or similar (optional)
                    },
                });

                // Audit Log
                await prisma.taskActivity.create({
                    data: {
                        taskId: spawnedTask.id,
                        userId: template.createdById,
                        actionType: "CREATE",
                        details: JSON.stringify({
                            note: "Automatically spawned recurring task instance.",
                        }),
                    },
                });

                // Copy checklist items from template to instance
                const templateChecklist = await prisma.checklistItem.findMany({
                    where: { taskId: template.id },
                });

                if (templateChecklist.length > 0) {
                    await prisma.checklistItem.createMany({
                        data: templateChecklist.map((item) => ({
                            taskId: spawnedTask.id,
                            title: item.title,
                            isCompleted: false,
                        })),
                    });
                }
            }
        }
    }
}
