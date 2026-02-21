import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, getDatabase } from './db';
import fs from 'fs';
import path from 'path';

describe('Local SQLite Database Engine', () => {
    let db: ReturnType<typeof getDatabase>;

    beforeAll(() => {
        // Remove old test db if it exists
        const testDbPath = path.join('/tmp', 'expressdelivery.sqlite');
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // Initialize the DB which will be mapped to /tmp via our Electron mock
        db = initDatabase();
    });

    afterAll(() => {
        db.close();
    });

    it('should initialize tables and pragmas correctly', () => {
        expect(db).toBeDefined();

        // Check tables exist
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get();
        expect(tableCheck).toBeDefined();

        // Verify WAL mode
        const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
        expect(journalMode?.journal_mode?.toLowerCase()).toBe('wal');
    });

    it('should insert and retrieve an account', () => {
        const stmt = db.prepare('INSERT INTO accounts (id, email, provider) VALUES (?, ?, ?)');
        stmt.run('acc_1', 'test@example.com', 'gmail');

        const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get('acc_1') as Record<string, unknown>;
        expect(row.email).toBe('test@example.com');
        expect(row.provider).toBe('gmail');
    });

    it('should fail adding duplicate emails (SQLite UNIQUE Constraint)', () => {
        const stmt = db.prepare('INSERT INTO accounts (id, email, provider) VALUES (?, ?, ?)');
        expect(() => {
            stmt.run('acc_2', 'test@example.com', 'outlook');
        }).toThrowError();
    });

    it('should enforce Foreign Key constraints on deletion', () => {
        // Insert a folder tied to the account
        db.prepare('INSERT INTO folders (id, account_id, name, path) VALUES (?, ?, ?, ?)').run('dir_1', 'acc_1', 'Inbox', '/INBOX');

        const folderCheckBefore = db.prepare('SELECT * FROM folders WHERE id = ?').get('dir_1');
        expect(folderCheckBefore).toBeDefined();

        // Delete the parent account
        db.prepare('DELETE FROM accounts WHERE id = ?').run('acc_1');

        // The Folder should be cascade-deleted
        const folderCheckAfter = db.prepare('SELECT * FROM folders WHERE id = ?').get('dir_1');
        expect(folderCheckAfter).toBeUndefined();
    });

    it('should propagate data to the FTS5 table via Triggers on Insert', () => {
        // Add a new account + folder for the email
        db.prepare('INSERT INTO accounts (id, email, provider) VALUES (?, ?, ?)').run('acc_3', 'fts@email.com', 'custom');
        db.prepare('INSERT INTO folders (id, account_id, name, path) VALUES (?, ?, ?, ?)').run('dir_2', 'acc_3', 'Sent', '/SENT');

        // Insert standard email
        const insertStmt = db.prepare('INSERT INTO emails (id, account_id, folder_id, subject, body_text) VALUES (?, ?, ?, ?, ?)');
        const emailId = 'email_1';
        insertStmt.run(emailId, 'acc_3', 'dir_2', 'Urgent Project Updates', 'The new UI looks absolutely fantastic!');

        // Query the virtual FTS table
        const searchStmt = db.prepare('SELECT * FROM emails_fts WHERE emails_fts MATCH ?');

        // Exact word match
        let results = searchStmt.all('fantastic');
        expect(results.length).toBe(1);
        expect((results[0] as Record<string, unknown>).subject).toBe('Urgent Project Updates');

        // No match
        results = searchStmt.all('terrible');
        expect(results.length).toBe(0);
    });
});
