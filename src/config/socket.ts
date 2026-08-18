import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";

let io: Server | null = null;

export function initSocket(server: HttpServer): Server {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "PUT", "DELETE"],
        },
    });

    io.on("connection", (socket: Socket) => {
        socket.on("join_team", (teamId: string) => {
            if (teamId) {
                socket.join(`team:${teamId}`);
            }
        });

        socket.on("leave_team", (teamId: string) => {
            if (teamId) {
                socket.leave(`team:${teamId}`);
            }
        });
    });

    return io;
}

export function getIO(): Server | null {
    return io;
}

export function notifyTeam(teamId: string, event: string, payload?: any) {
    if (io && teamId) {
        io.to(`team:${teamId}`).emit(event, payload);
    }
}
