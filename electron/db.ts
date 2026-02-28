import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: DatabaseType | null = null;

export function initDatabase(): DatabaseType {
    const dbPath = path.join(app.getPath('userData'), 'expressdelivery.sqlite');
    db = new Database(dbPath);

    // Initialize PRAGMAs
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables if they don't exist
    setupSchema(db);

    return db;
}

export function getDatabase(): DatabaseType {
    if (!db) {
        throw new Error('Database not initialized');
    }
    return db;
}

export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

function setupSchema(db: DatabaseType) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      password_encrypted TEXT,
      display_name TEXT,
      imap_host TEXT,
      imap_port INTEGER DEFAULT 993,
      smtp_host TEXT,
      smtp_port INTEGER DEFAULT 465,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      type TEXT, -- inbox, sent, trash, etc.
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      thread_id TEXT,
      subject TEXT,
      from_name TEXT,
      from_email TEXT,
      to_email TEXT,
      date DATETIME,
      snippet TEXT,
      body_text TEXT,
      body_html TEXT,
      is_read BOOLEAN DEFAULT 0,
      is_flagged BOOLEAN DEFAULT 0,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    -- FTS table for emails
    CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
      subject, from_name, from_email, snippet, body_text,
      content='emails', content_rowid='rowid'
    );

    -- Triggers for FTS
    CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
      INSERT INTO emails_fts(rowid, subject, from_name, from_email, snippet, body_text)
      VALUES (new.rowid, new.subject, new.from_name, new.from_email, new.snippet, new.body_text);
    END;

    CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
      INSERT INTO emails_fts(emails_fts, rowid, subject, from_name, from_email, snippet, body_text)
      VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_email, old.snippet, old.body_text);
    END;

    CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
      INSERT INTO emails_fts(emails_fts, rowid, subject, from_name, from_email, snippet, body_text)
      VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_email, old.snippet, old.body_text);
      INSERT INTO emails_fts(rowid, subject, from_name, from_email, snippet, body_text)
      VALUES (new.rowid, new.subject, new.from_name, new.from_email, new.snippet, new.body_text);
    END;

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT,
      body_html TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);

    runMigrations(db);
}

const CURRENT_SCHEMA_VERSION = 11;

function runMigrations(db: DatabaseType) {
    db.transaction(() => {
        const versionRow = db.prepare(
            "SELECT value FROM settings WHERE key = 'schema_version'"
        ).get() as { value: string } | undefined;

        let version = versionRow ? parseInt(versionRow.value, 10) : 0;

        // Skip all migrations if schema is already up-to-date
        if (version >= CURRENT_SCHEMA_VERSION) return;

        // Migration 1: Add IMAP/SMTP columns to accounts (for pre-existing DBs)
        if (version < 1) {
            const columns = db.prepare(
                "SELECT name FROM pragma_table_info('accounts')"
            ).all() as { name: string }[];
            const colNames = new Set(columns.map(c => c.name));

            if (!colNames.has('imap_host')) {
                db.exec("ALTER TABLE accounts ADD COLUMN imap_host TEXT");
                db.exec("ALTER TABLE accounts ADD COLUMN imap_port INTEGER DEFAULT 993");
                db.exec("ALTER TABLE accounts ADD COLUMN smtp_host TEXT");
                db.exec("ALTER TABLE accounts ADD COLUMN smtp_port INTEGER DEFAULT 465");
                db.exec("ALTER TABLE accounts ADD COLUMN display_name TEXT");
            }
            version = 1;
        }

        // Migration 2: Add cc/bcc columns to drafts
        if (version < 2) {
            const draftCols = db.prepare("SELECT name FROM pragma_table_info('drafts')").all() as { name: string }[];
            const draftColNames = new Set(draftCols.map(c => c.name));
            if (!draftColNames.has('cc')) {
                db.exec("ALTER TABLE drafts ADD COLUMN cc TEXT");
            }
            if (!draftColNames.has('bcc')) {
                db.exec("ALTER TABLE drafts ADD COLUMN bcc TEXT");
            }
            version = 2;
        }

        // Migration 3: Attachment support
        if (version < 3) {
            const emailCols = db.prepare("SELECT name FROM pragma_table_info('emails')").all() as { name: string }[];
            const emailColNames = new Set(emailCols.map(c => c.name));
            if (!emailColNames.has('has_attachments')) {
                db.exec("ALTER TABLE emails ADD COLUMN has_attachments INTEGER DEFAULT 0");
            }
            db.exec(`
                CREATE TABLE IF NOT EXISTS attachments (
                    id TEXT PRIMARY KEY,
                    email_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size INTEGER NOT NULL DEFAULT 0,
                    part_number TEXT,
                    content BLOB,
                    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
                )
            `);
            db.exec("CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id)");
            version = 3;
        }

        // Migration 4: Add signature_html column to accounts
        if (version < 4) {
            const accCols = db.prepare("SELECT name FROM pragma_table_info('accounts')").all() as { name: string }[];
            const accColNames = new Set(accCols.map(c => c.name));
            if (!accColNames.has('signature_html')) {
                db.exec("ALTER TABLE accounts ADD COLUMN signature_html TEXT");
            }
            version = 4;
        }

        // Migration 5: Add content_id column to attachments
        if (version < 5) {
            const attCols = db.prepare("SELECT name FROM pragma_table_info('attachments')").all() as { name: string }[];
            const attColNames = new Set(attCols.map(c => c.name));
            if (!attColNames.has('content_id')) {
                db.exec("ALTER TABLE attachments ADD COLUMN content_id TEXT");
            }
            version = 5;
        }

        // Migration 6: Add AI metadata columns to emails
        if (version < 6) {
            const emailCols = db.prepare("SELECT name FROM pragma_table_info('emails')").all() as { name: string }[];
            const emailColNames = new Set(emailCols.map(c => c.name));
            if (!emailColNames.has('ai_category')) {
                db.exec("ALTER TABLE emails ADD COLUMN ai_category TEXT");
            }
            if (!emailColNames.has('ai_priority')) {
                db.exec("ALTER TABLE emails ADD COLUMN ai_priority INTEGER");
            }
            if (!emailColNames.has('ai_labels')) {
                db.exec("ALTER TABLE emails ADD COLUMN ai_labels TEXT");
            }
            version = 6;
        }

        // Migration 7: Snooze support + scheduled sends + reminders + mail rules
        if (version < 7) {
            // is_snoozed column on emails
            const emailCols7 = db.prepare("SELECT name FROM pragma_table_info('emails')").all() as { name: string }[];
            const emailColNames7 = new Set(emailCols7.map(c => c.name));
            if (!emailColNames7.has('is_snoozed')) {
                db.exec("ALTER TABLE emails ADD COLUMN is_snoozed INTEGER DEFAULT 0");
            }

            // Snoozed emails table
            db.exec(`
                CREATE TABLE IF NOT EXISTS snoozed_emails (
                    id TEXT PRIMARY KEY,
                    email_id TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    original_folder_id TEXT NOT NULL,
                    snooze_until DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    restored INTEGER DEFAULT 0,
                    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);
            db.exec("CREATE INDEX IF NOT EXISTS idx_snoozed_due ON snoozed_emails(snooze_until) WHERE restored = 0");

            // Scheduled sends table
            db.exec(`
                CREATE TABLE IF NOT EXISTS scheduled_sends (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    draft_id TEXT,
                    to_email TEXT NOT NULL,
                    cc TEXT,
                    bcc TEXT,
                    subject TEXT NOT NULL,
                    body_html TEXT NOT NULL,
                    attachments_json TEXT,
                    send_at DATETIME NOT NULL,
                    status TEXT DEFAULT 'pending',
                    retry_count INTEGER DEFAULT 0,
                    error_message TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);
            db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_sends(send_at) WHERE status = 'pending'");

            // Reminders table
            db.exec(`
                CREATE TABLE IF NOT EXISTS reminders (
                    id TEXT PRIMARY KEY,
                    email_id TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    remind_at DATETIME NOT NULL,
                    note TEXT,
                    is_triggered INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);
            db.exec("CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(remind_at) WHERE is_triggered = 0");

            // Mail rules table
            db.exec(`
                CREATE TABLE IF NOT EXISTS mail_rules (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    priority INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    match_field TEXT NOT NULL,
                    match_operator TEXT NOT NULL,
                    match_value TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    action_value TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

            version = 7;
        }

        // Migration 8: Reply templates
        if (version < 8) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS reply_templates (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    body_html TEXT NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            version = 8;
        }

        // Migration 9: Email threading — message_id column + thread indexes
        if (version < 9) {
            const emailCols9 = db.prepare("SELECT name FROM pragma_table_info('emails')").all() as { name: string }[];
            const emailColNames9 = new Set(emailCols9.map(c => c.name));
            if (!emailColNames9.has('message_id')) {
                db.exec(`ALTER TABLE emails ADD COLUMN message_id TEXT`);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id)`);
            // Backfill: set message_id = thread_id for existing emails
            db.exec(`UPDATE emails SET message_id = thread_id WHERE message_id IS NULL`);
            version = 9;
        }

        // Migration 10: Performance indexes for hot query paths
        if (version < 10) {
            db.exec('CREATE INDEX IF NOT EXISTS idx_emails_folder_snooze_date ON emails(folder_id, is_snoozed, date DESC)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_emails_thread_folder_date ON emails(thread_id, folder_id, date DESC)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_emails_account_read_folder ON emails(account_id, is_read, folder_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_folders_account_type ON folders(account_id, type)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_folders_account_path ON folders(account_id, path)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_rules_account_active ON mail_rules(account_id, is_active, priority)');
            version = 10;
        }

        // Migration 11: Phase 7 — tags, saved searches, spam filter, folder colors, unsubscribe
        if (version < 11) {
            // User-defined tags
            db.exec(`
                CREATE TABLE IF NOT EXISTS tags (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT '#6366f1',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                    UNIQUE(account_id, name)
                )
            `);

            // Email-to-tag junction table
            db.exec(`
                CREATE TABLE IF NOT EXISTS email_tags (
                    email_id TEXT NOT NULL,
                    tag_id TEXT NOT NULL,
                    PRIMARY KEY(email_id, tag_id),
                    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
                    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
                )
            `);

            // Saved searches / smart folders
            db.exec(`
                CREATE TABLE IF NOT EXISTS saved_searches (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    query TEXT NOT NULL,
                    icon TEXT DEFAULT 'search',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

            // Spam token table (Bayesian classifier)
            db.exec(`
                CREATE TABLE IF NOT EXISTS spam_tokens (
                    token TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    spam_count INTEGER DEFAULT 0,
                    ham_count INTEGER DEFAULT 0,
                    PRIMARY KEY(token, account_id),
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

            // Spam stats per account
            db.exec(`
                CREATE TABLE IF NOT EXISTS spam_stats (
                    account_id TEXT PRIMARY KEY,
                    total_spam INTEGER DEFAULT 0,
                    total_ham INTEGER DEFAULT 0,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            `);

            // New columns on existing tables
            const folderCols11 = db.prepare("SELECT name FROM pragma_table_info('folders')").all() as { name: string }[];
            const folderColNames11 = new Set(folderCols11.map(c => c.name));
            if (!folderColNames11.has('color')) {
                db.exec("ALTER TABLE folders ADD COLUMN color TEXT");
            }

            const emailCols11 = db.prepare("SELECT name FROM pragma_table_info('emails')").all() as { name: string }[];
            const emailColNames11 = new Set(emailCols11.map(c => c.name));
            if (!emailColNames11.has('list_unsubscribe')) {
                db.exec("ALTER TABLE emails ADD COLUMN list_unsubscribe TEXT");
            }
            if (!emailColNames11.has('spam_score')) {
                db.exec("ALTER TABLE emails ADD COLUMN spam_score REAL");
            }

            // Indexes
            db.exec('CREATE INDEX IF NOT EXISTS idx_email_tags_email ON email_tags(email_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_email_tags_tag ON email_tags(tag_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_tags_account ON tags(account_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_saved_searches_account ON saved_searches(account_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_emails_spam_score ON emails(account_id, spam_score)');

            version = 11;
        }

        db.prepare(
            "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(String(version));
    })();
}
