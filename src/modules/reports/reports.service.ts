import { prisma } from "../../config/prisma";
import { getLocalDateString } from "../../utils/date";

const resolveReportDateRange = (
    daysFromToday?: string,
    startDate?: string,
    endDate?: string,
    clientToday?: string
) => {
    let now = new Date();
    let todayStr = getLocalDateString(now);
    if (clientToday && typeof clientToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)) {
        todayStr = clientToday;
    }
    const [tY, tM, tD] = todayStr.split("-").map(Number);
    const todayStart = new Date(Date.UTC(tY, tM - 1, tD, 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(tY, tM - 1, tD, 23, 59, 59, 999));

    if (startDate && endDate) {
        const [sY, sM, sD] = startDate.split("-").map(Number);
        const [eY, eM, eD] = endDate.split("-").map(Number);
        const start = new Date(Date.UTC(sY, sM - 1, sD, 0, 0, 0, 0));
        const end = new Date(Date.UTC(eY, eM - 1, eD, 23, 59, 59, 999));
        return { start, end, todayStr };
    }

    if (daysFromToday !== undefined && daysFromToday !== null && daysFromToday !== "") {
        const days = parseInt(daysFromToday, 10);
        if (days === 0) {
            // Today only
            return { start: todayStart, end: todayEnd, todayStr };
        } else if (days === 1) {
            // Yesterday only
            const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
            const yYear = yesterdayStart.getUTCFullYear();
            const yMonth = yesterdayStart.getUTCMonth();
            const yDay = yesterdayStart.getUTCDate();
            const yesterdayEnd = new Date(Date.UTC(yYear, yMonth, yDay, 23, 59, 59, 999));
            return {
                start: new Date(Date.UTC(yYear, yMonth, yDay, 0, 0, 0, 0)),
                end: yesterdayEnd,
                todayStr,
            };
        } else {
            const start = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
            return { start, end: todayEnd, todayStr };
        }
    }

    // Default: last 30 days
    const defaultStart = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { start: defaultStart, end: todayEnd, todayStr };
};

export const generateReport = async (
    teamId: string,
    daysFromToday?: string,
    startDate?: string,
    endDate?: string,
    memberId?: string,
    clientToday?: string
) => {
    const { start, end, todayStr } = resolveReportDateRange(
        daysFromToday,
        startDate,
        endDate,
        clientToday
    );

    const taskWhereClause: any = {
        teamId,
        isSoftDeleted: false,
        date: { gte: start, lte: end },
    };

    if (memberId && memberId !== "all") {
        taskWhereClause.assignedToId = memberId;
    }

    // Fetch in parallel: filtered tasks, team columns, all team members, and all tasks across team for member breakdown
    const [tasks, teamColumns, teamMemberships, allTeamTasksInRange] = await Promise.all([
        prisma.task.findMany({
            where: taskWhereClause,
            include: {
                column: {
                    select: {
                        id: true,
                        name: true,
                        isComplete: true,
                        order: true,
                    },
                },
                assignedTo: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        avatarUrl: true,
                        designation: true,
                    },
                },
                createdBy: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
                checklist: {
                    select: {
                        id: true,
                        title: true,
                        isCompleted: true,
                    },
                    orderBy: { createdAt: "asc" },
                },
                comments: {
                    select: {
                        id: true,
                        content: true,
                        createdAt: true,
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                avatarUrl: true,
                            },
                        },
                    },
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        }),
        prisma.taskColumn.findMany({
            where: { teamId },
            select: {
                id: true,
                name: true,
                isComplete: true,
                order: true,
            },
            orderBy: { order: "asc" },
        }),
        prisma.userTeam.findMany({
            where: { teamId },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        avatarUrl: true,
                        designation: true,
                        bio: true,
                    },
                },
            },
            orderBy: { user: { fullName: "asc" } },
        }),
        // When memberId is provided, we still need all tasks in range to calculate memberBreakdown for the top bubbles
        memberId && memberId !== "all"
            ? prisma.task.findMany({
                  where: {
                      teamId,
                      isSoftDeleted: false,
                      date: { gte: start, lte: end },
                  },
                  select: {
                      id: true,
                      assignedToId: true,
                      carryCount: true,
                      column: {
                          select: {
                              name: true,
                              isComplete: true,
                          },
                      },
                  },
              })
            : Promise.resolve(null),
    ]);

    const totalCount = tasks.length;
    const completedTasks = tasks.filter((t) => t.column.isComplete);
    const completedCount = completedTasks.length;
    const inProgressTasks = tasks.filter((t) => {
        const colName = t.column.name.toLowerCase();
        return !t.column.isComplete && (colName.includes("progress") || colName.includes("doing") || colName.includes("review"));
    }).length;
    const needsAttentionTasks = tasks.filter((t) => {
        const colName = t.column.name.toLowerCase();
        return !t.column.isComplete && (colName.includes("attention") || colName.includes("blocked"));
    }).length;

    const completionRate = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
    const staleCount = tasks.filter((t) => !t.column.isComplete && t.carryCount >= 2).length;

    const columnsBreakdown: Record<string, number> = {};
    teamColumns.forEach((col) => {
        columnsBreakdown[col.name] = 0;
    });
    tasks.forEach((t) => {
        const colName = t.column.name;
        columnsBreakdown[colName] = (columnsBreakdown[colName] || 0) + 1;
    });

    // Calculate Member Breakdown across all team members
    const taskPoolForMembers = allTeamTasksInRange || tasks;
    const memberBreakdown = teamMemberships.map((m) => {
        const mTasks = taskPoolForMembers.filter((t) => t.assignedToId === m.userId);
        const mTotal = mTasks.length;
        const mDone = mTasks.filter((t) => t.column.isComplete).length;
        const mInProgress = mTasks.filter((t) => {
            const colName = t.column.name.toLowerCase();
            return !t.column.isComplete && (colName.includes("progress") || colName.includes("doing") || colName.includes("review"));
        }).length;
        const mAttention = mTasks.filter((t) => {
            const colName = t.column.name.toLowerCase();
            return !t.column.isComplete && (colName.includes("attention") || colName.includes("blocked"));
        }).length;
        const mStale = mTasks.filter((t) => !t.column.isComplete && t.carryCount >= 2).length;
        const mRate = mTotal > 0 ? Math.round((mDone / mTotal) * 100) : 0;

        return {
            user: m.user,
            role: m.role,
            totalTasks: mTotal,
            completedTasks: mDone,
            inProgressTasks: mInProgress,
            needsAttentionTasks: mAttention,
            staleTasksCount: mStale,
            completionRate: mRate,
        };
    });

    // Group tasks by date for the daily activity feed
    const [tY, tM, tD] = todayStr.split("-").map(Number);
    const yesterdayDate = new Date(Date.UTC(tY, tM - 1, tD - 1));
    const yesterdayStr = getLocalDateString(yesterdayDate);

    const dailyGroupsMap: Record<string, typeof tasks> = {};
    tasks.forEach((t) => {
        const dStr = getLocalDateString(t.date);
        if (!dailyGroupsMap[dStr]) {
            dailyGroupsMap[dStr] = [];
        }
        dailyGroupsMap[dStr].push(t);
    });

    const dailyGroups = Object.keys(dailyGroupsMap)
        .sort((a, b) => b.localeCompare(a)) // Latest date first
        .map((dateKey) => {
            const dayTasks = dailyGroupsMap[dateKey];
            const isToday = dateKey === todayStr;
            const isYesterday = dateKey === yesterdayStr;
            const dayDone = dayTasks.filter((t) => t.column.isComplete).length;

            return {
                date: dateKey,
                isToday,
                isYesterday,
                totalCount: dayTasks.length,
                completedCount: dayDone,
                tasks: dayTasks.map((t) => {
                    const checklistTotal = t.checklist.length;
                    const checklistCompleted = t.checklist.filter((c) => c.isCompleted).length;

                    return {
                        id: t.id,
                        title: t.title,
                        description: t.description,
                        status: t.column.name,
                        columnId: t.column.id,
                        isComplete: t.column.isComplete,
                        priority: t.priority,
                        carryCount: t.carryCount,
                        date: getLocalDateString(t.date),
                        dueDate: t.dueDate ? getLocalDateString(t.dueDate) : null,
                        assignedTo: t.assignedTo,
                        createdBy: t.createdBy,
                        checklist: t.checklist,
                        checklistStats: {
                            total: checklistTotal,
                            completed: checklistCompleted,
                        },
                        latestComment: t.comments.length > 0 ? t.comments[0] : null,
                    };
                }),
            };
        });

    const selectedMemberUser =
        memberId && memberId !== "all"
            ? teamMemberships.find((m) => m.userId === memberId)?.user || null
            : null;

    return {
        startDate: getLocalDateString(start),
        endDate: getLocalDateString(end),
        todayDate: todayStr,
        selectedMemberId: memberId || "all",
        selectedMember: selectedMemberUser,
        totalTasks: totalCount,
        completedTasks: completedCount,
        inProgressTasks,
        needsAttentionTasks,
        completionRate: Math.round(completionRate * 10) / 10,
        columnsBreakdown,
        teamColumns,
        staleTasksCount: staleCount,
        memberBreakdown,
        dailyGroups,
        tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            status: t.column.name,
            columnId: t.column.id,
            isComplete: t.column.isComplete,
            priority: t.priority,
            carryCount: t.carryCount,
            date: getLocalDateString(t.date),
            dueDate: t.dueDate ? getLocalDateString(t.dueDate) : null,
            assignedTo: t.assignedTo,
            createdBy: t.createdBy,
            checklist: t.checklist,
            checklistStats: {
                total: t.checklist.length,
                completed: t.checklist.filter((c) => c.isCompleted).length,
            },
            latestComment: t.comments.length > 0 ? t.comments[0] : null,
        })),
    };
};

export const generateCsvExport = async (
    teamId: string,
    daysFromToday?: string,
    startDate?: string,
    endDate?: string,
    memberId?: string,
    clientToday?: string
) => {
    const { start, end } = resolveReportDateRange(
        daysFromToday,
        startDate,
        endDate,
        clientToday
    );

    const taskWhereClause: any = {
        teamId,
        isSoftDeleted: false,
        date: { gte: start, lte: end },
    };

    if (memberId && memberId !== "all") {
        taskWhereClause.assignedToId = memberId;
    }

    const tasks = await prisma.task.findMany({
        where: taskWhereClause,
        include: {
            column: { select: { name: true, isComplete: true } },
            assignedTo: { select: { fullName: true, email: true } },
            checklist: { select: { isCompleted: true } },
            comments: {
                select: { content: true },
                orderBy: { createdAt: "desc" },
                take: 1,
            },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    let csv = "Task ID,Title,Status,Priority,Date,Due Date,Carry Count,Assignee,Assignee Email,Subtasks Done,Subtasks Total,Latest Note\n";
    tasks.forEach((t) => {
        const escape = (str: string) => `"${(str || "").replace(/"/g, '""')}"`;
        const assigneeName = t.assignedTo?.fullName || "Unassigned";
        const assigneeEmail = t.assignedTo?.email || "";
        const subtasksDone = t.checklist.filter((c) => c.isCompleted).length;
        const subtasksTotal = t.checklist.length;
        const latestNote = t.comments.length > 0 ? t.comments[0].content : "";

        csv += `${t.id},${escape(t.title)},${escape(t.column.name)},${t.priority},${getLocalDateString(t.date)},${t.dueDate ? getLocalDateString(t.dueDate) : ""},${t.carryCount},${escape(assigneeName)},${escape(assigneeEmail)},${subtasksDone},${subtasksTotal},${escape(latestNote)}\n`;
    });

    return csv;
};

