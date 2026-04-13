import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { initDatabase, getDatabase } from './db';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Local SQLite Database Engine', () => {
    let db: ReturnType<typeof getDatabase>;
    let tmpDir: string;

    beforeAll(() => {
        // Use a unique temp directory to avoid SQLite locking conflicts with parallel tests
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-db-test-'));
        vi.mocked(app.getPath).mockReturnValue(tmpDir);

        db = initDatabase();
    });

    afterAll(() => {
        if (db) db.close();
        // Clean up temp directory
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
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

    it('should have attachments table after migration 3', () => {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attachments'").get();
        expect(table).toBeDefined();
    });

    it('should have has_attachments column on emails', () => {
        const cols = db.prepare("SELECT name FROM pragma_table_info('emails')").all() as { name: string }[];
        const colNames = cols.map(c => c.name);
        expect(colNames).toContain('has_attachments');
    });

    it('should cascade delete attachments when email is deleted', () => {
        db.prepare('INSERT INTO accounts (id, email, provider) VALUES (?, ?, ?)').run('acc_att', 'att@test.com', 'gmail');
        db.prepare('INSERT INTO folders (id, account_id, name, path) VALUES (?, ?, ?, ?)').run('fld_att', 'acc_att', 'Inbox', '/INBOX');
        db.prepare('INSERT INTO emails (id, account_id, folder_id, subject) VALUES (?, ?, ?, ?)').run('email_att', 'acc_att', 'fld_att', 'Test');
        db.prepare('INSERT INTO attachments (id, email_id, filename, mime_type, size, part_number) VALUES (?, ?, ?, ?, ?, ?)').run('att_1', 'email_att', 'file.pdf', 'application/pdf', 1024, '2');

        db.prepare('DELETE FROM emails WHERE id = ?').run('email_att');

        const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get('att_1');
        expect(att).toBeUndefined();
    });

    it('should have signature_html column on accounts after migration 4', () => {
        const cols = db.prepare("SELECT name FROM pragma_table_info('accounts')").all() as { name: string }[];
        const colNames = cols.map(c => c.name);
        expect(colNames).toContain('signature_html');
    });

    it('should have content_id column on attachments after migration 5', () => {
        const cols = db.prepare("SELECT name FROM pragma_table_info('attachments')").all() as { name: string }[];
        const colNames = cols.map(c => c.name);
        expect(colNames).toContain('content_id');
    });

    it('should store and retrieve signature_html for an account', () => {
        db.prepare('INSERT INTO accounts (id, email, provider, signature_html) VALUES (?, ?, ?, ?)').run('acc_sig', 'sig@test.com', 'gmail', 'Best regards,<br />Test');
        const row = db.prepare('SELECT signature_html FROM accounts WHERE id = ?').get('acc_sig') as { signature_html: string };
        expect(row.signature_html).toBe('Best regards,<br />Test');
        db.prepare('DELETE FROM accounts WHERE id = ?').run('acc_sig');
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

    it('should have performance indexes after migration 10', () => {
        const indexes = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
        ).all() as { name: string }[];
        const indexNames = indexes.map(i => i.name);
        expect(indexNames).toContain('idx_emails_folder_snooze_date');
        expect(indexNames).toContain('idx_emails_thread_folder_date');
        expect(indexNames).toContain('idx_emails_account_read_folder');
        expect(indexNames).toContain('idx_folders_account_type');
        expect(indexNames).toContain('idx_folders_account_path');
        expect(indexNames).toContain('idx_rules_account_active');
    });
});

// Phase 2 OAuth2: migration 16 verification
// Uses an isolated temp directory per suite so the migration runs from a
// fresh DB (independent of the suite above, which uses a different tmpDir).
// The existing runMigrations() API does not take a target version — it always
// runs through CURRENT_SCHEMA_VERSION — so we verify the end-state after
// initDatabase() rather than stopping at version 16.
describe('Phase 2 migration 16: oauth_credentials + auth columns', () => {
    let db: ReturnType<typeof getDatabase>;
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-db-test-m16-'));
        vi.mocked(app.getPath).mockReturnValue(tmpDir);
        db = initDatabase();
    });

    afterAll(() => {
        if (db) db.close();
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('adds auth_type column to accounts with default password', () => {
        const cols = db.prepare("SELECT name, dflt_value FROM pragma_table_info('accounts')").all() as Array<{ name: string; dflt_value: string }>;
        const authType = cols.find(c => c.name === 'auth_type');
        expect(authType).toBeDefined();
        expect(authType?.dflt_value).toContain('password');
    });

    it('adds auth_state column to accounts with default ok', () => {
        const cols = db.prepare("SELECT name, dflt_value FROM pragma_table_info('accounts')").all() as Array<{ name: string; dflt_value: string }>;
        const authState = cols.find(c => c.name === 'auth_state');
        expect(authState).toBeDefined();
        expect(authState?.dflt_value).toContain('ok');
    });

    it('creates oauth_credentials table with correct schema', () => {
        const tableExists = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='oauth_credentials'"
        ).get();
        expect(tableExists).toBeDefined();

        const cols = db.prepare("SELECT name, type, `notnull`, pk FROM pragma_table_info('oauth_credentials')").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
        const colsByName = Object.fromEntries(cols.map(c => [c.name, c]));

        expect(colsByName.account_id).toMatchObject({ type: 'TEXT', pk: 1 });
        expect(colsByName.provider).toMatchObject({ type: 'TEXT', notnull: 1 });
        expect(colsByName.access_token_encrypted).toMatchObject({ type: 'TEXT', notnull: 1 });
        expect(colsByName.refresh_token_encrypted).toMatchObject({ type: 'TEXT', notnull: 1 });
        expect(colsByName.expires_at).toMatchObject({ type: 'INTEGER', notnull: 1 });
        expect(colsByName.scope).toBeDefined();
        expect(colsByName.token_type).toBeDefined();
        expect(colsByName.provider_account_email).toBeDefined();
        expect(colsByName.provider_account_id).toBeDefined();
        expect(colsByName.created_at).toMatchObject({ type: 'INTEGER', notnull: 1 });
        expect(colsByName.updated_at).toMatchObject({ type: 'INTEGER', notnull: 1 });
    });

    it('oauth_credentials has FK CASCADE delete on accounts.id', () => {
        // Insert account + credential, delete account, expect credential gone
        db.prepare("INSERT INTO accounts (id, email, provider) VALUES ('m16_acc', 'm16@example.com', 'gmail')").run();
        db.prepare(
            "INSERT INTO oauth_credentials (account_id, provider, access_token_encrypted, refresh_token_encrypted, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run('m16_acc', 'google', 'AT', 'RT', 9999999999, 0, 0);

        db.prepare("DELETE FROM accounts WHERE id = 'm16_acc'").run();
        const remaining = db.prepare("SELECT COUNT(*) as n FROM oauth_credentials WHERE account_id = 'm16_acc'").get() as { n: number };
        expect(remaining.n).toBe(0);
    });

    it('creates idx_oauth_credentials_provider index', () => {
        const indexes = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='oauth_credentials'"
        ).all() as Array<{ name: string }>;
        expect(indexes.some(i => i.name === 'idx_oauth_credentials_provider')).toBe(true);
    });
});
