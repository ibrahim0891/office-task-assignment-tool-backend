import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";

let io: Server | null = null;

// Map userId -> Set of socketIds for sender-exclusion
const userSockets = new Map<string, Set<string>>();

export function initSocket(server: HttpServer): Server {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "PUT", "DELETE"],
        },
    });

    io.on("connection", (socket: Socket) => {
        console.log(`[Socket Server] Socket connected: ${socket.id}`);

        // Clients call this after connecting so we can map userId -> socketId
        socket.on("register_user", (userId: string) => {
            console.log(`[Socket Server] Registering user ${userId} for socket ${socket.id}`);
            if (!userId) return;
            (socket as any)._userId = userId;
            if (!userSockets.has(userId)) {
                userSockets.set(userId, new Set());
            }
            userSockets.get(userId)!.add(socket.id);
            socket.join(`user:${userId}`);
        });

        socket.on("join_team", (teamId: string) => {
            console.log(`[Socket Server] Socket ${socket.id} joining room team:${teamId}`);
            if (teamId) {
                socket.join(`team:${teamId}`);
            }
        });

        socket.on("leave_team", (teamId: string) => {
            console.log(`[Socket Server] Socket ${socket.id} leaving room team:${teamId}`);
            if (teamId) {
                socket.leave(`team:${teamId}`);
            }
        });

        socket.on("disconnect", () => {
            console.log(`[Socket Server] Socket disconnected: ${socket.id}`);
            const userId = (socket as any)._userId as string | undefined;
            if (userId && userSockets.has(userId)) {
                userSockets.get(userId)!.delete(socket.id);
                if (userSockets.get(userId)!.size === 0) {
                    userSockets.delete(userId);
                }
            }
        });
    });

    return io;
}

export function getIO(): Server | null {
    return io;
}

/**
 * Broadcast to the entire team room (all clients).
 */
export function notifyTeam(teamId: string, event: string, payload?: any) {
    console.log(`[Socket Server] notifyTeam to room team:${teamId}, event: ${event}, payload:`, payload);
    if (io && teamId) {
        io.to(`team:${teamId}`).emit(event, payload);
    }
}

/**
 * Broadcast to the team room but EXCLUDE all sockets belonging to `excludeUserId`.
 * This prevents the acting user from receiving their own socket echo.
 */
export function notifyTeamExclude(teamId: string, event: string, payload: any, excludeUserId?: string) {
    if (!io || !teamId) return;

    console.log(`[Socket Server] notifyTeamExclude to room team:${teamId}, event: ${event}, excludeUserId: ${excludeUserId}, payload:`, payload);

    if (!excludeUserId) {
        // Fallback to normal broadcast
        console.log(`[Socket Server] No excludeUserId provided, broadcasting normally to room team:${teamId}`);
        io.to(`team:${teamId}`).emit(event, payload);
        return;
    }

    const room = `team:${teamId}`;
    const excludedSocketIds = userSockets.get(excludeUserId);

    if (!excludedSocketIds || excludedSocketIds.size === 0) {
        // User has no tracked sockets — just broadcast normally
        console.log(`[Socket Server] No active sockets found for user ${excludeUserId}, broadcasting normally to room team:${teamId}`);
        io.to(room).emit(event, payload);
        return;
    }

    console.log(`[Socket Server] Excluding sockets:`, Array.from(excludedSocketIds));

    // In Socket.IO, if we want to broadcast to a room excluding multiple specific socket IDs:
    // We can use io.to(room).except(Array.from(excludedSocketIds)).emit(event, payload);
    // Let's check if except() is supported in Socket.IO v4 (it is!).
    // This is much cleaner and robust than socket.to(room).emit() because it excludes ALL of the sender's sockets (e.g. multiple tabs).
    try {
        io.to(room).except(Array.from(excludedSocketIds)).emit(event, payload);
        console.log(`[Socket Server] Broadcasted using except() to exclude sockets for user ${excludeUserId}`);
    } catch (e) {
        console.error(`[Socket Server] error using except():`, e);
        // Fallback: Broadcast from the first available socket in the exclude list
        for (const socketId of excludedSocketIds) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
                socket.to(room).emit(event, payload);
                console.log(`[Socket Server] Fallback broadcast from socket ${socketId} to room ${room}`);
                return;
            }
        }
        // Last resort fallback
        io.to(room).emit(event, payload);
    }
}

/**
 * Broadcast event directly to a specific user's private room.
 */
export function notifyUser(userId: string, event: string, payload?: any) {
    if (!io || !userId) return;
    console.log(`[Socket Server] notifyUser to room user:${userId}, event: ${event}, payload:`, payload);
    io.to(`user:${userId}`).emit(event, payload);
}
