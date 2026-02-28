import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, screen, Notification } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

// --- INITIALIZE LOGGER ---
import { logDebug } from './logger.js';

logDebug('--- NEW APP STARTUP ---');
logDebug(`Platform: ${process.platform}, Arch: ${process.arch}, App Path: ${app.getAppPath()}`);

// Robust exception handler — log and try to continue (exit only for truly fatal errors)
process.on('uncaughtException', (err) => {
  logDebug(`[UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}`);
  const userDataLog = path.join(app.getPath('userData'), 'crash.log')
  try {
    fs.appendFileSync(userDataLog, `[UNCAUGHT] ${new Date().toISOString()} - ${err.message}\n${err.stack}\n`)
  } catch {
    // Failsafe
  }
  // Only exit for truly fatal errors that compromise process integrity
  // (e.g. native module crashes, OOM). For JS-level errors, attempt to continue.
  const errWithCode = err as NodeJS.ErrnoException;
  const fatal = errWithCode.code === 'MODULE_NOT_FOUND'
    || err.message?.includes('NODE_MODULE_VERSION')
    || /out of memory|heap exhausted/i.test(err.message ?? '');
  if (fatal) process.exit(1);
})

// Prevent silent crash from unhandled promise rejections (e.g. IMAP reconnect failures)
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : '';
  logDebug(`[UNHANDLED REJECTION] ${msg}\n${stack}`);
  const userDataLog = path.join(app.getPath('userData'), 'crash.log')
  try {
    fs.appendFileSync(userDataLog, `[REJECTION] ${new Date().toISOString()} - ${msg}\n${stack}\n`)
  } catch {
    // Failsafe
  }
  // Do NOT exit — just log and continue. This prevents IMAP reconnect failures from killing the app.
})

// Log child process crashes to debug unexpected app closures
app.on('child-process-gone', (_event, details) => {
  logDebug(`[CHILD PROCESS GONE] type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
})

import { initDatabase, getDatabase, closeDatabase } from './db.js'
import { getMcpServer, setMcpConnectionCallback, restartMcpServer } from './mcpServer.js'
import { imapEngine } from './imap.js'
import { smtpEngine } from './smtp.js'
import { encryptData, decryptData } from './crypto.js'
import { sanitizeFts5Query } from './utils.js'
import { schedulerEngine } from './scheduler.js'
import { initAutoUpdater, setUpdateCallback, checkForUpdates, downloadUpdate, installUpdate } from './updater.js'
import { exportEml, exportMbox } from './emailExport.js'
import { importEml, importMbox } from './emailImport.js'
import { exportVcard, exportCsv, importVcard, importCsv } from './contactPortability.js'
import { trainSpam, classifySpam } from './spamFilter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let tray: Tray | null = null

// Track last successful IMAP sync timestamp per account (module-level so it's
// accessible from both the new-email callback and the imap:status IPC handler)
const lastSyncTimestamps: Map<string, number> = new Map();

// Helper: send sync status to renderer (guards destroyed window)
function sendSyncStatus(accountId: string, status: 'connecting' | 'connected' | 'error', timestamp: number | null) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('sync:status', { accountId, status, timestamp });
  }
}

/** Extract IMAP UID from a composite email ID (e.g. "acc123_42" → 42) */
function extractUid(emailId: string): number {
  const uidStr = emailId.includes('_') ? emailId.split('_').pop() : emailId;
  return parseInt(uidStr ?? '0', 10);
}

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

function showNotification(title: string, body: string, meta?: { emailId?: string; accountId?: string; folderId?: string }) {
  const db = getDatabase();
  const enabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('notifications_enabled') as { value: string } | undefined;
  if (enabled?.value === 'false') return;

  const notification = new Notification({ title, body, icon: path.join(process.env.VITE_PUBLIC, 'icon.png') });
  notification.on('click', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      if (meta) {
        win.webContents.send('notification:click', meta);
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
    show: false,
    backgroundColor: '#ffffff',
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      devTools: !!VITE_DEV_SERVER_URL,
    },
  })

  win.once('ready-to-show', () => {
    win?.show();
  })

  // Minimize to tray instead of closing (prevents app.quit on idle)
  win.on('close', (e) => {
    if (!(app as unknown as { isQuitting: boolean }).isQuitting) {
      e.preventDefault();
      win?.hide();
    }
  });

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

  // Defense-in-depth: block unexpected navigation from email iframe or renderer
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = VITE_DEV_SERVER_URL
      ? url.startsWith(VITE_DEV_SERVER_URL)
      : url.startsWith('file://');
    if (!allowed) {
      logDebug(`[BLOCKED NAVIGATION] ${url}`);
      event.preventDefault();
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    logDebug(`[BLOCKED WINDOW OPEN] ${url}`);
    return { action: 'deny' };
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
});

// Flag to distinguish intentional quit vs window close
(app as unknown as { isQuitting: boolean }).isQuitting = false;

app.on('before-quit', async () => {
  (app as unknown as { isQuitting: boolean }).isQuitting = true;
  logDebug('before-quit: cleaning up...');
  schedulerEngine.stop();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  try { getMcpServer().stop(); } catch { /* best effort */ }
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

  // Combined startup handler: accounts + folders + inbox emails in one round-trip
  ipcMain.handle('startup:load', () => {
    const accounts = db.prepare(
      'SELECT id, email, provider, display_name, imap_host, imap_port, smtp_host, smtp_port, signature_html, created_at FROM accounts'
    ).all() as Array<{ id: string }>;
    if (accounts.length === 0) return { accounts, folders: [], emails: [] };
    const firstAccountId = accounts[0].id;
    const folders = db.prepare(
      'SELECT id, name, path, type FROM folders WHERE account_id = ?'
    ).all(firstAccountId) as Array<{ id: string; type: string }>;
    const inbox = folders.find(f => f.type === 'inbox');
    const emails = inbox
      ? db.prepare(
        `SELECT id, thread_id, account_id, subject, from_name, from_email, to_email,
                date, snippet, is_read, is_flagged, has_attachments,
                ai_category, ai_priority, ai_labels
         FROM emails WHERE folder_id = ? AND (is_snoozed = 0 OR is_snoozed IS NULL)
         ORDER BY date DESC LIMIT 50`
      ).all(inbox.id)
      : [];
    // Bundle settings into the startup response to avoid a second IPC round-trip
    // Only non-sensitive keys here (undo_send_delay is a numeric timer, not a secret)
    const undoDelayRow = db.prepare("SELECT value FROM settings WHERE key = 'undo_send_delay'").get() as { value: string } | undefined;
    const undoDelay = Math.min(Math.max(parseInt(undoDelayRow?.value ?? '5', 10) || 5, 0), 30);
    return {
      accounts, folders, emails,
      selectedAccountId: firstAccountId,
      selectedFolderId: inbox?.id ?? null,
      settings: { undo_send_delay: String(undoDelay) },
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle('accounts:list', () => {
    return db.prepare(
      'SELECT id, email, provider, display_name, imap_host, imap_port, smtp_host, smtp_port, signature_html, created_at FROM accounts'
    ).all();
  });

  ipcMain.handle('accounts:test', async (_event, params: {
    email: string; password?: string; imap_host: string; imap_port: number;
    account_id?: string;
  }) => {
    let password = params.password ?? '';
    // When editing an existing account without re-entering password, decrypt stored password
    if (!password && params.account_id) {
      const row = db.prepare(
        'SELECT password_encrypted FROM accounts WHERE id = ?'
      ).get(params.account_id) as { password_encrypted: string } | undefined;
      if (!row) return { success: false, error: 'Account not found' };
      password = decryptData(Buffer.from(row.password_encrypted, 'base64'));
    }
    if (!password) return { success: false, error: 'Password is required' };
    return imapEngine.testConnection({
      email: params.email,
      password,
      imap_host: params.imap_host,
      imap_port: params.imap_port,
    });
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
      sendSyncStatus(id, 'connecting', null);
      const connected = await imapEngine.connectAccount(id);
      if (connected) {
        const folders = await imapEngine.listAndSyncFolders(id);
        const inbox = folders.find(f => f.type === 'inbox');
        if (inbox) {
          await imapEngine.syncNewEmails(id, inbox.path.replace(/^\//, ''));
        }
        const now = Date.now();
        lastSyncTimestamps.set(id, now);
        sendSyncStatus(id, 'connected', now);
      } else {
        sendSyncStatus(id, 'error', null);
      }
    } catch (err) {
      logDebug(`Post-add IMAP sync error: ${err instanceof Error ? err.message : String(err)}`);
      sendSyncStatus(id, 'error', null);
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
        sendSyncStatus(account.id, 'connecting', null);
        await imapEngine.disconnectAccount(account.id);
        const connected = await imapEngine.connectAccount(account.id);
        if (connected) {
          const now = Date.now();
          lastSyncTimestamps.set(account.id, now);
          sendSyncStatus(account.id, 'connected', now);
        } else {
          sendSyncStatus(account.id, 'error', null);
        }
      } catch (err) {
        logDebug(`Post-update IMAP reconnect error for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
        sendSyncStatus(account.id, 'error', null);
      }
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
      'SELECT id, name, path, type, color FROM folders WHERE account_id = ?'
    ).all(accountId);
  });

  // Folder CRUD operations
  const PROTECTED_FOLDER_TYPES = new Set(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']);

  ipcMain.handle('folders:create', async (_event, accountId: string, folderName: string, parentPath?: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    if (!folderName || typeof folderName !== 'string') throw new Error('Invalid folder name');
    const safeName = folderName.replace(/[\r\n\0/\\]/g, '').trim().slice(0, 100);
    if (!safeName) throw new Error('Invalid folder name');

    // Sanitize and verify parentPath ownership
    let fullPath = safeName;
    if (parentPath && typeof parentPath === 'string') {
      const safeParent = parentPath.replace(/[\r\n\0]/g, '').trim().slice(0, 200);
      // Verify the parent folder belongs to this account
      const parentFolder = db.prepare('SELECT id FROM folders WHERE account_id = ? AND path = ?').get(accountId, safeParent) as { id: string } | undefined;
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
  });

  ipcMain.handle('folders:rename', async (_event, folderId: string, newName: string) => {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');
    if (!newName || typeof newName !== 'string') throw new Error('Invalid folder name');
    const safeName = newName.replace(/[\r\n\0/\\]/g, '').trim().slice(0, 100);
    if (!safeName) throw new Error('Invalid folder name');

    const folder = db.prepare('SELECT id, account_id, path, type FROM folders WHERE id = ?').get(folderId) as { id: string; account_id: string; path: string; type: string } | undefined;
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
  });

  ipcMain.handle('folders:delete', async (_event, folderId: string) => {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');

    const folder = db.prepare('SELECT id, account_id, path, type FROM folders WHERE id = ?').get(folderId) as { id: string; account_id: string; path: string; type: string } | undefined;
    if (!folder) return { success: false, error: 'Folder not found' };
    if (PROTECTED_FOLDER_TYPES.has(folder.type)) return { success: false, error: 'Cannot delete system folder' };

    const emailCount = (db.prepare('SELECT COUNT(*) as count FROM emails WHERE folder_id = ?').get(folderId) as { count: number }).count;
    if (emailCount > 0) return { success: false, error: 'Folder is not empty' };

    const ok = await imapEngine.deleteMailbox(folder.account_id, folder.path);
    if (!ok) return { success: false, error: 'Failed to delete folder on server' };

    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    return { success: true };
  });

  ipcMain.handle('emails:mark-all-read', async (_event, folderId: string) => {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');

    const folder = db.prepare('SELECT id, account_id, path FROM folders WHERE id = ?').get(folderId) as { id: string; account_id: string; path: string } | undefined;
    if (!folder) return { success: false, error: 'Folder not found' };

    await imapEngine.markAllRead(folder.account_id, folder.path.replace(/^\//, ''));
    db.prepare('UPDATE emails SET is_read = 1 WHERE folder_id = ? AND is_read = 0').run(folderId);
    return { success: true };
  });

  // Lightweight mark-as-read (DB + IMAP flag only, no body fetch)
  ipcMain.handle('emails:mark-read', async (_event, emailId: string) => {
    if (!emailId || typeof emailId !== 'string') throw new Error('Invalid email ID');
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(emailId);

    const email = db.prepare('SELECT account_id, folder_id FROM emails WHERE id = ?').get(emailId) as { account_id: string; folder_id: string } | undefined;
    if (email) {
      const uid = extractUid(emailId);
      if (uid > 0) {
        const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(email.folder_id) as { path: string } | undefined;
        if (folder) {
          imapEngine.markAsRead(email.account_id, uid, folder.path.replace(/^\//, '')).catch(() => {});
        }
      }
    }
    return { success: true };
  });

  ipcMain.handle('emails:mark-unread', async (_event, emailId: string) => {
    if (!emailId || typeof emailId !== 'string') throw new Error('Invalid email ID');

    // Mark on IMAP server first, then update DB on success
    const email = db.prepare('SELECT account_id, folder_id FROM emails WHERE id = ?').get(emailId) as { account_id: string; folder_id: string } | undefined;
    if (email) {
      const uid = extractUid(emailId);
      if (uid > 0) {
        const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(email.folder_id) as { path: string } | undefined;
        if (folder) {
          imapEngine.markAsUnread(email.account_id, uid, folder.path.replace(/^\//, '')).catch(() => {});
        }
      }
    }

    db.prepare('UPDATE emails SET is_read = 0 WHERE id = ?').run(emailId);
    return { success: true };
  });

  ipcMain.handle('emails:list', (_event, folderId: string) => {
    // Virtual folder: unified inbox (all accounts) — thread-deduped
    if (folderId === '__unified') {
      return db.prepare(
        `SELECT e.id, e.thread_id, e.account_id, e.subject, e.from_name, e.from_email, e.to_email,
                e.date, e.snippet, e.is_read, e.is_flagged, e.has_attachments,
                e.ai_category, e.ai_priority, e.ai_labels,
                (SELECT COUNT(*) FROM emails e2
                 INNER JOIN folders f2 ON e2.folder_id = f2.id
                 WHERE e2.thread_id = e.thread_id AND f2.type = 'inbox'
                   AND (e2.is_snoozed = 0 OR e2.is_snoozed IS NULL)) AS thread_count
         FROM emails e
         INNER JOIN folders f ON e.folder_id = f.id
         WHERE f.type = 'inbox' AND (e.is_snoozed = 0 OR e.is_snoozed IS NULL)
           AND e.id = (
             SELECT e3.id FROM emails e3
             INNER JOIN folders f3 ON e3.folder_id = f3.id
             WHERE e3.thread_id = e.thread_id AND f3.type = 'inbox'
               AND (e3.is_snoozed = 0 OR e3.is_snoozed IS NULL)
             ORDER BY e3.date DESC LIMIT 1
           )
         ORDER BY e.date DESC LIMIT 50`
      ).all();
    }
    // Virtual folder: snoozed emails
    if (folderId === '__snoozed') {
      return db.prepare(
        `SELECT e.id, e.thread_id, e.account_id, e.subject, e.from_name, e.from_email, e.to_email,
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
    // Virtual folder: tag filter
    if (folderId.startsWith('__tag_')) {
      const tagId = folderId.slice(6);
      return db.prepare(
        `SELECT e.id, e.thread_id, e.account_id, e.subject, e.from_name, e.from_email, e.to_email,
                e.date, e.snippet, e.is_read, e.is_flagged, e.has_attachments,
                e.ai_category, e.ai_priority, e.ai_labels
         FROM emails e
         INNER JOIN email_tags et ON et.email_id = e.id
         WHERE et.tag_id = ?
         ORDER BY e.date DESC LIMIT 50`
      ).all(tagId);
    }
    // Virtual folder: saved search
    if (folderId.startsWith('__search_')) {
      const searchId = folderId.slice(9);
      const search = db.prepare('SELECT query FROM saved_searches WHERE id = ?').get(searchId) as { query: string } | undefined;
      if (!search) return [];
      const sanitized = sanitizeFts5Query(search.query);
      if (!sanitized) return [];
      return db.prepare(
        `SELECT e.id, e.thread_id, e.account_id, e.subject, e.from_name, e.from_email, e.to_email,
                e.date, e.snippet, e.is_read, e.is_flagged, e.has_attachments,
                e.ai_category, e.ai_priority, e.ai_labels
         FROM emails e
         INNER JOIN emails_fts ON emails_fts.rowid = e.rowid
         WHERE emails_fts MATCH ?
         ORDER BY e.date DESC LIMIT 50`
      ).all(sanitized);
    }
    return db.prepare(
      `SELECT e.id, e.thread_id, e.account_id, e.subject, e.from_name, e.from_email, e.to_email,
              e.date, e.snippet, e.is_read, e.is_flagged, e.has_attachments,
              e.ai_category, e.ai_priority, e.ai_labels,
              (SELECT COUNT(*) FROM emails e2 WHERE e2.thread_id = e.thread_id AND e2.folder_id = ?) AS thread_count
       FROM emails e
       WHERE e.folder_id = ? AND (e.is_snoozed = 0 OR e.is_snoozed IS NULL)
       AND e.id = (SELECT e3.id FROM emails e3 WHERE e3.thread_id = e.thread_id AND e3.folder_id = ? ORDER BY e3.date DESC LIMIT 1)
       ORDER BY e.date DESC LIMIT 50`
    ).all(folderId, folderId, folderId);
  });

  ipcMain.handle('emails:thread', (_event, threadId: string) => {
    return db.prepare(
      `SELECT id, thread_id, message_id, subject, from_name, from_email, to_email,
              date, snippet, body_text, body_html, is_read, is_flagged, has_attachments,
              ai_category, ai_priority, ai_labels, account_id, folder_id
       FROM emails WHERE thread_id = ? ORDER BY date ASC`
    ).all(threadId);
  });

  ipcMain.handle('emails:read', async (_event, emailId: string) => {
    const wasUnread = db.prepare('SELECT is_read FROM emails WHERE id = ?').get(emailId) as { is_read: number } | undefined;
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(emailId);
    // Notify renderer to refresh unread counts if this email was actually unread
    if (wasUnread && !wasUnread.is_read && win && !win.isDestroyed()) {
      win.webContents.send('email:read', { emailId });
    }

    const email = db.prepare(
      `SELECT id, account_id, folder_id, thread_id, subject,
              from_name, from_email, to_email, date, snippet,
              body_text, body_html, is_read, is_flagged, has_attachments,
              ai_category, ai_priority, ai_labels
       FROM emails WHERE id = ?`
    ).get(emailId) as Record<string, unknown> | undefined;
    if (!email) return null;

    // Mark as read on IMAP server
    const uid = extractUid(emailId);
    if (uid > 0) {
      const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(email.folder_id as string) as { path: string } | undefined;
      if (folder) {
        imapEngine.markAsRead(email.account_id as string, uid, folder.path.replace(/^\//, '')).catch(() => {});
      }
    }

    // On-demand body fetch: if body is missing, download from IMAP with charset-aware decoding
    const needsBodyFetch = !email.body_html && !email.body_text;
    let bodyFetchStatus: 'ok' | 'fetched' | 'imap_disconnected' | 'no_parts' | 'timeout' = 'ok';
    if (needsBodyFetch && uid > 0) {
      const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(email.folder_id as string) as { path: string } | undefined;
      if (folder) {
        const mailbox = folder.path.replace(/^\//, '');
        // Attempt reconnection if IMAP is disconnected
        const connected = await imapEngine.ensureConnected(email.account_id as string);
        if (!connected) {
          bodyFetchStatus = 'imap_disconnected';
        } else {
          try {
            const result = await Promise.race([
              imapEngine.refetchEmailBody(email.account_id as string, uid, mailbox),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
            ]);
            if (result) {
              db.prepare('UPDATE emails SET body_text = ?, body_html = ? WHERE id = ?').run(
                result.bodyText, result.bodyHtml, emailId
              );
              email.body_text = result.bodyText;
              email.body_html = result.bodyHtml;
              bodyFetchStatus = 'fetched';
            } else {
              bodyFetchStatus = imapEngine.isConnected(email.account_id as string) ? 'no_parts' : 'timeout';
            }
          } catch { bodyFetchStatus = 'timeout'; }
        }
        // Update sync status after reconnect attempt
        if (connected) {
          const now = Date.now();
          lastSyncTimestamps.set(email.account_id as string, now);
          sendSyncStatus(email.account_id as string, 'connected', now);
        } else {
          sendSyncStatus(email.account_id as string, 'error', null);
        }
      }
    }

    // Always return the email row even if on-demand body fetch failed
    return { ...email as object, bodyFetchStatus };
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

  ipcMain.handle('emails:delete', async (_event, emailId: string) => {
    const email = db.prepare(
      'SELECT id, account_id, folder_id FROM emails WHERE id = ?'
    ).get(emailId) as { id: string; account_id: string; folder_id: string } | undefined;
    if (!email) return { success: false };

    // Check if already in Trash — permanent delete
    const currentFolder = db.prepare(
      'SELECT type, path FROM folders WHERE id = ?'
    ).get(email.folder_id) as { type: string; path: string } | undefined;

    if (currentFolder?.type === 'trash') {
      // Permanent delete from Trash: delete on IMAP server + local DB
      const uid = extractUid(email.id);
      if (uid > 0) {
        await imapEngine.deleteMessage(email.account_id, uid, currentFolder.path.replace(/^\//, '')).catch(() => {});
      }
      db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
      return { success: true };
    }

    // Move to Trash folder
    const trashFolder = db.prepare(
      "SELECT id, path FROM folders WHERE account_id = ? AND type = 'trash'"
    ).get(email.account_id) as { id: string; path: string } | undefined;

    if (!trashFolder) {
      // No trash folder found — fallback to permanent delete
      db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
      return { success: true };
    }

    const sourceFolder = db.prepare(
      'SELECT path FROM folders WHERE id = ?'
    ).get(email.folder_id) as { path: string } | undefined;

    const uid = extractUid(email.id);

    if (uid > 0 && sourceFolder) {
      const moved = await imapEngine.moveMessage(
        email.account_id, uid,
        sourceFolder.path.replace(/^\//, ''),
        trashFolder.path.replace(/^\//, '')
      );
      if (moved) {
        db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(trashFolder.id, emailId);
        return { success: true };
      }
    }

    // IMAP move failed — fallback to local-only move
    db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(trashFolder.id, emailId);
    return { success: true };
  });

  ipcMain.handle('emails:purge-trash', async (_event, accountId: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');

    const trashFolder = db.prepare(
      "SELECT id, path FROM folders WHERE account_id = ? AND type = 'trash'"
    ).get(accountId) as { id: string; path: string } | undefined;
    if (!trashFolder) return { success: false, error: 'No trash folder found' };

    // Delete all emails in trash on IMAP server
    const trashEmails = db.prepare(
      'SELECT id FROM emails WHERE folder_id = ?'
    ).all(trashFolder.id) as Array<{ id: string }>;

    for (const email of trashEmails) {
      const uid = extractUid(email.id);
      if (uid > 0) {
        await imapEngine.deleteMessage(accountId, uid, trashFolder.path.replace(/^\//, '')).catch(() => {});
      }
    }

    // Delete all trash emails from local DB
    db.prepare('DELETE FROM emails WHERE folder_id = ?').run(trashFolder.id);
    return { success: true };
  });

  ipcMain.handle('emails:toggle-flag', (_event, emailId: string, flagged: boolean) => {
    db.prepare('UPDATE emails SET is_flagged = ? WHERE id = ?').run(flagged ? 1 : 0, emailId);
    return { success: true };
  });

  // Re-fetch email body from IMAP with charset-aware decoding (repair garbled emails)
  ipcMain.handle('emails:refetch-body', async (_event, emailId: string) => {
    const email = db.prepare(
      'SELECT id, account_id, folder_id FROM emails WHERE id = ?'
    ).get(emailId) as { id: string; account_id: string; folder_id: string } | undefined;
    if (!email) return { success: false, error: 'Email not found' };

    const folder = db.prepare(
      'SELECT path FROM folders WHERE id = ?'
    ).get(email.folder_id) as { path: string } | undefined;
    if (!folder) return { success: false, error: 'Folder not found' };

    const uid = extractUid(email.id);
    if (uid <= 0) return { success: false, error: 'Invalid UID' };

    const result = await imapEngine.refetchEmailBody(
      email.account_id, uid, folder.path.replace(/^\//, '')
    );
    if (!result) return { success: false, error: 'IMAP refetch failed' };

    db.prepare('UPDATE emails SET body_text = ?, body_html = ? WHERE id = ?').run(
      result.bodyText, result.bodyHtml, emailId
    );
    return { success: true };
  });

  // Batch repair garbled email bodies (re-fetches emails with missing bodies, capped at 200)
  ipcMain.handle('emails:repair-bodies', async (_event, accountId: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');

    // Only repair emails with missing/empty bodies, capped at 200 to prevent IMAP overload
    const emails = db.prepare(
      `SELECT id, folder_id FROM emails WHERE account_id = ?
       AND (body_html IS NULL OR body_html = '') AND (body_text IS NULL OR body_text = '')
       LIMIT 200`
    ).all(accountId) as Array<{ id: string; folder_id: string }>;

    let repaired = 0;
    let failed = 0;

    const folderStmt = db.prepare('SELECT path FROM folders WHERE id = ?');
    const updateStmt = db.prepare('UPDATE emails SET body_text = ?, body_html = ? WHERE id = ?');

    for (const email of emails) {
      const folder = folderStmt.get(email.folder_id) as { path: string } | undefined;
      if (!folder) { failed++; continue; }

      const uid = extractUid(email.id);
      if (uid <= 0) { failed++; continue; }

      const result = await imapEngine.refetchEmailBody(
        accountId, uid, folder.path.replace(/^\//, '')
      );
      if (result) {
        updateStmt.run(result.bodyText, result.bodyHtml, email.id);
        repaired++;
      } else {
        failed++;
      }
    }

    return { success: true, repaired, failed, total: emails.length };
  });

  ipcMain.handle('emails:source', async (_event, emailId: string, accountId: string) => {
    if (!emailId || typeof emailId !== 'string') return { error: 'Invalid email ID' };
    if (!accountId || typeof accountId !== 'string') return { error: 'Invalid account ID' };

    const email = db.prepare('SELECT account_id FROM emails WHERE id = ?').get(emailId) as { account_id: string } | undefined;
    if (!email) return { error: 'Email not found' };
    if (email.account_id !== accountId) return { error: 'Access denied' };

    const uid = extractUid(emailId);
    if (!uid || isNaN(uid)) return { error: 'Invalid email UID' };

    const connected = await imapEngine.ensureConnected(email.account_id);
    if (!connected) return { error: 'IMAP not connected' };

    try {
      const source = await imapEngine.fetchRawSource(email.account_id, uid);
      return { source };
    } catch (err) {
      logDebug(`[emails:source] error: ${err instanceof Error ? err.message : String(err)}`);
      return { error: 'Failed to fetch source' };
    }
  });

  ipcMain.handle('emails:unsubscribe-info', (_event, emailId: string) => {
    if (!emailId || typeof emailId !== 'string') return { hasUnsubscribe: false };

    const row = db.prepare('SELECT list_unsubscribe FROM emails WHERE id = ?').get(emailId) as { list_unsubscribe: string | null } | undefined;
    if (!row?.list_unsubscribe) return { hasUnsubscribe: false };

    const urls: Array<{ type: 'mailto' | 'http'; url: string }> = [];
    const matches = row.list_unsubscribe.match(/<([^>]+)>/g);
    if (matches) {
      for (const m of matches) {
        const url = m.slice(1, -1);
        if (url.startsWith('mailto:')) {
          urls.push({ type: 'mailto', url });
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          urls.push({ type: 'http', url });
        }
      }
    }
    return { hasUnsubscribe: urls.length > 0, urls };
  });

  // Print email
  ipcMain.handle('print:email', async () => {
    if (!win) return { success: false };
    win.webContents.print({}, (success) => {
      logDebug(`[print:email] print result: ${success}`);
    });
    return { success: true };
  });

  ipcMain.handle('print:email-pdf', async (_event, subject: string) => {
    if (!win) return { success: false };
    const safeName = (subject || 'email').replace(/[<>:"/\\|?*\r\n]/g, '_').slice(0, 100);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${safeName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { success: false };
    try {
      const pdfData = await win.webContents.printToPDF({ printBackground: true });
      fs.writeFileSync(result.filePath, pdfData);
      return { success: true, filePath: result.filePath };
    } catch (err) {
      logDebug(`[print:email-pdf] error: ${err instanceof Error ? err.message : String(err)}`);
      return { success: false, error: 'Failed to save PDF' };
    }
  });

  ipcMain.handle('folders:unread-counts', (_event, accountId: string) => {
    return db.prepare(
      'SELECT folder_id, COUNT(*) as count FROM emails WHERE account_id = ? AND is_read = 0 GROUP BY folder_id'
    ).all(accountId);
  });

  ipcMain.handle('folders:unified-unread-count', () => {
    return db.prepare(
      `SELECT COUNT(*) as count FROM emails e
       INNER JOIN folders f ON e.folder_id = f.id
       WHERE f.type = 'inbox' AND e.is_read = 0 AND (e.is_snoozed = 0 OR e.is_snoozed IS NULL)`
    ).get();
  });

  ipcMain.handle('imap:status', (_event, accountId: string) => {
    const lastSync = lastSyncTimestamps.get(accountId) ?? null;

    // 4-state status: none (no account setup), connecting (reconnecting), connected, error
    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
    if (!account) return { status: 'none', lastSync };

    if (imapEngine.isConnected(accountId)) return { status: 'connected', lastSync };
    if (imapEngine.isReconnecting(accountId)) return { status: 'connecting', lastSync };

    return { status: 'error', lastSync };
  });

  const BLOCKED_SETTINGS_GET_KEYS = new Set(['openrouter_api_key', 'mcp_auth_token']);
  ipcMain.handle('settings:get', (_event, key: string) => {
    if (BLOCKED_SETTINGS_GET_KEYS.has(key)) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });

  const ALLOWED_SETTINGS_KEYS = new Set(['theme', 'layout', 'sidebar_width', 'notifications', 'notifications_enabled', 'notifications_sound', 'locale', 'undo_send_delay', 'density_mode', 'reading_pane_zoom', 'sound_enabled', 'sound_custom_path', 'ai_compose_tone', 'mcp_enabled', 'mcp_port', 'mcp_auth_token']);
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

    const uid = extractUid(email.id);
    if (!uid || isNaN(uid)) throw new Error('Invalid email UID');

    const moved = await imapEngine.moveMessage(
      email.account_id,
      uid,
      sourceFolder.path.replace(/^\//, ''),
      archiveFolder.path.replace(/^\//, '')
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

    const uid = extractUid(email.id);
    if (!uid || isNaN(uid)) throw new Error('Invalid email UID');

    const moved = await imapEngine.moveMessage(
      email.account_id,
      uid,
      sourceFolder.path.replace(/^\//, ''),
      destFolder.path.replace(/^\//, '')
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

  ipcMain.handle('contacts:upsert', (_event: Electron.IpcMainInvokeEvent, params: { email: string; name?: string; company?: string; phone?: string; title?: string; notes?: string }) => {
    if (!params?.email) throw new Error('Email is required');
    const emailAddr = params.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr)) throw new Error('Invalid email format');
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO contacts (id, email, name, company, phone, title, notes) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name = COALESCE(excluded.name, contacts.name),
         company = COALESCE(excluded.company, contacts.company),
         phone = COALESCE(excluded.phone, contacts.phone),
         title = COALESCE(excluded.title, contacts.title),
         notes = COALESCE(excluded.notes, contacts.notes)`
    ).run(id, emailAddr, params.name?.trim() ?? null, params.company?.trim() ?? null, params.phone?.trim() ?? null, params.title?.trim() ?? null, params.notes?.trim() ?? null);
    return { success: true };
  });

  ipcMain.handle('contacts:update', (_event: Electron.IpcMainInvokeEvent, params: { id: string; name?: string; company?: string; phone?: string; title?: string; notes?: string }) => {
    if (!params?.id) throw new Error('Contact ID required');
    const fields: string[] = [];
    const values: (string | null)[] = [];
    for (const key of ['name', 'company', 'phone', 'title', 'notes'] as const) {
        if (params[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(params[key]?.trim() ?? null);
        }
    }
    if (fields.length === 0) return;
    values.push(params.id);
    db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
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

    const uid = extractUid(params.emailId);
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

      const uid = extractUid(params.emailId);
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

  // --- Phase 8: AI compose + analytics ---

  ipcMain.handle('ai:suggest-reply', async (_event, params: {
    emailId: string;
    accountId: string;
    tone?: string;
  }) => {
    if (!params?.emailId || typeof params.emailId !== 'string') {
      return { error: 'Invalid email ID' };
    }
    if (!params?.accountId || typeof params.accountId !== 'string') {
      return { error: 'Invalid account ID' };
    }

    const VALID_TONES = new Set(['professional', 'casual', 'friendly', 'formal', 'concise']);
    const tone = (typeof params.tone === 'string' && VALID_TONES.has(params.tone))
      ? params.tone as 'professional' | 'casual' | 'friendly' | 'formal' | 'concise'
      : 'professional';

    // Cross-account ownership check
    const email = db.prepare(`
      SELECT id, account_id, thread_id, subject, from_name, from_email,
             to_email, date, body_text, snippet
      FROM emails WHERE id = ?
    `).get(params.emailId) as Record<string, unknown> | undefined;
    if (!email) return { error: 'Email not found' };
    if (email.account_id !== params.accountId) return { error: 'Access denied' };

    // Get decrypted API key
    const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'openrouter_api_key'").get() as { value: string } | undefined;
    if (!keyRow?.value) return { error: 'OpenRouter API key not configured. Add it in Settings > AI / API Keys.' };
    let apiKey: string;
    try {
      apiKey = decryptData(Buffer.from(keyRow.value, 'base64'));
    } catch {
      return { error: 'Failed to decrypt API key' };
    }
    if (!apiKey) return { error: 'OpenRouter API key is empty' };

    // Thread context (last 3 messages)
    let threadContext: Array<{ fromName: string | null; fromEmail: string | null; bodyText: string | null }> = [];
    if (email.thread_id) {
      const threadEmails = db.prepare(`
        SELECT from_name, from_email, body_text, snippet
        FROM emails WHERE thread_id = ? AND account_id = ?
        ORDER BY date ASC
      `).all(email.thread_id as string, params.accountId) as Array<Record<string, unknown>>;
      threadContext = threadEmails.slice(-3).map(te => ({
        fromName: te.from_name as string | null,
        fromEmail: te.from_email as string | null,
        bodyText: typeof te.body_text === 'string' ? te.body_text.slice(0, 500) : (te.snippet as string | null),
      }));
    }

    // Sender history (last 3)
    const senderHistory = db.prepare(`
      SELECT subject, snippet
      FROM emails WHERE account_id = ? AND from_email = ?
      ORDER BY date DESC LIMIT 3
    `).all(params.accountId, email.from_email) as Array<{ subject: string | null; snippet: string | null }>;

    // Account info
    const account = db.prepare(
      'SELECT email, display_name FROM accounts WHERE id = ?'
    ).get(params.accountId) as { email: string; display_name: string | null } | undefined;
    if (!account) return { error: 'Account not found' };

    try {
      const { generateReply } = await import('./openRouterClient.js');
      const html = await generateReply({
        apiKey,
        emailSubject: (email.subject as string | null) ?? '',
        emailBody: typeof email.body_text === 'string'
          ? email.body_text.slice(0, 2000)
          : (email.snippet as string | null) ?? '',
        fromName: email.from_name as string | null,
        fromEmail: email.from_email as string | null,
        senderHistory,
        threadContext,
        tone,
        accountEmail: account.email,
        accountDisplayName: account.display_name,
      });
      return { html };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDebug(`[ai:suggest-reply] error: ${msg.replace(/[\r\n\0]/g, ' ').slice(0, 500)}`);
      return { error: `AI generation failed: ${msg.slice(0, 200)}` };
    }
  });

  ipcMain.handle('analytics:busiest-hours', (_event, accountId: string) => {
    if (!accountId || typeof accountId !== 'string') return [];
    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
    if (!account) return [];

    const since = new Date();
    since.setDate(since.getDate() - 30);

    return db.prepare(`
      SELECT CAST(strftime('%H', date, 'localtime') AS INTEGER) as hour, COUNT(*) as count
      FROM emails WHERE account_id = ? AND date >= ?
      GROUP BY hour ORDER BY count DESC LIMIT 3
    `).all(accountId, since.toISOString()) as Array<{ hour: number; count: number }>;
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

  // --- Reply templates handlers ---
  ipcMain.handle('templates:list', () => {
    return db.prepare('SELECT id, name, body_html, sort_order, created_at FROM reply_templates ORDER BY sort_order ASC, created_at DESC').all();
  });

  ipcMain.handle('templates:create', (_event, params: { name: string; body_html: string }) => {
    if (!params?.name?.trim()) throw new Error('Template name is required');
    if (!params?.body_html?.trim()) throw new Error('Template body is required');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO reply_templates (id, name, body_html) VALUES (?, ?, ?)').run(id, params.name.trim(), params.body_html.slice(0, 10_000));
    return { id };
  });

  ipcMain.handle('templates:update', (_event, params: { id: string; name: string; body_html: string }) => {
    if (!params?.id) throw new Error('Template ID is required');
    if (!params?.name?.trim()) throw new Error('Template name is required');
    db.prepare('UPDATE reply_templates SET name = ?, body_html = ? WHERE id = ?').run(params.name.trim(), params.body_html.slice(0, 10_000), params.id);
    return { success: true };
  });

  ipcMain.handle('templates:delete', (_event, templateId: string) => {
    db.prepare('DELETE FROM reply_templates WHERE id = ?').run(templateId);
    return { success: true };
  });

  // --- Renderer error logging handler ---
  ipcMain.handle('log:error', (_event, message: string) => {
    const safe = typeof message === 'string'
      ? `[RENDERER] ${message.replace(/[\r\n\0]/g, ' ').slice(0, 4000)}`
      : '[RENDERER] [invalid log message]';
    logDebug(safe);
    return { success: true };
  });

  // --- MCP connection status handler ---
  ipcMain.handle('mcp:connected-count', () => {
    return { count: getMcpServer().getConnectedCount() };
  });

  // --- MCP management handlers ---

  ipcMain.handle('mcp:get-status', () => {
    const mcp = getMcpServer();
    return {
      running: mcp.isRunning(),
      port: mcp.getPort(),
      connectedCount: mcp.getConnectedCount(),
    };
  });

  ipcMain.handle('mcp:get-token', () => {
    return { token: getMcpServer().getAuthToken() };
  });

  ipcMain.handle('mcp:regenerate-token', async () => {
    const newToken = crypto.randomBytes(32).toString('hex');
    const mcp = getMcpServer();
    const port = mcp.getPort();

    // Persist new token (encrypted)
    const encrypted = encryptData(newToken).toString('base64');
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('mcp_auth_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(encrypted);

    // Restart server with new token (disconnects all agents)
    await restartMcpServer({ port, authToken: newToken });

    return { token: newToken };
  });

  ipcMain.handle('mcp:set-port', async (_event: Electron.IpcMainInvokeEvent, port: number) => {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Port must be an integer between 1024 and 65535');
    }

    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('mcp_port', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(String(port));

    const token = getMcpServer().getAuthToken();
    await restartMcpServer({ port, authToken: token });

    return { success: true, port };
  });

  ipcMain.handle('mcp:toggle', async (_event: Electron.IpcMainInvokeEvent, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');

    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('mcp_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(enabled ? 'true' : 'false');

    const mcp = getMcpServer();
    if (enabled && !mcp.isRunning()) {
      mcp.start();
    } else if (!enabled && mcp.isRunning()) {
      await mcp.stop();
    }

    return { success: true, running: mcp.isRunning() };
  });

  ipcMain.handle('mcp:get-tools', () => {
    return { tools: getMcpServer().getToolList() };
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

  ipcMain.handle('folders:set-color', (_event, folderId: string, color: string | null) => {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');
    if (color !== null && (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))) {
      throw new Error('Invalid color format');
    }
    db.prepare('UPDATE folders SET color = ? WHERE id = ?').run(color, folderId);
    return { success: true };
  });

  // Phase 7: Tags
  ipcMain.handle('tags:list', (_event, accountId: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    return db.prepare('SELECT id, account_id, name, color, created_at FROM tags WHERE account_id = ? ORDER BY name').all(accountId);
  });

  ipcMain.handle('tags:create', (_event, accountId: string, name: string, color: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    if (!name || typeof name !== 'string' || name.trim().length === 0) throw new Error('Tag name required');
    if (!color || typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid color');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO tags (id, account_id, name, color) VALUES (?, ?, ?, ?)').run(id, accountId, name.trim().slice(0, 50), color);
    return { id, account_id: accountId, name: name.trim(), color };
  });

  ipcMain.handle('tags:update', (_event, tagId: string, accountId: string, name: string, color: string) => {
    if (!tagId || typeof tagId !== 'string') throw new Error('Invalid tag ID');
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'Invalid color format' };
    const tag = db.prepare('SELECT id FROM tags WHERE id = ? AND account_id = ?').get(tagId, accountId);
    if (!tag) throw new Error('Tag not found');
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ? AND account_id = ?').run(name.trim().slice(0, 50), color, tagId, accountId);
    return { success: true };
  });

  ipcMain.handle('tags:delete', (_event, tagId: string, accountId: string) => {
    if (!tagId || typeof tagId !== 'string') throw new Error('Invalid tag ID');
    const tag = db.prepare('SELECT id FROM tags WHERE id = ? AND account_id = ?').get(tagId, accountId);
    if (!tag) throw new Error('Tag not found');
    db.prepare('DELETE FROM tags WHERE id = ? AND account_id = ?').run(tagId, accountId);
    return { success: true };
  });

  ipcMain.handle('tags:assign', (_event, emailId: string, tagId: string) => {
    if (!emailId || !tagId) throw new Error('Email ID and tag ID required');
    const email = db.prepare('SELECT account_id FROM emails WHERE id = ?').get(emailId) as { account_id: string } | undefined;
    if (!email) throw new Error('Email not found');
    const tagRow = db.prepare('SELECT account_id FROM tags WHERE id = ?').get(tagId) as { account_id: string } | undefined;
    if (!tagRow) throw new Error('Tag not found');
    if (email.account_id !== tagRow.account_id) throw new Error('Access denied: tag and email belong to different accounts');
    db.prepare('INSERT OR IGNORE INTO email_tags (email_id, tag_id) VALUES (?, ?)').run(emailId, tagId);
    return { success: true };
  });

  ipcMain.handle('tags:remove', (_event, emailId: string, tagId: string) => {
    if (!emailId || !tagId) throw new Error('Email ID and tag ID required');
    db.prepare('DELETE FROM email_tags WHERE email_id = ? AND tag_id = ?').run(emailId, tagId);
    return { success: true };
  });

  ipcMain.handle('tags:emails', (_event, tagId: string) => {
    if (!tagId || typeof tagId !== 'string') throw new Error('Invalid tag ID');
    return db.prepare(
      `SELECT e.id, e.thread_id, e.subject, e.from_name, e.from_email, e.to_email,
              e.date, e.snippet, e.is_read, e.is_flagged, e.has_attachments,
              e.ai_category, e.ai_priority, e.ai_labels
       FROM emails e
       INNER JOIN email_tags et ON et.email_id = e.id
       WHERE et.tag_id = ?
       ORDER BY e.date DESC LIMIT 50`
    ).all(tagId);
  });

  ipcMain.handle('emails:tags', (_event, emailId: string) => {
    if (!emailId || typeof emailId !== 'string') throw new Error('Invalid email ID');
    return db.prepare(
      `SELECT t.id, t.name, t.color FROM tags t
       INNER JOIN email_tags et ON et.tag_id = t.id
       WHERE et.email_id = ?
       ORDER BY t.name`
    ).all(emailId);
  });

  // Phase 7: Saved searches
  ipcMain.handle('searches:list', (_event, accountId: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    return db.prepare('SELECT id, account_id, name, query, icon, created_at FROM saved_searches WHERE account_id = ? ORDER BY name').all(accountId);
  });

  ipcMain.handle('searches:create', (_event, accountId: string, name: string, query: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    if (!name || typeof name !== 'string' || name.trim().length === 0) throw new Error('Search name required');
    if (!query || typeof query !== 'string' || query.trim().length === 0) throw new Error('Search query required');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO saved_searches (id, account_id, name, query) VALUES (?, ?, ?, ?)').run(id, accountId, name.trim().slice(0, 100), query.trim().slice(0, 200));
    return { id, account_id: accountId, name: name.trim(), query: query.trim(), icon: 'search' };
  });

  ipcMain.handle('searches:delete', (_event, searchId: string, accountId: string) => {
    if (!searchId || typeof searchId !== 'string') throw new Error('Invalid search ID');
    const search = db.prepare('SELECT id FROM saved_searches WHERE id = ? AND account_id = ?').get(searchId, accountId);
    if (!search) throw new Error('Search not found');
    db.prepare('DELETE FROM saved_searches WHERE id = ? AND account_id = ?').run(searchId, accountId);
    return { success: true };
  });

  ipcMain.handle('searches:run', (_event, searchId: string, accountId: string) => {
    if (!searchId || typeof searchId !== 'string') throw new Error('Invalid search ID');
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    const search = db.prepare('SELECT query FROM saved_searches WHERE id = ? AND account_id = ?').get(searchId, accountId) as { query: string } | undefined;
    if (!search) return [];
    const sanitized = sanitizeFts5Query(search.query);
    if (!sanitized) return [];
    return db.prepare(
      `SELECT e.id, e.thread_id, e.subject, e.from_name, e.from_email, e.to_email,
              e.date, e.snippet, e.is_read, e.is_flagged, e.has_attachments,
              e.ai_category, e.ai_priority, e.ai_labels
       FROM emails e
       INNER JOIN emails_fts ON emails_fts.rowid = e.rowid
       WHERE emails_fts MATCH ? AND e.account_id = ?
       ORDER BY e.date DESC LIMIT 50`
    ).all(sanitized, accountId);
  });

  // Data Portability: Email Export/Import
  ipcMain.handle('export:eml', async (_event, emailId: string) => {
    if (!emailId || typeof emailId !== 'string') throw new Error('Invalid email ID');
    const emailRow = db.prepare('SELECT account_id FROM emails WHERE id = ?').get(emailId) as { account_id: string } | undefined;
    if (!emailRow) return { success: false, error: 'Email not found' };
    return exportEml(emailId, emailRow.account_id);
  });

  ipcMain.handle('export:mbox', async (_event, folderId: string) => {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');
    const folderRow = db.prepare('SELECT account_id FROM folders WHERE id = ?').get(folderId) as { account_id: string } | undefined;
    if (!folderRow) return { success: false, error: 'Folder not found' };
    return exportMbox(folderId, folderRow.account_id);
  });

  ipcMain.handle('import:eml', async (_event, folderId: string) => {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');
    return importEml(folderId);
  });

  ipcMain.handle('import:mbox', async (_event, folderId: string) => {
    if (!folderId || typeof folderId !== 'string') throw new Error('Invalid folder ID');
    return importMbox(folderId);
  });

  // Data Portability: Contact Export/Import
  ipcMain.handle('contacts:list', () => {
    return db
      .prepare('SELECT id, email, name, avatar_url, company, phone, title, notes FROM contacts ORDER BY name, email LIMIT 5000')
      .all();
  });

  ipcMain.handle('contacts:export-vcard', async () => {
    return exportVcard();
  });

  ipcMain.handle('contacts:export-csv', async () => {
    return exportCsv();
  });

  ipcMain.handle('contacts:import-vcard', async () => {
    return importVcard();
  });

  ipcMain.handle('contacts:import-csv', async () => {
    return importCsv();
  });

  // Phase 7 Batch 5: Spam — Bayesian classifier training and classification
  ipcMain.handle('spam:train', (_e, accountId: string, emailId: string, isSpam: boolean) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    if (!emailId   || typeof emailId   !== 'string') throw new Error('Invalid email ID');
    if (typeof isSpam !== 'boolean') throw new Error('isSpam must be a boolean');
    trainSpam(accountId, emailId, isSpam);
    return { success: true };
  });

  ipcMain.handle('spam:classify', (_e, accountId: string, emailId: string) => {
    if (!accountId || typeof accountId !== 'string') throw new Error('Invalid account ID');
    if (!emailId   || typeof emailId   !== 'string') throw new Error('Invalid email ID');
    const score = classifySpam(accountId, emailId);
    return { score };
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

  // Create window FIRST so user sees UI immediately
  logDebug('Creating main window...');
  try {
    createWindow();
    logDebug('Main window created successfully.');
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] Window creation failed: ${e.message}\n${e.stack}`);
  }

  // Wire up email:new IPC event from IMAP sync
  imapEngine.setNewEmailCallback((accountId, folderId, count) => {
    const now = Date.now();
    lastSyncTimestamps.set(accountId, now);
    if (win && !win.isDestroyed()) {
      win.webContents.send('email:new', { accountId, folderId, count });
    }
    sendSyncStatus(accountId, 'connected', now);
    if (count > 0) {
      showNotification('New Email', `${count} new message${count > 1 ? 's' : ''} received`, { accountId, folderId });
    }
  });

  // Defer non-critical services to after window creation
  try {
    const db = getDatabase();
    const mcpEnabledRow = db.prepare("SELECT value FROM settings WHERE key = 'mcp_enabled'").get() as { value: string } | undefined;
    const mcpEnabled = mcpEnabledRow?.value !== 'false'; // default true

    const mcpPortRow = db.prepare("SELECT value FROM settings WHERE key = 'mcp_port'").get() as { value: string } | undefined;
    const parsedPort = mcpPortRow ? parseInt(mcpPortRow.value, 10) : 3000;
    const mcpPort = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535 ? parsedPort : 3000;

    // Load persisted token or generate + persist a new one
    const mcpTokenRow = db.prepare("SELECT value FROM settings WHERE key = 'mcp_auth_token'").get() as { value: string } | undefined;
    let mcpAuthToken: string | undefined;
    if (mcpTokenRow) {
      try {
        mcpAuthToken = decryptData(Buffer.from(mcpTokenRow.value, 'base64'));
      } catch {
        logDebug('[MCP] Failed to decrypt persisted token, generating new one');
      }
    }
    if (!mcpAuthToken) {
      mcpAuthToken = crypto.randomBytes(32).toString('hex');
      const encrypted = encryptData(mcpAuthToken).toString('base64');
      db.prepare("INSERT INTO settings (key, value) VALUES ('mcp_auth_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(encrypted);
    }

    const mcp = getMcpServer({ port: mcpPort, authToken: mcpAuthToken });
    setMcpConnectionCallback((count: number) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('mcp:status', { connectedAgents: count });
      }
    });

    if (mcpEnabled) {
      mcp.start();
    }
  } catch (err: unknown) {
    logDebug(`[ERROR] MCP server start failed: ${err instanceof Error ? err.message : String(err)}`);
  }

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
      showNotification('Reminder', (subject ?? 'Follow up on email').slice(0, 100), { emailId, accountId });
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
  } catch (err: unknown) {
    logDebug(`[ERROR] Scheduler start failed: ${err instanceof Error ? err.message : String(err)}`);
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
    } catch (err: unknown) {
      logDebug(`[WARN] Auto-updater init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Connect saved accounts and sync folders + inbox on startup (non-blocking)
  try {
    const db = getDatabase();
    const accounts = db.prepare('SELECT id FROM accounts').all() as Array<{ id: string }>;
    for (const account of accounts) {
      sendSyncStatus(account.id, 'connecting', null);
      logDebug(`[STARTUP] Connecting IMAP for ${account.id}...`);
      imapEngine.connectAccount(account.id)
        .then(async (connected) => {
          logDebug(`[STARTUP] IMAP connect result for ${account.id}: ${connected}`);
          if (connected) {
            const folders = await imapEngine.listAndSyncFolders(account.id);
            const inbox = folders.find(f => f.type === 'inbox');
            if (inbox) {
              logDebug(`[STARTUP] Syncing inbox for ${account.id}: ${inbox.path}`);
              await imapEngine.syncNewEmails(account.id, inbox.path.replace(/^\//, ''));
              const now = Date.now();
              lastSyncTimestamps.set(account.id, now);
              sendSyncStatus(account.id, 'connected', now);
              logDebug(`[STARTUP] Sync complete for ${account.id}`);
            }
          } else {
            sendSyncStatus(account.id, 'error', null);
          }
        })
        .catch((err) => {
          logDebug(`[WARN] Startup IMAP connect failed for ${account.id}: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
          sendSyncStatus(account.id, 'error', null);
        });
    }
  } catch (err: unknown) {
    logDebug(`[ERROR] Startup IMAP sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5-second polling sync: check all connected accounts for new emails
  // and update sync timestamps. This replaces reliance on IDLE (which dies
  // after reconnect exhaustion) with a reliable periodic poll.
  // Delay first poll to let startup IMAP connect finish
  let pollSyncRunning = false;
  setInterval(async () => {
    if (pollSyncRunning) return; // skip if previous poll is still running
    pollSyncRunning = true;
    try {
      const db = getDatabase();
      const accts = db.prepare('SELECT id FROM accounts').all() as Array<{ id: string }>;
      for (const acct of accts) {
        try {
          // Skip reconnection if already connected — just sync
          if (!imapEngine.isConnected(acct.id)) {
            // Skip if currently reconnecting (startup or scheduled reconnect in progress)
            if (imapEngine.isReconnecting(acct.id)) continue;
            const connected = await imapEngine.ensureConnected(acct.id);
            if (!connected) {
              sendSyncStatus(acct.id, 'error', lastSyncTimestamps.get(acct.id) ?? null);
              continue;
            }
          }
          // Find inbox folder for this account
          const inbox = db.prepare(
            "SELECT path FROM folders WHERE account_id = ? AND type = 'inbox' LIMIT 1"
          ).get(acct.id) as { path: string } | undefined;
          if (!inbox) continue;
          const mailbox = inbox.path.replace(/^\//, '');
          await imapEngine.syncNewEmails(acct.id, mailbox);
          const now = Date.now();
          lastSyncTimestamps.set(acct.id, now);
          sendSyncStatus(acct.id, 'connected', now);

          // Body fetch for emails with missing content is handled inside
          // syncNewEmails (second pass within the same mailbox lock).
        } catch (err: unknown) {
          logDebug(`[WARN] Periodic sync error for ${acct.id}: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
        }
      }
    } finally {
      pollSyncRunning = false;
    }
  }, 15_000);
}).catch((err) => {
  logDebug(`[ERROR] app.whenReady() rejected: ${err.message}\n${err.stack}`);
});
