import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
    getTrustedSenders,
    listTrustedSenders,
    isSenderTrusted,
    addTrustedSender,
    removeTrustedSender,
} from './trustedSenders';

function makeDb(): DatabaseType {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    return db;
}

describe('trustedSenders — DB-backed allowlist', () => {
    let db: DatabaseType;
    beforeEach(() => { db = makeDb(); });

    it('returns empty set when settings row does not exist', () => {
        expect(getTrustedSenders(db).size).toBe(0);
        expect(listTrustedSenders(db)).toEqual([]);
        expect(isSenderTrusted(db, 'anyone@example.com')).toBe(false);
    });

    it('addTrustedSender persists a single address', () => {
        addTrustedSender(db, 'auto-confirm@amazon.ca');
        expect(isSenderTrusted(db, 'auto-confirm@amazon.ca')).toBe(true);
        expect(listTrustedSenders(db)).toEqual(['auto-confirm@amazon.ca']);
    });

    it('addTrustedSender lowercases and trims before storing', () => {
        addTrustedSender(db, '  Auto-Confirm@Amazon.ca  ');
        expect(isSenderTrusted(db, 'auto-confirm@amazon.ca')).toBe(true);
        expect(isSenderTrusted(db, 'AUTO-CONFIRM@AMAZON.CA')).toBe(true);
        expect(listTrustedSenders(db)).toEqual(['auto-confirm@amazon.ca']);
    });

    it('addTrustedSender is idempotent (no duplicates on repeated calls)', () => {
        addTrustedSender(db, 'a@b.com');
        addTrustedSender(db, 'a@b.com');
        addTrustedSender(db, 'A@B.com');
        expect(listTrustedSenders(db)).toEqual(['a@b.com']);
    });

    it('addTrustedSender persists multiple distinct addresses', () => {
        addTrustedSender(db, 'a@b.com');
        addTrustedSender(db, 'c@d.com');
        const list = listTrustedSenders(db);
        expect(list).toContain('a@b.com');
        expect(list).toContain('c@d.com');
        expect(list).toHaveLength(2);
    });

    it('addTrustedSender rejects invalid email shapes', () => {
        expect(() => addTrustedSender(db, 'not-an-email')).toThrow(/Invalid email/);
        expect(() => addTrustedSender(db, '')).toThrow(/Invalid email/);
        expect(() => addTrustedSender(db, 'foo@bar')).toThrow(/Invalid email/);
        expect(listTrustedSenders(db)).toEqual([]);
    });

    it('removeTrustedSender deletes the address (case/whitespace insensitive)', () => {
        addTrustedSender(db, 'a@b.com');
        addTrustedSender(db, 'c@d.com');
        removeTrustedSender(db, '  A@B.COM  ');
        expect(isSenderTrusted(db, 'a@b.com')).toBe(false);
        expect(isSenderTrusted(db, 'c@d.com')).toBe(true);
        expect(listTrustedSenders(db)).toEqual(['c@d.com']);
    });

    it('removeTrustedSender on a non-existent entry is a no-op', () => {
        addTrustedSender(db, 'a@b.com');
        removeTrustedSender(db, 'unknown@example.com');
        expect(listTrustedSenders(db)).toEqual(['a@b.com']);
    });

    it('survives a corrupted settings value (returns empty, does not throw)', () => {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('trusted_senders', 'not valid json {{{');
        expect(getTrustedSenders(db).size).toBe(0);
        expect(listTrustedSenders(db)).toEqual([]);
    });

    it('survives a non-array JSON value', () => {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('trusted_senders', '{"not":"an array"}');
        expect(getTrustedSenders(db).size).toBe(0);
    });

    it('isSenderTrusted handles null/undefined gracefully', () => {
        addTrustedSender(db, 'a@b.com');
        expect(isSenderTrusted(db, null)).toBe(false);
        expect(isSenderTrusted(db, undefined)).toBe(false);
        expect(isSenderTrusted(db, '')).toBe(false);
    });
});
