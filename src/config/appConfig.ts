import "dotenv/config";

export const APP_CONFIG = {
    DATABASE_URL: process.env.DATABASE_URL,
    PORT: parseInt(process.env.PORT || "5000", 10),
    MAX_TASK_TITLE_LENGTH: parseInt(process.env.MAX_TASK_TITLE_LENGTH || "300", 10),
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    JWT_SECRET: process.env.JWT_SECRET || "sm_technology_secret_key",
    SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
    SMTP_PORT: parseInt(process.env.SMTP_PORT || "587", 10),
    SMTP_USER: process.env.SMTP_USER || "",
    SMTP_PASS: process.env.SMTP_PASS || "",
    SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || "SM Technology",
    RESET_CODE_EXPIRY_MINUTES: parseInt(process.env.RESET_CODE_EXPIRY_MINUTES || "5", 10),
    NOTIFICATION_PURGE_DAYS: parseInt(process.env.NOTIFICATION_PURGE_DAYS || "30", 10),
};

