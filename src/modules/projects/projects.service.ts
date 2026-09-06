import { prisma } from "../../config/prisma";
import { createNotification } from "../notifications/notifications.service";
import { notifyTeam, notifyUser } from "../../config/socket";
import {
    wouldCreateCycle,
    calculateCriticalPath,
    calculateMemberCapacity,
} from "./projectEngine";

// Default columns created for every new project
const DEFAULT_COLUMNS = [
    { name: "To Do", order: 0, type: "TODO" as const, isComplete: false },
    { name: "In Progress", order: 1, type: "IN_PROGRESS" as const, isComplete: false },
    { name: "Under Review", order: 2, type: "NEED_ATTENTION" as const, isComplete: false },
    { name: "Completed", order: 3, type: "COMPLETED" as const, isComplete: true },
];

export function getStageWeight(columnOrStatus: any): number {
    if (!columnOrStatus) return 0;
    const isComplete = typeof columnOrStatus === "object" ? Boolean(columnOrStatus.isComplete) : false;
    if (isComplete) return 100;
    const raw = (typeof columnOrStatus === "object" ? (columnOrStatus.name || columnOrStatus.type || "") : String(columnOrStatus)).toLowerCase().trim();
    if (raw.includes("done") || raw.includes("complete") || raw === "completed") return 100;
    if (raw.includes("review") || raw.includes("qa") || raw.includes("test") || raw.includes("attention") || raw === "need_attention") return 75;
    if (raw.includes("progress") || raw.includes("doing") || raw.includes("dev") || raw === "in_progress") return 25;
    return 0;
}

export function calculateTaskProgress(task: any, columnMap: Record<string, any> = {}): number {
    if (!task) return 0;
    const subtasks = task.subtasks || [];
    if (subtasks.length > 0) {
        let total = 0;
        subtasks.forEach((st: any) => {
            if (st.isCompleted) {
                total += 100;
            } else {
                const col = st.columnId ? columnMap[st.columnId] : st.column;
                total += getStageWeight(col || st.status);
            }
        });
        return Math.round(total / subtasks.length);
    }
    if (task.isCompleted) return 100;
    const taskCol = task.columnId ? columnMap[task.columnId] : task.column;
    return getStageWeight(taskCol || task.status);
}

export function calculateProjectProgress(tasks: any[] = [], columns: any[] = []): number {
    if (!tasks || tasks.length === 0) return 0;
    const columnMap: Record<string, any> = {};
    if (Array.isArray(columns)) {
        columns.forEach((c) => {
            if (c?.id) columnMap[c.id] = c;
        });
    }
    const sum = tasks.reduce((acc, t) => acc + calculateTaskProgress(t, columnMap), 0);
    return Math.round(sum / tasks.length);
}

function mapProjectStatus(status: string) {
    switch (status) {
        case "ACTIVE": return "Active";
        case "ON_TRACK": return "OnTrack";
        case "AT_RISK": return "AtRisk";
        case "COMPLETED": return "Completed";
        case "ARCHIVED": return "Archived";
        default: return status;
    }
}

function mapTaskStatus(task: any) {
    if (task.column?.isComplete) return "Completed";
    const colName = (task.column?.name || "").toLowerCase().trim();
    if (colName === "completed" || colName === "done") return "Completed";
    if (colName === "cancelled" || colName === "canceled") return "Cancelled";
    if (colName.includes("attention") || colName === "blocked") return "NeedAttention";
    if (colName.includes("progress") || colName === "doing") return "InProgress";
    if (colName.includes("todo") || colName.includes("to do") || colName.includes("backlog")) return "ToDo";
    if (task.blockerCategory) return "Blocked";
    if (task.riskLevel === "AT_RISK") return "AtRisk";
    
    return task.column?.name || "InProgress";
}

function mapSubtaskStatus(sub: any) {
    if (sub.isCompleted || sub.column?.isComplete) return "Completed";
    if (sub.acceptanceStatus === "PENDING") return "PendingAcceptance";
    if (sub.acceptanceStatus === "REJECTED") return "ReworkRequired";
    return sub.column?.name || "InProgress";
}

function mapProjectData(project: any) {
    if (!project) return null;
    
    // Map tasks and their subtasks
    const mappedTasks = (project.tasks || []).map((task: any) => {
        const mappedSubtasks = (task.subtasks || []).map((sub: any) => ({
            ...sub,
            status: mapSubtaskStatus(sub),
            columnId: sub.columnId || (sub.isCompleted ? task.columnId : sub.columnId),
            commentsCount: Array.isArray(sub.comments) ? sub.comments.length : 0,
        }));
        
        return {
            ...task,
            status: mapTaskStatus(task),
            subtasks: mappedSubtasks,
            // Flatten assignees from ProjectTaskAssignee relation
            assignees: (task.assignees || []).map((a: any) => a.user),
        };
    });

    return {
        ...project,
        status: mapProjectStatus(project.status),
        tasks: mappedTasks,
    };
}

/**
 * Lists all projects for a team with aggregated metrics (filtered by user membership for non-leaders)
 */
export async function getProjectsList(teamId?: string, userId?: string, isWorkspaceLeader?: boolean) {
    let whereClause: any = {};

    if (userId) {
        const ledTeams = await prisma.userTeam.findMany({
            where: { userId, role: "LEADER" },
            select: { teamId: true },
        });
        const ledTeamIds = ledTeams.map((t) => t.teamId);

        whereClause = {
            OR: [
                { managerId: userId },
                { members: { some: { userId } } },
                ...(ledTeamIds.length > 0 ? [{ teamId: { in: ledTeamIds } }] : []),
            ],
        };
    } else if (teamId) {
        whereClause = { teamId };
    }

    const projects = await prisma.project.findMany({
        where: whereClause,
        include: {
            team: {
                select: { id: true, name: true, emoji: true },
            },
            manager: true,
            folder: true,
            members: {
                include: { user: true },
            },
            columns: {
                orderBy: { order: "asc" },
            },
            tasks: {
                include: {
                    column: true,
                    assignees: { include: { user: true } },
                    subtasks: true,
                },
            },
        },
        orderBy: { updatedAt: "desc" },
    });

    const list = projects.map((p) => {
        const totalTasks = p.tasks.length;
        const doneTasks = p.tasks.filter((t) => t.column?.isComplete).length;
        const progress = calculateProjectProgress(p.tasks, p.columns);
        const overdueTasks = p.tasks.filter(
            (t) => (t.riskLevel === "OVERDUE" || t.riskLevel === "CRITICAL_SLA") && !t.column.isComplete
        ).length;

        return {
            ...p,
            progress,
            totalTasks,
            doneTasks,
            overdueTasks,
        };
    });

    return list.map(mapProjectData);
}

/**
 * Gets portfolio-wide metrics across all projects for a team
 */
export async function getPortfolioSummary(teamId?: string, userId?: string, isWorkspaceLeader?: boolean) {
    let whereClause: any = {};

    if (userId) {
        const ledTeams = await prisma.userTeam.findMany({
            where: { userId, role: "LEADER" },
            select: { teamId: true },
        });
        const ledTeamIds = ledTeams.map((t) => t.teamId);

        whereClause = {
            OR: [
                { managerId: userId },
                { members: { some: { userId } } },
                ...(ledTeamIds.length > 0 ? [{ teamId: { in: ledTeamIds } }] : []),
            ],
        };
    } else if (teamId) {
        whereClause = { teamId };
    }

    const projects = await prisma.project.findMany({
        where: whereClause,
        include: {
            columns: {
                orderBy: { order: "asc" },
            },
            tasks: {
                include: {
                    column: true,
                },
            },
        },
    });

    const totalProjects = projects.length;
    const activeProjects = projects.filter((p) => p.status !== "COMPLETED" && p.status !== "ARCHIVED").length;

    let totalTasks = 0;
    let onTimeDoneTasks = 0;
    let criticalSLABreaches = 0;

    for (const p of projects) {
        totalTasks += p.tasks.length;
        for (const t of p.tasks) {
            if (t.column.isComplete && t.riskLevel !== "CRITICAL_SLA" && t.riskLevel !== "OVERDUE") {
                onTimeDoneTasks++;
            }
            if (t.riskLevel === "CRITICAL_SLA" && !t.column.isComplete) {
                criticalSLABreaches++;
            }
        }
    }

    const onTimeRate = totalTasks > 0 ? Math.round((onTimeDoneTasks / totalTasks) * 100) : 100;

    return {
        activeProjects,
        onTimeRate,
        criticalSLABreaches,
        totalProjects,
    };
}

/**
 * Gets complete project details with tasks, subtasks, members, and dependencies
 */
export async function getProjectDetail(projectId: string) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            team: {
                select: { id: true, name: true, emoji: true },
            },
            manager: true,
            members: {
                include: { user: true },
                orderBy: { role: "asc" },
            },
            columns: {
                orderBy: { order: "asc" },
            },
            tasks: {
                include: {
                    column: true,
                    createdBy: true,
                    reviewer: true,
                    assignees: { include: { user: true } },
                    subtasks: {
                        include: {
                            column: true,
                            assignedTo: true,
                            reviewer: true,
                            comments: {
                                include: {
                                    user: { select: { id: true, name: true, fullName: true, avatarUrl: true } },
                                },
                                orderBy: { createdAt: "asc" },
                            },
                            activities: {
                                include: {
                                    user: { select: { id: true, name: true, fullName: true, avatarUrl: true } },
                                },
                                orderBy: { createdAt: "desc" },
                            },
                        },
                        orderBy: { createdAt: "asc" },
                    },
                    reworkLogs: {
                        include: { rejectedBy: true },
                        orderBy: { createdAt: "desc" },
                    },
                    incidents: {
                        include: { assignee: true, resolvedBy: true },
                    },
                },
                orderBy: { createdAt: "asc" },
            },
            dependencies: {
                include: {
                    predecessorTask: true,
                    successorTask: true,
                },
            },
            invitations: {
                where: { status: "PENDING" },
                include: { receiver: { select: { id: true, name: true, email: true, avatarUrl: true } }, sender: { select: { id: true, name: true } } },
                orderBy: { createdAt: "desc" },
            },
            assets: {
                include: {
                    createdBy: {
                        select: { id: true, name: true, fullName: true, avatarUrl: true },
                    },
                },
                orderBy: [
                    { isPinned: "desc" },
                    { createdAt: "desc" },
                ],
            },
            categories: {
                include: {
                    _count: {
                        select: { docs: true, links: true },
                    },
                },
                orderBy: { createdAt: "asc" },
            },
            docs: {
                include: {
                    category: true,
                    createdBy: {
                        select: { id: true, name: true, fullName: true, avatarUrl: true },
                    },
                },
                orderBy: { updatedAt: "desc" },
            },
            links: {
                include: {
                    category: true,
                    createdBy: {
                        select: { id: true, name: true, fullName: true, avatarUrl: true },
                    },
                },
                orderBy: { createdAt: "desc" },
            },
        },
    });

    if (!project) throw new Error("Project not found.");

    // Recalculate progress
    const totalTasks = project.tasks.length;
    const doneTasks = project.tasks.filter((t) => t.column?.isComplete).length;
    const progress = calculateProjectProgress(project.tasks, project.columns);

    // Get critical path IDs
    const criticalTaskIds = await calculateCriticalPath(projectId);

    return mapProjectData({
        ...project,
        progress,
        criticalTaskIds: Array.from(criticalTaskIds),
    });
}

/**
 * Creates a new project with default columns and assigns the creator as MANAGER
 */
export async function createProject(
    data: {
        teamId: string;
        folderId?: string;
        title: string;
        description?: string;
        emoji?: string;
        startDate: string;
        endDate: string;
    },
    creatorUserId: string
) {
    const { teamId, folderId, title, description, emoji, startDate, endDate } = data;

    if (!teamId || !title || !startDate || !endDate) {
        throw new Error("teamId, title, startDate, and endDate are required.");
    }

    return await prisma.$transaction(async (tx) => {
        let targetFolderId = folderId;
        if (!targetFolderId) {
            const oldestFolder = await tx.folder.findFirst({
                where: { teamId },
                orderBy: { createdAt: "asc" },
            });
            if (oldestFolder) {
                targetFolderId = oldestFolder.id;
            } else {
                const newFolder = await tx.folder.create({
                    data: {
                        teamId,
                        name: "New Folder",
                    },
                });
                targetFolderId = newFolder.id;
            }
        }

        const project = await tx.project.create({
            data: {
                teamId,
                folderId: targetFolderId,
                title,
                description: description || "",
                emoji: emoji || "📁",
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                status: "ACTIVE",
                progress: 0,
                managerId: creatorUserId,
                columns: {
                    create: DEFAULT_COLUMNS,
                },
                members: {
                    create: {
                        userId: creatorUserId,
                        role: "MANAGER",
                        isPrimaryLeader: false,
                        dailyCapacity: 1.0,
                    },
                },
            },
            include: {
                manager: true,
                columns: true,
                members: { include: { user: true } },
            },
        });

        return project;
    });
}

/**
 * Updates project settings
 */
export async function updateProject(projectId: string, data: any) {
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.emoji !== undefined) updateData.emoji = data.emoji;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);
    if (data.managerId !== undefined) updateData.managerId = data.managerId;
    if (data.folderId !== undefined) updateData.folderId = data.folderId;

    return await prisma.project.update({
        where: { id: projectId },
        data: updateData,
        include: {
            manager: true,
            columns: true,
            members: { include: { user: true } },
        },
    });
}

/**
 * Deletes a project
 */
export async function deleteProject(projectId: string) {
    return await prisma.project.delete({
        where: { id: projectId },
    });
}

/**
 * Gets analytics for a single project: KPIs, Capacity Heatmap, Incidents, Rework log
 */
export async function getProjectAnalytics(projectId: string, startDate?: string) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            tasks: {
                include: {
                    column: true,
                    subtasks: true,
                    reworkLogs: { include: { rejectedBy: true } },
                    incidents: { include: { assignee: true, resolvedBy: true } },
                },
            },
            members: { include: { user: true } },
        },
    });

    if (!project) throw new Error("Project not found.");

    const totalTasks = project.tasks.length;
    const doneTasks = project.tasks.filter((t) => t.column.isComplete).length;
    const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const allSubtasks = project.tasks.flatMap((t) => t.subtasks);
    const doneSubtasks = allSubtasks.filter((s) => s.isCompleted).length;
    const totalSubtasks = allSubtasks.length;

    const tasksWithRework = project.tasks.filter((t) => t.reworkCount > 0);
    const reworkRate = totalTasks > 0 ? Math.round((tasksWithRework.length / totalTasks) * 100) : 0;

    const incidents = project.tasks.flatMap((t) => t.incidents);
    const reworkEntries = project.tasks.flatMap((t) =>
        t.reworkLogs.map((r) => ({
            ...r,
            taskTitle: t.title,
        }))
    );

    const anchorDate = startDate || project.startDate.toISOString().split("T")[0];
    const capacityHeatmap = await calculateMemberCapacity(projectId, anchorDate, 7);

    return {
        completionPct,
        totalTasks,
        doneTasks,
        totalSubtasks,
        doneSubtasks,
        reworkRate,
        tasksWithReworkCount: tasksWithRework.length,
        incidents,
        reworkEntries,
        capacityHeatmap,
    };
}

// ----------------------------------------------------
// PROJECT MEMBERS
// ----------------------------------------------------

export async function addProjectMember(
    projectId: string,
    data: { userId?: string; email?: string; role?: string; dailyCapacity?: number }
) {
    let userId = data.userId;

    if (!userId && data.email) {
        const user = await prisma.user.findUnique({
            where: { email: data.email.trim() },
        });
        if (!user) throw new Error(`User with email "${data.email}" not found.`);
        userId = user.id;
    }

    if (!userId) throw new Error("userId or valid email is required.");

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, title: true, teamId: true },
    });
    if (!project) throw new Error("Project not found.");

    const existing = await prisma.projectMember.findUnique({
        where: {
            projectId_userId: {
                projectId,
                userId,
            },
        },
    });
    if (existing) {
        throw new Error("This user is already a member of this project.");
    }

    const role = data.role ? (String(data.role).toUpperCase() as any) : "MEMBER";

    const newMember = await prisma.projectMember.create({
        data: {
            projectId,
            userId,
            role,
            dailyCapacity: data.dailyCapacity !== undefined ? Number(data.dailyCapacity) : 1.0,
        },
        include: { user: true },
    });

    // Send real-time notification to the invited user
    await createNotification({
        userId,
        content: `You have been added to project "${project.title}" as ${role.toLowerCase()}.`,
        type: "PROJECT_INVITATION",
        teamId: project.teamId,
    }).catch((err) => {
        console.error("Failed to create project invitation notification:", err);
    });

    // Broadcast real-time events to the team room and the specific user
    notifyTeam(project.teamId, "project_updated", {
        projectId,
        action: "MEMBER_ADDED",
        userId,
        projectTitle: project.title,
        role,
    });
    notifyUser(userId, "project_invitation", {
        projectId,
        projectTitle: project.title,
        role,
    });

    return newMember;
}

export async function updateProjectMember(memberId: string, data: any, actingUserId?: string) {
    const member = await prisma.projectMember.findUnique({
        where: { id: memberId },
        include: {
            project: { select: { id: true, teamId: true, managerId: true, title: true } },
            user: { select: { id: true, name: true, email: true } },
        },
    });

    if (!member) {
        throw new Error("Project member not found.");
    }

    // Safeguard 1: Manager role immutability
    const isTargetManager = member.role === "MANAGER" || member.project.managerId === member.userId;
    if (isTargetManager && data.role && String(data.role).toUpperCase() !== "MANAGER") {
        throw new Error("The Project Manager's role cannot be downgraded or modified via member role settings.");
    }

    // Safeguard 2: Allowed Role Enum validation
    const ALLOWED_ROLES = ["MEMBER", "LEADER", "VIEWER", "MANAGER"];
    let targetRole: any = undefined;
    if (data.role) {
        targetRole = String(data.role).toUpperCase();
        if (!ALLOWED_ROLES.includes(targetRole)) {
            throw new Error(`Invalid role "${data.role}". Allowed roles are: MEMBER, LEADER, VIEWER.`);
        }
        if (targetRole === "MANAGER" && !isTargetManager) {
            throw new Error("Cannot assign MANAGER role directly. Project manager ownership must be transferred.");
        }
    }

    // Safeguard 3: Acting user hierarchy and self-modification check
    if (actingUserId) {
        if (actingUserId === member.userId && targetRole && targetRole !== member.role) {
            throw new Error("You cannot modify your own role in the project.");
        }

        const isActingManager = member.project.managerId === actingUserId;
        const actingMember = await prisma.projectMember.findUnique({
            where: { projectId_userId: { projectId: member.projectId, userId: actingUserId } },
        });
        const isActingLeader = isActingManager || actingMember?.role === "LEADER" || actingMember?.role === "MANAGER";

        if (!isActingLeader) {
            throw new Error("Only project managers and leaders are authorized to change member roles.");
        }

        // Leader hierarchy safeguard: Leaders cannot demote another Leader unless they are the Manager
        if (!isActingManager && member.role === "LEADER" && targetRole && targetRole !== "LEADER") {
            throw new Error("Only the Project Manager can demote or reassign existing Project Leaders.");
        }
    }

    const updated = await prisma.projectMember.update({
        where: { id: memberId },
        data: {
            ...(targetRole && { role: targetRole }),
            ...(data.dailyCapacity !== undefined && { dailyCapacity: Math.max(0.1, Number(data.dailyCapacity)) }),
            ...(data.isPrimaryLeader !== undefined && { isPrimaryLeader: Boolean(data.isPrimaryLeader) }),
        },
        include: { user: true, project: { select: { id: true, teamId: true, title: true } } },
    });

    // Real-time notification if role changed
    if (targetRole && targetRole !== member.role) {
        await createNotification({
            userId: member.userId,
            content: `Your role in project "${member.project.title}" was updated to ${targetRole.toLowerCase()}.`,
            type: "ROLE_UPDATED",
            teamId: member.project.teamId,
        }).catch((err) => console.error("Failed to notify user on role update:", err));
    }

    if (updated.project) {
        notifyTeam(updated.project.teamId, "project_updated", {
            projectId: updated.projectId,
            action: "MEMBER_UPDATED",
            memberId,
            userId: member.userId,
            newRole: targetRole || member.role,
        });
        notifyUser(member.userId, "project_updated", {
            projectId: updated.projectId,
            action: "MEMBER_UPDATED",
            newRole: targetRole || member.role,
        });
    }

    return updated;
}

export async function removeProjectMember(memberId: string, actingUserId?: string) {
    const member = await prisma.projectMember.findUnique({
        where: { id: memberId },
        include: { project: { select: { id: true, teamId: true, managerId: true, title: true } } },
    });

    if (!member) {
        throw new Error("Project member not found.");
    }

    // Safeguard: Cannot remove Project Manager
    if (member.role === "MANAGER" || member.project.managerId === member.userId) {
        throw new Error("The Project Manager cannot be removed from the project.");
    }

    // Safeguard: If removing someone else, acting user must be manager, leader, or workspace leader
    if (actingUserId && actingUserId !== member.userId) {
        const isActingManager = member.project.managerId === actingUserId;
        const actingMember = await prisma.projectMember.findUnique({
            where: { projectId_userId: { projectId: member.projectId, userId: actingUserId } },
        });
        const isActingLeader = isActingManager || actingMember?.role === "LEADER" || actingMember?.role === "MANAGER";

        if (!isActingLeader) {
            throw new Error("Only project managers and leaders can remove members from the project.");
        }
    }

    const deleted = await prisma.projectMember.delete({
        where: { id: memberId },
    });

    if (member?.project) {
        notifyTeam(member.project.teamId, "project_updated", {
            projectId: member.projectId,
            action: "MEMBER_REMOVED",
            userId: member.userId,
        });
        notifyUser(member.userId, "project_updated", {
            projectId: member.projectId,
            action: "MEMBER_REMOVED",
        });
    }

    return deleted;
}

// ----------------------------------------------------
// PROJECT TASKS (SUPER TASKS)
// ----------------------------------------------------

export async function createProjectTask(projectId: string, data: any, createdById: string) {
    let {
        title,
        description,
        columnId,
        startDate,
        dueDate,
        estimatedDays,
        effortMode,
        priority,
        reviewerId,
        assigneeIds = [],
        subtasks = [],
    } = data;

    if (!title || !title.trim()) {
        throw new Error("Task title is required.");
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, title: true, teamId: true, startDate: true, endDate: true, columns: { orderBy: { order: "asc" } } },
    });

    if (!project) throw new Error("Project not found.");

    if (!columnId) {
        if (project.columns && project.columns.length > 0) {
            columnId = project.columns[0].id;
        } else {
            throw new Error("Project has no columns defined.");
        }
    }

    const sDate = startDate ? new Date(startDate) : new Date(project.startDate || Date.now());
    const dDate = dueDate ? new Date(dueDate) : new Date(project.endDate || (Date.now() + 7 * 24 * 60 * 60 * 1000));

    // Validate task start and due dates against project timeline bounds
    if (project.startDate && project.endDate) {
        const pStartStr = new Date(project.startDate).toISOString().split("T")[0];
        const pEndStr = new Date(project.endDate).toISOString().split("T")[0];

        const taskStartStr = new Date(sDate).toISOString().split("T")[0];
        const taskDueStr = new Date(dDate).toISOString().split("T")[0];

        if (taskStartStr < pStartStr) {
            throw new Error(`Task start date (${taskStartStr}) cannot be earlier than project start date (${pStartStr}).`);
        }
        if (taskStartStr > pEndStr) {
            throw new Error(`Task start date (${taskStartStr}) cannot be later than project end date (${pEndStr}).`);
        }
        if (taskDueStr < pStartStr) {
            throw new Error(`Task due date (${taskDueStr}) cannot be earlier than project start date (${pStartStr}).`);
        }
        if (taskDueStr > pEndStr) {
            throw new Error(`Task due date (${taskDueStr}) cannot be later than project end date (${pEndStr}).`);
        }
        if (taskStartStr > taskDueStr) {
            throw new Error("Task start date cannot be later than task due date.");
        }
    }

    const task = await prisma.projectTask.create({
        data: {
            projectId,
            columnId,
            title: title.trim(),
            description: description ? description.trim() : "",
            startDate: sDate,
            dueDate: dDate,
            estimatedDays: estimatedDays ? Number(estimatedDays) : 1.0,
            effortMode: effortMode || "SHARED",
            priority: priority || "MEDIUM",
            riskLevel: "ON_TRACK",
            reviewerId: reviewerId || null,
            createdById,
            assignees: {
                create: assigneeIds.map((uId: string) => ({
                    userId: uId,
                    acceptanceStatus: "ACCEPTED",
                })),
            },
            subtasks: {
                create: subtasks.map((st: any) => ({
                    title: st.title,
                    description: st.description || "",
                    assignedToId: st.assignedToId,
                    startDate: new Date(st.startDate || sDate),
                    dueDate: new Date(st.dueDate || dDate),
                    estimatedDays: st.estimatedDays ? Number(st.estimatedDays) : 1.0,
                    reviewerId: st.reviewerId || null,
                })),
            },
        },
        include: {
            column: true,
            createdBy: true,
            reviewer: true,
            assignees: { include: { user: true } },
            subtasks: { include: { assignedTo: true, reviewer: true } },
        },
    });

    // Notify everyone assigned to this new task
    if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
        for (const uId of assigneeIds) {
            if (uId !== createdById) {
                await createNotification({
                    userId: uId,
                    content: `You were assigned to main task "${task.title}" in project "${project.title}".`,
                    type: "PROJECT_TASK_ASSIGNED",
                    taskId: `project:${projectId}:task:${task.id}`,
                    teamId: project.teamId,
                }).catch((err) => console.error("Failed to create task notification:", err));
            }
        }
    }

    return task;
}

export async function updateProjectTask(taskId: string, data: any) {
    if (data.startDate !== undefined || data.dueDate !== undefined) {
        const existingTask = await prisma.projectTask.findUnique({
            where: { id: taskId },
            include: { project: true },
        });
        if (!existingTask) throw new Error("Task not found.");

        const newStart = data.startDate !== undefined ? new Date(data.startDate) : existingTask.startDate;
        const newDue = data.dueDate !== undefined ? new Date(data.dueDate) : existingTask.dueDate;

        if (existingTask.project.startDate && existingTask.project.endDate) {
            const pStartStr = new Date(existingTask.project.startDate).toISOString().split("T")[0];
            const pEndStr = new Date(existingTask.project.endDate).toISOString().split("T")[0];

            const taskStartStr = new Date(newStart).toISOString().split("T")[0];
            const taskDueStr = new Date(newDue).toISOString().split("T")[0];

            if (taskStartStr < pStartStr) {
                throw new Error(`Task start date (${taskStartStr}) cannot be earlier than project start date (${pStartStr}).`);
            }
            if (taskStartStr > pEndStr) {
                throw new Error(`Task start date (${taskStartStr}) cannot be later than project end date (${pEndStr}).`);
            }
            if (taskDueStr < pStartStr) {
                throw new Error(`Task due date (${taskDueStr}) cannot be earlier than project start date (${pStartStr}).`);
            }
            if (taskDueStr > pEndStr) {
                throw new Error(`Task due date (${taskDueStr}) cannot be later than project end date (${pEndStr}).`);
            }
            if (taskStartStr > taskDueStr) {
                throw new Error("Task start date cannot be later than task due date.");
            }
        }
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.columnId !== undefined) updateData.columnId = data.columnId;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate);
    if (data.estimatedDays !== undefined) updateData.estimatedDays = Number(data.estimatedDays);
    if (data.actualDays !== undefined) updateData.actualDays = Number(data.actualDays);
    if (data.effortMode !== undefined) updateData.effortMode = data.effortMode;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.riskLevel !== undefined) updateData.riskLevel = data.riskLevel;
    if (data.blockerCategory !== undefined) updateData.blockerCategory = data.blockerCategory;
    if (data.blockerReason !== undefined) updateData.blockerReason = data.blockerReason;
    if (data.reviewerId !== undefined) updateData.reviewerId = data.reviewerId || null;

    if (data.assigneeIds && Array.isArray(data.assigneeIds)) {
        await prisma.projectTaskAssignee.deleteMany({ where: { taskId } });
        await prisma.projectTaskAssignee.createMany({
            data: data.assigneeIds.map((userId: string) => ({
                taskId,
                userId,
                acceptanceStatus: "ACCEPTED",
            })),
        });
    }

    return await prisma.projectTask.update({
        where: { id: taskId },
        data: updateData,
        include: {
            column: true,
            createdBy: true,
            reviewer: true,
            assignees: { include: { user: true } },
            subtasks: { include: { assignedTo: true, reviewer: true } },
        },
    });
}

export async function deleteProjectTask(taskId: string) {
    return await prisma.projectTask.delete({
        where: { id: taskId },
    });
}

/**
 * Reviewer flags rework / rejection with defect category
 */
export async function reworkProjectTask(
    taskId: string,
    data: { defectCategory: string; reason?: string },
    rejectedById: string
) {
    const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        include: { project: true },
    });
    if (!task) throw new Error("Task not found.");

    const newCycle = task.reworkCount + 1;

    await prisma.projectReworkLog.create({
        data: {
            taskId,
            cycleNumber: newCycle,
            defectCategory: data.defectCategory as any,
            reason: data.reason || "",
            rejectedById,
        },
    });

    return await prisma.projectTask.update({
        where: { id: taskId },
        data: {
            reworkCount: newCycle,
            riskLevel: "AT_RISK",
        },
        include: {
            column: true,
            assignees: { include: { user: true } },
            reworkLogs: { include: { rejectedBy: true } },
        },
    });
}

// ----------------------------------------------------
// SUBTASKS (1-to-1)
// ----------------------------------------------------

export async function createProjectSubtask(taskId: string, data: any, actingUserId?: string) {
    const parentTask = await prisma.projectTask.findUnique({
        where: { id: taskId },
        include: {
            assignees: true,
            project: { include: { members: true } },
        },
    });
    if (!parentTask) throw new Error("Main task not found.");

    let targetAssigneeId = data.assignedToId;

    if (actingUserId) {
        const isManager = parentTask.project.managerId === actingUserId;
        const isProjectLeader = parentTask.project.members.some(
            (m) => m.userId === actingUserId && (m.role === "LEADER" || m.role === "MANAGER")
        );
        const isProjectMember = parentTask.project.members.some((m) => m.userId === actingUserId);
        const isTaskAssignee = parentTask.assignees.some((a) => a.userId === actingUserId);

        if (!isManager && !isProjectLeader && !isTaskAssignee && !isProjectMember) {
            throw new Error("Access denied. You must be a project member to create subtasks.");
        }

        // If regular member, force subtask to be assigned to themselves
        if (!isManager && !isProjectLeader) {
            targetAssigneeId = actingUserId;
        } else if (!targetAssigneeId) {
            targetAssigneeId = actingUserId;
        }
    }

    if (!targetAssigneeId) {
        throw new Error("Subtask assignee is required.");
    }

    const startDate = data.startDate ? new Date(data.startDate) : (parentTask.startDate || new Date());
    const dueDate = data.dueDate ? new Date(data.dueDate) : (parentTask.dueDate || new Date());

    let targetColumnId = data.columnId;
    if (!targetColumnId) {
        const firstCol = await prisma.projectColumn.findFirst({
            where: { projectId: parentTask.projectId },
            orderBy: { order: "asc" },
        });
        targetColumnId = parentTask.columnId || firstCol?.id;
    }

    let isCompleted = data.isCompleted !== undefined ? Boolean(data.isCompleted) : false;
    if (targetColumnId) {
        const col = await prisma.projectColumn.findUnique({ where: { id: targetColumnId } });
        if (col?.isComplete) {
            isCompleted = true;
        }
    }

    const createdSubtask = await prisma.projectSubtask.create({
        data: {
            parentTaskId: taskId,
            columnId: targetColumnId,
            title: data.title,
            description: data.description || "",
            priority: data.priority || "MEDIUM",
            assignedToId: targetAssigneeId,
            startDate,
            dueDate,
            estimatedDays: data.estimatedDays ? Number(data.estimatedDays) : 1.0,
            actualDays: data.actualDays ? Number(data.actualDays) : 0,
            isCompleted,
            reviewerId: data.reviewerId || null,
        },
        include: { assignedTo: true, reviewer: true, column: true },
    });

    if (targetAssigneeId && targetAssigneeId !== actingUserId) {
        await createNotification({
            userId: targetAssigneeId,
            content: `You were assigned subtask "${data.title}" in project "${parentTask.project.title}".`,
            type: "PROJECT_SUBTASK_ASSIGNED",
            taskId: `project:${parentTask.projectId}:task:${taskId}:subtask:${createdSubtask.id}`,
            teamId: parentTask.project.teamId,
        }).catch((err) => console.error("Failed to create subtask notification:", err));
    }

    return createdSubtask;
}

export async function updateProjectSubtask(subtaskId: string, data: any, actingUserId?: string) {
    const existingSubtask = await prisma.projectSubtask.findUnique({
        where: { id: subtaskId },
        include: {
            parentTask: {
                include: {
                    assignees: true,
                    project: { include: { members: true } },
                },
            },
        },
    });
    if (!existingSubtask) throw new Error("Subtask not found.");

    if (actingUserId) {
        const isManager = existingSubtask.parentTask.project.managerId === actingUserId;
        const isProjectLeader = existingSubtask.parentTask.project.members.some(
            (m) => m.userId === actingUserId && (m.role === "LEADER" || m.role === "MANAGER")
        );
        const isSubtaskAssignee = existingSubtask.assignedToId === actingUserId;

        if (!isManager && !isProjectLeader && !isSubtaskAssignee) {
            throw new Error("Access denied. You can only update subtasks assigned to you.");
        }

        // Only Manager or Leader can reassign subtask to someone else
        if (data.assignedToId !== undefined && data.assignedToId !== existingSubtask.assignedToId) {
            if (!isManager && !isProjectLeader) {
                throw new Error("Access denied. Only project managers or leaders can reassign subtasks.");
            }
        }
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.columnId !== undefined) {
        updateData.columnId = data.columnId;
        const targetCol = await prisma.projectColumn.findUnique({ where: { id: data.columnId } });
        if (targetCol?.isComplete) {
            updateData.isCompleted = true;
        } else if (data.isCompleted === undefined && existingSubtask.isCompleted && targetCol && !targetCol.isComplete) {
            updateData.isCompleted = false;
        }
    }
    if (data.isCompleted !== undefined) updateData.isCompleted = Boolean(data.isCompleted);
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate);
    if (data.estimatedDays !== undefined) updateData.estimatedDays = Number(data.estimatedDays);
    if (data.actualDays !== undefined) updateData.actualDays = Number(data.actualDays);

    return await prisma.projectSubtask.update({
        where: { id: subtaskId },
        data: updateData,
        include: { assignedTo: true, reviewer: true, column: true },
    });
}

export async function deleteProjectSubtask(subtaskId: string, actingUserId?: string) {
    const existingSubtask = await prisma.projectSubtask.findUnique({
        where: { id: subtaskId },
        include: {
            parentTask: {
                include: {
                    project: { include: { members: true } },
                },
            },
        },
    });
    if (!existingSubtask) throw new Error("Subtask not found.");

    if (actingUserId) {
        const isManager = existingSubtask.parentTask.project.managerId === actingUserId;
        const isProjectLeader = existingSubtask.parentTask.project.members.some(
            (m) => m.userId === actingUserId && (m.role === "LEADER" || m.role === "MANAGER")
        );
        const isSubtaskAssignee = existingSubtask.assignedToId === actingUserId;

        if (!isManager && !isProjectLeader && !isSubtaskAssignee) {
            throw new Error("Access denied. You can only delete subtasks assigned to you.");
        }
    }

    return await prisma.projectSubtask.delete({
        where: { id: subtaskId },
    });
}

// ----------------------------------------------------
// TASK DEPENDENCIES (DAG)
// ----------------------------------------------------

export async function createTaskDependency(
    projectId: string,
    data: { predecessorTaskId: string; successorTaskId: string; dependencyType?: string }
) {
    const { predecessorTaskId, successorTaskId, dependencyType = "FINISH_TO_START" } = data;

    if (predecessorTaskId === successorTaskId) {
        throw new Error("A task cannot depend on itself.");
    }

    // Check DAG cycle
    const createsCycle = await wouldCreateCycle(projectId, predecessorTaskId, successorTaskId);
    if (createsCycle) {
        throw new Error("Circular dependency detected. This dependency cannot be added.");
    }

    return await prisma.taskDependency.create({
        data: {
            projectId,
            predecessorTaskId,
            successorTaskId,
            dependencyType: dependencyType as any,
        },
        include: {
            predecessorTask: true,
            successorTask: true,
        },
    });
}

export async function deleteTaskDependency(dependencyId: string) {
    return await prisma.taskDependency.delete({
        where: { id: dependencyId },
    });
}

// ----------------------------------------------------
// INCIDENTS
// ----------------------------------------------------

export async function resolveProjectIncident(incidentId: string, resolvedById: string) {
    return await prisma.projectIncident.update({
        where: { id: incidentId },
        data: {
            resolvedAt: new Date(),
            resolvedById,
        },
        include: { assignee: true, resolvedBy: true },
    });
}

export async function reassignIncidentTask(
    incidentId: string,
    newAssigneeId: string,
    actingUserId: string
) {
    const incident = await prisma.projectIncident.findUnique({
        where: { id: incidentId },
        include: { task: true },
    });

    if (!incident) throw new Error("Incident not found.");

    // Replace assignees on task
    await prisma.projectTaskAssignee.deleteMany({ where: { taskId: incident.taskId } });
    await prisma.projectTaskAssignee.create({
        data: {
            taskId: incident.taskId,
            userId: newAssigneeId,
            acceptanceStatus: "ACCEPTED",
        },
    });

    // Mark incident resolved with reassign note
    return await prisma.projectIncident.update({
        where: { id: incidentId },
        data: {
            resolvedAt: new Date(),
            resolvedById: actingUserId,
        },
        include: { assignee: true, resolvedBy: true },
    });
}

// ----------------------------------------------------
// PROJECT INVITATIONS
// ----------------------------------------------------

export async function sendProjectInvitation(
    projectId: string,
    senderId: string,
    data: { userId?: string; email?: string; role?: string; dailyCapacity?: number }
) {
    let receiverId = data.userId;

    if (!receiverId && data.email) {
        const user = await prisma.user.findUnique({
            where: { email: data.email.trim() },
        });
        if (!user) throw new Error(`User with email "${data.email}" not found.`);
        receiverId = user.id;
    }

    if (!receiverId) throw new Error("userId or valid email is required.");

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, title: true, teamId: true, managerId: true },
    });
    if (!project) throw new Error("Project not found.");

    if (receiverId === project.managerId) {
        throw new Error("User is already the manager of this project.");
    }

    // Check if already an accepted member
    const existingMember = await prisma.projectMember.findUnique({
        where: {
            projectId_userId: {
                projectId,
                userId: receiverId,
            },
        },
    });
    if (existingMember) {
        throw new Error("This user is already an active member of this project.");
    }

    // Check if there is already a PENDING invitation
    const existingInvitation = await prisma.projectInvitation.findFirst({
        where: {
            projectId,
            receiverId,
            status: "PENDING",
        },
    });
    if (existingInvitation) {
        throw new Error("A pending invitation has already been sent to this user.");
    }

    const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { id: true, name: true, avatarUrl: true, email: true },
    });

    const role = data.role ? (String(data.role).toUpperCase() as any) : "MEMBER";
    const dailyCapacity = data.dailyCapacity !== undefined ? Number(data.dailyCapacity) : 1.0;

    const invitation = await prisma.projectInvitation.create({
        data: {
            projectId,
            senderId,
            receiverId,
            role,
            dailyCapacity,
            status: "PENDING",
        },
        include: {
            project: { select: { id: true, title: true, emoji: true, teamId: true, startDate: true, endDate: true } },
            sender: { select: { id: true, name: true, avatarUrl: true, email: true } },
            receiver: { select: { id: true, name: true, avatarUrl: true, email: true } },
        },
    });

    // Send real-time notification to the receiver
    await createNotification({
        userId: receiverId,
        content: `${sender?.name || "A team leader"} invited you to join project "${project.title}" as ${role.toLowerCase()}.`,
        type: "PROJECT_INVITATION",
        teamId: project.teamId,
    }).catch((err) => {
        console.error("Failed to create project invitation notification:", err);
    });

    // Real-time socket events
    notifyUser(receiverId, "project_invitation", {
        invitationId: invitation.id,
        projectId,
        projectTitle: project.title,
        senderName: sender?.name || "Team Member",
        role,
    });
    notifyTeam(project.teamId, "invitation_sent", {
        projectId,
        invitationId: invitation.id,
    });

    return invitation;
}

export async function getReceivedProjectInvitations(userId: string, teamId?: string) {
    const where: any = {
        receiverId: userId,
        status: "PENDING",
    };

    return await prisma.projectInvitation.findMany({
        where,
        include: {
            project: {
                select: {
                    id: true,
                    title: true,
                    emoji: true,
                    description: true,
                    startDate: true,
                    endDate: true,
                    teamId: true,
                    team: { select: { id: true, name: true, emoji: true } },
                    manager: { select: { id: true, name: true, avatarUrl: true } },
                    folder: { select: { id: true, name: true, emoji: true } },
                },
            },
            sender: {
                select: { id: true, name: true, avatarUrl: true, email: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function getSentProjectInvitations(userId: string, teamId?: string, isWorkspaceLeader?: boolean) {
    const where: any = {};

    if (teamId) {
        where.project = { teamId };
    }

    if (!isWorkspaceLeader) {
        where.OR = [
            { senderId: userId },
            { project: { managerId: userId } },
        ];
    }

    return await prisma.projectInvitation.findMany({
        where: {
            ...where,
            status: { in: ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"] },
        },
        include: {
            project: {
                select: {
                    id: true,
                    title: true,
                    emoji: true,
                    teamId: true,
                    team: { select: { id: true, name: true, emoji: true } },
                    manager: { select: { id: true, name: true, avatarUrl: true } },
                },
            },
            receiver: {
                select: { id: true, name: true, avatarUrl: true, email: true },
            },
            sender: {
                select: { id: true, name: true, avatarUrl: true, email: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function getPendingInvitationsCount(userId: string, teamId?: string) {
    const where: any = {
        receiverId: userId,
        status: "PENDING",
    };
    const count = await prisma.projectInvitation.count({ where });
    return { count };
}

export async function acceptProjectInvitation(invitationId: string, userId: string) {
    const invitation = await prisma.projectInvitation.findUnique({
        where: { id: invitationId },
        include: {
            project: { select: { id: true, title: true, teamId: true, managerId: true } },
            sender: { select: { id: true, name: true, email: true } },
            receiver: { select: { id: true, name: true, email: true } },
        },
    });

    if (!invitation) throw new Error("Invitation not found.");
    if (invitation.receiverId !== userId) {
        throw new Error("You are not authorized to accept this invitation.");
    }
    if (invitation.status !== "PENDING") {
        throw new Error(`Invitation is no longer pending (current status: ${invitation.status}).`);
    }

    // Update invitation to ACCEPTED
    const updatedInvitation = await prisma.projectInvitation.update({
        where: { id: invitationId },
        data: {
            status: "ACCEPTED",
            respondedAt: new Date(),
        },
    });

    // Create or update ProjectMember relation
    const member = await prisma.projectMember.upsert({
        where: {
            projectId_userId: {
                projectId: invitation.projectId,
                userId: invitation.receiverId,
            },
        },
        update: {
            role: invitation.role,
            dailyCapacity: invitation.dailyCapacity,
        },
        create: {
            projectId: invitation.projectId,
            userId: invitation.receiverId,
            role: invitation.role,
            dailyCapacity: invitation.dailyCapacity,
        },
        include: { user: true, project: true },
    });

    // Notify the sender
    await createNotification({
        userId: invitation.senderId,
        content: `${invitation.receiver.name} accepted the invitation to join project "${invitation.project.title}".`,
        type: "PROJECT_INVITATION_ACCEPTED",
        teamId: invitation.project.teamId,
    }).catch((err) => {
        console.error("Failed to create invitation accepted notification:", err);
    });

    // Emit socket events
    notifyUser(invitation.senderId, "project_invitation_accepted", {
        invitationId,
        projectId: invitation.projectId,
        projectTitle: invitation.project.title,
        member: invitation.receiver,
    });
    notifyTeam(invitation.project.teamId, "project_updated", {
        projectId: invitation.projectId,
        action: "MEMBER_JOINED",
        userId: invitation.receiverId,
        projectTitle: invitation.project.title,
    });
    notifyUser(userId, "project_joined", {
        projectId: invitation.projectId,
    });

    // Fetch the joined project data to return directly
    const project = await prisma.project.findUnique({
        where: { id: invitation.projectId },
        include: {
            manager: true,
            folder: true,
            members: { include: { user: true } },
            columns: { orderBy: { order: "asc" } },
        },
    });

    return {
        message: "Invitation accepted successfully",
        invitation: updatedInvitation,
        member,
        project: project ? mapProjectData(project) : null,
    };
}

export async function rejectProjectInvitation(invitationId: string, userId: string) {
    const invitation = await prisma.projectInvitation.findUnique({
        where: { id: invitationId },
        include: {
            project: { select: { id: true, title: true, teamId: true } },
            receiver: { select: { id: true, name: true } },
        },
    });

    if (!invitation) throw new Error("Invitation not found.");
    if (invitation.receiverId !== userId) {
        throw new Error("You are not authorized to decline this invitation.");
    }
    if (invitation.status !== "PENDING") {
        throw new Error(`Invitation is no longer pending (current status: ${invitation.status}).`);
    }

    const updatedInvitation = await prisma.projectInvitation.update({
        where: { id: invitationId },
        data: {
            status: "REJECTED",
            respondedAt: new Date(),
        },
    });

    notifyUser(invitation.senderId, "project_invitation_rejected", {
        invitationId,
        projectId: invitation.projectId,
        projectTitle: invitation.project.title,
        memberName: invitation.receiver.name,
    });

    return {
        message: "Invitation declined",
        invitation: updatedInvitation,
    };
}

export async function cancelProjectInvitation(invitationId: string, actingUserId: string) {
    const invitation = await prisma.projectInvitation.findUnique({
        where: { id: invitationId },
        include: {
            project: { select: { id: true, title: true, teamId: true, managerId: true } },
        },
    });

    if (!invitation) throw new Error("Invitation not found.");

    const isSender = invitation.senderId === actingUserId;
    const isManager = invitation.project.managerId === actingUserId;

    if (!isSender && !isManager) {
        throw new Error("Only the sender or project manager can cancel this invitation.");
    }

    if (invitation.status !== "PENDING") {
        throw new Error(`Invitation is no longer pending (current status: ${invitation.status}).`);
    }

    const updatedInvitation = await prisma.projectInvitation.update({
        where: { id: invitationId },
        data: {
            status: "CANCELLED",
            respondedAt: new Date(),
        },
    });

    notifyUser(invitation.receiverId, "project_invitation_cancelled", {
        invitationId,
        projectId: invitation.projectId,
    });

    return {
        message: "Invitation cancelled",
        invitation: updatedInvitation,
    };
}

export async function createProjectColumn(projectId: string, name: string, type: string = "CUSTOM", isComplete?: boolean) {
    const existing = await prisma.projectColumn.findFirst({
        where: { projectId, name: { equals: name, mode: "insensitive" } },
    });
    if (existing) {
        throw new Error(`A column named "${name}" already exists in this project.`);
    }

    const lastCol = await prisma.projectColumn.findFirst({
        where: { projectId },
        orderBy: { order: "desc" },
    });
    const order = lastCol ? lastCol.order + 1 : 0;

    return await prisma.projectColumn.create({
        data: {
            projectId,
            name: name.trim(),
            type: "CUSTOM",
            order,
            isComplete: !!isComplete,
        },
    });
}

export async function updateProjectColumn(columnId: string, name?: string, type?: string, isComplete?: boolean) {
    const col = await prisma.projectColumn.findUnique({ where: { id: columnId } });
    if (!col) throw new Error("Column not found.");

    const updateData: any = {};
    if (name !== undefined && name.trim()) {
        const existing = await prisma.projectColumn.findFirst({
            where: {
                projectId: col.projectId,
                name: { equals: name.trim(), mode: "insensitive" },
                id: { not: columnId },
            },
        });
        if (existing) {
            throw new Error(`A column named "${name.trim()}" already exists in this project.`);
        }
        updateData.name = name.trim();
    }
    if (isComplete !== undefined) {
        updateData.isComplete = isComplete;
    }
    if (type !== undefined) {
        updateData.type = type;
    }

    return await prisma.projectColumn.update({
        where: { id: columnId },
        data: updateData,
    });
}

export async function deleteProjectColumn(columnId: string) {
    const col = await prisma.projectColumn.findUnique({
        where: { id: columnId },
        include: { tasks: true },
    });
    if (!col) throw new Error("Column not found.");

    if (col.type !== "CUSTOM") {
        throw new Error("Core system workflow stages cannot be deleted.");
    }

    const totalColumns = await prisma.projectColumn.count({
        where: { projectId: col.projectId },
    });
    if (totalColumns <= 1) {
        throw new Error("Cannot delete the only remaining column in the project.");
    }

    // Find fallback column
    const fallbackCol = await prisma.projectColumn.findFirst({
        where: { projectId: col.projectId, id: { not: columnId } },
        orderBy: { order: "asc" },
    });

    if (fallbackCol) {
        if (col.tasks.length > 0) {
            await prisma.projectTask.updateMany({
                where: { columnId },
                data: { columnId: fallbackCol.id },
            });
        }
        await prisma.projectSubtask.updateMany({
            where: { columnId },
            data: { columnId: fallbackCol.id },
        });
    }

    await prisma.projectColumn.delete({ where: { id: columnId } });

    return { message: "Column deleted successfully", fallbackColumnId: fallbackCol?.id, fallbackColumnName: fallbackCol?.name };
}

export async function reorderProjectColumns(projectId: string, columnOrders: { id: string; order: number }[]) {
    await prisma.$transaction(
        columnOrders.map((item) =>
            prisma.projectColumn.update({
                where: { id: item.id },
                data: { order: item.order },
            })
        )
    );
    return await prisma.projectColumn.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
    });
}



// ----------------------------------------------------
// PROJECT TASK & SUBTASK COMMENTS
// ----------------------------------------------------

export async function getProjectTaskComments(taskId: string, subtaskId?: string) {
    return await prisma.projectTaskComment.findMany({
        where: subtaskId
            ? { subtaskId }
            : { taskId, subtaskId: null },
        include: {
            user: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
            resolvedBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
        orderBy: { createdAt: "asc" },
    });
}

export async function createProjectTaskComment(
    projectId: string,
    taskId: string,
    userId: string,
    content: string,
    subtaskId?: string
) {
    if (!content || !content.trim()) {
        throw new Error("Comment content cannot be empty.");
    }

    const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        include: {
            project: { include: { members: true } },
            assignees: true,
            subtasks: { where: subtaskId ? { id: subtaskId } : undefined, include: { assignedTo: true } },
        },
    });

    if (!task) throw new Error("Task not found.");

    const comment = await prisma.projectTaskComment.create({
        data: {
            taskId,
            subtaskId: subtaskId || null,
            userId,
            content: content.trim(),
        },
        include: {
            user: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });

    const subtaskTarget = subtaskId ? task.subtasks.find((s) => s.id === subtaskId) : null;
    const targetTitle = subtaskTarget ? `subtask "${subtaskTarget.title}"` : `task "${task.title}"`;

    const activity = await prisma.projectTaskActivity.create({
        data: {
            taskId,
            subtaskId: subtaskId || null,
            userId,
            actionType: "COMMENT",
            details: JSON.stringify({
                note: `Commented on ${targetTitle}: "${content.trim().slice(0, 80)}"`,
            }),
        },
        include: {
            user: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });

    // Real-time broadcast to the team room
    const teamId = task.project.teamId;
    notifyTeam(teamId, "project_task_comment_created", {
        projectId,
        taskId,
        subtaskId: subtaskId || null,
        comment,
        activity,
    });

    // In-app notification to subtask assignee if someone else commented
    const commentingUser = (comment as any).user;
    const authorName = commentingUser?.name || commentingUser?.fullName || "A team member";

    if (subtaskTarget && subtaskTarget.assignedToId && subtaskTarget.assignedToId !== userId) {
        await createNotification({
            userId: subtaskTarget.assignedToId,
            type: "PROJECT_SUBTASK_COMMENT",
            content: `${authorName} commented on your subtask "${subtaskTarget.title}": "${content.trim().slice(0, 60)}"`,
            taskId: `project:${projectId}:task:${taskId}:subtask:${subtaskId}`,
            teamId,
        }).catch((e) => console.error("Notification error:", e));
    } else if (!subtaskId && Array.isArray(task.assignees)) {
        for (const a of task.assignees) {
            if (a.userId && a.userId !== userId) {
                await createNotification({
                    userId: a.userId,
                    type: "PROJECT_TASK_COMMENT",
                    content: `${authorName} commented on task "${task.title}": "${content.trim().slice(0, 60)}"`,
                    taskId: `project:${projectId}:task:${taskId}`,
                    teamId,
                }).catch((e) => console.error("Notification error:", e));
            }
        }
    }

    return { comment, activity };
}

export async function deleteProjectTaskComment(commentId: string, actingUserId: string) {
    const comment = await prisma.projectTaskComment.findUnique({
        where: { id: commentId },
        include: {
            task: {
                include: {
                    project: { include: { members: true } },
                },
            },
        },
    });

    if (!comment) throw new Error("Comment not found.");

    const isAuthor = comment.userId === actingUserId;
    const isManager = comment.task.project.managerId === actingUserId;
    const isProjectLeader = comment.task.project.members.some(
        (m) => m.userId === actingUserId && (m.role === "LEADER" || m.role === "MANAGER")
    );

    if (!isAuthor && !isManager && !isProjectLeader) {
        throw new Error("Access denied. You can only delete your own comments.");
    }

    await prisma.projectTaskComment.delete({ where: { id: commentId } });

    // Real-time broadcast
    notifyTeam(comment.task.project.teamId, "project_task_comment_deleted", {
        projectId: comment.task.projectId,
        taskId: comment.taskId,
        subtaskId: comment.subtaskId,
        commentId,
    });

    return { success: true, message: "Comment deleted successfully." };
}

export async function updateProjectTaskComment(
    commentId: string,
    actingUserId: string,
    content: string
) {
    if (!content || !content.trim()) {
        throw new Error("Comment content cannot be empty.");
    }

    const comment = await prisma.projectTaskComment.findUnique({
        where: { id: commentId },
        include: {
            task: { include: { project: { include: { members: true } } } },
        },
    });

    if (!comment) throw new Error("Comment not found.");

    if (comment.userId !== actingUserId) {
        throw new Error("Access denied. Only the author can edit this comment.");
    }

    const updated = await prisma.projectTaskComment.update({
        where: { id: commentId },
        data: {
            content: content.trim(),
            isEdited: true,
        },
        include: {
            user: { select: { id: true, name: true, fullName: true, avatarUrl: true } },
            resolvedBy: { select: { id: true, name: true, fullName: true, avatarUrl: true } },
        },
    });

    notifyTeam(comment.task.project.teamId, "project_task_comment_updated", {
        projectId: comment.task.projectId,
        taskId: comment.taskId,
        subtaskId: comment.subtaskId,
        comment: updated,
    });

    return updated;
}

export async function toggleResolveProjectTaskComment(
    commentId: string,
    actingUserId: string,
    explicitResolve?: boolean
) {
    const comment = await prisma.projectTaskComment.findUnique({
        where: { id: commentId },
        include: {
            task: {
                include: {
                    project: { include: { members: true } },
                    assignees: true,
                    subtasks: true,
                },
            },
        },
    });

    if (!comment) throw new Error("Comment not found.");

    const project = comment.task.project;
    const isAuthor = comment.userId === actingUserId;
    const isManager = project.managerId === actingUserId;
    const isProjectLeader = project.members.some(
        (m) => m.userId === actingUserId && (m.role === "LEADER" || m.role === "MANAGER")
    );
    const isMainTaskAssignee = comment.task.assignees.some((a) => a.userId === actingUserId);
    const isSubtaskAssignee = comment.subtaskId
        ? comment.task.subtasks.some((st) => st.id === comment.subtaskId && st.assignedToId === actingUserId)
        : false;

    if (!isAuthor && !isManager && !isProjectLeader && !isMainTaskAssignee && !isSubtaskAssignee) {
        throw new Error("Access denied. Only the author, assignees, or project leaders can resolve comments.");
    }

    const nextResolveState = explicitResolve !== undefined ? explicitResolve : !comment.isResolved;

    const updated = await prisma.projectTaskComment.update({
        where: { id: commentId },
        data: {
            isResolved: nextResolveState,
            resolvedById: nextResolveState ? actingUserId : null,
            resolvedAt: nextResolveState ? new Date() : null,
        },
        include: {
            user: { select: { id: true, name: true, fullName: true, avatarUrl: true } },
            resolvedBy: { select: { id: true, name: true, fullName: true, avatarUrl: true } },
        },
    });

    const actionType = nextResolveState ? "COMMENT_RESOLVED" : "COMMENT_REOPENED";
    const activity = await prisma.projectTaskActivity.create({
        data: {
            taskId: comment.taskId,
            subtaskId: comment.subtaskId || null,
            userId: actingUserId,
            actionType,
            details: JSON.stringify({
                note: nextResolveState ? "Resolved comment thread" : "Reopened comment thread",
                commentId,
            }),
        },
        include: {
            user: { select: { id: true, name: true, fullName: true, avatarUrl: true } },
        },
    });

    notifyTeam(project.teamId, "project_task_comment_resolved", {
        projectId: comment.task.projectId,
        taskId: comment.taskId,
        subtaskId: comment.subtaskId,
        comment: updated,
        activity,
    });

    return { comment: updated, activity };
}


// ==========================================
// PROJECT ASSETS & DOCUMENTATION SERVICES
// ==========================================

export async function getProjectAssets(
    projectId: string,
    filters?: { category?: string; type?: string; isPinned?: boolean; search?: string }
) {
    const where: any = { projectId };
    if (filters?.category && filters.category !== "ALL") {
        where.category = filters.category;
    }
    if (filters?.type) {
        where.type = filters.type;
    }
    if (filters?.isPinned !== undefined) {
        where.isPinned = filters.isPinned;
    }
    if (filters?.search && filters.search.trim()) {
        const query = filters.search.trim();
        where.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { url: { contains: query, mode: "insensitive" } },
            { content: { contains: query, mode: "insensitive" } },
        ];
    }

    return prisma.projectAsset.findMany({
        where,
        include: {
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
        orderBy: [
            { isPinned: "desc" },
            { createdAt: "desc" },
        ],
    });
}

export async function createProjectAsset(
    projectId: string,
    data: {
        title: string;
        type?: "LINK" | "DOC";
        category?: "CODE" | "DESIGN" | "DOCS" | "SHEET" | "DEPLOYMENT" | "MEETING" | "GENERAL";
        url?: string;
        content?: string;
        description?: string;
        isPinned?: boolean;
    },
    userId: string
) {
    if (!data.title || !data.title.trim()) {
        throw new Error("Asset title is required.");
    }

    const type = data.type || "LINK";
    if (type === "LINK" && !data.url) {
        throw new Error("Asset URL is required for Link assets.");
    }
    if (type === "DOC" && !data.content) {
        throw new Error("Document content is required for Doc assets.");
    }

    return prisma.projectAsset.create({
        data: {
            projectId,
            title: data.title.trim(),
            type,
            category: data.category || "GENERAL",
            url: data.url ? data.url.trim() : null,
            content: data.content || null,
            description: data.description ? data.description.trim() : null,
            isPinned: Boolean(data.isPinned),
            createdById: userId,
        },
        include: {
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
}

export async function updateProjectAsset(
    projectId: string,
    assetId: string,
    data: {
        title?: string;
        type?: "LINK" | "DOC";
        category?: "CODE" | "DESIGN" | "DOCS" | "SHEET" | "DEPLOYMENT" | "MEETING" | "GENERAL";
        url?: string;
        content?: string;
        description?: string;
        isPinned?: boolean;
    },
    userId: string,
    isLeaderOrManager: boolean = false
) {
    const existing = await prisma.projectAsset.findFirst({
        where: { id: assetId, projectId },
    });

    if (!existing) {
        throw new Error("Asset not found.");
    }

    if (!isLeaderOrManager && existing.createdById !== userId) {
        throw new Error("Only the asset creator or project leaders can edit this asset.");
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title.trim();
    if (data.type !== undefined) updateData.type = data.type;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.url !== undefined) updateData.url = data.url ? data.url.trim() : null;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.description !== undefined) updateData.description = data.description ? data.description.trim() : null;
    if (data.isPinned !== undefined) updateData.isPinned = Boolean(data.isPinned);

    return prisma.projectAsset.update({
        where: { id: assetId },
        data: updateData,
        include: {
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
}

export async function deleteProjectAsset(
    projectId: string,
    assetId: string,
    userId: string,
    isLeaderOrManager: boolean = false
) {
    const existing = await prisma.projectAsset.findFirst({
        where: { id: assetId, projectId },
    });

    if (!existing) {
        throw new Error("Asset not found.");
    }

    if (!isLeaderOrManager && existing.createdById !== userId) {
        throw new Error("Only the asset creator or project leaders can delete this asset.");
    }

    return prisma.projectAsset.delete({
        where: { id: assetId },
    });
}

export async function togglePinAsset(
    projectId: string,
    assetId: string,
    userId: string,
    isLeaderOrManager: boolean = false
) {
    const existing = await prisma.projectAsset.findFirst({
        where: { id: assetId, projectId },
    });

    if (!existing) {
        throw new Error("Asset not found.");
    }

    if (!isLeaderOrManager && existing.createdById !== userId) {
        throw new Error("Only the asset creator or project leaders can pin/unpin this asset.");
    }

    return prisma.projectAsset.update({
        where: { id: assetId },
        data: { isPinned: !existing.isPinned },
        include: {
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
}

// ==========================================
// PROJECT CATEGORIES (DOCS & LINKS)
// ==========================================

export async function getProjectCategories(projectId: string) {
    return prisma.projectCategory.findMany({
        where: { projectId },
        include: {
            _count: {
                select: { docs: true, links: true },
            },
        },
        orderBy: { createdAt: "asc" },
    });
}

export async function createProjectCategory(
    projectId: string,
    data: { name: string; color?: string }
) {
    if (!data.name || !data.name.trim()) {
        throw new Error("Category name is required.");
    }

    return prisma.projectCategory.create({
        data: {
            projectId,
            name: data.name.trim(),
            color: data.color ? data.color.trim() : null,
        },
        include: {
            _count: {
                select: { docs: true, links: true },
            },
        },
    });
}

export async function updateProjectCategory(
    projectId: string,
    categoryId: string,
    data: { name?: string; color?: string }
) {
    const existing = await prisma.projectCategory.findFirst({
        where: { id: categoryId, projectId },
    });

    if (!existing) {
        throw new Error("Category not found.");
    }

    const updateData: any = {};
    if (data.name !== undefined) {
        if (!data.name.trim()) throw new Error("Category name cannot be empty.");
        updateData.name = data.name.trim();
    }
    if (data.color !== undefined) {
        updateData.color = data.color ? data.color.trim() : null;
    }

    return prisma.projectCategory.update({
        where: { id: categoryId },
        data: updateData,
        include: {
            _count: {
                select: { docs: true, links: true },
            },
        },
    });
}

export async function deleteProjectCategory(projectId: string, categoryId: string) {
    const existing = await prisma.projectCategory.findFirst({
        where: { id: categoryId, projectId },
    });

    if (!existing) {
        throw new Error("Category not found.");
    }

    // Set categoryId to null on associated docs & links first to ensure clean fallback
    await prisma.$transaction([
        prisma.projectDoc.updateMany({
            where: { projectId, categoryId },
            data: { categoryId: null },
        }),
        prisma.projectLink.updateMany({
            where: { projectId, categoryId },
            data: { categoryId: null },
        }),
        prisma.projectCategory.delete({
            where: { id: categoryId },
        }),
    ]);

    return { success: true, message: "Category deleted and child items moved to uncategorized." };
}

// ==========================================
// PROJECT DOCUMENTS (RICH-TEXT WORKSPACE)
// ==========================================

export async function getProjectDocs(
    projectId: string,
    filters?: { categoryId?: string; search?: string }
) {
    const where: any = { projectId };
    if (filters?.categoryId) {
        if (filters.categoryId === "uncategorized" || filters.categoryId === "null") {
            where.categoryId = null;
        } else if (filters.categoryId !== "ALL") {
            where.categoryId = filters.categoryId;
        }
    }
    if (filters?.search && filters.search.trim()) {
        const query = filters.search.trim();
        where.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { content: { contains: query, mode: "insensitive" } },
        ];
    }

    return prisma.projectDoc.findMany({
        where,
        include: {
            category: true,
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
        orderBy: { updatedAt: "desc" },
    });
}

export async function createProjectDoc(
    projectId: string,
    data: {
        title: string;
        content?: string;
        categoryId?: string | null;
    },
    userId: string
) {
    if (!data.title || !data.title.trim()) {
        throw new Error("Document title is required.");
    }

    let resolvedCategoryId: string | null = null;
    if (data.categoryId && data.categoryId !== "uncategorized" && data.categoryId !== "null") {
        const cat = await prisma.projectCategory.findFirst({
            where: { id: data.categoryId, projectId },
        });
        if (cat) {
            resolvedCategoryId = cat.id;
        }
    }

    return prisma.projectDoc.create({
        data: {
            projectId,
            title: data.title.trim(),
            content: data.content ?? "",
            categoryId: resolvedCategoryId,
            createdById: userId,
        },
        include: {
            category: true,
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
}

export async function updateProjectDoc(
    projectId: string,
    docId: string,
    data: {
        title?: string;
        content?: string;
        categoryId?: string | null;
    },
    userId: string,
    isLeaderOrManager: boolean = false
) {
    const existing = await prisma.projectDoc.findFirst({
        where: { id: docId, projectId },
    });

    if (!existing) {
        throw new Error("Document not found.");
    }

    if (!isLeaderOrManager && existing.createdById !== userId) {
        throw new Error("Only the document author or project leaders can edit this document.");
    }

    const updateData: any = {};
    if (data.title !== undefined) {
        if (!data.title.trim()) throw new Error("Document title cannot be empty.");
        updateData.title = data.title.trim();
    }
    if (data.content !== undefined) updateData.content = data.content;
    if (data.categoryId !== undefined) {
        if (data.categoryId && data.categoryId !== "uncategorized" && data.categoryId !== "null") {
            const cat = await prisma.projectCategory.findFirst({
                where: { id: data.categoryId, projectId },
            });
            updateData.categoryId = cat ? cat.id : null;
        } else {
            updateData.categoryId = null;
        }
    }

    return prisma.projectDoc.update({
        where: { id: docId },
        data: updateData,
        include: {
            category: true,
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
}

export async function deleteProjectDoc(
    projectId: string,
    docId: string,
    userId: string,
    isLeaderOrManager: boolean = false
) {
    const existing = await prisma.projectDoc.findFirst({
        where: { id: docId, projectId },
    });

    if (!existing) {
        throw new Error("Document not found.");
    }

    if (!isLeaderOrManager && existing.createdById !== userId) {
        throw new Error("Only the document author or project leaders can delete this document.");
    }

    return prisma.projectDoc.delete({
        where: { id: docId },
    });
}

// ==========================================
// PROJECT LINKS & RESOURCES
// ==========================================

export async function getProjectLinks(
    projectId: string,
    filters?: { categoryId?: string; search?: string }
) {
    const where: any = { projectId };
    if (filters?.categoryId) {
        if (filters.categoryId === "uncategorized" || filters.categoryId === "null") {
            where.categoryId = null;
        } else if (filters.categoryId !== "ALL") {
            where.categoryId = filters.categoryId;
        }
    }
    if (filters?.search && filters.search.trim()) {
        const query = filters.search.trim();
        where.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { url: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
        ];
    }

    return prisma.projectLink.findMany({
        where,
        include: {
            category: true,
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function createProjectLink(
    projectId: string,
    data: {
        title: string;
        url: string;
        description?: string;
        categoryId?: string | null;
    },
    userId: string
) {
    if (!data.title || !data.title.trim()) {
        throw new Error("Link title is required.");
    }
    if (!data.url || !data.url.trim()) {
        throw new Error("Link URL is required.");
    }

    let resolvedCategoryId: string | null = null;
    if (data.categoryId && data.categoryId !== "uncategorized" && data.categoryId !== "null") {
        const cat = await prisma.projectCategory.findFirst({
            where: { id: data.categoryId, projectId },
        });
        if (cat) {
            resolvedCategoryId = cat.id;
        }
    }

    return prisma.projectLink.create({
        data: {
            projectId,
            title: data.title.trim(),
            url: data.url.trim(),
            description: data.description ? data.description.trim() : null,
            categoryId: resolvedCategoryId,
            createdById: userId,
        },
        include: {
            category: true,
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
}

export async function updateProjectLink(
    projectId: string,
    linkId: string,
    data: {
        title?: string;
        url?: string;
        description?: string;
        categoryId?: string | null;
    },
    userId: string,
    isLeaderOrManager: boolean = false
) {
    const existing = await prisma.projectLink.findFirst({
        where: { id: linkId, projectId },
    });

    if (!existing) {
        throw new Error("Link not found.");
    }

    if (!isLeaderOrManager && existing.createdById !== userId) {
        throw new Error("Only the link creator or project leaders can edit this link.");
    }

    const updateData: any = {};
    if (data.title !== undefined) {
        if (!data.title.trim()) throw new Error("Link title cannot be empty.");
        updateData.title = data.title.trim();
    }
    if (data.url !== undefined) {
        if (!data.url.trim()) throw new Error("Link URL cannot be empty.");
        updateData.url = data.url.trim();
    }
    if (data.description !== undefined) {
        updateData.description = data.description ? data.description.trim() : null;
    }
    if (data.categoryId !== undefined) {
        if (data.categoryId && data.categoryId !== "uncategorized" && data.categoryId !== "null") {
            const cat = await prisma.projectCategory.findFirst({
                where: { id: data.categoryId, projectId },
            });
            updateData.categoryId = cat ? cat.id : null;
        } else {
            updateData.categoryId = null;
        }
    }

    return prisma.projectLink.update({
        where: { id: linkId },
        data: updateData,
        include: {
            category: true,
            createdBy: {
                select: { id: true, name: true, fullName: true, avatarUrl: true },
            },
        },
    });
}

export async function deleteProjectLink(
    projectId: string,
    linkId: string,
    userId: string,
    isLeaderOrManager: boolean = false
) {
    const existing = await prisma.projectLink.findFirst({
        where: { id: linkId, projectId },
    });

    if (!existing) {
        throw new Error("Link not found.");
    }

    if (!isLeaderOrManager && existing.createdById !== userId) {
        throw new Error("Only the link creator or project leaders can delete this link.");
    }

    return prisma.projectLink.delete({
        where: { id: linkId },
    });
}

