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

function setupSchema(db: DatabaseType) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      password_encrypted TEXT,
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
  `);
}
