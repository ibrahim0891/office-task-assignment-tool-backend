import { prisma } from "../../config/prisma";
import { notifyTeam } from "../../config/socket";

/**
 * Validates if adding a directed dependency (predecessorId -> successorId) creates a cycle in the task graph.
 */
export async function wouldCreateCycle(
    projectId: string,
    predecessorId: string,
    successorId: string
): Promise<boolean> {
    if (predecessorId === successorId) return true;

    // Fetch all existing dependencies for the project
    const dependencies = await prisma.taskDependency.findMany({
        where: { projectId },
        select: { predecessorTaskId: true, successorTaskId: true },
    });

    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const dep of dependencies) {
        if (!adj.has(dep.predecessorTaskId)) adj.set(dep.predecessorTaskId, []);
        adj.get(dep.predecessorTaskId)!.push(dep.successorTaskId);
    }

    // Add proposed edge: predecessorId -> successorId
    if (!adj.has(predecessorId)) adj.set(predecessorId, []);
    adj.get(predecessorId)!.push(successorId);

    // BFS/DFS from successorId to see if we can reach predecessorId (which would mean a cycle)
    const visited = new Set<string>();
    const queue = [successorId];

    while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === predecessorId) return true;

        if (!visited.has(curr)) {
            visited.add(curr);
            const neighbors = adj.get(curr) || [];
            for (const next of neighbors) {
                if (!visited.has(next)) {
                    queue.push(next);
                }
            }
        }
    }

    return false;
}

/**
 * Calculates Critical Path tasks for a project using Critical Path Method (CPM)
 */
export async function calculateCriticalPath(projectId: string): Promise<Set<string>> {
    const tasks = await prisma.projectTask.findMany({
        where: { projectId },
        include: {
            column: true,
            successorDeps: true,
            predecessorDeps: true,
        },
    });

    if (tasks.length === 0) return new Set();

    const criticalTasks = new Set<string>();

    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    const taskMap = new Map<string, typeof tasks[0]>();

    for (const t of tasks) {
        taskMap.set(t.id, t);
        inDegree.set(t.id, 0);
        adj.set(t.id, []);
    }

    for (const t of tasks) {
        for (const dep of t.successorDeps) {
            adj.get(dep.predecessorTaskId)?.push(dep.successorTaskId);
            inDegree.set(dep.successorTaskId, (inDegree.get(dep.successorTaskId) || 0) + 1);
        }
    }

    const duration = (t: typeof tasks[0]) => Math.max(1, t.estimatedDays || 1);
    const eft = new Map<string, number>();
    const est = new Map<string, number>();

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
        if (deg === 0) {
            queue.push(id);
            est.set(id, 0);
            eft.set(id, duration(taskMap.get(id)!));
        }
    }

    const topoOrder: string[] = [];
    while (queue.length > 0) {
        const u = queue.shift()!;
        topoOrder.push(u);
        const currentEFT = eft.get(u) || 0;

        for (const v of adj.get(u) || []) {
            const currentEST = est.get(v) || 0;
            const newEST = Math.max(currentEST, currentEFT);
            est.set(v, newEST);
            eft.set(v, newEST + duration(taskMap.get(v)!));

            inDegree.set(v, inDegree.get(v)! - 1);
            if (inDegree.get(v) === 0) {
                queue.push(v);
            }
        }
    }

    let maxDuration = 0;
    for (const val of eft.values()) {
        if (val > maxDuration) maxDuration = val;
    }

    const lft = new Map<string, number>();
    const lst = new Map<string, number>();

    for (const id of topoOrder) {
        lft.set(id, maxDuration);
    }

    for (let i = topoOrder.length - 1; i >= 0; i--) {
        const u = topoOrder[i];
        const uLFT = lft.get(u) || maxDuration;
        lst.set(u, uLFT - duration(taskMap.get(u)!));

        for (const v of adj.get(u) || []) {
            const vLST = lst.get(v) || maxDuration;
            lft.set(u, Math.min(lft.get(u) || maxDuration, vLST));
            lst.set(u, (lft.get(u) || maxDuration) - duration(taskMap.get(u)!));
        }
    }

    for (const t of tasks) {
        const slack = (lst.get(t.id) || 0) - (est.get(t.id) || 0);
        if (Math.abs(slack) < 0.001) {
            criticalTasks.add(t.id);
        }
    }

    return criticalTasks;
}

/**
 * Calculates day-based capacity load for members across a given date range.
 * Formula: U(M, D) = sum( estimatedDays / taskSpanInDays ) for each task/subtask assigned to M overlapping date D.
 */
export async function calculateMemberCapacity(
    projectId: string,
    startDateStr: string,
    numDays: number = 7
): Promise<any[]> {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            members: {
                include: { user: true },
            },
            tasks: {
                include: {
                    column: true,
                    assignees: { include: { user: true } },
                    subtasks: { include: { assignedTo: true } },
                },
            },
        },
    });

    if (!project) return [];

    const start = new Date(startDateStr);
    const dateRange: Date[] = [];
    for (let i = 0; i < numDays; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        dateRange.push(d);
    }

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return project.members.map((member) => {
        const memberUserId = member.userId;
        const activeSubtasks = project.tasks
            .flatMap((t) => t.subtasks)
            .filter((st) => st.assignedToId === memberUserId && !st.isCompleted);

        const days = dateRange.map((d) => {
            const dateStr = d.toISOString().split("T")[0];
            const dTime = d.getTime();

            let dailyLoad = 0;

            for (const st of activeSubtasks) {
                const sTime = new Date(st.startDate).getTime();
                const eTime = new Date(st.dueDate).getTime();
                const spanDays = Math.max(1, Math.round((eTime - sTime) / 86400000) + 1);

                if (dTime >= sTime && dTime <= eTime) {
                    const est = st.estimatedDays || 1;
                    dailyLoad += est / spanDays;
                }
            }

            const dayOfWeek = d.getDay();
            return {
                date: dateStr,
                dayLabel: dayLabels[dayOfWeek],
                utilization: parseFloat(dailyLoad.toFixed(2)),
            };
        });

        return {
            user: member.user,
            role: member.role,
            dailyCapacity: member.dailyCapacity,
            activeTasks: activeSubtasks.length,
            days,
        };
    });
}

/**
 * Batched SLA Risk & Escalation Engine (100% loop-free updates using updateMany & createMany)
 */
export async function runSlaEscalationCheck(): Promise<void> {
    const now = new Date();
    const nowMs = now.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const twoDaysMs = 48 * 60 * 60 * 1000;
    const threeDaysMs = 72 * 60 * 60 * 1000;

    // Fetch all active incomplete project tasks
    const incompleteTasks = await prisma.projectTask.findMany({
        where: {
            column: { isComplete: false },
        },
        include: {
            project: { select: { id: true, teamId: true } },
            column: true,
            assignees: { select: { userId: true } },
            incidents: {
                where: { resolvedAt: null },
                select: { id: true, escalationLevel: true, createdAt: true },
            },
        },
    });

    if (incompleteTasks.length === 0) return;

    // Batch buckets for riskLevel updates
    const criticalSlaIds: string[] = [];
    const overdueIds: string[] = [];
    const approachingIds: string[] = [];

    // Batch buckets for SLA Incident creation & escalation
    const newIncidentsToCreate: {
        projectId: string;
        taskId: string;
        assigneeId: string;
        daysLate: number;
        escalationLevel: string;
        leaderInaction: boolean;
    }[] = [];

    const incidentIdsToEscalateLevel2: string[] = [];
    const teamNotifications: { teamId: string; payload: any }[] = [];

    for (const task of incompleteTasks) {
        const dueMs = new Date(task.dueDate).getTime();
        const overdueMs = nowMs - dueMs;
        const daysLate = Math.max(0, Math.floor(overdueMs / oneDayMs));

        // 1. Categorize risk level buckets
        if (overdueMs > threeDaysMs) {
            if (task.riskLevel !== "CRITICAL_SLA") criticalSlaIds.push(task.id);
        } else if (overdueMs > 0) {
            if (task.riskLevel !== "OVERDUE") overdueIds.push(task.id);
        } else if (Math.abs(overdueMs) <= twoDaysMs) {
            if (task.riskLevel !== "APPROACHING_DEADLINE") approachingIds.push(task.id);
        }

        // 2. Categorize SLA incidents
        if (overdueMs >= twoDaysMs) {
            const activeIncident = task.incidents[0];
            const primaryAssigneeId = task.assignees[0]?.userId || task.createdById;

            if (!activeIncident) {
                // Queue new Level 1 incident
                newIncidentsToCreate.push({
                    projectId: task.projectId,
                    taskId: task.id,
                    assigneeId: primaryAssigneeId,
                    daysLate: Math.max(2, daysLate),
                    escalationLevel: "LEVEL_1",
                    leaderInaction: false,
                });

                teamNotifications.push({
                    teamId: task.project.teamId,
                    payload: {
                        projectId: task.projectId,
                        taskId: task.id,
                        taskTitle: task.title,
                        level: "LEVEL_1",
                        daysLate: Math.max(2, daysLate),
                    },
                });
            } else if (activeIncident.escalationLevel === "LEVEL_1") {
                const incidentAgeMs = nowMs - new Date(activeIncident.createdAt).getTime();
                const isLeaderInactive = incidentAgeMs >= oneDayMs;

                if (overdueMs >= threeDaysMs || isLeaderInactive) {
                    incidentIdsToEscalateLevel2.push(activeIncident.id);
                    teamNotifications.push({
                        teamId: task.project.teamId,
                        payload: {
                            incidentId: activeIncident.id,
                            projectId: task.projectId,
                            taskId: task.id,
                            taskTitle: task.title,
                            level: "LEVEL_2",
                            daysLate: Math.max(3, daysLate),
                            leaderInaction: isLeaderInactive,
                        },
                    });
                }
            }
        }
    }

    // ----------------------------------------------------
    // BATCH UPDATE QUERIES (Zero Loop updates, Single Queries)
    // ----------------------------------------------------

    const batchPromises: Promise<any>[] = [];

    // Bulk update task risk levels
    if (criticalSlaIds.length > 0) {
        batchPromises.push(
            prisma.projectTask.updateMany({
                where: { id: { in: criticalSlaIds } },
                data: { riskLevel: "CRITICAL_SLA" },
            })
        );
    }
    if (overdueIds.length > 0) {
        batchPromises.push(
            prisma.projectTask.updateMany({
                where: { id: { in: overdueIds } },
                data: { riskLevel: "OVERDUE" },
            })
        );
    }
    if (approachingIds.length > 0) {
        batchPromises.push(
            prisma.projectTask.updateMany({
                where: { id: { in: approachingIds } },
                data: { riskLevel: "APPROACHING_DEADLINE" },
            })
        );
    }

    // Bulk create new SLA Level 1 incidents
    if (newIncidentsToCreate.length > 0) {
        batchPromises.push(
            prisma.projectIncident.createMany({
                data: newIncidentsToCreate,
            })
        );
    }

    // Bulk escalate existing incidents to Level 2
    if (incidentIdsToEscalateLevel2.length > 0) {
        batchPromises.push(
            prisma.projectIncident.updateMany({
                where: { id: { in: incidentIdsToEscalateLevel2 } },
                data: {
                    escalationLevel: "LEVEL_2",
                    leaderInaction: true,
                },
            })
        );
    }

    // Execute all bulk operations concurrently in a single round-trip
    if (batchPromises.length > 0) {
        await Promise.all(batchPromises);
    }

    // Broadcast notifications
    for (const notif of teamNotifications) {
        notifyTeam(notif.teamId, "project_sla_incident", notif.payload);
    }
}
