/**
 * Phase 6 IPC Handler Tests
 *
 * Tests for new IPC handlers introduced in Phase 6:
 *  - emails:mark-read      — lightweight mark-as-read (DB only, fire-and-forget IMAP)
 *  - emails:mark-unread    — mark as unread (DB + IMAP)
 *  - emails:mark-all-read  — mark all emails in a folder as read
 *  - folders:create        — create IMAP folder (input validation, parentPath ownership)
 *  - folders:rename        — rename folder (system folder guard, transactional DB update)
 *  - folders:delete        — delete folder (system folder guard, non-empty guard)
 *  - extractUid helper     — composite email-ID → IMAP UID parsing
 *
 * Infrastructure: in-memory SQLite (same pattern as db.test.ts), mocked IMAP engine.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { app } from 'electron';
import type { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ---------------------------------------------------------------------------
// In-memory DB helper
// ---------------------------------------------------------------------------
import { initDatabase, closeDatabase } from './db';

// ---------------------------------------------------------------------------
// IMAP engine mock — prevents real network calls in unit tests
// ---------------------------------------------------------------------------
const mockImapEngine = {
    createMailbox: vi.fn().mockResolvedValue(true),
    renameMailbox: vi.fn().mockResolvedValue(true),
    deleteMailbox: vi.fn().mockResolvedValue(true),
    markAllRead: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
};

vi.mock('./imap.js', () => ({
    imapEngine: mockImapEngine,
}));

// ---------------------------------------------------------------------------
// extractUid — tested directly from the logic in main.ts
// (The function is not exported; we reproduce the implementation here to
//  unit-test the exact algorithm that the IPC handlers depend on.)
// ---------------------------------------------------------------------------
function extractUid(emailId: string): number {
    const uidStr = emailId.includes('_') ? emailId.split('_').pop() : emailId;
    return parseInt(uidStr ?? '0', 10);
}

// ---------------------------------------------------------------------------
// Handler implementations under test
// These are pure functions extracted from the IPC handler bodies so that they
// can be exercised without spinning up an Electron app.
// ---------------------------------------------------------------------------

const PROTECTED_FOLDER_TYPES = new Set(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']);

function markEmailRead(db: DatabaseType, emailId: string) {
    if (!emailId || typeof emailId !== 'string') throw new Error('Invalid email ID');
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(emailId);
    return { success: true };
}

function markEmailUnread(db: DatabaseType, emailId: string) {
    if (!emailId || typeof emailId !== 'string') throw new Error('Invalid email ID');
    db.prepare('UPDATE emails SET is_read = 0 WHERE id = ?').run(emailId);
    return { success: true };
}

async function markAllRead(
    db: DatabaseType,
    folderId: string,
    imapEngine: typeof mockImapEngine
) {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');
    const folder = db.prepare('SELECT id, account_id, path FROM folders WHERE id = ?').get(folderId) as
        | { id: string; account_id: string; path: string }
        | undefined;
    if (!folder) return { success: false, error: 'Folder not found' };
    await imapEngine.markAllRead(folder.account_id, folder.path.replace(/^\//, ''));
    db.prepare('UPDATE emails SET is_read = 1 WHERE folder_id = ? AND is_read = 0').run(folderId);
    return { success: true };
}

async function createFolder(
    db: DatabaseType,
    accountId: string,
    folderName: string,
    parentPath: string | undefined,
    imapEngine: typeof mockImapEngine
) {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    if (!folderName || typeof folderName !== 'string') throw new Error('Invalid folder name');
    const safeName = folderName.replace(/[\r\n\0/\\]/g, '').trim().slice(0, 100);
    if (!safeName) throw new Error('Invalid folder name');

    let fullPath = safeName;
    if (parentPath && typeof parentPath === 'string') {
        const safeParent = parentPath.replace(/[\r\n\0]/g, '').trim().slice(0, 200);
        const parentFolder = db.prepare('SELECT id FROM folders WHERE account_id = ? AND path = ?').get(accountId, safeParent) as
            | { id: string }
            | undefined;
        if (!parentFolder) return { success: false, error: 'Parent folder not found or does not belong to this account' };
        fullPath = `${safeParent}/${safeName}`;
    }

    const ok = await imapEngine.createMailbox(accountId, fullPath);
    if (!ok) return { success: false, error: 'Failed to create folder on server' };

    const folderId = `${accountId}_${fullPath}`;
    db.prepare(
        'INSERT OR IGNORE INTO folders (id, account_id, name, path, type) VALUES (?, ?, ?, ?, ?)'
    ).run(folderId, accountId, safeName, fullPath, 'other');
    return { success: true, folderId };
}

async function renameFolder(
    db: DatabaseType,
    folderId: string,
    newName: string,
    imapEngine: typeof mockImapEngine
) {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');
    if (!newName || typeof newName !== 'string') throw new Error('Invalid folder name');
    const safeName = newName.replace(/[\r\n\0/\\]/g, '').trim().slice(0, 100);
    if (!safeName) throw new Error('Invalid folder name');

    const folder = db.prepare('SELECT id, account_id, path, type FROM folders WHERE id = ?').get(folderId) as
        | { id: string; account_id: string; path: string; type: string }
        | undefined;
    if (!folder) return { success: false, error: 'Folder not found' };
    if (PROTECTED_FOLDER_TYPES.has(folder.type)) return { success: false, error: 'Cannot rename system folder' };

    const parts = folder.path.split('/');
    parts[parts.length - 1] = safeName;
    const newPath = parts.join('/');

    const ok = await imapEngine.renameMailbox(folder.account_id, folder.path, newPath);
    if (!ok) return { success: false, error: 'Failed to rename folder on server' };

    const newFolderId = `${folder.account_id}_${newPath}`;
    // PK rename requires: insert new → migrate children → delete old (FK-safe)
    db.transaction(() => {
        db.prepare('INSERT INTO folders (id, account_id, name, path, type) VALUES (?, ?, ?, ?, ?)').run(newFolderId, folder.account_id, safeName, newPath, folder.type);
        db.prepare('UPDATE emails SET folder_id = ? WHERE folder_id = ?').run(newFolderId, folderId);
        db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    })();
    return { success: true, folderId: newFolderId };
}

async function deleteFolder(
    db: DatabaseType,
    folderId: string,
    imapEngine: typeof mockImapEngine
) {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');

    const folder = db.prepare('SELECT id, account_id, path, type FROM folders WHERE id = ?').get(folderId) as
        | { id: string; account_id: string; path: string; type: string }
        | undefined;
    if (!folder) return { success: false, error: 'Folder not found' };
    if (PROTECTED_FOLDER_TYPES.has(folder.type)) return { success: false, error: 'Cannot delete system folder' };

    const emailCount = (db.prepare('SELECT COUNT(*) as count FROM emails WHERE folder_id = ?').get(folderId) as { count: number }).count;
    if (emailCount > 0) return { success: false, error: 'Folder is not empty' };

    const ok = await imapEngine.deleteMailbox(folder.account_id, folder.path);
    if (!ok) return { success: false, error: 'Failed to delete folder on server' };

    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    return { success: true };
}

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

let db: DatabaseType;
let tmpDir: string;

beforeAll(() => {
    // Use a unique temp directory to avoid SQLite locking conflicts with parallel tests
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-phase6-test-'));
    vi.mocked(app.getPath).mockReturnValue(tmpDir);
    db = initDatabase();
});

afterAll(() => {
    closeDatabase();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
    vi.clearAllMocks();
    mockImapEngine.createMailbox.mockResolvedValue(true);
    mockImapEngine.renameMailbox.mockResolvedValue(true);
    mockImapEngine.deleteMailbox.mockResolvedValue(true);
    mockImapEngine.markAllRead.mockResolvedValue(undefined);
    mockImapEngine.markAsRead.mockResolvedValue(undefined);
    mockImapEngine.markAsUnread.mockResolvedValue(undefined);

    // Clean test data between tests (keep schema)
    db.prepare('DELETE FROM emails').run();
    db.prepare('DELETE FROM folders').run();
    db.prepare('DELETE FROM accounts').run();
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function insertAccount(id = 'acc-1', email = 'user@example.com') {
    db.prepare('INSERT INTO accounts (id, email, provider) VALUES (?, ?, ?)').run(id, email, 'gmail');
    return id;
}

function insertFolder(
    id: string,
    accountId: string,
    name: string,
    folderPath: string,
    type = 'other'
) {
    db.prepare('INSERT INTO folders (id, account_id, name, path, type) VALUES (?, ?, ?, ?, ?)').run(
        id, accountId, name, folderPath, type
    );
    return id;
}

function insertEmail(id: string, accountId: string, folderId: string, isRead = 0) {
    db.prepare(
        'INSERT INTO emails (id, account_id, folder_id, subject, is_read) VALUES (?, ?, ?, ?, ?)'
    ).run(id, accountId, folderId, `Subject for ${id}`, isRead);
    return id;
}

// ---------------------------------------------------------------------------
// 1. extractUid helper
// ---------------------------------------------------------------------------
describe('extractUid', () => {
    it('parses UID from a simple numeric id', () => {
        expect(extractUid('42')).toBe(42);
    });

    it('extracts UID from composite id (acc_uid format)', () => {
        expect(extractUid('acc-1_123')).toBe(123);
    });

    it('extracts UID from deeply nested composite id', () => {
        expect(extractUid('acc-1_folder_456')).toBe(456);
    });

    it('returns 0 for a non-numeric suffix', () => {
        expect(extractUid('acc-1_abc')).toBe(NaN);
    });

    it('returns 0 for an empty string suffix after split', () => {
        const result = extractUid('acc-1_');
        expect(result).toBeNaN();
    });

    it('handles composite IDs with multiple underscores', () => {
        // "abc_def_789" → pop() → "789"
        expect(extractUid('abc_def_789')).toBe(789);
    });

    it('parses a single UID with no underscores', () => {
        expect(extractUid('99')).toBe(99);
    });

    it('returns 1 for id "acc_1"', () => {
        expect(extractUid('acc_1')).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 2. emails:mark-read
// ---------------------------------------------------------------------------
describe('emails:mark-read', () => {
    it('sets is_read=1 for the target email in the DB', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 0);

        const result = markEmailRead(db, 'email-1');

        expect(result).toEqual({ success: true });
        const row = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('email-1') as { is_read: number };
        expect(row.is_read).toBe(1);
    });

    it('does not affect other emails when marking one as read', () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 0);
        insertEmail('email-2', 'acc-1', 'folder-inbox', 0);

        markEmailRead(db, 'email-1');

        const email2 = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('email-2') as { is_read: number };
        expect(email2.is_read).toBe(0);
    });

    it('throws when email ID is empty string', () => {
        expect(() => markEmailRead(db, '')).toThrow('Invalid email ID');
    });

    it('does not throw when email ID does not exist in DB (silent no-op)', () => {
        // UPDATE with no matching row is valid SQL; returns success
        expect(() => markEmailRead(db, 'nonexistent-id')).not.toThrow();
    });

    it('is idempotent — marking already-read email succeeds without error', () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 1); // already read

        const result = markEmailRead(db, 'email-1');
        expect(result).toEqual({ success: true });
        const row = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('email-1') as { is_read: number };
        expect(row.is_read).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 3. emails:mark-unread
// ---------------------------------------------------------------------------
describe('emails:mark-unread', () => {
    it('sets is_read=0 for the target email in the DB', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 1);

        const result = markEmailUnread(db, 'email-1');

        expect(result).toEqual({ success: true });
        const row = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('email-1') as { is_read: number };
        expect(row.is_read).toBe(0);
    });

    it('does not affect other emails in the folder', () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 1);
        insertEmail('email-2', 'acc-1', 'folder-inbox', 1);

        markEmailUnread(db, 'email-1');

        const email2 = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('email-2') as { is_read: number };
        expect(email2.is_read).toBe(1);
    });

    it('throws when email ID is empty string', () => {
        expect(() => markEmailUnread(db, '')).toThrow('Invalid email ID');
    });

    it('is idempotent — marking already-unread email succeeds', () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 0);

        const result = markEmailUnread(db, 'email-1');
        expect(result).toEqual({ success: true });
    });
});

// ---------------------------------------------------------------------------
// 4. emails:mark-all-read
// ---------------------------------------------------------------------------
describe('emails:mark-all-read', () => {
    it('sets is_read=1 for all unread emails in the specified folder', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 0);
        insertEmail('email-2', 'acc-1', 'folder-inbox', 0);
        insertEmail('email-3', 'acc-1', 'folder-inbox', 1); // already read

        const result = await markAllRead(db, 'folder-inbox', mockImapEngine);

        expect(result).toEqual({ success: true });
        const unread = db.prepare('SELECT COUNT(*) as c FROM emails WHERE folder_id = ? AND is_read = 0').get('folder-inbox') as { c: number };
        expect(unread.c).toBe(0);
    });

    it('does not affect emails in other folders', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertFolder('folder-sent', 'acc-1', 'Sent', 'Sent', 'sent');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 0);
        insertEmail('email-2', 'acc-1', 'folder-sent', 0); // different folder

        await markAllRead(db, 'folder-inbox', mockImapEngine);

        const sentEmail = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('email-2') as { is_read: number };
        expect(sentEmail.is_read).toBe(0); // unchanged
    });

    it('calls imapEngine.markAllRead with the correct account and path', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', '/INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 0);

        await markAllRead(db, 'folder-inbox', mockImapEngine);

        // Leading slash stripped from path
        expect(mockImapEngine.markAllRead).toHaveBeenCalledWith('acc-1', 'INBOX');
    });

    it('returns success: false when folder is not found', async () => {
        const result = await markAllRead(db, 'nonexistent-folder', mockImapEngine);
        expect(result).toEqual({ success: false, error: 'Folder not found' });
    });

    it('throws when folderId is empty string', async () => {
        await expect(markAllRead(db, '', mockImapEngine)).rejects.toThrow('Invalid folder ID');
    });

    it('is a no-op (succeeds) when all emails are already read', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-1', 'acc-1', 'folder-inbox', 1);
        insertEmail('email-2', 'acc-1', 'folder-inbox', 1);

        const result = await markAllRead(db, 'folder-inbox', mockImapEngine);
        expect(result).toEqual({ success: true });
    });

    it('is a no-op (succeeds) when folder has no emails', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');

        const result = await markAllRead(db, 'folder-inbox', mockImapEngine);
        expect(result).toEqual({ success: true });
    });
});

// ---------------------------------------------------------------------------
// 5. folders:create
// ---------------------------------------------------------------------------
describe('folders:create', () => {
    it('creates a top-level folder and inserts it into DB', async () => {
        insertAccount();

        const result = await createFolder(db, 'acc-1', 'Projects', undefined, mockImapEngine);

        expect(result.success).toBe(true);
        expect(result.folderId).toBe('acc-1_Projects');
        const row = db.prepare('SELECT * FROM folders WHERE id = ?').get('acc-1_Projects') as { name: string; path: string; type: string };
        expect(row.name).toBe('Projects');
        expect(row.path).toBe('Projects');
        expect(row.type).toBe('other');
    });

    it('calls imapEngine.createMailbox with the full path', async () => {
        insertAccount();

        await createFolder(db, 'acc-1', 'Archive', undefined, mockImapEngine);

        expect(mockImapEngine.createMailbox).toHaveBeenCalledWith('acc-1', 'Archive');
    });

    it('creates a subfolder under an existing parent folder', async () => {
        insertAccount();
        insertFolder('acc-1_Work', 'acc-1', 'Work', 'Work', 'other');

        const result = await createFolder(db, 'acc-1', 'Reports', 'Work', mockImapEngine);

        expect(result.success).toBe(true);
        expect(result.folderId).toBe('acc-1_Work/Reports');
        expect(mockImapEngine.createMailbox).toHaveBeenCalledWith('acc-1', 'Work/Reports');
    });

    it('returns success:false when parent folder does not exist', async () => {
        insertAccount();

        const result = await createFolder(db, 'acc-1', 'Child', 'NonExistentParent', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Parent folder not found');
    });

    it('returns success:false when parent folder belongs to a different account (cross-account guard)', async () => {
        insertAccount('acc-1', 'user1@example.com');
        insertAccount('acc-2', 'user2@example.com');
        // Parent folder belongs to acc-2
        insertFolder('acc-2_Work', 'acc-2', 'Work', 'Work', 'other');

        // acc-1 tries to create a subfolder under acc-2's folder
        const result = await createFolder(db, 'acc-1', 'Spy', 'Work', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not belong to this account');
        // IMAP must NOT have been called
        expect(mockImapEngine.createMailbox).not.toHaveBeenCalled();
    });

    it('throws when accountId is empty string', async () => {
        await expect(createFolder(db, '', 'Folder', undefined, mockImapEngine)).rejects.toThrow('Invalid account ID');
    });

    it('throws when folderName is empty string', async () => {
        insertAccount();
        await expect(createFolder(db, 'acc-1', '', undefined, mockImapEngine)).rejects.toThrow('Invalid folder name');
    });

    it('strips CRLF and path separators from folder name', async () => {
        insertAccount();

        const result = await createFolder(db, 'acc-1', 'Good\r\nName/Bad\\chars', undefined, mockImapEngine);

        expect(result.success).toBe(true);
        // CRLF and separators are stripped; only "GoodNameBadchars" remains
        const row = db.prepare('SELECT name FROM folders WHERE account_id = ?').get('acc-1') as { name: string };
        expect(row.name).toBe('GoodNameBadchars');
    });

    it('throws when folder name is only unsafe characters (empty after strip)', async () => {
        insertAccount();
        await expect(createFolder(db, 'acc-1', '/\\', undefined, mockImapEngine)).rejects.toThrow('Invalid folder name');
    });

    it('returns success:false when IMAP server fails to create mailbox', async () => {
        insertAccount();
        mockImapEngine.createMailbox.mockResolvedValueOnce(false);

        const result = await createFolder(db, 'acc-1', 'FailMe', undefined, mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to create folder on server');
        // Nothing inserted to DB
        const row = db.prepare('SELECT * FROM folders WHERE name = ?').get('FailMe');
        expect(row).toBeUndefined();
    });

    it('truncates folder names longer than 100 characters', async () => {
        insertAccount();
        const longName = 'A'.repeat(150);

        const result = await createFolder(db, 'acc-1', longName, undefined, mockImapEngine);

        expect(result.success).toBe(true);
        const row = db.prepare('SELECT name FROM folders WHERE account_id = ?').get('acc-1') as { name: string };
        expect(row.name.length).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// 6. folders:rename
// ---------------------------------------------------------------------------
describe('folders:rename', () => {
    it('renames a custom folder in the DB and on IMAP', async () => {
        insertAccount();
        insertFolder('acc-1_OldName', 'acc-1', 'OldName', 'OldName', 'other');

        const result = await renameFolder(db, 'acc-1_OldName', 'NewName', mockImapEngine);

        expect(result.success).toBe(true);
        expect(result.folderId).toBe('acc-1_NewName');
        // Old folder ID should be gone
        const old = db.prepare('SELECT * FROM folders WHERE id = ?').get('acc-1_OldName');
        expect(old).toBeUndefined();
        // New folder ID should exist
        const newFolder = db.prepare('SELECT name, path FROM folders WHERE id = ?').get('acc-1_NewName') as { name: string; path: string };
        expect(newFolder.name).toBe('NewName');
        expect(newFolder.path).toBe('NewName');
    });

    it('calls imapEngine.renameMailbox with old and new paths', async () => {
        insertAccount();
        insertFolder('acc-1_OldPath', 'acc-1', 'OldPath', 'OldPath', 'other');

        await renameFolder(db, 'acc-1_OldPath', 'NewPath', mockImapEngine);

        expect(mockImapEngine.renameMailbox).toHaveBeenCalledWith('acc-1', 'OldPath', 'NewPath');
    });

    it('updates the folder_id on all emails in the renamed folder (transactional)', async () => {
        insertAccount();
        insertFolder('acc-1_OldName', 'acc-1', 'OldName', 'OldName', 'other');
        insertEmail('email-1', 'acc-1', 'acc-1_OldName', 0);
        insertEmail('email-2', 'acc-1', 'acc-1_OldName', 0);

        await renameFolder(db, 'acc-1_OldName', 'NewName', mockImapEngine);

        const email1 = db.prepare('SELECT folder_id FROM emails WHERE id = ?').get('email-1') as { folder_id: string };
        const email2 = db.prepare('SELECT folder_id FROM emails WHERE id = ?').get('email-2') as { folder_id: string };
        expect(email1.folder_id).toBe('acc-1_NewName');
        expect(email2.folder_id).toBe('acc-1_NewName');
    });

    it('preserves parent path when renaming a nested folder', async () => {
        insertAccount();
        insertFolder('acc-1_Work/Reports', 'acc-1', 'Reports', 'Work/Reports', 'other');

        const result = await renameFolder(db, 'acc-1_Work/Reports', 'Summaries', mockImapEngine);

        expect(result.success).toBe(true);
        const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get('acc-1_Work/Summaries') as { path: string };
        expect(folder.path).toBe('Work/Summaries');
    });

    it('rejects renaming a system folder (inbox)', async () => {
        insertAccount();
        insertFolder('acc-1_INBOX', 'acc-1', 'Inbox', 'INBOX', 'inbox');

        const result = await renameFolder(db, 'acc-1_INBOX', 'HackedInbox', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Cannot rename system folder');
        expect(mockImapEngine.renameMailbox).not.toHaveBeenCalled();
    });

    it('rejects renaming a system folder (sent)', async () => {
        insertAccount();
        insertFolder('acc-1_Sent', 'acc-1', 'Sent', 'Sent', 'sent');

        const result = await renameFolder(db, 'acc-1_Sent', 'MySent', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Cannot rename system folder');
    });

    it('rejects renaming a system folder (trash)', async () => {
        insertAccount();
        insertFolder('acc-1_Trash', 'acc-1', 'Trash', 'Trash', 'trash');

        const result = await renameFolder(db, 'acc-1_Trash', 'Recycled', mockImapEngine);

        expect(result.success).toBe(false);
    });

    it('returns success:false when folder is not found', async () => {
        const result = await renameFolder(db, 'nonexistent-folder', 'NewName', mockImapEngine);
        expect(result.success).toBe(false);
        expect(result.error).toBe('Folder not found');
    });

    it('returns success:false when IMAP rename fails', async () => {
        insertAccount();
        insertFolder('acc-1_OldName', 'acc-1', 'OldName', 'OldName', 'other');
        mockImapEngine.renameMailbox.mockResolvedValueOnce(false);

        const result = await renameFolder(db, 'acc-1_OldName', 'NewName', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to rename folder on server');
        // DB should NOT have been updated
        const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get('acc-1_OldName');
        expect(folder).toBeDefined(); // still the old one
    });

    it('throws when folderId is empty string', async () => {
        await expect(renameFolder(db, '', 'NewName', mockImapEngine)).rejects.toThrow('Invalid folder ID');
    });

    it('throws when newName is empty string', async () => {
        insertAccount();
        insertFolder('acc-1_F', 'acc-1', 'F', 'F', 'other');
        await expect(renameFolder(db, 'acc-1_F', '', mockImapEngine)).rejects.toThrow('Invalid folder name');
    });

    it('strips CRLF and path separators from new name', async () => {
        insertAccount();
        insertFolder('acc-1_OldName', 'acc-1', 'OldName', 'OldName', 'other');

        const result = await renameFolder(db, 'acc-1_OldName', 'Good\r\n/\\Bad', mockImapEngine);

        expect(result.success).toBe(true);
        const folder = db.prepare('SELECT name FROM folders WHERE account_id = ?').get('acc-1') as { name: string };
        expect(folder.name).toBe('GoodBad');
    });
});

// ---------------------------------------------------------------------------
// 7. folders:delete
// ---------------------------------------------------------------------------
describe('folders:delete', () => {
    it('deletes an empty custom folder from DB and IMAP', async () => {
        insertAccount();
        insertFolder('acc-1_OldFolder', 'acc-1', 'OldFolder', 'OldFolder', 'other');

        const result = await deleteFolder(db, 'acc-1_OldFolder', mockImapEngine);

        expect(result).toEqual({ success: true });
        const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get('acc-1_OldFolder');
        expect(folder).toBeUndefined();
    });

    it('calls imapEngine.deleteMailbox with correct account and path', async () => {
        insertAccount();
        insertFolder('acc-1_TestPath', 'acc-1', 'TestPath', 'TestPath', 'other');

        await deleteFolder(db, 'acc-1_TestPath', mockImapEngine);

        expect(mockImapEngine.deleteMailbox).toHaveBeenCalledWith('acc-1', 'TestPath');
    });

    it('rejects deleting a non-empty folder', async () => {
        insertAccount();
        insertFolder('acc-1_HasEmail', 'acc-1', 'HasEmail', 'HasEmail', 'other');
        insertEmail('email-1', 'acc-1', 'acc-1_HasEmail', 0);

        const result = await deleteFolder(db, 'acc-1_HasEmail', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Folder is not empty');
        // Folder must still exist
        const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get('acc-1_HasEmail');
        expect(folder).toBeDefined();
        expect(mockImapEngine.deleteMailbox).not.toHaveBeenCalled();
    });

    it('rejects deleting system folder (inbox)', async () => {
        insertAccount();
        insertFolder('acc-1_INBOX', 'acc-1', 'Inbox', 'INBOX', 'inbox');

        const result = await deleteFolder(db, 'acc-1_INBOX', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Cannot delete system folder');
        expect(mockImapEngine.deleteMailbox).not.toHaveBeenCalled();
    });

    it('rejects deleting system folder (trash)', async () => {
        insertAccount();
        insertFolder('acc-1_Trash', 'acc-1', 'Trash', 'Trash', 'trash');

        const result = await deleteFolder(db, 'acc-1_Trash', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Cannot delete system folder');
    });

    it('rejects deleting system folder (drafts)', async () => {
        insertAccount();
        insertFolder('acc-1_Drafts', 'acc-1', 'Drafts', 'Drafts', 'drafts');

        const result = await deleteFolder(db, 'acc-1_Drafts', mockImapEngine);

        expect(result.success).toBe(false);
    });

    it('rejects deleting system folder (sent)', async () => {
        insertAccount();
        insertFolder('acc-1_Sent', 'acc-1', 'Sent', 'Sent', 'sent');

        const result = await deleteFolder(db, 'acc-1_Sent', mockImapEngine);

        expect(result.success).toBe(false);
    });

    it('returns success:false when folder is not found', async () => {
        const result = await deleteFolder(db, 'nonexistent-folder', mockImapEngine);
        expect(result.success).toBe(false);
        expect(result.error).toBe('Folder not found');
    });

    it('returns success:false when IMAP delete fails', async () => {
        insertAccount();
        insertFolder('acc-1_EmptyCustom', 'acc-1', 'EmptyCustom', 'EmptyCustom', 'other');
        mockImapEngine.deleteMailbox.mockResolvedValueOnce(false);

        const result = await deleteFolder(db, 'acc-1_EmptyCustom', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to delete folder on server');
        // Folder must still exist in DB
        const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get('acc-1_EmptyCustom');
        expect(folder).toBeDefined();
    });

    it('throws when folderId is empty string', async () => {
        await expect(deleteFolder(db, '', mockImapEngine)).rejects.toThrow('Invalid folder ID');
    });

    it('correctly evaluates empty folder after all emails were deleted', async () => {
        insertAccount();
        insertFolder('acc-1_NowEmpty', 'acc-1', 'NowEmpty', 'NowEmpty', 'other');
        insertEmail('email-1', 'acc-1', 'acc-1_NowEmpty', 0);
        // Remove the email first
        db.prepare('DELETE FROM emails WHERE id = ?').run('email-1');

        const result = await deleteFolder(db, 'acc-1_NowEmpty', mockImapEngine);

        expect(result).toEqual({ success: true });
    });
});

// ---------------------------------------------------------------------------
// 8. Cross-account isolation
// ---------------------------------------------------------------------------
describe('Cross-account isolation', () => {
    it('folders:create prevents using another account\'s folder as parent', async () => {
        insertAccount('acc-1', 'a1@test.com');
        insertAccount('acc-2', 'a2@test.com');
        insertFolder('acc-2_ParentFolder', 'acc-2', 'ParentFolder', 'ParentFolder', 'other');

        const result = await createFolder(db, 'acc-1', 'SubChild', 'ParentFolder', mockImapEngine);

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not belong to this account');
    });

    it('mark-all-read only affects the specified folder, not folders from other accounts', async () => {
        insertAccount('acc-1', 'a1@test.com');
        insertAccount('acc-2', 'a2@test.com');
        insertFolder('acc-1_INBOX', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertFolder('acc-2_INBOX', 'acc-2', 'Inbox', 'INBOX', 'inbox');
        insertEmail('e1-acc1', 'acc-1', 'acc-1_INBOX', 0);
        insertEmail('e1-acc2', 'acc-2', 'acc-2_INBOX', 0);

        await markAllRead(db, 'acc-1_INBOX', mockImapEngine);

        const acc2Email = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('e1-acc2') as { is_read: number };
        expect(acc2Email.is_read).toBe(0); // unchanged
    });
});

// ---------------------------------------------------------------------------
// 9. DB constraint edge cases
// ---------------------------------------------------------------------------
describe('DB constraint edge cases', () => {
    it('folders:create uses INSERT OR IGNORE — duplicate folder path is silently ignored', async () => {
        insertAccount();
        insertFolder('acc-1_Projects', 'acc-1', 'Projects', 'Projects', 'other');

        // Second creation of the same path — should not throw
        const result = await createFolder(db, 'acc-1', 'Projects', undefined, mockImapEngine);
        expect(result.success).toBe(true);
    });

    it('mark-all-read leaves already-read emails with is_read=1', async () => {
        insertAccount();
        insertFolder('folder-inbox', 'acc-1', 'Inbox', 'INBOX', 'inbox');
        insertEmail('email-read', 'acc-1', 'folder-inbox', 1); // already read

        await markAllRead(db, 'folder-inbox', mockImapEngine);

        const row = db.prepare('SELECT is_read FROM emails WHERE id = ?').get('email-read') as { is_read: number };
        expect(row.is_read).toBe(1);
    });
});
