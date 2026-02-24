import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

// --- INITIALIZE LOGGER FIRST ---
let debugLogPath: string;
try {
  debugLogPath = path.join(app.getPath('logs'), 'debug_startup.log');
} catch {
  debugLogPath = path.join(path.dirname(app.getPath('exe')), 'debug_startup.log');
}
function logDebug(message: string) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(debugLogPath, `[${timestamp}] ${message}\n`);
  } catch {
    // Ignore if we can't write to the exe directory
  }
}

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
import { encryptData } from './crypto.js'
import { sanitizeFts5Query } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let tray: Tray | null = null

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
      'SELECT id, email, provider, display_name, imap_host, imap_port, smtp_host, smtp_port, created_at FROM accounts'
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
    smtp_host?: string; smtp_port?: number;
  }) => {
    const id = crypto.randomUUID();
    const encrypted = encryptData(account.password).toString('base64');
    db.prepare(
      `INSERT INTO accounts (id, email, provider, password_encrypted, display_name, imap_host, imap_port, smtp_host, smtp_port)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, account.email, account.provider, encrypted,
      account.display_name ?? null, account.imap_host ?? null,
      account.imap_port ?? 993, account.smtp_host ?? null, account.smtp_port ?? 465);

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
    smtp_host?: string; smtp_port?: number;
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
    return db.prepare(
      `SELECT id, thread_id, subject, from_name, from_email, to_email,
              date, snippet, is_read, is_flagged
       FROM emails WHERE folder_id = ? ORDER BY date DESC LIMIT 50`
    ).all(folderId);
  });

  ipcMain.handle('emails:read', (_event, emailId: string) => {
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(emailId);
    return db.prepare(
      `SELECT id, account_id, folder_id, thread_id, subject,
              from_name, from_email, to_email, date, snippet,
              body_text, body_html, is_read, is_flagged
       FROM emails WHERE id = ?`
    ).get(emailId);
  });

  ipcMain.handle('emails:search', (_event, query: string) => {
    const sanitized = sanitizeFts5Query(query);
    if (!sanitized) return [];
    try {
      return db.prepare(
        `SELECT e.id, e.subject, e.from_name, e.from_email, e.snippet, e.date, e.is_read, e.is_flagged
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
    const success = await smtpEngine.sendEmail(
      params.accountId, sanitizedTo, stripCRLF(params.subject), params.html,
      sanitizeList(params.cc), sanitizeList(params.bcc)
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

  ipcMain.handle('settings:get', (_event, key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });

  const ALLOWED_SETTINGS_KEYS = new Set(['theme', 'layout', 'sidebar_width', 'notifications']);
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

  // Wire up email:new IPC event from IMAP sync
  imapEngine.setNewEmailCallback((accountId, folderId, count) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('email:new', { accountId, folderId, count });
    }
  });

  logDebug('Creating main window...');
  try {
    createWindow();
    logDebug('Main window created successfully.');
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[ERROR] Window creation failed: ${e.message}\n${e.stack}`);
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
