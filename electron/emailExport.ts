import { getDatabase } from './db.js';
import { dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import { stripCRLF } from './utils.js';

interface EmailRow {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  to_email: string | null;
  date: string | null;
  body_text: string | null;
  body_html: string | null;
  message_id: string | null;
}

function buildEmlContent(email: EmailRow): string {
  const boundary = `----=_Part_${Date.now()}`;
  const date = email.date ? new Date(email.date).toUTCString() : new Date().toUTCString();
  const safeMessageId = stripCRLF(email.message_id || `<${email.id}@expressdelivery.local>`);
  const safeFromName = stripCRLF(email.from_name ?? '');
  const safeFromEmail = stripCRLF(email.from_email ?? '');
  const safeToEmail = stripCRLF(email.to_email ?? '');
  const safeSubject = stripCRLF(email.subject ?? '');
  const from = safeFromName
    ? `"${safeFromName.replace(/"/g, '\\"')}" <${safeFromEmail}>`
    : safeFromEmail;

  let eml = '';
  eml += `From: ${from}\r\n`;
  eml += `To: ${safeToEmail}\r\n`;
  eml += `Subject: ${safeSubject}\r\n`;
  eml += `Date: ${date}\r\n`;
  eml += `Message-ID: ${safeMessageId}\r\n`;
  eml += `MIME-Version: 1.0\r\n`;

  if (email.body_html) {
    eml += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
    eml += `\r\n`;
    eml += `--${boundary}\r\n`;
    eml += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    eml += `Content-Transfer-Encoding: 8bit\r\n`;
    eml += `\r\n`;
    eml += `${email.body_text ?? ''}\r\n`;
    eml += `--${boundary}\r\n`;
    eml += `Content-Type: text/html; charset="UTF-8"\r\n`;
    eml += `Content-Transfer-Encoding: 8bit\r\n`;
    eml += `\r\n`;
    eml += `${email.body_html}\r\n`;
    eml += `--${boundary}--\r\n`;
  } else {
    eml += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    eml += `Content-Transfer-Encoding: 8bit\r\n`;
    eml += `\r\n`;
    eml += `${email.body_text ?? ''}\r\n`;
  }

  return eml;
}

function buildMboxEntry(email: EmailRow): string {
  const date = email.date ? new Date(email.date).toUTCString() : new Date().toUTCString();
  const sender = email.from_email ?? 'unknown@localhost';
  const emlContent = buildEmlContent(email);
  // Escape "From " at the start of any line (MBOX format requirement)
  const escapedLines = emlContent.split('\n').map(l => (l.startsWith('From ') ? '>' + l : l)).join('\n');
  return `From ${sender} ${date}\n${escapedLines}\n`;
}

export async function exportEml(emailId: string, accountId: string): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase();
  const email = db.prepare(
    'SELECT id, subject, from_name, from_email, to_email, date, body_text, body_html, message_id, account_id FROM emails WHERE id = ? AND account_id = ?'
  ).get(emailId, accountId) as (EmailRow & { account_id: string }) | undefined;

  if (!email) return { success: false, error: 'Email not found' };

  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: `${(email.subject ?? 'email').replace(/[^a-zA-Z0-9 ]/g, '_').slice(0, 50)}.eml`,
    filters: [{ name: 'Email Message', extensions: ['eml'] }],
  });

  if (result.canceled || !result.filePath) return { success: false };

  fs.writeFileSync(result.filePath, buildEmlContent(email), 'utf-8');
  return { success: true };
}

export async function exportMbox(folderId: string, accountId: string): Promise<{ success: boolean; count?: number; error?: string }> {
  const db = getDatabase();
  const emails = db.prepare(
    'SELECT id, subject, from_name, from_email, to_email, date, body_text, body_html, message_id FROM emails WHERE folder_id = ? AND account_id = ? ORDER BY date ASC'
  ).all(folderId, accountId) as EmailRow[];

  if (emails.length === 0) return { success: false, error: 'No emails in folder' };

  const folder = db.prepare('SELECT name FROM folders WHERE id = ?').get(folderId) as { name: string } | undefined;
  const folderName = folder?.name ?? 'emails';

  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: `${folderName.replace(/[^a-zA-Z0-9]/g, '_')}.mbox`,
    filters: [{ name: 'Mailbox', extensions: ['mbox'] }],
  });

  if (result.canceled || !result.filePath) return { success: false };

  // Write entries one at a time to avoid accumulating a large in-memory string
  fs.writeFileSync(result.filePath, '', 'utf-8');
  for (const email of emails) {
    fs.appendFileSync(result.filePath, buildMboxEntry(email), 'utf-8');
  }
  return { success: true, count: emails.length };
}
