import { prisma } from "../../config/prisma";
import { getLocalDateString } from "../../utils/date";

const resolveReportDateRange = (
    daysFromToday?: string,
    startDate?: string,
    endDate?: string
) => {
    let start = new Date();
    let end = new Date();

    if (daysFromToday) {
        const days = parseInt(daysFromToday, 10);
        start.setDate(start.getDate() - days);
    } else if (startDate && endDate) {
        start = new Date(startDate);
        end = new Date(endDate);
    } else {
        start.setDate(start.getDate() - 30);
    }

    return { start, end };
};

export const generateReport = async (
    teamId: string,
    daysFromToday?: string,
    startDate?: string,
    endDate?: string
) => {
    const { start, end } = resolveReportDateRange(daysFromToday, startDate, endDate);

    // Parallelize tasks and column definitions in a single roundtrip with selective field projection
    const [tasks, teamColumns] = await Promise.all([
        prisma.task.findMany({
            where: {
                teamId,
                isSoftDeleted: false,
                date: { gte: start, lte: end },
            },
            select: {
                id: true,
                title: true,
                priority: true,
                carryCount: true,
                estimatedTime: true,
                actualTime: true,
                date: true,
                dueDate: true,
                column: {
                    select: {
                        name: true,
                        isComplete: true,
                    },
                },
            },
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
    ]);

    const totalCount = tasks.length;
    const completedTasks = tasks.filter((t) => t.column.isComplete);
    const completedCount = completedTasks.length;

    const completionRate = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

    const completedWithTime = completedTasks.filter((t) => t.actualTime && t.actualTime > 0);
    const averageTimeToDone =
        completedWithTime.length > 0
            ? completedWithTime.reduce((sum, t) => sum + (t.actualTime || 0), 0) / completedWithTime.length
            : 0;

    const columnsBreakdown: Record<string, number> = {};
    // Initialize all team columns with 0 count
    teamColumns.forEach((col) => {
        columnsBreakdown[col.name] = 0;
    });

    tasks.forEach((t) => {
        const colName = t.column.name;
        columnsBreakdown[colName] = (columnsBreakdown[colName] || 0) + 1;
    });

    const today = new Date();
    const overdueCount = tasks.filter(
        (t) => !t.column.isComplete && t.dueDate && new Date(t.dueDate) < today
    ).length;

    const totalEstimated = tasks.reduce((sum, t) => sum + (t.estimatedTime || 0), 0);
    const totalActual = tasks.reduce((sum, t) => sum + (t.actualTime || 0), 0);

    const staleCount = tasks.filter((t) => !t.column.isComplete && t.carryCount >= 3).length;

    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalTasks: totalCount,
        completedTasks: completedCount,
        completionRate: Math.round(completionRate * 10) / 10,
        averageTimeToDone: Math.round(averageTimeToDone * 10) / 10,
        columnsBreakdown,
        teamColumns,
        overdueCount,
        totalEstimatedHours: totalEstimated,
        totalActualHours: totalActual,
        staleTasksCount: staleCount,
        tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.column.name,
            priority: t.priority,
            carryCount: t.carryCount,
            estimatedTime: t.estimatedTime,
            actualTime: t.actualTime,
            date: getLocalDateString(t.date),
            dueDate: t.dueDate ? getLocalDateString(t.dueDate) : null,
        })),
    };
};

export const generateCsvExport = async (
    teamId: string,
    daysFromToday?: string,
    startDate?: string,
    endDate?: string
) => {
    const { start, end } = resolveReportDateRange(daysFromToday, startDate, endDate);

    const tasks = await prisma.task.findMany({
        where: {
            teamId,
            isSoftDeleted: false,
            date: { gte: start, lte: end },
        },
        select: {
            id: true,
            title: true,
            priority: true,
            date: true,
            dueDate: true,
            carryCount: true,
            estimatedTime: true,
            actualTime: true,
            column: {
                select: { name: true },
            },
            assignedTo: {
                select: { fullName: true },
            },
        },
    });

    let csv = "Task ID,Title,Status,Priority,Date,Due Date,Carry Count,Est Hours,Act Hours,Assignee\n";
    tasks.forEach((t) => {
        const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
        const assigneeName = t.assignedTo?.fullName || "Unassigned";
        csv += `${t.id},${escape(t.title)},${escape(t.column.name)},${t.priority},${getLocalDateString(t.date)},${t.dueDate ? getLocalDateString(t.dueDate) : ""},${t.carryCount},${t.estimatedTime || 0},${t.actualTime || 0},${escape(assigneeName)}\n`;
    });

    return csv;
};
