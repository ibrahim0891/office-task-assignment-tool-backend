import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
import { prisma } from "./config/prisma";
import { APP_CONFIG } from "./config/appConfig";
import { authenticateToken, enforceObserverRole } from "./middleware/auth";

// Route imports
import authRouter from "./modules/auth/auth.route";
import usersRouter from "./modules/users/users.route";
import columnsRouter from "./modules/columns/columns.route";
import tasksRouter from "./modules/tasks/tasks.route";
import projectsRouter from "./modules/projects/projects.route";
import reportsRouter from "./modules/reports/reports.route";
import notificationsRouter from "./modules/notifications/notifications.route";
import knowledgeRouter from "./modules/knowledge/knowledge.route";
import bookmarksRouter from "./modules/bookmarks/bookmarks.route";
import iframeRouter from "./modules/iframe/iframe.route";
import pushRouter from "./modules/push/push.route";
import foldersRouter from "./modules/folders/folders.route";


import { createServer } from "http";
import { initSocket } from "./config/socket";
import { runSlaEscalationCheck } from "./modules/projects/projectEngine";

const app = express();
const httpServer = createServer(app);
initSocket(httpServer);

app.use(compression());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Global Authentication Middleware
app.use(authenticateToken);

// Global Observer check Middleware
app.use(enforceObserverRole);

// Routes registration
app.use("/api/auth", authRouter);
app.use("/api", usersRouter);
app.use("/api", columnsRouter);
app.use("/api", tasksRouter);
app.use("/api", projectsRouter);
app.use("/api", reportsRouter);
app.use("/api", notificationsRouter);
app.use("/api", knowledgeRouter);
app.use("/api", bookmarksRouter);
app.use("/api", iframeRouter);
app.use("/api", pushRouter);
app.use("/api", foldersRouter);


const PORT = APP_CONFIG.PORT;
httpServer.listen(PORT, async () => {
    console.log(`Backend server running on port ${PORT}. Max Task Title Length: ${APP_CONFIG.MAX_TASK_TITLE_LENGTH}. Reset Code Expiry: ${APP_CONFIG.RESET_CODE_EXPIRY_MINUTES}m. Notification Purge: ${APP_CONFIG.NOTIFICATION_PURGE_DAYS}d`);
    try {
        // Purge legacy empty activity records from database
        await prisma.taskActivity.deleteMany({
            where: {
                details: "{}",
            },
        });

        // Run initial SLA escalation check on startup
        await runSlaEscalationCheck();

        // Schedule periodic SLA escalation check every 10 minutes
        setInterval(async () => {
            try {
                await runSlaEscalationCheck();
            } catch (err) {
                console.error("[SLA Engine] Periodic check error:", err);
            }
        }, 10 * 60 * 1000);
    } catch (e) {}
});
