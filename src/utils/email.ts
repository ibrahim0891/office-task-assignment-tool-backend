import nodemailer from "nodemailer";
import { APP_CONFIG } from "../config/appConfig";

const transporter = nodemailer.createTransport({
    host: APP_CONFIG.SMTP_HOST,
    port: APP_CONFIG.SMTP_PORT,
    secure: APP_CONFIG.SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
        user: APP_CONFIG.SMTP_USER,
        pass: APP_CONFIG.SMTP_PASS,
    },
});

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
    if (!APP_CONFIG.SMTP_USER || !APP_CONFIG.SMTP_PASS) {
        console.warn("[Email Service] SMTP configuration is incomplete. Skipping sending email.");
        return;
    }

    const mailOptions = {
        from: `"${APP_CONFIG.SMTP_FROM_NAME}" <${APP_CONFIG.SMTP_USER}>`,
        to,
        subject,
        html,
        replyTo: "noreply@gmail.com", // dummy reply-to
    };

    await transporter.sendMail(mailOptions);
}
