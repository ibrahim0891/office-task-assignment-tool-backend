import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { APP_CONFIG } from '../src/config/appConfig';

const pool = new pg.Pool({
  connectionString: APP_CONFIG.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Clearing all database records for production clean state...');

  // Clean existing data completely
  await prisma.notification.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.taskActivity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.taskColumn.deleteMany();
  await prisma.projectReworkLog.deleteMany();
  await prisma.projectIncident.deleteMany();
  await prisma.taskDependency.deleteMany();
  await prisma.projectSubtask.deleteMany();
  await prisma.projectTaskAssignee.deleteMany();
  await prisma.projectTask.deleteMany();
  await prisma.projectColumn.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.userTeam.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();

  console.log('Database wiped completely. Ready for fresh user registrations.');
}

main()
  .catch((e) => {
    console.error('Error during database wipe:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
