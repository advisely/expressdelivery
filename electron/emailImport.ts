import { getDatabase } from './db.js';
import { dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * Strip the most dangerous HTML constructs before storing imported email HTML.
 * DOMPurify is not available in Node (requires DOM), so we use targeted regex
 * to remove <script> blocks and inline event handler attributes.
 * The renderer still runs DOMPurify before rendering inside the sandboxed iframe.
 */
function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
}

interface ParsedEmail {
  subject: string;
  from_name: string;
  from_email: string;
  to_email: string;
  date: string;
  body_text: string;
  body_html: string;
  message_id: string;
}

function parseEmlContent(content: string): ParsedEmail | null {
  const headerEnd = content.indexOf('\r\n\r\n');
  const splitIdx = headerEnd !== -1 ? headerEnd : content.indexOf('\n\n');
  if (splitIdx === -1) return null;

  const headerPart = content.slice(0, splitIdx);
  const bodyPart = content.slice(splitIdx + (headerEnd !== -1 ? 4 : 2));

  const getHeader = (name: string): string => {
    // Matches header value, including folded lines (lines starting with whitespace)
    const regex = new RegExp(`^${name}:\\s*(.+?)(?=\\r?\\n[^ \\t]|$)`, 'mis');
    const match = headerPart.match(regex);
    return match ? match[1].replace(/\r?\n[ \t]+/g, ' ').trim() : '';
  };

  const fromRaw = getHeader('From');
  let from_name = '';
  let from_email = fromRaw;
  const fromMatch = fromRaw.match(/^"?([^"<]*)"?\s*<([^>]+)>/);
  if (fromMatch) {
    from_name = fromMatch[1].trim();
    from_email = fromMatch[2].trim();
  }

  const subject = getHeader('Subject');
  const to_email = getHeader('To').replace(/<|>/g, '').split(',')[0].trim();
  const dateRaw = getHeader('Date');
  const date = dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString();
  const message_id = getHeader('Message-ID').replace(/[<>]/g, '');

  const contentType = getHeader('Content-Type');
  let body_text = bodyPart;
  let body_html = '';

  if (contentType.toLowerCase().includes('multipart/')) {
    const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1].slice(0, 70);
      // Escape regex special chars in the boundary
      const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = bodyPart.split(new RegExp(`--${escapedBoundary}`));
      for (const part of parts) {
        const partLower = part.toLowerCase();
        if (partLower.includes('content-type: text/plain')) {
          const pBodyIdx = part.indexOf('\n\n');
          if (pBodyIdx !== -1) body_text = part.slice(pBodyIdx + 2).trim();
        } else if (partLower.includes('content-type: text/html')) {
          const pBodyIdx = part.indexOf('\n\n');
          if (pBodyIdx !== -1) body_html = part.slice(pBodyIdx + 2).trim();
        }
      }
    }
  } else if (contentType.toLowerCase().includes('text/html')) {
    body_html = bodyPart;
    body_text = '';
  }

  return { subject, from_name, from_email, to_email, date, body_text, body_html, message_id };
}

export async function importEml(folderId: string): Promise<{ success: boolean; count?: number; error?: string }> {
  const db = getDatabase();
  const folder = db.prepare('SELECT id, account_id FROM folders WHERE id = ?').get(folderId) as
    | { id: string; account_id: string }
    | undefined;
  if (!folder) return { success: false, error: 'Folder not found' };

  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win!, {
    filters: [{ name: 'Email Message', extensions: ['eml'] }],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const insert = db.prepare(
    `INSERT INTO emails
       (id, account_id, folder_id, thread_id, message_id, subject, from_name, from_email,
        to_email, date, snippet, body_text, body_html, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  const EML_MAX_BYTES = 50 * 1024 * 1024; // 50 MB per EML file

  let count = 0;
  // Cap at 100 files per import to prevent accidental bulk imports
  for (const filePath of result.filePaths.slice(0, 100)) {
    const fileSize = fs.statSync(filePath).size;
    if (fileSize > EML_MAX_BYTES) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseEmlContent(content);
    if (!parsed) continue;

    const id = crypto.randomUUID();
    const snippet = (parsed.body_text || '').slice(0, 200);
    const safeBodyHtml = parsed.body_html ? stripDangerousHtml(parsed.body_html) : '';
    insert.run(
      id, folder.account_id, folderId, id,
      parsed.message_id || id, parsed.subject, parsed.from_name,
      parsed.from_email, parsed.to_email, parsed.date,
      snippet, parsed.body_text, safeBodyHtml
    );
    count++;
  }

  return { success: true, count };
}

export async function importMbox(folderId: string): Promise<{ success: boolean; count?: number; error?: string }> {
  const db = getDatabase();
  const folder = db.prepare('SELECT id, account_id FROM folders WHERE id = ?').get(folderId) as
    | { id: string; account_id: string }
    | undefined;
  if (!folder) return { success: false, error: 'Folder not found' };

  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win!, {
    filters: [{ name: 'Mailbox', extensions: ['mbox'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const MBOX_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
  const mboxFileSize = fs.statSync(result.filePaths[0]).size;
  if (mboxFileSize > MBOX_MAX_BYTES) {
    return { success: false, error: 'File too large (max 200 MB)' };
  }

  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  // Split MBOX on "From " lines at the start of a line
  const messages = content.split(/^From /m).filter(Boolean);

  if (messages.length > 1000) {
    return { success: false, error: 'File too large (max 1000 messages)' };
  }

  const insert = db.prepare(
    `INSERT INTO emails
       (id, account_id, folder_id, thread_id, message_id, subject, from_name, from_email,
        to_email, date, snippet, body_text, body_html, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  let count = 0;
  db.transaction(() => {
    for (const msg of messages) {
      // Each split starts with the "From <sender> <date>" line — skip it
      const firstNewline = msg.indexOf('\n');
      if (firstNewline === -1) continue;
      // Unescape ">From " lines that were escaped per MBOX convention
      const emlContent = msg.slice(firstNewline + 1).replace(/^>(From )/gm, '$1');
      const parsed = parseEmlContent(emlContent);
      if (!parsed) continue;

      const id = crypto.randomUUID();
      const snippet = (parsed.body_text || '').slice(0, 200);
      const safeBodyHtml = parsed.body_html ? stripDangerousHtml(parsed.body_html) : '';
      insert.run(
        id, folder.account_id, folderId, id,
        parsed.message_id || id, parsed.subject, parsed.from_name,
        parsed.from_email, parsed.to_email, parsed.date,
        snippet, parsed.body_text, safeBodyHtml
      );
      count++;
    }
  })();

  return { success: true, count };
}
