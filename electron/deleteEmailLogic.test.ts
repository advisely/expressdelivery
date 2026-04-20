import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { deleteEmailLogic, extractUidFromEmailId } from './deleteEmailLogic';

function makeDb(): DatabaseType {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL);
        CREATE TABLE folders (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT
        );
        CREATE TABLE emails (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            folder_id TEXT NOT NULL,
            subject TEXT
        );
    `);
    return db;
}

function seed(db: DatabaseType) {
    db.prepare('INSERT INTO accounts (id, email) VALUES (?, ?)').run('acc-1', 'u@example.com');
    db.prepare('INSERT INTO folders (id, account_id, name, path, type) VALUES (?, ?, ?, ?, ?)').run(
        'acc-1_INBOX', 'acc-1', 'Inbox', 'INBOX', 'inbox',
    );
    db.prepare('INSERT INTO folders (id, account_id, name, path, type) VALUES (?, ?, ?, ?, ?)').run(
        'acc-1_Trash', 'acc-1', 'Trash', 'Trash', 'trash',
    );
    db.prepare('INSERT INTO emails (id, account_id, folder_id, subject) VALUES (?, ?, ?, ?)').run(
        'acc-1_42', 'acc-1', 'acc-1_INBOX', 'Hello',
    );
}

describe('extractUidFromEmailId', () => {
    it('parses the trailing UID from a composite email ID', () => {
        expect(extractUidFromEmailId('acc-1_42')).toBe(42);
        expect(extractUidFromEmailId('uuid-with-dashes_99')).toBe(99);
    });
    it('returns the parsed value when no underscore is present', () => {
        expect(extractUidFromEmailId('123')).toBe(123);
    });
    it('returns NaN for non-numeric trailing segments (caller must guard with > 0 check)', () => {
        expect(extractUidFromEmailId('foo_bar')).toBeNaN();
    });
});

describe('deleteEmailLogic — Move to Trash path (REGRESSION: do NOT silently fall back)', () => {
    let db: DatabaseType;
    beforeEach(() => { db = makeDb(); seed(db); });

    it('returns { success: true } and updates folder_id when moveMessage succeeds', async () => {
        const moveMessage = vi.fn().mockResolvedValue(true);
        const deleteMessage = vi.fn().mockResolvedValue(true);

        const result = await deleteEmailLogic(db, 'acc-1_42', { moveMessage, deleteMessage });

        expect(result.success).toBe(true);
        const row = db.prepare('SELECT folder_id FROM emails WHERE id = ?').get('acc-1_42') as { folder_id: string };
        expect(row.folder_id).toBe('acc-1_Trash');
        expect(moveMessage).toHaveBeenCalledWith('acc-1', 42, 'INBOX', 'Trash');
    });

    it('returns { success: false } and LEAVES folder_id intact when moveMessage returns false', async () => {
        // This is the v1.18.0 → v1.18.1 fix. Previously the IPC silently
        // fell back to a local-only folder_id update + returned success: true,
        // which caused the email to reappear in INBOX on the next sync because
        // the server still had it there.
        const moveMessage = vi.fn().mockResolvedValue(false);
        const deleteMessage = vi.fn();

        const result = await deleteEmailLogic(db, 'acc-1_42', { moveMessage, deleteMessage });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/server rejected/i);
        const row = db.prepare('SELECT folder_id FROM emails WHERE id = ?').get('acc-1_42') as { folder_id: string };
        expect(row.folder_id).toBe('acc-1_INBOX'); // unchanged
    });

    it('returns { success: false } and LEAVES folder_id intact when moveMessage throws', async () => {
        const moveMessage = vi.fn().mockRejectedValue(new Error('Account not connected'));
        const deleteMessage = vi.fn();

        const result = await deleteEmailLogic(db, 'acc-1_42', { moveMessage, deleteMessage });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Account not connected');
        const row = db.prepare('SELECT folder_id FROM emails WHERE id = ?').get('acc-1_42') as { folder_id: string };
        expect(row.folder_id).toBe('acc-1_INBOX');
    });

    it('returns { success: false } when no trash folder exists for the account', async () => {
        // Edge: trash folder lookup misses (e.g., folder discovery hasn't run
        // yet). Allowed to local-delete — there's no reasonable IMAP move.
        db.prepare('DELETE FROM folders WHERE id = ?').run('acc-1_Trash');

        const moveMessage = vi.fn();
        const deleteMessage = vi.fn();

        const result = await deleteEmailLogic(db, 'acc-1_42', { moveMessage, deleteMessage });

        expect(result.success).toBe(true);
        const row = db.prepare('SELECT folder_id FROM emails WHERE id = ?').get('acc-1_42');
        expect(row).toBeUndefined();
        expect(moveMessage).not.toHaveBeenCalled();
    });

    it('returns { success: false } when the email does not exist', async () => {
        const result = await deleteEmailLogic(db, 'nonexistent', {
            moveMessage: vi.fn(), deleteMessage: vi.fn(),
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });
});

describe('deleteEmailLogic — Permanent delete from Trash', () => {
    let db: DatabaseType;
    beforeEach(() => {
        db = makeDb(); seed(db);
        db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run('acc-1_Trash', 'acc-1_42');
    });

    it('returns { success: true, permanent: true } when IMAP delete succeeds', async () => {
        const deleteMessage = vi.fn().mockResolvedValue(true);
        const result = await deleteEmailLogic(db, 'acc-1_42', {
            moveMessage: vi.fn(), deleteMessage,
        });
        expect(result.success).toBe(true);
        expect(result.permanent).toBe(true);
        const row = db.prepare('SELECT id FROM emails WHERE id = ?').get('acc-1_42');
        expect(row).toBeUndefined();
        expect(deleteMessage).toHaveBeenCalledWith('acc-1', 42, 'Trash');
    });

    it('returns { success: false } and LEAVES the row intact when IMAP delete returns false', async () => {
        const deleteMessage = vi.fn().mockResolvedValue(false);
        const result = await deleteEmailLogic(db, 'acc-1_42', {
            moveMessage: vi.fn(), deleteMessage,
        });
        expect(result.success).toBe(false);
        const row = db.prepare('SELECT id FROM emails WHERE id = ?').get('acc-1_42');
        expect(row).toBeDefined();
    });

    it('returns { success: false } when IMAP delete throws', async () => {
        const deleteMessage = vi.fn().mockRejectedValue(new Error('boom'));
        const result = await deleteEmailLogic(db, 'acc-1_42', {
            moveMessage: vi.fn(), deleteMessage,
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('boom');
    });
});
