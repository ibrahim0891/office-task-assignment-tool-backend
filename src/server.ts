import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { PrismaClient, Role } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import {
    processAvatarUpload,
    deleteFromCloudinary,
    isCloudinaryConfigured,
    uploadImageAttachment,
} from "./cloudinary";

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Global Middleware to enforce OBSERVER read-only security on all POST/PUT/DELETE write routes
app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "DELETE"].includes(req.method)) {
        return next();
    }
    if (req.path === "/api/auth/login") {
        return next();
    }

    const userId = req.headers["x-user-id"] as string;
    let teamId = (req.headers["x-team-id"] as string) || req.body.teamId;

    if (!userId) {
        return next();
    }

    // If taskId exists in the path params, fetch task to resolve teamId
    const taskMatch = req.path.match(/\/api\/tasks\/([^/]+)/);
    if (!teamId && taskMatch && taskMatch[1]) {
        try {
            const task = await prisma.task.findUnique({
                where: { id: taskMatch[1] },
            });
            if (task) {
                teamId = task.teamId;
            }
        } catch (e) {}
    }

    if (teamId) {
        try {
            const membership = await prisma.userTeam.findUnique({
                where: { userId_teamId: { userId, teamId } },
            });
            if (membership && membership.role === Role.OBSERVER) {
                return res
                    .status(403)
                    .json({
                        error: "Observers have read-only access and cannot modify workspace data.",
                    });
            }
        } catch (e) {}
    }
    next();
});

// Helper for dates without timezone shifts
function getLocalDateString(date: Date): string {
    return date.toISOString().split("T")[0];
}

function parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split("-").map(Number);
    // Create Date at noon local time to avoid timezone offsets causing date flips
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

// ============================================================================
// CORE ENGINES: CARRY-FORWARD & RECURRING TASKS
// ============================================================================

async function runCarryForwardAndRecurring(teamId: string, dateStr: string) {
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

// ============================================================================
// API ENDPOINTS
// ============================================================================

// 0. AUTHENTICATION
app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || user.password !== password) {
            return res
                .status(401)
                .json({ error: "Invalid email or password." });
        }

        res.json(user);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { name, email, password } = req.body;
    try {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res
                .status(400)
                .json({ error: "User with this email already exists." });
        }

        const user = await prisma.user.create({
            data: { name, email, password },
        });

        // Automatically create a personal workspace for this member
        const personalTeam = await prisma.team.create({
            data: { name: `${name.split(" ")[0]}'s Personal Space` },
        });

        // Create Default Kanban Columns
        const defaultCols = [
            {
                name: "To Do",
                order: 0,
                wipLimit: 10,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "Up Next",
                order: 1,
                wipLimit: 5,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "In Progress",
                order: 2,
                wipLimit: 3,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "Blocked",
                order: 3,
                wipLimit: 3,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "Need Attention Later",
                order: 4,
                wipLimit: 5,
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
                teamId: personalTeam.id,
                name: col.name,
                order: col.order,
                wipLimit: col.wipLimit,
                isComplete: col.isComplete,
                triggersCarryForward: col.triggersCarryForward,
            })),
        });

        // Link user to their personal workspace as LEADER
        await prisma.userTeam.create({
            data: {
                userId: user.id,
                teamId: personalTeam.id,
                role: Role.LEADER,
            },
        });

        res.status(201).json(user);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 1. USERS & TEAMS
app.get(
    "/api/users/exclude-team/:teamId",
    async (req: Request, res: Response) => {
        const { teamId } = req.params;
        try {
            const users = await prisma.user.findMany({
                where: {
                    NOT: {
                        teamMemberships: {
                            some: { teamId },
                        },
                    },
                },
            });
            res.json(users);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

app.get("/api/users", async (req: Request, res: Response) => {
    const { search } = req.query;
    try {
        const whereClause: any = {};
        if (search) {
            whereClause.OR = [
                { name: { contains: search as string, mode: "insensitive" } },
                { email: { contains: search as string, mode: "insensitive" } },
                {
                    designation: {
                        contains: search as string,
                        mode: "insensitive",
                    },
                },
            ];
        }
        const users = await prisma.user.findMany({
            where: whereClause,
            include: {
                teamMemberships: {
                    include: { team: true },
                },
            },
        });
        res.json(users);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/users/profile/:userId", async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.userId },
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

        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }

        res.json(user);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/api/users/profile/:userId", async (req: Request, res: Response) => {
    const { userId } = req.params;
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
    } = req.body;

    try {
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!existingUser) {
            return res.status(404).json({ error: "User not found" });
        }

        let finalAvatarUrl = avatarUrl;
        if (avatarUrl !== undefined && avatarUrl !== existingUser.avatarUrl) {
            if (avatarUrl && avatarUrl.startsWith("data:image/")) {
                // Upload base64 image to Cloudinary & delete old Cloudinary image
                finalAvatarUrl = await processAvatarUpload(
                    avatarUrl,
                    existingUser.avatarUrl,
                );
            } else if (!avatarUrl && existingUser.avatarUrl) {
                // Avatar cleared -> delete old image from Cloudinary
                await deleteFromCloudinary(existingUser.avatarUrl);
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                ...(name !== undefined && { name }),
                ...(finalAvatarUrl !== undefined && {
                    avatarUrl: finalAvatarUrl,
                }),
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

        res.json(updatedUser);
    } catch (error: any) {
        console.error("Error updating user profile:", error);
        res.status(500).json({
            error: error.message || "Failed to update profile",
        });
    }
});

app.get("/api/teams", async (req: Request, res: Response) => {
    const userId =
        (req.query.userId as string) || (req.headers["x-user-id"] as string);
    try {
        const whereClause = userId
            ? {
                  members: {
                      some: { userId },
                  },
              }
            : {};

        const teams = await prisma.team.findMany({
            where: whereClause,
            include: {
                members: {
                    include: { user: true },
                },
                columns: true,
            },
        });
        res.json(teams);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Remove a team member (triggers reassignment of incomplete tasks to leader)
app.post(
    "/api/teams/:teamId/members/remove",
    async (req: Request, res: Response) => {
        const { teamId } = req.params;
        const { userId } = req.body; // User being removed
        const actingUserId = req.headers["x-user-id"] as string; // Logged in user doing the action

        try {
            // 1. Confirm acting user is a LEADER of this team
            const actorRole = await prisma.userTeam.findUnique({
                where: { userId_teamId: { userId: actingUserId, teamId } },
            });

            if (!actorRole || actorRole.role !== Role.LEADER) {
                return res
                    .status(403)
                    .json({ error: "Only team leaders can remove members." });
            }

            // 2. Find team leader to reassign tasks to (fallback to acting user)
            const leaders = await prisma.userTeam.findMany({
                where: { teamId, role: Role.LEADER },
            });
            const reassignedLeaderId = leaders[0]?.userId || actingUserId;

            // Get "Need Attention Later" column
            const columns = await prisma.taskColumn.findMany({
                where: { teamId },
            });
            const needAttentionCol =
                columns.find(
                    (c) => c.name.toLowerCase() === "need attention later",
                ) ||
                columns.find((c) =>
                    c.name.toLowerCase().includes("attention"),
                ) ||
                columns[0];

            // 3. Find all active, incomplete tasks assigned to the member who is leaving
            const memberTasks = await prisma.task.findMany({
                where: {
                    teamId,
                    assignedToId: userId,
                    isSoftDeleted: false,
                    column: { isComplete: false },
                },
            });

            // Reassign them to leader and flag as Need Attention
            for (const task of memberTasks) {
                await prisma.task.update({
                    where: { id: task.id },
                    data: {
                        assignedToId: reassignedLeaderId,
                        columnId: needAttentionCol.id,
                    },
                });

                // Audit Log
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

                // Notification
                await prisma.notification.create({
                    data: {
                        userId: reassignedLeaderId,
                        content: `Task "${task.title}" reassigned to you because the assignee was removed from the team.`,
                        type: "NEED_ATTENTION",
                        taskId: task.id,
                    },
                });
            }

            // 4. Remove membership
            await prisma.userTeam.delete({
                where: { userId_teamId: { userId, teamId } },
            });

            res.json({
                message:
                    "Member removed successfully, and active tasks reassigned.",
                reassignedCount: memberTasks.length,
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// Add a team member
app.post(
    "/api/teams/:teamId/members/add",
    async (req: Request, res: Response) => {
        const { teamId } = req.params;
        const { userId, role } = req.body;

        try {
            const membership = await prisma.userTeam.create({
                data: {
                    userId,
                    teamId,
                    role: (role as Role) || Role.MEMBER,
                },
                include: { user: true, team: true },
            });

            // Notify the user about workspace membership
            await prisma.notification.create({
                data: {
                    userId,
                    content: `You have been added to team workspace "${membership.team.name}" as a ${membership.role}.`,
                    type: "REASSIGN",
                },
            });

            res.json(membership);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// Invite a member by Email address (provisions account if new)
app.post(
    "/api/teams/:teamId/members/invite-by-email",
    async (req: Request, res: Response) => {
        const { teamId } = req.params;
        const { email, role } = req.body;
        const actingUserId = req.headers["x-user-id"] as string;

        if (!email || !email.trim()) {
            return res
                .status(400)
                .json({ error: "Email address is required." });
        }

        const cleanEmail = email.trim().toLowerCase();

        try {
            // 1. Confirm acting user is a LEADER of this team
            if (actingUserId) {
                const actorRole = await prisma.userTeam.findUnique({
                    where: { userId_teamId: { userId: actingUserId, teamId } },
                });

                if (!actorRole || actorRole.role !== Role.LEADER) {
                    return res
                        .status(403)
                        .json({
                            error: "Only team leaders can invite new members.",
                        });
                }
            }

            // 2. Check if user already exists
            let targetUser = await prisma.user.findUnique({
                where: { email: cleanEmail },
            });

            // If user does not exist, provision a new user profile with default password
            if (!targetUser) {
                const nameFromEmail = cleanEmail.split("@")[0];
                const formattedName =
                    nameFromEmail.charAt(0).tocapitalize() +
                    nameFromEmail.slice(1);

                targetUser = await prisma.user.create({
                    data: {
                        email: cleanEmail,
                        name: formattedName,
                        password: "password123",
                    },
                });

                // Provision target user's personal space
                const personalTeam = await prisma.team.create({
                    data: { name: `${formattedName}'s Personal Space` },
                });

                const defaultCols = [
                    {
                        name: "To Do",
                        order: 0,
                        wipLimit: 10,
                        isComplete: false,
                        triggersCarryForward: true,
                    },
                    {
                        name: "Up Next",
                        order: 1,
                        wipLimit: 5,
                        isComplete: false,
                        triggersCarryForward: true,
                    },
                    {
                        name: "In Progress",
                        order: 2,
                        wipLimit: 3,
                        isComplete: false,
                        triggersCarryForward: true,
                    },
                    {
                        name: "Blocked",
                        order: 3,
                        wipLimit: 3,
                        isComplete: false,
                        triggersCarryForward: true,
                    },
                    {
                        name: "Need Attention Later",
                        order: 4,
                        wipLimit: 5,
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
                        teamId: personalTeam.id,
                        name: col.name,
                        order: col.order,
                        wipLimit: col.wipLimit,
                        isComplete: col.isComplete,
                        triggersCarryForward: col.triggersCarryForward,
                    })),
                });

                await prisma.userTeam.create({
                    data: {
                        userId: targetUser.id,
                        teamId: personalTeam.id,
                        role: Role.LEADER,
                    },
                });
            }

            // 3. Check if already in the target team
            const existingMembership = await prisma.userTeam.findUnique({
                where: { userId_teamId: { userId: targetUser.id, teamId } },
            });

            if (existingMembership) {
                return res
                    .status(400)
                    .json({
                        error: "User is already a member of this workspace.",
                    });
            }

            // 4. Create membership in target team
            const membership = await prisma.userTeam.create({
                data: {
                    userId: targetUser.id,
                    teamId,
                    role: (role as Role) || Role.MEMBER,
                },
                include: { user: true, team: true },
            });

            // 5. Send notification to invited user
            await prisma.notification.create({
                data: {
                    userId: targetUser.id,
                    content: `You have been invited and added to workspace "${membership.team.name}" as a ${membership.role}.`,
                    type: "REASSIGN",
                },
            });

            res.json({
                message: "User invited successfully.",
                membership,
                user: targetUser,
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// Create new Team
app.post("/api/teams", async (req: Request, res: Response) => {
    const { name, creatorId } = req.body;
    try {
        const team = await prisma.team.create({
            data: { name },
        });

        // Create default columns
        const defaultCols = [
            {
                name: "To Do",
                order: 0,
                wipLimit: 10,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "Up Next",
                order: 1,
                wipLimit: 5,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "In Progress",
                order: 2,
                wipLimit: 3,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "Blocked",
                order: 3,
                wipLimit: 3,
                isComplete: false,
                triggersCarryForward: true,
            },
            {
                name: "Need Attention Later",
                order: 4,
                wipLimit: 5,
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

        // Add creator as LEADER
        await prisma.userTeam.create({
            data: {
                userId: creatorId,
                teamId: team.id,
                role: Role.LEADER,
            },
        });

        res.json(team);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Update Team Name
app.put("/api/teams/:teamId", async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { name } = req.body;
    const actingUserId = req.headers["x-user-id"] as string;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Team name is required." });
    }

    try {
        if (actingUserId) {
            const membership = await prisma.userTeam.findUnique({
                where: { userId_teamId: { userId: actingUserId, teamId } },
            });
            if (!membership) {
                return res
                    .status(403)
                    .json({ error: "Access denied. You are not a member of this workspace." });
            }
        }

        const updatedTeam = await prisma.team.update({
            where: { id: teamId },
            data: { name: name.trim() },
        });

        res.json(updatedTeam);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to update workspace name" });
    }
});

// Delete Team (Cascading deletion of all columns, tasks, subtasks, checklists, comments, attachments, activities, and user memberships)
app.delete("/api/teams/:teamId", async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { password, confirmationText } = req.body;
    const actingUserId = req.headers["x-user-id"] as string;

    if (!actingUserId) {
        return res.status(401).json({ error: "User authentication required." });
    }

    if (confirmationText !== "I know what I'm doing") {
        return res.status(400).json({
            error: 'Confirmation text must match "I know what I\'m doing" exactly.',
        });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: actingUserId },
        });

        if (!user || user.password !== password) {
            return res
                .status(401)
                .json({ error: "Incorrect password. Workspace deletion aborted." });
        }

        const membership = await prisma.userTeam.findUnique({
            where: { userId_teamId: { userId: actingUserId, teamId } },
        });

        if (!membership || membership.role !== Role.LEADER) {
            return res
                .status(403)
                .json({ error: "Only workspace leaders can delete a workspace." });
        }

        // Delete all Cloudinary assets associated with tasks in this workspace
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
                    console.error(`Failed to delete Cloudinary asset for attachment ${att.id}:`, e);
                }
            }
        }

        await prisma.team.delete({
            where: { id: teamId },
        });

        res.json({ success: true, message: "Workspace deleted successfully." });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to delete workspace" });
    }
});

// 2. CONFIGURABLE COLUMNS
app.get("/api/teams/:teamId/columns", async (req: Request, res: Response) => {
    try {
        const columns = await prisma.taskColumn.findMany({
            where: { teamId: req.params.teamId },
            orderBy: { order: "asc" },
        });
        res.json(columns);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/teams/:teamId/columns", async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { columns } = req.body; // Entire list of columns to sync/reorder

    try {
        // Perform a transaction to replace/upsert columns
        const results = await prisma.$transaction(
            columns.map((col: any, index: number) =>
                prisma.taskColumn.upsert({
                    where: { id: col.id || "new-id-" + index },
                    update: {
                        name: col.name,
                        order: index,
                        wipLimit:
                            col.wipLimit !== undefined ? col.wipLimit : null,
                        isComplete: col.isComplete || false,
                        triggersCarryForward:
                            col.triggersCarryForward !== undefined
                                ? col.triggersCarryForward
                                : true,
                    },
                    create: {
                        teamId,
                        name: col.name,
                        order: index,
                        wipLimit:
                            col.wipLimit !== undefined ? col.wipLimit : null,
                        isComplete: col.isComplete || false,
                        triggersCarryForward:
                            col.triggersCarryForward !== undefined
                                ? col.triggersCarryForward
                                : true,
                    },
                }),
            ),
        );
        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.delete(
    "/api/teams/:teamId/columns/:columnId",
    async (req: Request, res: Response) => {
        const { teamId, columnId } = req.params;

        try {
            // Move any tasks in the deleted column to the first column
            const otherColumns = await prisma.taskColumn.findMany({
                where: { teamId, id: { not: columnId } },
                orderBy: { order: "asc" },
            });

            if (otherColumns.length === 0) {
                return res
                    .status(400)
                    .json({
                        error: "Cannot delete the last column of a board.",
                    });
            }

            const fallbackColId = otherColumns[0].id;

            await prisma.task.updateMany({
                where: { columnId },
                data: { columnId: fallbackColId },
            });

            await prisma.taskColumn.delete({
                where: { id: columnId },
            });

            res.json({
                message:
                    "Column deleted. Existing tasks moved to " +
                    otherColumns[0].name,
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// 3. TASKS
app.get("/api/tasks", async (req: Request, res: Response) => {
    const { teamId, date, userId, search, isSoftDeleted, isArchived } =
        req.query;

    try {
        if (!teamId) {
            return res.status(400).json({ error: "teamId is required." });
        }

        // Run carry-forward and recurring task triggers first!
        if (date) {
            await runCarryForwardAndRecurring(teamId as string, date as string);
        }

        // Build filters
        const whereClause: any = {
            teamId: teamId as string,
        };

        if (req.query.archivedOrDeleted === "true") {
            whereClause.OR = [{ isSoftDeleted: true }, { isArchived: true }];
        } else {
            whereClause.isSoftDeleted = isSoftDeleted === "true" ? true : false;
            whereClause.isArchived = isArchived === "true" ? true : false;
        }

        if (date) {
            whereClause.date = parseLocalDate(date as string);
        }

        if (userId) {
            whereClause.assignedToId = userId as string;
        }

        if (search) {
            whereClause.OR = [
                { title: { contains: search as string, mode: "insensitive" } },
                {
                    description: {
                        contains: search as string,
                        mode: "insensitive",
                    },
                },
            ];
        }

        const tasks = await prisma.task.findMany({
            where: whereClause,
            include: {
                column: true,
                createdBy: true,
                assignedTo: true,
                checklist: true,
                comments: {
                    include: { user: true },
                    orderBy: { createdAt: "asc" },
                },
                attachments: true,
                activities: {
                    include: { user: true },
                    orderBy: { createdAt: "desc" },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        res.json(tasks);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/tasks", async (req: Request, res: Response) => {
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
    } = req.body;

    try {
        const dateStr = date || getLocalDateString(new Date());
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
        });

        // Create Audit Log
        await prisma.taskActivity.create({
            data: {
                taskId: task.id,
                userId: createdById,
                actionType: "CREATE",
                details: JSON.stringify({ title }),
            },
        });

        // Send notifications if reassigned
        if (finalAssignedToId !== createdById) {
            await prisma.notification.create({
                data: {
                    userId: finalAssignedToId,
                    content: `You have been assigned a new task: "${title}".`,
                    type: "REASSIGN",
                    taskId: task.id,
                },
            });
        }

        res.status(201).json(task);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/api/tasks/:taskId", async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;
    const actingTeamId = req.headers["x-team-id"] as string;

    const {
        title,
        description,
        columnId,
        priority,
        dueDate,
        date,
        estimatedTime,
        actualTime,
        assignedToId,
        isRecurring,
        recurrence,
        isArchived,
    } = req.body;

    try {
        // 1. Fetch existing task
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { column: true },
        });

        if (!task) {
            return res.status(404).json({ error: "Task not found." });
        }

        // 2. Fetch acting user membership and role
        const userRole = await prisma.userTeam.findUnique({
            where: {
                userId_teamId: { userId: actingUserId, teamId: actingTeamId },
            },
        });

        if (!userRole) {
            return res
                .status(403)
                .json({ error: "User does not belong to this team." });
        }

        // Enforce Rule: Workspace Leaders or the task creator can update the status of tasks.
        const changingStatus = columnId && columnId !== task.columnId;
        if (changingStatus) {
            const isLeader = userRole.role === Role.LEADER;
            const isCreator = task.createdById === actingUserId;
            if (!isLeader && !isCreator) {
                return res
                    .status(403)
                    .json({
                        error: "Only the workspace leader or task creator can update this task's status.",
                    });
            }
        }

        // Workspace Leaders and task creators can view and edit task details.

        // Prepare update payload
        const updateData: any = {};
        const detailsChanges: any = {};

        if (title !== undefined && title !== task.title) {
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
                from: task.dueDate
                    ? new Date(task.dueDate).toLocaleDateString()
                    : "None",
                to: newDue ? newDue.toLocaleDateString() : "None",
            };
        }
        if (
            estimatedTime !== undefined &&
            estimatedTime !== task.estimatedTime
        ) {
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

        if (assignedToId !== undefined && assignedToId !== task.assignedToId) {
            updateData.assignedToId = assignedToId;
            const oldUser = await prisma.user.findUnique({
                where: { id: task.assignedToId },
            });
            const newUser = await prisma.user.findUnique({
                where: { id: assignedToId },
            });
            detailsChanges.assignedTo = {
                from: oldUser?.name || "Unassigned",
                to: newUser?.name || "Unassigned",
            };
        }

        if (columnId !== undefined && columnId !== task.columnId) {
            updateData.columnId = columnId;

            const oldColName = task.column?.name || "Previous Column";
            const newCol = await prisma.taskColumn.findUnique({
                where: { id: columnId },
            });
            detailsChanges.status = {
                from: oldColName,
                to: newCol?.name || "New Column",
            };

            // Check WIP Limits
            if (newCol && newCol.wipLimit) {
                const count = await prisma.task.count({
                    where: {
                        columnId: newCol.id,
                        isSoftDeleted: false,
                        date: task.date,
                    },
                });
                if (count >= newCol.wipLimit) {
                    detailsChanges.wipLimitWarning = `WIP limit of ${newCol.wipLimit} exceeded for column "${newCol.name}"!`;
                }
            }
        }

        // Save changes
        const updatedTask = await prisma.task.update({
            where: { id: taskId },
            data: updateData,
        });

        // Create Audit Activity log only if there are actual changes
        if (Object.keys(detailsChanges).length > 0) {
            const actionType = changingStatus ? "STATUS_CHANGE" : "EDIT";
            await prisma.taskActivity.create({
                data: {
                    taskId,
                    userId: actingUserId,
                    actionType,
                    details: JSON.stringify(detailsChanges),
                },
            });
        }

        // Notify assignee if reassigned
        if (assignedToId && assignedToId !== task.assignedToId) {
            await prisma.notification.create({
                data: {
                    userId: assignedToId,
                    content: `Task "${updatedTask.title}" has been reassigned to you.`,
                    type: "REASSIGN",
                    taskId: updatedTask.id,
                },
            });
        }

        res.json(updatedTask);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete (soft delete / archive)
app.delete("/api/tasks/:taskId", async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        const task = await prisma.task.findUnique({
            where: { id: taskId },
        });

        if (!task) {
            return res.status(404).json({ error: "Task not found." });
        }

        // Rule 7: Only the task creator can delete that task.
        if (task.createdById !== actingUserId) {
            return res
                .status(403)
                .json({ error: "Only the task creator can delete this task." });
        }

        // Soft delete
        const deletedTask = await prisma.task.update({
            where: { id: taskId },
            data: { isSoftDeleted: true },
        });

        // Audit Log
        await prisma.taskActivity.create({
            data: {
                taskId,
                userId: actingUserId,
                actionType: "DELETE",
                details: JSON.stringify({ note: "Task soft deleted." }),
            },
        });

        res.json({ message: "Task soft deleted.", deletedTask });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Restore soft-deleted or archived task
app.post("/api/tasks/:taskId/restore", async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const actingUserId = req.headers["x-user-id"] as string;

    try {
        const task = await prisma.task.update({
            where: { id: taskId },
            data: { isSoftDeleted: false, isArchived: false },
        });

        await prisma.taskActivity.create({
            data: {
                taskId,
                userId: actingUserId || task.createdById,
                actionType: "EDIT",
                details: JSON.stringify({ note: "Task restored from trash." }),
            },
        });

        res.json(task);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Permanent Delete task
app.delete(
    "/api/tasks/:taskId/permanent",
    async (req: Request, res: Response) => {
        const { taskId } = req.params;

        try {
            // Delete related records
            await prisma.checklistItem.deleteMany({ where: { taskId } });
            await prisma.comment.deleteMany({ where: { taskId } });
            await prisma.attachment.deleteMany({ where: { taskId } });
            await prisma.taskActivity.deleteMany({ where: { taskId } });
            await prisma.notification.deleteMany({ where: { taskId } });

            await prisma.task.delete({
                where: { id: taskId },
            });

            res.json({ message: "Task permanently deleted." });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// 4. SUBTASKS / CHECKLISTS
app.post(
    "/api/tasks/:taskId/checklist",
    async (req: Request, res: Response) => {
        const { taskId } = req.params;
        const { title } = req.body;

        try {
            const item = await prisma.checklistItem.create({
                data: { taskId, title },
            });
            res.status(201).json(item);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

app.put(
    "/api/tasks/:taskId/checklist/:itemId",
    async (req: Request, res: Response) => {
        const { itemId } = req.params;
        const { isCompleted } = req.body;

        try {
            const item = await prisma.checklistItem.update({
                where: { id: itemId },
                data: { isCompleted },
            });
            res.json(item);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

app.delete(
    "/api/tasks/:taskId/checklist/:itemId",
    async (req: Request, res: Response) => {
        try {
            await prisma.checklistItem.delete({
                where: { id: req.params.itemId },
            });
            res.json({ message: "Checklist item deleted." });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// 5. COMMENTS THREAD
app.post("/api/tasks/:taskId/comments", async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const { userId, content } = req.body;

    try {
        const comment = await prisma.comment.create({
            data: { taskId, userId, content },
            include: { user: true },
        });

        // Check for @mentions in comment content
        // Format: @[Name] or @[Name Member]
        // For simple demo, if comment has '@Bob' or '@Alice' or '@Charlie', find user and notify
        const mentions = content.match(/@(\w+)/g);
        if (mentions) {
            for (const mention of mentions) {
                const namePart = mention.substring(1); // strip @
                const mentionedUser = await prisma.user.findFirst({
                    where: {
                        name: { contains: namePart, mode: "insensitive" },
                    },
                });

                if (mentionedUser && mentionedUser.id !== userId) {
                    await prisma.notification.create({
                        data: {
                            userId: mentionedUser.id,
                            content: `You were mentioned in a comment on task: "${content.substring(0, 40)}..."`,
                            type: "COMMENT_MENTION",
                            taskId,
                        },
                    });
                }
            }
        }

        // Save Activity Log
        await prisma.taskActivity.create({
            data: {
                taskId,
                userId,
                actionType: "COMMENT",
                details: JSON.stringify({ note: "Added comment." }),
            },
        });

        res.status(201).json(comment);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete / Resolve Comment
app.delete(
    "/api/tasks/:taskId/comments/:commentId",
    async (req: Request, res: Response) => {
        const { taskId, commentId } = req.params;
        const actingUserId = req.headers["x-user-id"] as string;

        try {
            const comment = await prisma.comment.findUnique({
                where: { id: commentId },
            });

            if (!comment) {
                return res.status(404).json({ error: "Comment not found." });
            }

            const task = await prisma.task.findUnique({
                where: { id: taskId },
            });

            // Permission check: comment author or task author
            if (
                actingUserId &&
                comment.userId !== actingUserId &&
                task?.createdById !== actingUserId
            ) {
                return res
                    .status(403)
                    .json({
                        error: "Only the comment author or task author can resolve this comment.",
                    });
            }

            await prisma.comment.delete({
                where: { id: commentId },
            });

            if (actingUserId) {
                await prisma.taskActivity.create({
                    data: {
                        taskId,
                        userId: actingUserId,
                        actionType: "COMMENT",
                        details: JSON.stringify({ note: "Resolved comment." }),
                    },
                });
            }

            res.json({ message: "Comment resolved and removed." });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// 6. ATTACHMENTS
app.post(
    "/api/tasks/:taskId/attachments",
    async (req: Request, res: Response) => {
        const { taskId } = req.params;
        const { name, url, type } = req.body;
        const actingUserId = req.headers["x-user-id"] as string;

        try {
            const attachment = await prisma.attachment.create({
                data: { taskId, name, url, type },
            });

            await prisma.taskActivity.create({
                data: {
                    taskId,
                    userId: actingUserId || "system", // fallback
                    actionType: "ATTACHMENT",
                    details: JSON.stringify({ name }),
                },
            });

            res.status(201).json(attachment);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// Upload image attachment to Cloudinary (compressed by 30%)
app.post(
    "/api/tasks/:taskId/upload-image",
    async (req: Request, res: Response) => {
        const { taskId } = req.params;
        const { imageBase64, filename, userId } = req.body;

        try {
            if (!imageBase64) {
                return res
                    .status(400)
                    .json({ error: "imageBase64 is required." });
            }

            const task = await prisma.task.findUnique({
                where: { id: taskId },
            });
            if (!task) {
                return res.status(404).json({ error: "Task not found." });
            }

            // Upload to Cloudinary with 30% compression (quality: 70)
            const imageUrl = await uploadImageAttachment(
                imageBase64,
                "task_attachments",
            );

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

            res.status(201).json(attachment);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// Delete attachment
app.delete(
    "/api/tasks/:taskId/attachments/:attachmentId",
    async (req: Request, res: Response) => {
        const { attachmentId } = req.params;
        const actingUserId = req.headers["x-user-id"] as string;

        try {
            const attachment = await prisma.attachment.findUnique({
                where: { id: attachmentId },
            });

            if (!attachment) {
                return res.status(404).json({ error: "Attachment not found." });
            }

            // Delete from Cloudinary if Cloudinary image
            if (attachment.url) {
                await deleteFromCloudinary(attachment.url);
            }

            await prisma.attachment.delete({
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

            res.json({ message: "Attachment deleted successfully." });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

// 7. REPORTS
app.get("/api/reports", async (req: Request, res: Response) => {
    const { teamId, startDate, endDate, daysFromToday } = req.query;

    try {
        if (!teamId) {
            return res.status(400).json({ error: "teamId is required." });
        }

        let start = new Date();
        let end = new Date();

        if (daysFromToday) {
            const days = parseInt(daysFromToday as string);
            start.setDate(start.getDate() - days);
        } else if (startDate && endDate) {
            start = new Date(startDate as string);
            end = new Date(endDate as string);
        } else {
            // Default to last 30 days
            start.setDate(start.getDate() - 30);
        }

        // Fetch active tasks created or active in range
        const tasks = await prisma.task.findMany({
            where: {
                teamId: teamId as string,
                isSoftDeleted: false,
                date: { gte: start, lte: end },
            },
            include: { column: true },
        });

        const totalCount = tasks.length;
        const completedTasks = tasks.filter((t) => t.column.isComplete);
        const completedCount = completedTasks.length;

        // Average completion rate
        const completionRate =
            totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

        // Average time-to-done (sum actualTime / count)
        const completedWithTime = completedTasks.filter(
            (t) => t.actualTime && t.actualTime > 0,
        );
        const averageTimeToDone =
            completedWithTime.length > 0
                ? completedWithTime.reduce(
                      (sum, t) => sum + (t.actualTime || 0),
                      0,
                  ) / completedWithTime.length
                : 0;

        // Tasks by column distribution
        const columnsBreakdown: Record<string, number> = {};
        tasks.forEach((t) => {
            columnsBreakdown[t.column.name] =
                (columnsBreakdown[t.column.name] || 0) + 1;
        });

        // Overdue tasks
        const today = new Date();
        const overdueCount = tasks.filter(
            (t) =>
                !t.column.isComplete &&
                t.dueDate &&
                new Date(t.dueDate) < today,
        ).length;

        // Time tracking estimates vs actuals
        const totalEstimated = tasks.reduce(
            (sum, t) => sum + (t.estimatedTime || 0),
            0,
        );
        const totalActual = tasks.reduce(
            (sum, t) => sum + (t.actualTime || 0),
            0,
        );

        // Stale tasks (sitting in In Progress or Need Attention for > 3 carryCounts)
        const staleCount = tasks.filter(
            (t) => !t.column.isComplete && t.carryCount >= 3,
        ).length;

        res.json({
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            totalTasks: totalCount,
            completedTasks: completedCount,
            completionRate: Math.round(completionRate * 10) / 10,
            averageTimeToDone: Math.round(averageTimeToDone * 10) / 10,
            columnsBreakdown,
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
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// CSV Export Endpoint
app.get("/api/reports/export", async (req: Request, res: Response) => {
    const { teamId, startDate, endDate, daysFromToday } = req.query;

    try {
        if (!teamId) {
            return res.status(400).json({ error: "teamId is required." });
        }

        let start = new Date();
        let end = new Date();

        if (daysFromToday) {
            const days = parseInt(daysFromToday as string);
            start.setDate(start.getDate() - days);
        } else if (startDate && endDate) {
            start = new Date(startDate as string);
            end = new Date(endDate as string);
        } else {
            start.setDate(start.getDate() - 30);
        }

        const tasks = await prisma.task.findMany({
            where: {
                teamId: teamId as string,
                isSoftDeleted: false,
                date: { gte: start, lte: end },
            },
            include: {
                column: true,
                assignedTo: true,
            },
        });

        let csv =
            "Task ID,Title,Status,Priority,Date,Due Date,Carry Count,Est Hours,Act Hours,Assignee\n";
        tasks.forEach((t) => {
            const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
            csv += `${t.id},${escape(t.title)},${escape(t.column.name)},${t.priority},${getLocalDateString(t.date)},${t.dueDate ? getLocalDateString(t.dueDate) : ""},${t.carryCount},${t.estimatedTime || 0},${t.actualTime || 0},${escape(t.assignedTo.name)}\n`;
        });

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="task-report-${getLocalDateString(new Date())}.csv"`,
        );
        res.status(200).send(csv);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 8. NOTIFICATIONS
app.get("/api/notifications", async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"] as string;

    try {
        // Purge notifications archived over 30 days ago
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await prisma.notification.deleteMany({
            where: {
                userId,
                isArchived: true,
                archivedAt: { lt: thirtyDaysAgo },
            },
        });

        const notifications = await prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });
        res.json(notifications);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/api/notifications/clear-all", async (req: Request, res: Response) => {
    const userId = req.headers["x-user-id"] as string;
    try {
        await prisma.notification.updateMany({
            where: { userId, isArchived: false },
            data: { isArchived: true, archivedAt: new Date(), isRead: true },
        });
        res.json({
            message: "All notifications cleared and archived for 30 days.",
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put(
    "/api/notifications/:id/archive",
    async (req: Request, res: Response) => {
        try {
            const notification = await prisma.notification.update({
                where: { id: req.params.id },
                data: {
                    isArchived: true,
                    archivedAt: new Date(),
                    isRead: true,
                },
            });
            res.json(notification);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },
);

app.put("/api/notifications/:id/read", async (req: Request, res: Response) => {
    try {
        const notification = await prisma.notification.update({
            where: { id: req.params.id },
            data: { isRead: true },
        });
        res.json(notification);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// IFRAME PROXY — strips X-Frame-Options so any site can render in an iframe
// ============================================================================
app.get("/api/iframe-proxy", async (req: Request, res: Response) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send("URL required");
    try {
        // Forward incoming request cookies (if any) so authenticated sessions pass through
        const reqHeaders: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
        };
        if (req.headers.cookie) {
            reqHeaders["Cookie"] = req.headers.cookie;
        }

        const upstream = await fetch(targetUrl, {
            headers: reqHeaders,
            redirect: "follow",
        });

        const contentType = upstream.headers.get("content-type") || "text/html";
        
        // Strip X-Frame-Options and Content-Security-Policy completely (matching Chrome DNR extension rules)
        res.setHeader("Content-Type", contentType);
        res.removeHeader("X-Frame-Options");
        res.removeHeader("Content-Security-Policy");
        res.removeHeader("Content-Security-Policy-Report-Only");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Credentials", "true");

        // Forward Set-Cookie header if provided by upstream
        const setCookie = upstream.headers.get("set-cookie");
        if (setCookie) {
            res.setHeader("Set-Cookie", setCookie);
        }

        if (contentType.includes("text/html")) {
            let html = await upstream.text();
            let baseUrl = targetUrl;
            try { baseUrl = new URL(targetUrl).origin; } catch {}

            // Remove any inline meta http-equiv="X-Frame-Options" or CSP tags
            html = html.replace(/<meta[^>]*http-equiv=["']?(content-security-policy|x-frame-options)["']?[^>]*>/gi, "");

            // Inject base tag so relative assets load directly from origin
            if (html.includes("<head>")) {
                html = html.replace("<head>", `<head><base href="${baseUrl}/">`);
            } else if (html.includes("<Head>")) {
                html = html.replace("<Head>", `<Head><base href="${baseUrl}/">`);
            } else {
                html = `<base href="${baseUrl}/">` + html;
            }
            res.send(html);
        } else {
            const buf = await upstream.arrayBuffer();
            res.send(Buffer.from(buf));
        }
    } catch (e: any) {
        res.status(200).send(`<!DOCTYPE html><html><head><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAFAF9;color:#888883;flex-direction:column;gap:8px;}</style></head><body><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101m-.758-4.899a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1"/></svg><p style="font-size:12px;">Unable to preview this site</p><a href="${targetUrl}" target="_blank" style="font-size:11px;color:#1A1A1A;">Open in new tab →</a></body></html>`);
    }
});

// ============================================================================
// BOOTSTRAP SERVER
// ============================================================================
// ============================================================================
// KNOWLEDGE BASE ROUTES
// ============================================================================

app.get("/api/knowledge", async (req: Request, res: Response) => {
    const { teamId } = req.query;
    if (!teamId) return res.status(400).json({ error: "teamId required" });
    try {
        const articles = await prisma.knowledgeArticle.findMany({
            where: { teamId: String(teamId) },
            include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
            orderBy: { updatedAt: "desc" },
        });
        res.json(articles);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch articles" });
    }
});

app.post("/api/knowledge", async (req: Request, res: Response) => {
    const { teamId, title, content, createdById } = req.body;
    if (!teamId || !title || !createdById) return res.status(400).json({ error: "teamId, title, createdById required" });
    try {
        const article = await prisma.knowledgeArticle.create({
            data: { teamId, title, content: content || "", createdById },
            include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
        });
        res.json(article);
    } catch (e) {
        res.status(500).json({ error: "Failed to create article" });
    }
});

app.put("/api/knowledge/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, content } = req.body;
    try {
        const article = await prisma.knowledgeArticle.update({
            where: { id },
            data: { title, content },
            include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
        });
        res.json(article);
    } catch (e) {
        res.status(500).json({ error: "Failed to update article" });
    }
});

app.delete("/api/knowledge/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await prisma.knowledgeArticle.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Failed to delete article" });
    }
});

// ============================================================================
// BOOKMARKS ROUTES
// ============================================================================

app.get("/api/bookmarks", async (req: Request, res: Response) => {
    const { teamId } = req.query;
    if (!teamId) return res.status(400).json({ error: "teamId required" });
    try {
        const bookmarks = await prisma.bookmark.findMany({
            where: { teamId: String(teamId) },
            include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
            orderBy: { createdAt: "desc" },
        });
        res.json(bookmarks);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
});

app.post("/api/bookmarks", async (req: Request, res: Response) => {
    const { teamId, title, url, description, createdById } = req.body;
    if (!teamId || !title || !url || !createdById) return res.status(400).json({ error: "teamId, title, url, createdById required" });
    try {
        const bookmark = await prisma.bookmark.create({
            data: { teamId, title, url, description, createdById },
            include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
        });
        res.json(bookmark);
    } catch (e) {
        res.status(500).json({ error: "Failed to create bookmark" });
    }
});

app.put("/api/bookmarks/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, url, description } = req.body;
    try {
        const bookmark = await prisma.bookmark.update({
            where: { id },
            data: { title, url, description },
            include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
        });
        res.json(bookmark);
    } catch (e) {
        res.status(500).json({ error: "Failed to update bookmark" });
    }
});

app.delete("/api/bookmarks/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await prisma.bookmark.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Failed to delete bookmark" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`Backend server running on port ${PORT}`);
    try {
        // Purge legacy empty activity records from database
        await prisma.taskActivity.deleteMany({
            where: {
                actionType: "EDIT",
                details: { in: ["{}", "", "null", "undefined"] },
            },
        });
    } catch (e) {
        console.error("Error cleaning up legacy activity records:", e);
    }
});
