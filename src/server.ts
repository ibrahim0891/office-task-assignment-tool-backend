import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./config/prisma";
import { authenticateToken, enforceObserverRole } from "./middleware/auth";

// Route imports
import authRouter from "./modules/auth/auth.route";
import usersRouter from "./modules/users/users.route";
import columnsRouter from "./modules/columns/columns.route";
import tasksRouter from "./modules/tasks/tasks.route";
import reportsRouter from "./modules/reports/reports.route";
import notificationsRouter from "./modules/notifications/notifications.route";
import knowledgeRouter from "./modules/knowledge/knowledge.route";
import bookmarksRouter from "./modules/bookmarks/bookmarks.route";
import iframeRouter from "./modules/iframe/iframe.route";

import { createServer } from "http";
import { initSocket } from "./config/socket";

const app = express();
const httpServer = createServer(app);
initSocket(httpServer);

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
app.use("/api", reportsRouter);
app.use("/api", notificationsRouter);
app.use("/api", knowledgeRouter);
app.use("/api", bookmarksRouter);
app.use("/api", iframeRouter);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, async () => {
    console.log(`Backend server running on port ${PORT}`);
    try {
        // Purge legacy empty activity records from database
        await prisma.taskActivity.deleteMany({
            where: {
                details: "{}",
            },
        });
    } catch (e) {}
});
