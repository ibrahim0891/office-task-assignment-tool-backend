import jwt from "jsonwebtoken";
import { prisma, Role } from "../../config/prisma";
import { JWT_SECRET } from "../../middleware/auth";
import { sendEmail } from "../../utils/email";
import { APP_CONFIG } from "../../config/appConfig";

const buildEmailTemplate = (name: string, bodyText: string, code: string, footerNote: string) => {
    return `
<div style="background-color: #FAFAF9; padding: 40px 20px; margin: 0; min-height: 100%;">
    <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 0 auto; background-color: #ffffff;">
        <!-- Row 1: Top Corners -->
        <tr>
            <td style="width: 12px; height: 12px; border-top: 2px solid #1A1A1A; border-left: 2px solid #1A1A1A; line-height: 0; font-size: 0;">&nbsp;</td>
            <td style="height: 12px; border-top: 1px solid #E5E5E3; line-height: 0; font-size: 0;">&nbsp;</td>
            <td style="width: 12px; height: 12px; border-top: 1px solid #E5E5E3; border-right: 1px solid #E5E5E3; line-height: 0; font-size: 0;">&nbsp;</td>
        </tr>
        
        <!-- Row 2: Content -->
        <tr>
            <td style="width: 12px; border-left: 1px solid #E5E5E3;">&nbsp;</td>
            <td style="padding: 15px 15px 25px 15px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1A1A;">
                
                <!-- Logo / Header -->
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="font-family: Georgia, Cambria, 'Times New Roman', Times, serif; font-size: 26px; font-weight: normal; color: #1A1A1A; margin: 0 0 4px 0;">
                        SM Technology
                    </h1>
                    <p style="font-size: 13px; color: #888883; margin: 0;">
                        Daily Task Management System
                    </p>
                </div>
                
                <!-- Main Body -->
                <div style="font-size: 14px; line-height: 1.6; color: #1A1A1A;">
                    <p style="margin: 0 0 16px 0; font-weight: 500;">Hello ${name},</p>
                    <p style="margin: 0 0 24px 0; color: #4A4A48;">${bodyText}</p>
                    
                    <!-- Code Card -->
                    <div style="font-family: Courier, monospace; font-size: 28px; font-weight: bold; padding: 20px; background-color: #FAFAF9; text-align: center; border: 1px solid #E5E5E3; border-radius: 2px; color: #1A1A1A; margin: 24px 0;">
                        ${code}
                    </div>
                    
                    <p style="font-size: 13px; color: #888883; margin: 24px 0 0 0; line-height: 1.5; border-top: 1px dashed #E5E5E3; padding-top: 15px;">
                        ${footerNote}
                    </p>
                </div>

            </td>
            <td style="width: 12px; border-right: 1px solid #E5E5E3;">&nbsp;</td>
        </tr>
        
        <!-- Row 3: Bottom Corners -->
        <tr>
            <td style="width: 12px; height: 12px; border-bottom: 1px solid #E5E5E3; border-left: 1px solid #E5E5E3; line-height: 0; font-size: 0;">&nbsp;</td>
            <td style="height: 12px; border-bottom: 1px solid #E5E5E3; line-height: 0; font-size: 0;">&nbsp;</td>
            <td style="width: 12px; height: 12px; border-bottom: 2px solid #1A1A1A; border-right: 2px solid #1A1A1A; line-height: 0; font-size: 0;">&nbsp;</td>
        </tr>
    </table>
</div>
    `;
};

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

    if (!user.isVerified) {
        throw new Error("EMAIL_NOT_VERIFIED");
    }

    const token = await generateToken(user);

    return { user, token };
};

export const registerUser = async (fullName: string, email: string, passwordString: string) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new Error("User with this email already exists.");
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    const user = await prisma.user.create({
        data: {
            name: fullName,
            fullName,
            email,
            password: passwordString,
            isVerified: false,
            verificationCode,
        },
    });

    // Automatically create a personal workspace for this member
    const personalTeam = await prisma.team.create({
        data: { name: `${fullName.split(" ")[0]}'s Personal Space` },
    });

    // Create Default Kanban Columns (To Do -> Up Next -> In Progress -> Done -> Others)
    const defaultCols = [
        { name: "To Do", order: 0, wipLimit: 10, isComplete: false, triggersCarryForward: true },
        { name: "Up Next", order: 1, wipLimit: 5, isComplete: false, triggersCarryForward: true },
        { name: "In Progress", order: 2, wipLimit: 3, isComplete: false, triggersCarryForward: true },
        { name: "Done", order: 3, wipLimit: null, isComplete: true, triggersCarryForward: false },
        { name: "Blocked", order: 4, wipLimit: 3, isComplete: false, triggersCarryForward: true },
        { name: "Need Attention Later", order: 5, wipLimit: 5, isComplete: false, triggersCarryForward: true },
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

    try {
        await sendEmail({
            to: email,
            subject: "Verify your email - SM Technology",
            html: buildEmailTemplate(
                fullName,
                "Thank you for registering. Please verify your email using the following 6-digit verification code:",
                verificationCode,
                "If you did not request this email, you can safely ignore it."
            ),
        });
    } catch (e) {
        console.error("[Email Error] Failed to send verification email:", e);
    }

    return { user, requiresVerification: true };
};

export const verifyEmailCode = async (email: string, code: string) => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        throw new Error("User not found.");
    }
    if (user.isVerified) {
        throw new Error("Email is already verified.");
    }
    if (user.verificationCode !== code) {
        throw new Error("Invalid verification code.");
    }

    const updatedUser = await prisma.user.update({
        where: { email },
        data: {
            isVerified: true,
            verificationCode: null,
        },
    });

    const token = await generateToken(updatedUser);
    return { user: updatedUser, token };
};

export const sendNewVerificationCode = async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        throw new Error("User not found.");
    }
    if (user.isVerified) {
        throw new Error("Email is already verified.");
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.user.update({
        where: { email },
        data: { verificationCode },
    });

    await sendEmail({
        to: email,
        subject: "Verify your email - SM Technology",
        html: buildEmailTemplate(
            user.fullName,
            "Your new 6-digit verification code is:",
            verificationCode,
            "If you did not request this email, you can safely ignore it."
        ),
    });
};

export const sendResetPasswordCode = async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        throw new Error("User with this email does not exist.");
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpires = new Date(Date.now() + APP_CONFIG.RESET_CODE_EXPIRY_MINUTES * 60 * 1000);

    await prisma.user.update({
        where: { email },
        data: {
            resetCode,
            resetCodeExpires,
        },
    });

    await sendEmail({
        to: email,
        subject: "Reset your password - SM Technology",
        html: buildEmailTemplate(
            user.fullName,
            "We received a request to reset your password. Use the following 6-digit code to reset it:",
            resetCode,
            `This code expires in ${APP_CONFIG.RESET_CODE_EXPIRY_MINUTES} minutes. If you did not request a password reset, please ignore this email.`
        ),
    });
};

export const resetPasswordWithCode = async (email: string, code: string, newPasswordString: string) => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        throw new Error("User not found.");
    }
    if (!user.resetCode || user.resetCode !== code) {
        throw new Error("Invalid password reset code.");
    }
    if (!user.resetCodeExpires || new Date() > user.resetCodeExpires) {
        throw new Error("Password reset code has expired.");
    }

    await prisma.user.update({
        where: { email },
        data: {
            password: newPasswordString,
            resetCode: null,
            resetCodeExpires: null,
        },
    });
};
