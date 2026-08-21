// Helper for dates without timezone shifts - uses UTC to ensure cross-timezone consistency
export function getLocalDateString(date: Date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split("-").map(Number);
    // Standardize to UTC midnight: 00:00:00.000Z
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
