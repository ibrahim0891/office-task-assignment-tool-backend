/**
 * Backfill script to fix existing ProjectColumn types.
 * Columns created before the type system was introduced have type=CUSTOM (the default).
 * This maps well-known column names to their proper system types.
 *
 * Usage: npx tsx backfill-column-types.ts
 */
import { prisma } from "./src/config/prisma";

// Map well-known column names to their correct system types
const NAME_TO_TYPE: Record<string, { type: string; isComplete: boolean }> = {
    "backlog": { type: "BACKLOG", isComplete: false },
    "to do": { type: "TODO", isComplete: false },
    "todo": { type: "TODO", isComplete: false },
    "in progress": { type: "IN_PROGRESS", isComplete: false },
    "need attention": { type: "NEED_ATTENTION", isComplete: false },
    "completed": { type: "COMPLETED", isComplete: true },
    "done": { type: "COMPLETED", isComplete: true },
    "cancelled": { type: "CANCELLED", isComplete: false },
    "canceled": { type: "CANCELLED", isComplete: false },
    "in review": { type: "IN_PROGRESS", isComplete: false },
};

async function main() {
    const columns = await prisma.projectColumn.findMany({
        where: { type: "CUSTOM" },
    });

    console.log(`Found ${columns.length} columns with type=CUSTOM`);

    let updated = 0;
    for (const col of columns) {
        const key = col.name.trim().toLowerCase();
        const mapping = NAME_TO_TYPE[key];
        if (mapping) {
            await prisma.projectColumn.update({
                where: { id: col.id },
                data: { type: mapping.type as any, isComplete: mapping.isComplete },
            });
            console.log(`  ✓ "${col.name}" → ${mapping.type} (project: ${col.projectId})`);
            updated++;
        } else {
            console.log(`  - "${col.name}" → kept as CUSTOM (no mapping)`);
        }
    }

    console.log(`\nDone. Updated ${updated} / ${columns.length} columns.`);
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
