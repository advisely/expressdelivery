import type { Database as DatabaseType } from 'better-sqlite3';

/**
 * User-managed allowlist of trusted email sender addresses. When a sender's
 * lowercased email is in this list, the renderer's `assessSenderRisk` is
 * bypassed for that email — no red "Loading remote images is NOT recommended"
 * banner, no danger variant, no risk reasons. Remote-image blocking remains
 * independent (privacy choice, not security choice).
 *
 * Storage: a single row in the SQLite `settings` table with key
 * `trusted_senders` whose value is a JSON array of lowercased email strings.
 * Rationale: no schema migration required for MVP; the list is small (rarely
 * exceeds a few dozen entries); read happens once per email open.
 *
 * v1.18.3+. Pinned by trustedSenders.test.ts.
 */

const SETTINGS_KEY = 'trusted_senders';

function readRaw(db: DatabaseType): string[] {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row?.value) return [];
    try {
        const parsed: unknown = JSON.parse(row.value);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
        return [];
    }
}

function writeRaw(db: DatabaseType, list: string[]): void {
    const json = JSON.stringify(list);
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(SETTINGS_KEY, json);
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** Return the trusted-sender allowlist as a Set of lowercased addresses. */
export function getTrustedSenders(db: DatabaseType): Set<string> {
    return new Set(readRaw(db).map(normalizeEmail).filter(Boolean));
}

/** Return the trusted-sender allowlist as an ordered array (UI listing). */
export function listTrustedSenders(db: DatabaseType): string[] {
    return [...new Set(readRaw(db).map(normalizeEmail).filter(Boolean))];
}

/** True if `email` is currently in the trusted allowlist. */
export function isSenderTrusted(db: DatabaseType, email: string | null | undefined): boolean {
    if (!email) return false;
    return getTrustedSenders(db).has(normalizeEmail(email));
}

/**
 * Add `email` to the trusted allowlist. Idempotent — calling twice with the
 * same address (regardless of case/whitespace) does not produce duplicates.
 * Returns the updated list.
 */
export function addTrustedSender(db: DatabaseType, email: string): string[] {
    const normalized = normalizeEmail(email);
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new Error(`Invalid email address: ${email}`);
    }
    const current = new Set(readRaw(db).map(normalizeEmail).filter(Boolean));
    current.add(normalized);
    const updated = [...current];
    writeRaw(db, updated);
    return updated;
}

/** Remove `email` from the trusted allowlist. Returns the updated list. */
export function removeTrustedSender(db: DatabaseType, email: string): string[] {
    const normalized = normalizeEmail(email);
    const current = new Set(readRaw(db).map(normalizeEmail).filter(Boolean));
    current.delete(normalized);
    const updated = [...current];
    writeRaw(db, updated);
    return updated;
}
