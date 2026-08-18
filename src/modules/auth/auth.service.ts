import jwt from "jsonwebtoken";
import { prisma, Role } from "../../config/prisma";
import { JWT_SECRET } from "../../middleware/auth";

export async function generateToken(user: { id: string; email: string }) {
    const memberships = await prisma.userTeam.findMany({
        where: { userId: user.id },
    });
    const roles = memberships.reduce((acc, curr) => {
        acc[curr.teamId] = curr.role;
        return acc;
    }, {} as Record<string, string>);

    return jwt.sign({ userId: user.id, email: user.email, roles }, JWT_SECRET, {
        expiresIn: "7d",
    });
}

export const loginUser = async (email: string, passwordString: string) => {
    const user = await prisma.user.findUnique({
        where: { email },
    });

    if (!user || user.password !== passwordString) {
        throw new Error("Invalid email or password.");
    }

    const token = await generateToken(user);

    return { user, token };
};

export const registerUser = async (name: string, email: string, passwordString: string) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new Error("User with this email already exists.");
    }

    const user = await prisma.user.create({
        data: { name, email, password: passwordString },
    });

    // Automatically create a personal workspace for this member
    const personalTeam = await prisma.team.create({
        data: { name: `${name.split(" ")[0]}'s Personal Space` },
    });

    // Create Default Kanban Columns
    const defaultCols = [
        { name: "To Do", order: 0, wipLimit: 10, isComplete: false, triggersCarryForward: true },
        { name: "Up Next", order: 1, wipLimit: 5, isComplete: false, triggersCarryForward: true },
        { name: "In Progress", order: 2, wipLimit: 3, isComplete: false, triggersCarryForward: true },
        { name: "Blocked", order: 3, wipLimit: 3, isComplete: false, triggersCarryForward: true },
        { name: "Need Attention Later", order: 4, wipLimit: 5, isComplete: false, triggersCarryForward: true },
        { name: "Done", order: 5, wipLimit: null, isComplete: true, triggersCarryForward: false },
        { name: "Cancelled", order: 6, wipLimit: null, isComplete: false, triggersCarryForward: false },
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

    const token = await generateToken(user);

    return { user, token };
};
