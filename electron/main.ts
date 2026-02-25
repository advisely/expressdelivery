import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, screen, Notification } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

// --- INITIALIZE LOGGER ---
import { logDebug } from './logger.js';

logDebug('--- NEW APP STARTUP ---');
logDebug(`Platform: ${process.platform}, Arch: ${process.arch}, App Path: ${app.getAppPath()}`);

// Simple robust exception wrapper for silent startup crashes
process.on('uncaughtException', (err) => {
  logDebug(`[UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}`);
  const userDataLog = path.join(app.getPath('userData'), 'crash.log')
  try {
    fs.appendFileSync(userDataLog, `[UNCAUGHT] ${new Date().toISOString()} - ${err.message}\n${err.stack}\n`)
  } catch {
    // Failsafe
  }
  process.exit(1)
})

import { initDatabase, getDatabase, closeDatabase } from './db.js'
import { mcpServer } from './mcpServer.js'
import { imapEngine } from './imap.js'
import { smtpEngine } from './smtp.js'
import { encryptData, decryptData } from './crypto.js'
import { sanitizeFts5Query } from './utils.js'
import { schedulerEngine } from './scheduler.js'
import { initAutoUpdater, setUpdateCallback, checkForUpdates, downloadUpdate, installUpdate } from './updater.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let tray: Tray | null = null

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'application/octet-stream',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.json': 'application/json',
    '.xml': 'application/xml',
  };
  return mimeMap[ext] ?? 'application/octet-stream';
}

function showNotification(title: string, body: string, emailId?: string) {
  const db = getDatabase();
  const enabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('notifications_enabled') as { value: string } | undefined;
  if (enabled?.value === 'false') return;

  const notification = new Notification({ title, body, icon: path.join(process.env.VITE_PUBLIC, 'icon.png') });
  notification.on('click', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      if (emailId) {
        win.webContents.send('notification:click', { emailId });
      }
    }
  });
  notification.show();
}

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1400, screenW),
    height: Math.min(900, screenH),
    minWidth: 900,
    minHeight: 600,
    center: true,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !!VITE_DEV_SERVER_URL,
    },
  })

  // Use the app icon for the system tray; fall back to a transparent 1x1 buffer
  // if the file isn't present (e.g. during first-run before public/ is populated).
  let trayIcon: Electron.NativeImage;
  const trayIconPath = path.join(process.env.VITE_PUBLIC, 'icon.png');
  if (fs.existsSync(trayIconPath)) {
    trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
  } else {
    const fallback = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    trayIcon = nativeImage.createFromBuffer(fallback);
  }
  tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open ExpressDelivery', click: () => win?.show() },
    { type: 'separator' },
    {
      label: 'Quit', click: () => {
        app.quit()
      }
    }
  ])
  tray.setToolTip('ExpressDelivery MCP Server Running')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (win?.isVisible()) { win.hide() } else { win?.show() }
  })

  // Log renderer errors to debug log
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logDebug(`[RENDERER LOAD FAIL] code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logDebug(`[RENDERER GONE] reason=${details.reason} exitCode=${details.exitCode}`);
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  logDebug('before-quit: cleaning up...');
  schedulerEngine.stop();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  mcpServer.stop();
  try { await imapEngine.disconnectAll(); } catch { /* best effort */ }
  try { closeDatabase(); } catch { /* best effort */ }
  logDebug('before-quit: cleanup complete.');
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function registerIpcHandlers() {
  const db = getDatabase();

  ipcMain.handle('accounts:list', () => {
    return db.prepare(
      'SELECT id, email, provider, display_name, imap_host, imap_port, smtp_host, smtp_port, signature_html, created_at FROM accounts'
    ).all();
  });

  ipcMain.handle('accounts:test', async (_event, params: {
    email: string; password: string; imap_host: string; imap_port: number;
  }) => {
    return imapEngine.testConnection(params);
  });

  ipcMain.handle('accounts:add', async (_event, account: {
    email: string; provider: string; password: string;
    display_name?: string; imap_host?: string; imap_port?: number;
    smtp_host?: string; smtp_port?: number; signature_html?: string;
  }) => {
    const id = crypto.randomUUID();
    const encrypted = encryptData(account.password).toString('base64');
    db.prepare(
      `INSERT INTO accounts (id, email, provider, password_encrypted, display_name, imap_host, imap_port, smtp_host, smtp_port, signature_html)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, account.email, account.provider, encrypted,
      account.display_name ?? null, account.imap_host ?? null,
      account.imap_port ?? 993, account.smtp_host ?? null, account.smtp_port ?? 465,
      account.signature_html ? account.signature_html.slice(0, 10_000) : null);

    // Post-add: connect IMAP, sync folders, sync INBOX
    try {
      const connected = await imapEngine.connectAccount(id);
      if (connected) {
        const folders = await imapEngine.listAndSyncFolders(id);
        const inbox = folders.find(f => f.type === 'inbox');
        if (inbox) {
          await imapEngine.syncNewEmails(id, inbox.path.replace(/^\//, ''));
        }
      }
    } catch (err) {
      logDebug(`Post-add IMAP sync error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { id };
  });

  ipcMain.handle('accounts:update', async (_event, account: {
    id: string; email?: string; provider?: string; password?: string;
    display_name?: string; imap_host?: string; imap_port?: number;
    smtp_host?: string; smtp_port?: number; signature_html?: string;
  }) => {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (account.email !== undefined) { fields.push('email = ?'); values.push(account.email); }
    if (account.provider !== undefined) { fields.push('provider = ?'); values.push(account.provider); }
    if (account.display_name !== undefined) { fields.push('display_name = ?'); values.push(account.display_name); }
    if (account.imap_host !== undefined) { fields.push('imap_host = ?'); values.push(account.imap_host); }
    if (account.imap_port !== undefined) { fields.push('imap_port = ?'); values.push(account.imap_port); }
    if (account.smtp_host !== undefined) { fields.push('smtp_host = ?'); values.push(account.smtp_host); }
    if (account.smtp_port !== undefined) { fields.push('smtp_port = ?'); values.push(account.smtp_port); }
    if (account.signature_html !== undefined) { fields.push('signature_html = ?'); values.push(account.signature_html ? account.signature_html.slice(0, 10_000) : null); }
    if (account.password) {
      const encrypted = encryptData(account.password).toString('base64');
      fields.push('password_encrypted = ?');
      values.push(encrypted);
    }

    if (fields.length > 0) {
      values.push(account.id);
      db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Reconnect IMAP if server settings changed
    if (account.imap_host !== undefined || account.imap_port !== undefined || account.password || account.email !== undefined) {
      try {
        await imapEngine.disconnectAccount(account.id);
        await imapEngine.connectAccount(account.id);
      } catch { /* best effort reconnect */ }
    }

    return { success: true };
  });

  ipcMain.handle('accounts:remove', async (_event, accountId: string) => {
    try {
      await imapEngine.disconnectAccount(accountId);
    } catch (err) {
      logDebug(`IMAP disconnect error during account removal: ${err instanceof Error ? err.message : String(err)}`);
    }
    db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    return { success: true };
  });

  ipcMain.handle('folders:list', (_event, accountId: string) => {
    return db.prepare(
      'SELECT id, name, path, type FROM folders WHERE account_id = ?'
    ).all(accountId);
  });

  ipcMain.handle('emails:list', (_event, folderId: string) => {
    // Virtual folder: snoozed emails
    if (folderId === '__snoozed') {
      return db.prepare(
        `SELECT e.id, e.thread_id, e.subject, e.from_name, e.from_email, e.to_email,
                e.date, e.snippet, e.is_read, e.is_flagged, e.has_attachments,
                e.ai_category, e.ai_priority, e.ai_labels
         FROM emails e
         INNER JOIN snoozed_emails s ON s.email_id = e.id AND s.restored = 0
         WHERE e.is_snoozed = 1
         ORDER BY s.snooze_until ASC LIMIT 50`
      ).all();
    }
    // Virtual folder: scheduled sends (return as email-like summaries)
    if (folderId === '__scheduled') {
      return db.prepare(
        `SELECT id, '' AS thread_id, subject, '' AS from_name, to_email AS from_email, to_email,
                send_at AS date, subject AS snippet, 0 AS is_read, 0 AS is_flagged, 0 AS has_attachments,
                NULL AS ai_category, NULL AS ai_priority, NULL AS ai_labels
         FROM scheduled_sends
         WHERE status = 'pending'
         ORDER BY send_at ASC LIMIT 50`
      ).all();
    }
    return db.prepare(
      `SELECT id, thread_id, subject, from_name, from_email, to_email,
              date, snippet, is_read, is_flagged, has_attachments,
              ai_category, ai_priority, ai_labels
       FROM emails WHERE folder_id = ? AND (is_snoozed = 0 OR is_snoozed IS NULL) ORDER BY date DESC LIMIT 50`
    ).all(folderId);
  });

  ipcMain.handle('emails:read', (_event, emailId: string) => {
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(emailId);
    return db.prepare(
      `SELECT id, account_id, folder_id, thread_id, subject,
              from_name, from_email, to_email, date, snippet,
              body_text, body_html, is_read, is_flagged, has_attachments,
              ai_category, ai_priority, ai_labels
       FROM emails WHERE id = ?`
    ).get(emailId);
  });

  ipcMain.handle('emails:search', (_event, query: string) => {
    const sanitized = sanitizeFts5Query(query);
    if (!sanitized) return [];
    try {
      return db.prepare(
        `SELECT e.id, e.subject, e.from_name, e.from_email, e.snippet, e.date,
                e.is_read, e.is_flagged, e.has_attachments,
                e.ai_category, e.ai_priority, e.ai_labels
         FROM emails_fts f
         JOIN emails e ON f.rowid = e.rowid
         WHERE emails_fts MATCH ?
         ORDER BY rank LIMIT 20`
      ).all(sanitized);
    } catch {
      return [];
    }
  });

  ipcMain.handle('email:send', async (_event, params: {
    accountId: string; to: string | string[]; subject: string; html: string;
    cc?: string | string[]; bcc?: string | string[];
    attachments?: Array<{ filename: string; content: string; contentType: string }>;
  }) => {
    const stripCRLF = (s: string) => s.replace(/[\r\n\0]/g, '');
    const sanitizeList = (list: string | string[] | undefined) => {
      if (!list) return undefined;
      const arr = (Array.isArray(list) ? list : [list])
        .map(addr => stripCRLF(addr.trim()))
        .filter(addr => addr.length > 0);
      return arr.length > 0 ? arr : undefined;
    };
    const sanitizedTo = sanitizeList(params.to);
    if (!sanitizedTo || sanitizedTo.length === 0) throw new Error('No valid recipients');

    // Validate attachments
    if (params.attachments && params.attachments.length > 10) {
      throw new Error('Maximum 10 attachments allowed');
    }
    const attachments = params.attachments?.map(att => {
      if (!att.filename || !att.content || !att.contentType) {
        throw new Error('Invalid attachment data');
      }
      const sanitizedName = stripCRLF(path.basename(att.filename)).slice(0, 255);
      const buf = Buffer.from(att.content, 'base64');
      if (buf.length === 0 || buf.length > 25 * 1024 * 1024) {
        throw new Error(`Attachment ${sanitizedName} exceeds 25MB limit or is empty`);
      }
      return { filename: sanitizedName, content: att.content, contentType: getMimeType(sanitizedName) };
    });

    const success = await smtpEngine.sendEmail(
      params.accountId, sanitizedTo, stripCRLF(params.subject), params.html,
      sanitizeList(params.cc), sanitizeList(params.bcc),
      attachments
    );
    if (success) {
      const upsertContact = db.prepare(
        `INSERT INTO contacts (id, email, name) VALUES (?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET name = COALESCE(excluded.name, contacts.name)`
      );
      for (const addr of sanitizedTo) {
        upsertContact.run(crypto.randomUUID(), addr.toLowerCase(), null);
      }
      if (params.cc) {
        const ccList = Array.isArray(params.cc) ? params.cc : [params.cc];
        for (const addr of ccList) {
          const sanitized = stripCRLF(addr.trim());
          if (sanitized) upsertContact.run(crypto.randomUUID(), sanitized.toLowerCase(), null);
        }
      }
    }
    return { success };
  });

  ipcMain.handle('emails:delete', (_event, emailId: string) => {
    db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
    return { success: true };
  });

  ipcMain.handle('emails:toggle-flag', (_event, emailId: string, flagged: boolean) => {
    db.prepare('UPDATE emails SET is_flagged = ? WHERE id = ?').run(flagged ? 1 : 0, emailId);
    return { success: true };
  });

  ipcMain.handle('folders:unread-counts', (_event, accountId: string) => {
    return db.prepare(
      'SELECT folder_id, COUNT(*) as count FROM emails WHERE account_id = ? AND is_read = 0 GROUP BY folder_id'
    ).all(accountId);
  });

  const BLOCKED_SETTINGS_GET_KEYS = new Set(['openrouter_api_key']);
  ipcMain.handle('settings:get', (_event, key: string) => {
    if (BLOCKED_SETTINGS_GET_KEYS.has(key)) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });

  const ALLOWED_SETTINGS_KEYS = new Set(['theme', 'layout', 'sidebar_width', 'notifications', 'notifications_enabled', 'notifications_sound', 'locale']);
  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      throw new Error(`Setting key not allowed: ${key}`);
    }
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
    return { success: true };
  });

  ipcMain.handle('emails:archive', async (_event: Electron.IpcMainInvokeEvent, emailId: string) => {
    if (!emailId || typeof emailId !== 'string') throw new Error('Invalid email ID');

    const email = db.prepare(
      'SELECT id, account_id, folder_id FROM emails WHERE id = ?'
    ).get(emailId) as { id: string; account_id: string; folder_id: string } | undefined;
    if (!email) throw new Error('Email not found');

    const archiveFolder = db.prepare(
      "SELECT id, path FROM folders WHERE account_id = ? AND type = 'archive'"
    ).get(email.account_id) as { id: string; path: string } | undefined;
    if (!archiveFolder) throw new Error('No archive folder found');

    const sourceFolder = db.prepare(
      'SELECT path FROM folders WHERE id = ?'
    ).get(email.folder_id) as { path: string } | undefined;
    if (!sourceFolder) throw new Error('Source folder not found');

    const uidStr = email.id.includes('_') ? email.id.split('_').pop() : email.id;
    const uid = parseInt(uidStr ?? '0', 10);
    if (!uid || isNaN(uid)) throw new Error('Invalid email UID');

    const moved = await imapEngine.moveMessage(
      email.account_id,
      uid,
      sourceFolder.path,
      archiveFolder.path
    );
    if (moved) {
      db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(archiveFolder.id, email.id);
    }
    return { success: moved };
  });

  ipcMain.handle('emails:move', async (_event: Electron.IpcMainInvokeEvent, params: { emailId: string; destFolderId: string }) => {
    if (!params?.emailId || !params?.destFolderId) throw new Error('Missing required parameters');

    const email = db.prepare(
      'SELECT id, account_id, folder_id FROM emails WHERE id = ?'
    ).get(params.emailId) as { id: string; account_id: string; folder_id: string } | undefined;
    if (!email) throw new Error('Email not found');

    const sourceFolder = db.prepare(
      'SELECT path, account_id FROM folders WHERE id = ?'
    ).get(email.folder_id) as { path: string; account_id: string } | undefined;
    const destFolder = db.prepare(
      'SELECT id, path, account_id FROM folders WHERE id = ?'
    ).get(params.destFolderId) as { id: string; path: string; account_id: string } | undefined;
    if (!sourceFolder || !destFolder) throw new Error('Folder not found');
    if (destFolder.account_id !== email.account_id) throw new Error('Cross-account move not allowed');

    const uidStr = email.id.includes('_') ? email.id.split('_').pop() : email.id;
    const uid = parseInt(uidStr ?? '0', 10);
    if (!uid || isNaN(uid)) throw new Error('Invalid email UID');

    const moved = await imapEngine.moveMessage(
      email.account_id,
      uid,
      sourceFolder.path,
      destFolder.path
    );
    if (moved) {
      db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(destFolder.id, email.id);
    }
    return { success: moved };
  });

  ipcMain.handle('contacts:search', (_event: Electron.IpcMainInvokeEvent, query: string) => {
    if (!query || typeof query !== 'string' || query.trim().length < 2) return [];
    const trimmed = query.trim().slice(0, 100);
    const pattern = `%${trimmed}%`;
    return db.prepare(
      'SELECT id, email, name FROM contacts WHERE email LIKE ? OR name LIKE ? LIMIT 10'
    ).all(pattern, pattern);
  });

  ipcMain.handle('contacts:upsert', (_event: Electron.IpcMainInvokeEvent, params: { email: string; name?: string }) => {
    if (!params?.email) throw new Error('Email is required');
    const emailAddr = params.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr)) throw new Error('Invalid email format');
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO contacts (id, email, name) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = COALESCE(excluded.name, contacts.name)`
    ).run(id, emailAddr, params.name?.trim() ?? null);
    return { success: true };
  });

  ipcMain.handle('drafts:list', (_event: Electron.IpcMainInvokeEvent, accountId: string) => {
    if (!accountId) return [];
    return db.prepare(
      'SELECT id, account_id, to_email, subject, body_html, cc, bcc, created_at, updated_at FROM drafts WHERE account_id = ? ORDER BY updated_at DESC'
    ).all(accountId);
  });

  ipcMain.handle('drafts:save', (_event: Electron.IpcMainInvokeEvent, params: {
    id?: string; accountId: string; to: string; subject: string; bodyHtml: string;
    cc?: string; bcc?: string;
  }) => {
    if (!params?.accountId) throw new Error('Account ID required');
    const id = params.id ?? crypto.randomUUID();
    // Verify ownership before overwrite: reject if draft exists under a different account
    if (params.id) {
      const existing = db.prepare('SELECT account_id FROM drafts WHERE id = ?').get(params.id) as { account_id: string } | undefined;
      if (existing && existing.account_id !== params.accountId) throw new Error('Draft ownership mismatch');
    }
    db.prepare(
      `INSERT INTO drafts (id, account_id, to_email, subject, body_html, cc, bcc, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         to_email = excluded.to_email,
         subject = excluded.subject,
         body_html = excluded.body_html,
         cc = excluded.cc,
         bcc = excluded.bcc,
         updated_at = datetime('now')`
    ).run(id, params.accountId, params.to ?? '', params.subject ?? '', params.bodyHtml ?? '', params.cc ?? null, params.bcc ?? null);
    return { id };
  });

  ipcMain.handle('drafts:get', (_event: Electron.IpcMainInvokeEvent, params: { draftId: string; accountId: string }) => {
    if (!params?.draftId || !params?.accountId) return null;
    return db.prepare(
      'SELECT id, account_id, to_email, subject, body_html, cc, bcc, created_at, updated_at FROM drafts WHERE id = ? AND account_id = ?'
    ).get(params.draftId, params.accountId);
  });

  ipcMain.handle('drafts:delete', (_event: Electron.IpcMainInvokeEvent, params: { draftId: string; accountId: string }) => {
    if (!params?.draftId || !params?.accountId) return { success: false };
    db.prepare('DELETE FROM drafts WHERE id = ? AND account_id = ?').run(params.draftId, params.accountId);
    return { success: true };
  });

  // --- Attachment handlers ---

  ipcMain.handle('attachments:list', (_event, emailId: string) => {
    if (!emailId || typeof emailId !== 'string') return [];
    return db.prepare(
      'SELECT id, email_id, filename, mime_type, size, part_number FROM attachments WHERE email_id = ?'
    ).all(emailId);
  });

  ipcMain.handle('attachments:download', async (_event, params: {
    attachmentId: string;
    emailId: string;
  }) => {
    if (!params?.attachmentId || !params?.emailId) throw new Error('Missing parameters');

    const att = db.prepare(
      'SELECT id, email_id, filename, mime_type, size, part_number, content FROM attachments WHERE id = ?'
    ).get(params.attachmentId) as {
      id: string; email_id: string; filename: string; mime_type: string;
      size: number; part_number: string; content: Buffer | null;
    } | undefined;

    if (!att) throw new Error('Attachment not found');
    if (att.email_id !== params.emailId) throw new Error('Attachment-email mismatch');

    const safeName = path.basename(att.filename).slice(0, 255);

    // Return cached content if available
    if (att.content) {
      return {
        filename: safeName,
        mimeType: att.mime_type,
        content: att.content.toString('base64'),
      };
    }

    // Fetch from IMAP on-demand
    const email = db.prepare(
      'SELECT account_id, folder_id FROM emails WHERE id = ?'
    ).get(params.emailId) as { account_id: string; folder_id: string } | undefined;
    if (!email) throw new Error('Email not found');

    const folder = db.prepare(
      'SELECT path FROM folders WHERE id = ?'
    ).get(email.folder_id) as { path: string } | undefined;
    if (!folder) throw new Error('Folder not found');

    const uidStr = params.emailId.includes('_') ? params.emailId.split('_').pop() : params.emailId;
    const uid = parseInt(uidStr ?? '0', 10);
    if (!uid || isNaN(uid)) throw new Error('Invalid email UID');

    const mailbox = folder.path.replace(/^\//, '');
    const contentBuffer = await imapEngine.downloadAttachment(
      email.account_id, uid, mailbox, att.part_number
    );

    if (!contentBuffer) throw new Error('Failed to download attachment from server');

    // Cache in database for future access
    db.prepare('UPDATE attachments SET content = ? WHERE id = ?').run(contentBuffer, att.id);

    return {
      filename: safeName,
      mimeType: att.mime_type,
      content: contentBuffer.toString('base64'),
    };
  });

  ipcMain.handle('attachments:save', async (_event, params: {
    filename: string;
    content: string;
  }) => {
    if (!win) throw new Error('No window available');
    if (!params?.filename || !params?.content) throw new Error('Missing parameters');

    const safeName = path.basename(params.filename).slice(0, 255);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: safeName,
    });
    if (result.canceled || !result.filePath) return { success: false };

    try {
      const buffer = Buffer.from(params.content, 'base64');
      if (buffer.length === 0) throw new Error('Empty content');
      fs.writeFileSync(result.filePath, buffer);
      return { success: true, path: result.filePath };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Write failed' };
    }
  });

  ipcMain.handle('dialog:open-file', async () => {
    if (!win) throw new Error('No window available');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const files: Array<{ filename: string; content: string; contentType: string; size: number }> = [];
    for (const filePath of result.filePaths) {
      const stat = fs.statSync(filePath);
      if (stat.size > 25 * 1024 * 1024) {
        throw new Error(`File ${path.basename(filePath)} exceeds 25MB limit`);
      }
      const buffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      files.push({
        filename,
        content: buffer.toString('base64'),
        contentType: getMimeType(filename),
        size: stat.size,
      });
    }
    return files;
  });

  // --- CID inline image handler ---
  const SAFE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

  ipcMain.handle('attachments:by-cid', async (_event, params: {
    emailId: string;
    contentIds: string[];
  }) => {
    if (!params?.emailId || !params?.contentIds || !Array.isArray(params.contentIds)) return {};
    const cids = params.contentIds.slice(0, 10); // Cap at 10 inline images per email

    // Verify email exists and belongs to a valid account
    const emailOwner = db.prepare(
      'SELECT account_id FROM emails WHERE id = ?'
    ).get(params.emailId) as { account_id: string } | undefined;
    if (!emailOwner) return {};
    const accountExists = db.prepare('SELECT id FROM accounts WHERE id = ?').get(emailOwner.account_id);
    if (!accountExists) return {};

    const result: Record<string, string> = {};

    for (const cid of cids) {
      if (!cid || typeof cid !== 'string') continue;
      const att = db.prepare(
        'SELECT id, email_id, mime_type, part_number, content FROM attachments WHERE email_id = ? AND content_id = ?'
      ).get(params.emailId, cid) as {
        id: string; email_id: string; mime_type: string;
        part_number: string; content: Buffer | null;
      } | undefined;
      if (!att) continue;
      // Only allow safe image MIME types in data: URLs
      if (!SAFE_IMAGE_MIMES.has(att.mime_type)) continue;

      if (att.content) {
        result[cid] = `data:${att.mime_type};base64,${att.content.toString('base64')}`;
        continue;
      }

      // On-demand IMAP download
      const email = db.prepare(
        'SELECT account_id, folder_id FROM emails WHERE id = ?'
      ).get(params.emailId) as { account_id: string; folder_id: string } | undefined;
      if (!email) continue;

      const folder = db.prepare(
        'SELECT path FROM folders WHERE id = ?'
      ).get(email.folder_id) as { path: string } | undefined;
      if (!folder) continue;

      const uidStr = params.emailId.includes('_') ? params.emailId.split('_').pop() : params.emailId;
      const uid = parseInt(uidStr ?? '0', 10);
      if (!uid || isNaN(uid)) continue;

      const mailbox = folder.path.replace(/^\//, '');
      const contentBuffer = await imapEngine.downloadAttachment(
        email.account_id, uid, mailbox, att.part_number
      );
      if (contentBuffer) {
        db.prepare('UPDATE attachments SET content = ? WHERE id = ?').run(contentBuffer, att.id);
        result[cid] = `data:${att.mime_type};base64,${contentBuffer.toString('base64')}`;
      }
    }

    return result;
  });

  // --- API key handlers (encrypted via safeStorage) ---

  ipcMain.handle('apikeys:get-openrouter', () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'openrouter_api_key'")
      .get() as { value: string } | undefined;
    if (!row?.value) return null;
    try {
      return decryptData(Buffer.from(row.value, 'base64'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('apikeys:set-openrouter', (_event: Electron.IpcMainInvokeEvent, apiKey: string) => {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      db.prepare("DELETE FROM settings WHERE key = 'openrouter_api_key'").run();
      return { success: true };
    }
    const trimmed = apiKey.trim();
    if (trimmed.length > 512) throw new Error('API key exceeds maximum length (512 characters)');
    const encrypted = encryptData(trimmed).toString('base64');
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('openrouter_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(encrypted);
    return { success: true };
  });

  // --- Phase 4: Snooze handlers ---

  ipcMain.handle('emails:snooze', (_event, params: { emailId: string; snoozeUntil: string }) => {
    if (!params?.emailId || !params?.snoozeUntil) throw new Error('Missing required parameters');
    const snoozeDate = new Date(params.snoozeUntil);
    if (isNaN(snoozeDate.getTime()) || snoozeDate.getTime() <= Date.now()) {
      throw new Error('Snooze time must be in the future');
    }
    const email = db.prepare('SELECT id, account_id, folder_id FROM emails WHERE id = ?')
      .get(params.emailId) as { id: string; account_id: string; folder_id: string } | undefined;
    if (!email) throw new Error('Email not found');

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO snoozed_emails (id, email_id, account_id, original_folder_id, snooze_until)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, email.id, email.account_id, email.folder_id, snoozeDate.toISOString());
    db.prepare('UPDATE emails SET is_snoozed = 1 WHERE id = ?').run(email.id);
    return { success: true, snoozedId: id };
  });

  ipcMain.handle('emails:unsnooze', (_event, emailId: string) => {
    if (!emailId) throw new Error('Email ID required');
    const snoozed = db.prepare(
      'SELECT id, original_folder_id FROM snoozed_emails WHERE email_id = ? AND restored = 0'
    ).get(emailId) as { id: string; original_folder_id: string } | undefined;
    if (!snoozed) throw new Error('No active snooze for this email');

    db.prepare('UPDATE emails SET is_snoozed = 0, folder_id = ? WHERE id = ?')
      .run(snoozed.original_folder_id, emailId);
    db.prepare('UPDATE snoozed_emails SET restored = 1 WHERE id = ?').run(snoozed.id);
    return { success: true };
  });

  ipcMain.handle('snoozed:list', (_event, accountId: string) => {
    if (!accountId) return [];
    return db.prepare(
      `SELECT s.id, s.email_id, s.snooze_until, s.created_at,
              e.subject, e.from_name, e.from_email, e.snippet
       FROM snoozed_emails s
       JOIN emails e ON s.email_id = e.id
       WHERE s.account_id = ? AND s.restored = 0
       ORDER BY s.snooze_until ASC`
    ).all(accountId);
  });

  // --- Phase 4: Scheduled send handlers ---

  ipcMain.handle('scheduled:create', (_event, params: {
    accountId: string; to: string; subject: string; bodyHtml: string;
    cc?: string; bcc?: string; sendAt: string; draftId?: string;
    attachments?: Array<{ filename: string; content: string; contentType: string }>;
  }) => {
    if (!params?.accountId || !params?.to || !params?.subject || !params?.sendAt) {
      throw new Error('Missing required parameters');
    }
    const sendDate = new Date(params.sendAt);
    if (isNaN(sendDate.getTime()) || sendDate.getTime() <= Date.now()) {
      throw new Error('Send time must be in the future');
    }
    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(params.accountId);
    if (!account) throw new Error('Account not found');

    const id = crypto.randomUUID();
    const attachmentsJson = params.attachments ? JSON.stringify(params.attachments) : null;
    const stripCRLF = (s: string) => s.replace(/[\r\n\0]/g, '');
    db.prepare(
      `INSERT INTO scheduled_sends (id, account_id, draft_id, to_email, cc, bcc, subject, body_html, attachments_json, send_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, params.accountId, params.draftId ?? null, stripCRLF(params.to), params.cc ? stripCRLF(params.cc) : null,
      params.bcc ? stripCRLF(params.bcc) : null, stripCRLF(params.subject), params.bodyHtml, attachmentsJson, sendDate.toISOString());
    return { success: true, scheduledId: id };
  });

  ipcMain.handle('scheduled:cancel', (_event, scheduledId: string, accountId: string) => {
    if (!scheduledId || !accountId) throw new Error('Scheduled ID and account ID required');
    const row = db.prepare("SELECT id FROM scheduled_sends WHERE id = ? AND account_id = ? AND status = 'pending'")
      .get(scheduledId, accountId);
    if (!row) throw new Error('Scheduled send not found or already processed');
    db.prepare("UPDATE scheduled_sends SET status = 'cancelled' WHERE id = ? AND account_id = ?").run(scheduledId, accountId);
    return { success: true };
  });

  ipcMain.handle('scheduled:list', (_event, accountId: string) => {
    if (!accountId) return [];
    return db.prepare(
      `SELECT id, to_email, subject, send_at, status, error_message, created_at
       FROM scheduled_sends WHERE account_id = ? AND status IN ('pending', 'sending')
       ORDER BY send_at ASC`
    ).all(accountId);
  });

  ipcMain.handle('scheduled:update', (_event, params: { scheduledId: string; accountId: string; sendAt: string }) => {
    if (!params?.scheduledId || !params?.accountId || !params?.sendAt) throw new Error('Missing required parameters');
    const sendDate = new Date(params.sendAt);
    if (isNaN(sendDate.getTime()) || sendDate.getTime() <= Date.now()) {
      throw new Error('Send time must be in the future');
    }
    const row = db.prepare("SELECT id FROM scheduled_sends WHERE id = ? AND account_id = ? AND status = 'pending'")
      .get(params.scheduledId, params.accountId);
    if (!row) throw new Error('Scheduled send not found or already processed');
    db.prepare('UPDATE scheduled_sends SET send_at = ? WHERE id = ? AND account_id = ?')
      .run(sendDate.toISOString(), params.scheduledId, params.accountId);
    return { success: true };
  });

  // --- Phase 4: Reminder handlers ---

  ipcMain.handle('reminders:create', (_event, params: {
    emailId: string; remindAt: string; note?: string;
  }) => {
    if (!params?.emailId || !params?.remindAt) throw new Error('Missing required parameters');
    const remindDate = new Date(params.remindAt);
    if (isNaN(remindDate.getTime()) || remindDate.getTime() <= Date.now()) {
      throw new Error('Reminder time must be in the future');
    }
    const email = db.prepare('SELECT id, account_id FROM emails WHERE id = ?')
      .get(params.emailId) as { id: string; account_id: string } | undefined;
    if (!email) throw new Error('Email not found');

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO reminders (id, email_id, account_id, remind_at, note)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, email.id, email.account_id, remindDate.toISOString(), params.note?.slice(0, 500) ?? null);
    return { success: true, reminderId: id };
  });

  ipcMain.handle('reminders:cancel', (_event, reminderId: string, accountId: string) => {
    if (!reminderId || !accountId) throw new Error('Reminder ID and account ID required');
    db.prepare('DELETE FROM reminders WHERE id = ? AND account_id = ? AND is_triggered = 0').run(reminderId, accountId);
    return { success: true };
  });

  ipcMain.handle('reminders:list', (_event, accountId: string) => {
    if (!accountId) return [];
    return db.prepare(
      `SELECT r.id, r.email_id, r.remind_at, r.note, r.created_at,
              e.subject, e.from_name, e.from_email
       FROM reminders r
       JOIN emails e ON r.email_id = e.id
       WHERE r.account_id = ? AND r.is_triggered = 0
       ORDER BY r.remind_at ASC`
    ).all(accountId);
  });

  // --- Phase 4: Mail rule handlers ---

  ipcMain.handle('rules:list', (_event, accountId: string) => {
    if (!accountId) return [];
    return db.prepare(
      'SELECT id, name, priority, is_active, match_field, match_operator, match_value, action_type, action_value FROM mail_rules WHERE account_id = ? ORDER BY priority ASC'
    ).all(accountId);
  });

  ipcMain.handle('rules:create', (_event, params: {
    accountId: string; name: string; matchField: string; matchOperator: string;
    matchValue: string; actionType: string; actionValue?: string;
  }) => {
    if (!params?.accountId || !params?.name || !params?.matchField || !params?.matchOperator || !params?.matchValue || !params?.actionType) {
      throw new Error('Missing required parameters');
    }
    const VALID_FIELDS = new Set(['from', 'subject', 'body', 'has_attachment']);
    const VALID_OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with']);
    const VALID_ACTIONS = new Set(['move', 'mark_read', 'flag', 'delete', 'label', 'categorize']);
    if (!VALID_FIELDS.has(params.matchField)) throw new Error('Invalid match field');
    if (!VALID_OPERATORS.has(params.matchOperator)) throw new Error('Invalid match operator');
    if (!VALID_ACTIONS.has(params.actionType)) throw new Error('Invalid action type');

    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(params.accountId);
    if (!account) throw new Error('Account not found');

    const maxPriority = db.prepare(
      'SELECT MAX(priority) as maxP FROM mail_rules WHERE account_id = ?'
    ).get(params.accountId) as { maxP: number | null } | undefined;
    const priority = (maxPriority?.maxP ?? -1) + 1;

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO mail_rules (id, account_id, name, priority, match_field, match_operator, match_value, action_type, action_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, params.accountId, params.name.slice(0, 200), priority,
      params.matchField, params.matchOperator, params.matchValue.slice(0, 500),
      params.actionType, params.actionValue?.slice(0, 200) ?? null);
    return { success: true, ruleId: id };
  });

  ipcMain.handle('rules:update', (_event, params: {
    ruleId: string; accountId?: string; name?: string; isActive?: boolean;
    matchField?: string; matchOperator?: string; matchValue?: string;
    actionType?: string; actionValue?: string;
  }) => {
    if (!params?.ruleId) throw new Error('Rule ID required');
    const VALID_FIELDS = new Set(['from', 'subject', 'body', 'has_attachment']);
    const VALID_OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with']);
    const VALID_ACTIONS = new Set(['move', 'mark_read', 'flag', 'delete', 'label', 'categorize']);
    if (params.matchField !== undefined && !VALID_FIELDS.has(params.matchField)) throw new Error('Invalid match field');
    if (params.matchOperator !== undefined && !VALID_OPERATORS.has(params.matchOperator)) throw new Error('Invalid match operator');
    if (params.actionType !== undefined && !VALID_ACTIONS.has(params.actionType)) throw new Error('Invalid action type');

    // Verify rule exists (and optionally verify account ownership)
    const whereClause = params.accountId
      ? 'SELECT id FROM mail_rules WHERE id = ? AND account_id = ?'
      : 'SELECT id FROM mail_rules WHERE id = ?';
    const whereArgs = params.accountId ? [params.ruleId, params.accountId] : [params.ruleId];
    const rule = db.prepare(whereClause).get(...whereArgs);
    if (!rule) throw new Error('Rule not found');

    const fields: string[] = [];
    const values: unknown[] = [];
    if (params.name !== undefined) { fields.push('name = ?'); values.push(params.name.slice(0, 200)); }
    if (params.isActive !== undefined) { fields.push('is_active = ?'); values.push(params.isActive ? 1 : 0); }
    if (params.matchField !== undefined) { fields.push('match_field = ?'); values.push(params.matchField); }
    if (params.matchOperator !== undefined) { fields.push('match_operator = ?'); values.push(params.matchOperator); }
    if (params.matchValue !== undefined) { fields.push('match_value = ?'); values.push(params.matchValue.slice(0, 500)); }
    if (params.actionType !== undefined) { fields.push('action_type = ?'); values.push(params.actionType); }
    if (params.actionValue !== undefined) { fields.push('action_value = ?'); values.push(params.actionValue?.slice(0, 200) ?? null); }

    if (fields.length > 0) {
      values.push(params.ruleId);
      db.prepare(`UPDATE mail_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    return { success: true };
  });

  ipcMain.handle('rules:delete', (_event, ruleId: string, accountId: string) => {
    if (!ruleId || !accountId) throw new Error('Rule ID and account ID required');
    db.prepare('DELETE FROM mail_rules WHERE id = ? AND account_id = ?').run(ruleId, accountId);
    return { success: true };
  });

  ipcMain.handle('rules:reorder', (_event, params: { ruleIds: string[]; accountId: string }) => {
    if (!params?.ruleIds || !Array.isArray(params.ruleIds) || !params?.accountId) throw new Error('Rule IDs array and account ID required');
    if (params.ruleIds.length > 1000) throw new Error('Too many rules');
    const updateStmt = db.prepare('UPDATE mail_rules SET priority = ? WHERE id = ? AND account_id = ?');
    db.transaction(() => {
      for (let i = 0; i < params.ruleIds.length; i++) {
        updateStmt.run(i, params.ruleIds[i], params.accountId);
      }
    })();
    return { success: true };
  });

  ipcMain.handle('rules:test', (_event, params: {
    accountId: string; matchField: string; matchOperator: string; matchValue: string;
  }) => {
    if (!params?.accountId || !params?.matchField || !params?.matchOperator || !params?.matchValue) {
      throw new Error('Missing required parameters');
    }
    const VALID_MATCH_FIELDS = ['from', 'subject', 'body', 'has_attachment'];
    const VALID_MATCH_OPS = ['contains', 'equals', 'starts_with', 'ends_with'];
    if (!VALID_MATCH_FIELDS.includes(params.matchField)) throw new Error('Invalid match field');
    if (!VALID_MATCH_OPS.includes(params.matchOperator)) throw new Error('Invalid operator');
    // Build a WHERE clause to preview rule matches
    let whereSql: string;
    const value = params.matchValue;
    const fieldMap: Record<string, string> = {
      from: 'from_email', subject: 'subject', body: 'body_text', has_attachment: 'has_attachments',
    };
    const col = fieldMap[params.matchField]!;

    if (params.matchField === 'has_attachment') {
      whereSql = `has_attachments = ${value === '1' ? 1 : 0}`;
    } else if (params.matchOperator === 'contains') {
      whereSql = `${col} LIKE '%' || ? || '%'`;
    } else if (params.matchOperator === 'equals') {
      whereSql = `${col} = ?`;
    } else if (params.matchOperator === 'starts_with') {
      whereSql = `${col} LIKE ? || '%'`;
    } else if (params.matchOperator === 'ends_with') {
      whereSql = `${col} LIKE '%' || ?`;
    } else {
      throw new Error('Invalid operator');
    }

    const query = `SELECT id, subject, from_email, date FROM emails WHERE account_id = ? AND ${whereSql} ORDER BY date DESC LIMIT 10`;
    if (params.matchField === 'has_attachment') {
      return db.prepare(query).all(params.accountId);
    }
    return db.prepare(query).all(params.accountId, value);
  });

  // --- MCP connection status handler ---
  ipcMain.handle('mcp:connected-count', () => {
    return { count: mcpServer.getConnectedCount() };
  });

  // --- Auto-update handlers ---
  ipcMain.handle('update:check', async () => {
    try {
      const result = await checkForUpdates();
      return { available: !!result?.updateInfo, version: result?.updateInfo?.version ?? null };
    } catch {
      return { available: false, version: null };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      await downloadUpdate();
      return { success: true };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle('update:install', () => {
    installUpdate();
  });

}

app.whenReady().then(() => {
  logDebug('app.whenReady() triggered. Initializing database...');
  try {
    initDatabase();
    logDebug('Database initialized successfully.');
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] Database initialization failed: ${e.message}\n${e.stack}`);
    dialog.showErrorBox(
      'ExpressDelivery - Database Error',
      `Failed to initialize database:\n${e.message}\n\nThe application will now close.`
    );
    app.quit();
    return;
  }

  logDebug('Registering IPC handlers...');
  try {
    registerIpcHandlers();
    logDebug('IPC handlers registered successfully.');
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] IPC handler registration failed: ${e.message}\n${e.stack}`);
  }

  logDebug('Starting MCP server...');
  try {
    mcpServer.start();
    logDebug('MCP server started successfully.');
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] MCP server start failed: ${e.message}\n${e.stack}`);
  }

  // Wire up MCP connection status push to renderer
  mcpServer.setConnectionCallback((count) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('mcp:status', { connectedAgents: count });
    }
  });

  // Wire up email:new IPC event from IMAP sync
  imapEngine.setNewEmailCallback((accountId, folderId, count) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('email:new', { accountId, folderId, count });
    }
    if (count > 0) {
      showNotification('New Email', `${count} new message${count > 1 ? 's' : ''} received`);
    }
  });

  // Start scheduler engine for snooze/send-later/reminders
  schedulerEngine.setCallbacks({
    onSnoozeRestore: (_emailId, accountId, folderId) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('email:new', { accountId, folderId, count: 1 });
      }
    },
    onReminderDue: (emailId, accountId, subject, fromEmail) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('reminder:due', { emailId, accountId, subject, fromEmail });
      }
      showNotification('Reminder', (subject ?? 'Follow up on email').slice(0, 100), emailId);
    },
    onScheduledSendResult: (scheduledId, success, error) => {
      if (win && !win.isDestroyed()) {
        const channel = success ? 'scheduled:sent' : 'scheduled:failed';
        win.webContents.send(channel, { scheduledId, error });
      }
      if (!success) {
        showNotification('Scheduled Email Failed', error ?? 'Could not send scheduled email');
      }
    },
  });
  try {
    schedulerEngine.start();
    logDebug('Scheduler engine started successfully.');
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] Scheduler start failed: ${e.message}`);
  }

  logDebug('Creating main window...');
  try {
    createWindow();
    logDebug('Main window created successfully.');
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] Window creation failed: ${e.message}\n${e.stack}`);
  }

  // Initialize auto-updater (only in production)
  if (!VITE_DEV_SERVER_URL) {
    try {
      initAutoUpdater();
      setUpdateCallback((event, data) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(event, data);
        }
      });
      checkForUpdates().catch(() => { /* silent */ });
      logDebug('Auto-updater initialized.');
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      logDebug(`[WARN] Auto-updater init failed: ${e.message}`);
    }
  }

  // Connect saved accounts and sync folders on startup
  try {
    const db = getDatabase();
    const accounts = db.prepare('SELECT id FROM accounts').all() as Array<{ id: string }>;
    for (const account of accounts) {
      imapEngine.connectAccount(account.id)
        .then(async (connected) => {
          if (connected) {
            await imapEngine.listAndSyncFolders(account.id);
          }
        })
        .catch((err) => {
          logDebug(`[WARN] Startup IMAP connect failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] Startup IMAP sync failed: ${e.message}`);
  }
}).catch((err) => {
  logDebug(`[ERROR] app.whenReady() rejected: ${err.message}\n${err.stack}`);
});
