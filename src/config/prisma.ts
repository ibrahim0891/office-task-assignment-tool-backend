import { PrismaClient, Role } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { APP_CONFIG } from "./appConfig";

const pool = new pg.Pool({
    connectionString: APP_CONFIG.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

export { Role };
