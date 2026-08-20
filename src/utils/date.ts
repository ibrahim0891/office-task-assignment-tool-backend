// Helper for dates without timezone shifts
export function getLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split("-").map(Number);
    // Create Date at noon local time to avoid timezone offsets causing date flips
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}
