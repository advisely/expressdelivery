/** Strip carriage return, newline, and null bytes to prevent header injection */
export function stripCRLF(s: string): string {
    return s.replace(/[\r\n\0]/g, '');
}

/** Sanitize FTS5 query: strip special characters, enforce max length */
export function sanitizeFts5Query(raw: string): string {
    const cleaned = raw
        .replace(/["*^():\\]/g, '')
        .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
        .trim();
    return cleaned.slice(0, 200);
}
