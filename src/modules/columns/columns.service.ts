import { prisma } from "../../config/prisma";

export const getColumnsByTeamId = async (teamId: string) => {
    return prisma.taskColumn.findMany({
        where: { teamId },
        orderBy: { order: "asc" },
    });
};




export const syncColumns = async (teamId: string, columns: any[]) => {
    // Check constant columns in database
    const dbColumns = await prisma.taskColumn.findMany({
        where: { teamId },
    });
    const constantNames = ["to do", "todo", "in progress", "need attention later", "need attention", "done"];
    for (const dbCol of dbColumns) {
        const isDbConstant = constantNames.includes(dbCol.name.toLowerCase().trim());
        if (isDbConstant) {
            const incomingCol = columns.find((c) => c.id === dbCol.id);
            if (!incomingCol) {
                throw new Error(`Constant column "${dbCol.name}" cannot be deleted.`);
            }
            if (incomingCol.name.toLowerCase().trim() !== dbCol.name.toLowerCase().trim()) {
                throw new Error(`Constant column "${dbCol.name}" cannot be renamed.`);
            }
        }
    }

    return prisma.$transaction(
        columns.map((col: any, index: number) =>
            prisma.taskColumn.upsert({
                where: { id: col.id || "new-id-" + index },
                update: {
                    name: col.name,
                    order: index,
                    wipLimit: col.wipLimit !== undefined ? col.wipLimit : null,
                    isComplete: col.isComplete || false,
                    triggersCarryForward:
                        col.triggersCarryForward !== undefined
                            ? col.triggersCarryForward
                            : true,
                },
                create: {
                    teamId,
                    name: col.name,
                    order: index,
                    wipLimit: col.wipLimit !== undefined ? col.wipLimit : null,
                    isComplete: col.isComplete || false,
                    triggersCarryForward:
                        col.triggersCarryForward !== undefined
                            ? col.triggersCarryForward
                            : true,
                },
            })
        )
    );
};


export const deleteColumnItem = async (teamId: string, columnId: string) => {
    const colToDelete = await prisma.taskColumn.findUnique({
        where: { id: columnId },
    });
    if (colToDelete) {
        const normalized = colToDelete.name.toLowerCase().trim();
        const constantNames = ["to do", "todo", "in progress", "need attention later", "need attention", "done"];
        if (constantNames.includes(normalized)) {
            throw new Error(`Column "${colToDelete.name}" is a constant column and cannot be deleted.`);
        }
    }

    const otherColumns = await prisma.taskColumn.findMany({
        where: { teamId, id: { not: columnId } },
        orderBy: { order: "asc" },
    });

    if (otherColumns.length === 0) {
        throw new Error("Cannot delete the last column of a board.");
    }

    const fallbackColId = otherColumns[0].id;

    // Move tasks to fallback column and delete the column atomically
    await prisma.$transaction([
        prisma.task.updateMany({
            where: { columnId },
            data: { columnId: fallbackColId },
        }),
        prisma.taskColumn.delete({
            where: { id: columnId },
        }),
    ]);

    return otherColumns[0].name;
};
