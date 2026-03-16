import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';

export interface SeedOptions {
  dbPath: string;
  accountCount?: number;
  emailsPerFolder?: number;
}

export function seedTestDatabase(options: SeedOptions) {
  const { dbPath, accountCount = 1, emailsPerFolder = 10 } = options;
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create minimal schema (mirrors electron/db.ts migration 0-13)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT OR REPLACE INTO settings VALUES ('schema_version', '13');

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT, provider TEXT, password_encrypted TEXT,
      imap_host TEXT, imap_port INTEGER, smtp_host TEXT, smtp_port INTEGER,
      display_name TEXT, signature_html TEXT
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY, account_id TEXT, name TEXT, path TEXT, type TEXT,
      color TEXT, sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY, account_id TEXT, folder_id TEXT, thread_id TEXT,
      message_id TEXT, subject TEXT, from_name TEXT, from_email TEXT,
      to_email TEXT, date TEXT, snippet TEXT, body_text TEXT, body_html TEXT,
      is_read INTEGER DEFAULT 0, is_flagged INTEGER DEFAULT 0,
      has_attachments INTEGER DEFAULT 0, ai_category TEXT, ai_priority INTEGER,
      ai_labels TEXT, is_snoozed INTEGER DEFAULT 0, list_unsubscribe TEXT,
      spam_score REAL, schema_version INTEGER DEFAULT 13,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, account_id TEXT, to_email TEXT, cc TEXT, bcc TEXT,
      subject TEXT, body_html TEXT, attachments_json TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT,
      company TEXT, phone TEXT, title TEXT, notes TEXT
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, email_id TEXT, filename TEXT, mime_type TEXT,
      size INTEGER, data BLOB, content_id TEXT,
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
    );
  `);

  const accounts: string[] = [];

  for (let a = 0; a < accountCount; a++) {
    const accountId = randomUUID();
    accounts.push(accountId);
    const email = `test${a + 1}@example.com`;

    db.prepare(
      'INSERT INTO accounts (id, email, provider, password_encrypted, imap_host, imap_port, smtp_host, smtp_port, display_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(accountId, email, 'custom', 'encrypted-test', 'localhost', 993, 'localhost', 587, `Test User ${a + 1}`);

    // Create standard folders
    const folderTypes = [
      { name: 'INBOX', path: '/INBOX', type: 'inbox' },
      { name: 'Sent', path: '/Sent', type: 'sent' },
      { name: 'Drafts', path: '/Drafts', type: 'drafts' },
      { name: 'Trash', path: '/Trash', type: 'trash' },
      { name: 'Archive', path: '/Archive', type: 'archive' },
    ];

    for (const [idx, f] of folderTypes.entries()) {
      const folderId = `${accountId}_${f.path.slice(1)}`;
      db.prepare(
        'INSERT INTO folders (id, account_id, name, path, type, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(folderId, accountId, f.name, f.path, f.type, idx);

      // Seed emails in INBOX and Sent
      if (f.type === 'inbox' || f.type === 'sent') {
        for (let e = 0; e < emailsPerFolder; e++) {
          const emailId = randomUUID();
          const date = new Date(Date.now() - e * 3600000).toISOString();
          db.prepare(`
            INSERT INTO emails (id, account_id, folder_id, thread_id, message_id, subject, from_name, from_email, to_email, date, snippet, body_text, body_html, is_read, schema_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 13)
          `).run(
            emailId, accountId, folderId, `thread-${e}@example.com`, `msg-${e}@example.com`,
            `Test Email ${e + 1} in ${f.name}`, `Sender ${e}`, `sender${e}@example.com`,
            email, date, `Preview of email ${e + 1}...`,
            `This is the body of test email ${e + 1}`,
            `<p>This is the <b>HTML body</b> of test email ${e + 1}</p>`,
            e < 3 ? 1 : 0  // first 3 are read
          );
        }
      }
    }
  }

  // Seed contacts
  for (let c = 0; c < 5; c++) {
    db.prepare('INSERT INTO contacts (id, email, name) VALUES (?, ?, ?)').run(
      randomUUID(), `contact${c}@example.com`, `Contact ${c}`
    );
  }

  db.close();
  return { accounts };
}

// Re-export path for consumer convenience
export { path };
