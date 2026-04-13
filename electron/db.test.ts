import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
    initDatabase,
    getDatabase,
    runMigrations,
    insertOAuthCredential,
    getOAuthCredential,
    updateAccessToken,
    updateAccessAndRefreshToken,
    deleteOAuthCredential,
    setAuthState,
} from './db';
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

// Phase 2 OAuth2: migration 17 (legacy outlook recommended_reauth data migration)
// Uses :memory: DBs with a hand-rolled schema-16 skeleton (accounts + settings
// tables, schema_version row set to 16) so runMigrations() runs ONLY migration
// 17. This is cleaner than full initDatabase() because migration 17 is a
// data migration whose effect depends on which rows exist at the moment it
// runs — we must seed legacy outlook rows *before* the migration executes.
// runMigrations is exported (Phase 2) precisely to enable this test pattern.
function buildSchemaV16Fixture(): Database.Database {
    const d = new Database(':memory:');
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    // Minimum schema that migration 17 touches: accounts with auth_state column
    // and the settings table used by runMigrations for version bookkeeping.
    d.exec(`
        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            provider TEXT NOT NULL,
            password_encrypted TEXT,
            auth_type TEXT NOT NULL DEFAULT 'password',
            auth_state TEXT NOT NULL DEFAULT 'ok'
        );
        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT INTO settings (key, value) VALUES ('schema_version', '16');
    `);
    return d;
}

describe('Phase 2 migration 17: legacy outlook recommended_reauth', () => {
    it('marks all accounts with provider=outlook as recommended_reauth', () => {
        const d = buildSchemaV16Fixture();
        // Seed legacy outlook accounts
        d.prepare("INSERT INTO accounts (id, email, provider, password_encrypted) VALUES ('a1', 'p@hotmail.com', 'outlook', 'enc1')").run();
        d.prepare("INSERT INTO accounts (id, email, provider, password_encrypted) VALUES ('a2', 'b@company.com', 'outlook', 'enc2')").run();
        // Seed a non-outlook account that should NOT be touched
        d.prepare("INSERT INTO accounts (id, email, provider, password_encrypted) VALUES ('a3', 'g@gmail.com', 'gmail', 'enc3')").run();

        runMigrations(d);

        const a1 = d.prepare("SELECT auth_state FROM accounts WHERE id = 'a1'").get() as { auth_state: string };
        const a2 = d.prepare("SELECT auth_state FROM accounts WHERE id = 'a2'").get() as { auth_state: string };
        const a3 = d.prepare("SELECT auth_state FROM accounts WHERE id = 'a3'").get() as { auth_state: string };
        expect(a1.auth_state).toBe('recommended_reauth');
        expect(a2.auth_state).toBe('recommended_reauth');
        expect(a3.auth_state).toBe('ok');
        d.close();
    });

    it('does NOT touch password_encrypted on legacy outlook accounts', () => {
        const d = buildSchemaV16Fixture();
        d.prepare("INSERT INTO accounts (id, email, provider, password_encrypted) VALUES ('a1', 'p@hotmail.com', 'outlook', 'original_pwd')").run();

        runMigrations(d);

        const a1 = d.prepare("SELECT password_encrypted FROM accounts WHERE id = 'a1'").get() as { password_encrypted: string };
        expect(a1.password_encrypted).toBe('original_pwd');
        d.close();
    });

    it('does NOT change auth_type on legacy outlook accounts', () => {
        const d = buildSchemaV16Fixture();
        d.prepare("INSERT INTO accounts (id, email, provider, password_encrypted) VALUES ('a1', 'p@hotmail.com', 'outlook', 'enc')").run();

        runMigrations(d);

        const a1 = d.prepare("SELECT auth_type FROM accounts WHERE id = 'a1'").get() as { auth_type: string };
        expect(a1.auth_type).toBe('password');
        d.close();
    });

    it('is idempotent — running twice does not re-flip rows that have since been changed', () => {
        const d = buildSchemaV16Fixture();
        d.prepare("INSERT INTO accounts (id, email, provider, password_encrypted) VALUES ('a1', 'p@hotmail.com', 'outlook', 'enc')").run();

        // First run: applies migration 17, flipping a1 to recommended_reauth.
        runMigrations(d);
        expect((d.prepare("SELECT auth_state FROM accounts WHERE id = 'a1'").get() as { auth_state: string }).auth_state).toBe('recommended_reauth');

        // Simulate downstream state change: user clicked "re-auth" later and app set a1 back to ok.
        d.prepare("UPDATE accounts SET auth_state = 'ok' WHERE id = 'a1'").run();

        // Second run: short-circuits at version >= CURRENT_SCHEMA_VERSION guard,
        // so migration 17 must NOT re-flip the row.
        runMigrations(d);
        const after = d.prepare("SELECT auth_state FROM accounts WHERE id = 'a1'").get() as { auth_state: string };
        expect(after.auth_state).toBe('ok');
        d.close();
    });
});

// Phase 2 OAuth2: DB access helpers (insertOAuthCredential, getOAuthCredential,
// updateAccessToken, updateAccessAndRefreshToken, deleteOAuthCredential,
// setAuthState). Uses a hand-rolled schema-v17 fixture so helpers can be
// exercised without the app.getPath mocking and tmpDir dance.
function buildSchemaV17Fixture(): Database.Database {
    const d = new Database(':memory:');
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    // Full post-migration-17 schema for the tables these helpers touch.
    d.exec(`
        CREATE TABLE accounts (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            provider TEXT NOT NULL,
            password_encrypted TEXT,
            auth_type TEXT NOT NULL DEFAULT 'password',
            auth_state TEXT NOT NULL DEFAULT 'ok'
        );
        CREATE TABLE oauth_credentials (
            account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            access_token_encrypted TEXT NOT NULL,
            refresh_token_encrypted TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            scope TEXT,
            token_type TEXT,
            provider_account_email TEXT,
            provider_account_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_oauth_credentials_provider ON oauth_credentials(provider);
        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT INTO settings (key, value) VALUES ('schema_version', '17');
    `);
    return d;
}

describe('OAuth credentials DB helpers', () => {
    function setup(): Database.Database {
        const d = buildSchemaV17Fixture();
        d.prepare("INSERT INTO accounts (id, email, provider) VALUES ('acc1', 'test@gmail.com', 'gmail')").run();
        return d;
    }

    it('insertOAuthCredential persists a row and sets created_at/updated_at', () => {
        const d = setup();
        insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'google',
            accessTokenEncrypted: 'AT_enc',
            refreshTokenEncrypted: 'RT_enc',
            expiresAt: 1234567890000,
            scope: 'https://mail.google.com/',
            tokenType: 'Bearer',
            providerAccountEmail: 'test@gmail.com',
            providerAccountId: '12345',
        });
        const row = d.prepare("SELECT * FROM oauth_credentials WHERE account_id = 'acc1'").get() as Record<string, unknown>;
        expect(row.provider).toBe('google');
        expect(row.access_token_encrypted).toBe('AT_enc');
        expect(row.refresh_token_encrypted).toBe('RT_enc');
        expect(row.expires_at).toBe(1234567890000);
        expect(row.created_at).toBeGreaterThan(0);
        expect(row.updated_at).toBeGreaterThan(0);
        d.close();
    });

    it('insertOAuthCredential upserts on conflict (re-auth case)', () => {
        const d = setup();
        insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'google',
            accessTokenEncrypted: 'AT_v1',
            refreshTokenEncrypted: 'RT_v1',
            expiresAt: 1000,
            scope: 'foo',
            tokenType: 'Bearer',
            providerAccountEmail: 'a@b.c',
            providerAccountId: '1',
        });
        // Re-insert with new values — should upsert, not throw PK constraint
        insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'google',
            accessTokenEncrypted: 'AT_v2',
            refreshTokenEncrypted: 'RT_v2',
            expiresAt: 2000,
            scope: 'bar',
            tokenType: 'Bearer',
            providerAccountEmail: 'a@b.c',
            providerAccountId: '1',
        });
        const row = d.prepare("SELECT * FROM oauth_credentials WHERE account_id = 'acc1'").get() as Record<string, unknown>;
        expect(row.access_token_encrypted).toBe('AT_v2');
        expect(row.refresh_token_encrypted).toBe('RT_v2');
        expect(row.expires_at).toBe(2000);
        expect(row.scope).toBe('bar');
        d.close();
    });

    it('insertOAuthCredential rejects invalid provider values', () => {
        const d = setup();
        expect(() => insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'bogus' as never,
            accessTokenEncrypted: 'AT',
            refreshTokenEncrypted: 'RT',
            expiresAt: 1000,
        })).toThrow(/Invalid OAuth provider/);
        d.close();
    });

    it('getOAuthCredential returns null for non-existent account', () => {
        const d = setup();
        const cred = getOAuthCredential(d, 'nonexistent');
        expect(cred).toBeNull();
        d.close();
    });

    it('getOAuthCredential returns the typed row for an existing account', () => {
        const d = setup();
        insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'microsoft_personal',
            accessTokenEncrypted: 'AT',
            refreshTokenEncrypted: 'RT',
            expiresAt: 9999999999000,
            scope: 'Mail.Send',
            tokenType: 'Bearer',
            providerAccountEmail: 'test@hotmail.com',
            providerAccountId: 'msuser',
        });
        const cred = getOAuthCredential(d, 'acc1');
        expect(cred).not.toBeNull();
        expect(cred?.provider).toBe('microsoft_personal');
        expect(cred?.providerAccountEmail).toBe('test@hotmail.com');
        expect(cred?.providerAccountId).toBe('msuser');
        expect(cred?.accessTokenEncrypted).toBe('AT');
        expect(cred?.refreshTokenEncrypted).toBe('RT');
        expect(cred?.expiresAt).toBe(9999999999000);
        d.close();
    });

    it('updateAccessToken updates only access_token + expires_at + updated_at, leaves refresh_token alone', () => {
        const d = setup();
        insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'google',
            accessTokenEncrypted: 'AT_v1',
            refreshTokenEncrypted: 'RT_v1',
            expiresAt: 1000,
            scope: 'foo',
            tokenType: 'Bearer',
            providerAccountEmail: 'a@b.c',
            providerAccountId: '1',
        });

        updateAccessToken(d, 'acc1', { accessTokenEncrypted: 'AT_v2', expiresAt: 2000 });

        const row = d.prepare("SELECT * FROM oauth_credentials WHERE account_id = 'acc1'").get() as Record<string, unknown>;
        expect(row.access_token_encrypted).toBe('AT_v2');
        expect(row.expires_at).toBe(2000);
        expect(row.refresh_token_encrypted).toBe('RT_v1'); // unchanged
        d.close();
    });

    it('updateAccessAndRefreshToken updates both tokens (Google rotation case D5.4)', () => {
        const d = setup();
        insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'google',
            accessTokenEncrypted: 'AT_v1',
            refreshTokenEncrypted: 'RT_v1',
            expiresAt: 1000,
            scope: 'foo',
            tokenType: 'Bearer',
            providerAccountEmail: 'a@b.c',
            providerAccountId: '1',
        });

        updateAccessAndRefreshToken(d, 'acc1', {
            accessTokenEncrypted: 'AT_v2',
            refreshTokenEncrypted: 'RT_v2',
            expiresAt: 2000,
        });

        const row = d.prepare("SELECT * FROM oauth_credentials WHERE account_id = 'acc1'").get() as Record<string, unknown>;
        expect(row.access_token_encrypted).toBe('AT_v2');
        expect(row.refresh_token_encrypted).toBe('RT_v2');
        expect(row.expires_at).toBe(2000);
        d.close();
    });

    it('deleteOAuthCredential removes the row', () => {
        const d = setup();
        insertOAuthCredential(d, {
            accountId: 'acc1',
            provider: 'google',
            accessTokenEncrypted: 'AT',
            refreshTokenEncrypted: 'RT',
            expiresAt: 1000,
            scope: '',
            tokenType: 'Bearer',
            providerAccountEmail: '',
            providerAccountId: '',
        });
        deleteOAuthCredential(d, 'acc1');
        expect(getOAuthCredential(d, 'acc1')).toBeNull();
        d.close();
    });

    it('setAuthState validates the value and updates accounts.auth_state', () => {
        const d = setup();
        setAuthState(d, 'acc1', 'reauth_required');
        const row = d.prepare("SELECT auth_state FROM accounts WHERE id = 'acc1'").get() as { auth_state: string };
        expect(row.auth_state).toBe('reauth_required');
        d.close();
    });

    it('setAuthState throws on invalid value', () => {
        const d = setup();
        expect(() => setAuthState(d, 'acc1', 'bogus' as never)).toThrow(/auth_state/);
        d.close();
    });
});
