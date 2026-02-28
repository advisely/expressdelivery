import { getDatabase } from './db.js';
import { dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';

interface ContactRow {
  id: string;
  email: string;
  name: string | null;
}

export async function exportVcard(): Promise<{ success: boolean; count?: number }> {
  const db = getDatabase();
  const contacts = db
    .prepare('SELECT id, email, name FROM contacts ORDER BY name, email')
    .all() as ContactRow[];
  if (contacts.length === 0) return { success: false };

  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: 'contacts.vcf',
    filters: [{ name: 'vCard', extensions: ['vcf'] }],
  });

  if (result.canceled || !result.filePath) return { success: false };

  let vcf = '';
  for (const contact of contacts) {
    const displayName = (contact.name ?? contact.email).replace(/[\\;,]/g, '\\$&');
    vcf += 'BEGIN:VCARD\r\n';
    vcf += 'VERSION:3.0\r\n';
    vcf += `FN:${displayName}\r\n`;
    vcf += `EMAIL:${contact.email}\r\n`;
    vcf += 'END:VCARD\r\n';
  }

  fs.writeFileSync(result.filePath, vcf, 'utf-8');
  return { success: true, count: contacts.length };
}

export async function exportCsv(): Promise<{ success: boolean; count?: number }> {
  const db = getDatabase();
  const contacts = db
    .prepare('SELECT id, email, name FROM contacts ORDER BY name, email')
    .all() as ContactRow[];
  if (contacts.length === 0) return { success: false };

  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: 'contacts.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (result.canceled || !result.filePath) return { success: false };

  let csv = 'Name,Email\r\n';
  for (const contact of contacts) {
    const name = (contact.name ?? '').replace(/"/g, '""');
    const email = contact.email.replace(/"/g, '""');
    csv += `"${name}","${email}"\r\n`;
  }

  fs.writeFileSync(result.filePath, csv, 'utf-8');
  return { success: true, count: contacts.length };
}

export async function importVcard(): Promise<{ success: boolean; count?: number; error?: string }> {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win!, {
    filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const VCARD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  const vcardFileSize = fs.statSync(result.filePaths[0]).size;
  if (vcardFileSize > VCARD_MAX_BYTES) {
    return { success: false, error: 'File too large (max 10 MB)' };
  }

  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  const db = getDatabase();

  // Split into individual vCards; filter out empty segments
  const cards = content.split(/(?=BEGIN:VCARD)/i).filter(c => c.trim().length > 0);

  const upsert = db.prepare(
    'INSERT INTO contacts (id, email, name) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name'
  );

  let count = 0;
  // Cap at 5000 contacts per import
  for (const card of cards.slice(0, 5000)) {
    const emailMatch = card.match(/^EMAIL[^:]*:(.+)$/mi);
    if (!emailMatch) continue;
    const email = emailMatch[1].trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) continue;

    const fnMatch = card.match(/^FN:(.+)$/mi);
    // Unescape vCard escaped chars (\; \, \\)
    const name = fnMatch ? fnMatch[1].trim().replace(/\\([;,\\])/g, '$1') : '';

    const id = crypto.randomUUID();
    upsert.run(id, email, name || null);
    count++;
  }

  return { success: true, count };
}

export async function importCsv(): Promise<{ success: boolean; count?: number; error?: string }> {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win!, {
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const CSV_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  const csvFileSize = fs.statSync(result.filePaths[0]).size;
  if (csvFileSize > CSV_MAX_BYTES) {
    return { success: false, error: 'File too large (max 10 MB)' };
  }

  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  const db = getDatabase();

  // Skip header row if it contains "name" or "email" (case-insensitive)
  const firstLine = lines[0].toLowerCase();
  const startIdx = firstLine.includes('name') || firstLine.includes('email') ? 1 : 0;

  const upsert = db.prepare(
    'INSERT INTO contacts (id, email, name) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name'
  );

  let count = 0;
  // Cap at 5000 rows per import
  for (const line of lines.slice(startIdx, 5001)) {
    const fields = parseCsvLine(line);

    // Find the field containing an email address (has '@')
    const emailField = fields.find(f => f.includes('@'));
    if (!emailField) continue;
    const email = emailField.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) continue;

    // Name is any other non-empty field
    const nameField = fields.find(f => f !== emailField) ?? '';
    const id = crypto.randomUUID();
    upsert.run(id, email, nameField.trim() || null);
    count++;
  }

  return { success: true, count };
}

/** Minimal single-line CSV parser that handles double-quote escaping. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped double-quote ("")
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === ',' || ch === ';') && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
