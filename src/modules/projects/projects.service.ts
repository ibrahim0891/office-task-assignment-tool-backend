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
    { name: "Backlog", order: 0, isComplete: false },
    { name: "In Progress", order: 1, isComplete: false },
    { name: "In Review", order: 2, isComplete: false },
    { name: "Done", order: 3, isComplete: true },
];

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
    if (task.column?.isComplete) return "Done";
    if (task.blockerCategory) return "Blocked";
    if (task.riskLevel === "AT_RISK") return "AtRisk";
    
    const colName = task.column?.name;
    if (colName === "Backlog") return "Backlog";
    if (colName === "In Progress") return "InProgress";
    if (colName === "In Review") return "InReview";
    if (colName === "Done") return "Done";
    
    return "InProgress";
}

function mapSubtaskStatus(sub: any) {
    if (sub.isCompleted) return "Done";
    if (sub.acceptanceStatus === "PENDING") return "PendingAcceptance";
    if (sub.acceptanceStatus === "REJECTED") return "ReworkRequired";
    return "InProgress";
}

function mapProjectData(project: any) {
    if (!project) return null;
    
    // Map tasks and their subtasks
    const mappedTasks = (project.tasks || []).map((task: any) => {
        const mappedSubtasks = (task.subtasks || []).map((sub: any) => ({
            ...sub,
            status: mapSubtaskStatus(sub),
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
export async function getProjectsList(teamId: string, userId?: string, isWorkspaceLeader?: boolean) {
    if (!teamId) throw new Error("teamId is required.");

    const whereClause: any = { teamId };

    if (userId && !isWorkspaceLeader) {
        whereClause.OR = [
            { managerId: userId },
            { members: { some: { userId } } },
        ];
    }

    const projects = await prisma.project.findMany({
        where: whereClause,
        include: {
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
        const doneTasks = p.tasks.filter((t) => t.column.isComplete).length;
        const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
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
export async function getPortfolioSummary(teamId: string, userId?: string, isWorkspaceLeader?: boolean) {
    const whereClause: any = { teamId };

    if (userId && !isWorkspaceLeader) {
        whereClause.OR = [
            { managerId: userId },
            { members: { some: { userId } } },
        ];
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
                        include: { assignedTo: true, reviewer: true },
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
        },
    });

    if (!project) throw new Error("Project not found.");

    // Recalculate progress
    const totalTasks = project.tasks.length;
    const doneTasks = project.tasks.filter((t) => t.column.isComplete).length;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

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
    const {
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

    if (!title || !startDate || !dueDate || !columnId) {
        throw new Error("title, columnId, startDate, and dueDate are required.");
    }

    return await prisma.projectTask.create({
        data: {
            projectId,
            columnId,
            title,
            description: description || "",
            startDate: new Date(startDate),
            dueDate: new Date(dueDate),
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
                    startDate: new Date(st.startDate || startDate),
                    dueDate: new Date(st.dueDate || dueDate),
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
}

export async function updateProjectTask(taskId: string, data: any) {
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

export async function createProjectSubtask(taskId: string, data: any) {
    return await prisma.projectSubtask.create({
        data: {
            parentTaskId: taskId,
            title: data.title,
            description: data.description || "",
            assignedToId: data.assignedToId,
            startDate: new Date(data.startDate),
            dueDate: new Date(data.dueDate),
            estimatedDays: data.estimatedDays ? Number(data.estimatedDays) : 1.0,
            reviewerId: data.reviewerId || null,
        },
        include: { assignedTo: true, reviewer: true },
    });
}

export async function updateProjectSubtask(subtaskId: string, data: any) {
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.isCompleted !== undefined) updateData.isCompleted = Boolean(data.isCompleted);
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate);
    if (data.estimatedDays !== undefined) updateData.estimatedDays = Number(data.estimatedDays);
    if (data.actualDays !== undefined) updateData.actualDays = Number(data.actualDays);

    return await prisma.projectSubtask.update({
        where: { id: subtaskId },
        data: updateData,
        include: { assignedTo: true, reviewer: true },
    });
}

export async function deleteProjectSubtask(subtaskId: string) {
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

    if (teamId) {
        where.project = { teamId };
    }

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
    if (teamId) {
        where.project = { teamId };
    }
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

