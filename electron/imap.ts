import { ImapFlow } from 'imapflow';
import { getDatabase } from './db.js';
import { decryptData } from './crypto.js';
import { logDebug } from './logger.js';

interface AttachmentMeta {
    partNumber: string;
    filename: string;
    mimeType: string;
    size: number;
    contentId: string | null;
}

interface BodyStructureNode {
    part?: string;
    type?: string;
    id?: string;
    disposition?: string;
    dispositionParameters?: Record<string, string>;
    parameters?: Record<string, string>;
    size?: number;
    childNodes?: BodyStructureNode[];
}

function sanitizeAttFilename(raw: string): string {
    return raw
        .replace(/[\r\n\0]/g, '')                    // strip CRLF / NUL
        .replace(/[\u202a-\u202e\u2066-\u2069]/g, '') // strip bidi overrides
        .replace(/[/\\]/g, '_')                       // strip path separators
        .slice(0, 255) || 'unnamed';
}

function stripCidBrackets(cid: string): string {
    return cid.replace(/^<|>$/g, '');
}

function extractAttachments(structure: BodyStructureNode): AttachmentMeta[] {
    const attachments: AttachmentMeta[] = [];

    function walk(node: BodyStructureNode) {
        // Inline images with Content-ID should be captured for CID resolution
        if (node.disposition?.toLowerCase() === 'inline') {
            if (node.id && node.type?.startsWith('image/') && node.part) {
                const rawName = node.dispositionParameters?.filename
                    ?? node.parameters?.name
                    ?? 'inline-image';
                attachments.push({
                    partNumber: node.part,
                    filename: sanitizeAttFilename(rawName),
                    mimeType: node.type,
                    size: node.size ?? 0,
                    contentId: stripCidBrackets(node.id),
                });
            }
            // Non-image inline nodes: still recurse into children
            if (node.childNodes) {
                for (const child of node.childNodes) {
                    walk(child);
                }
            }
            return;
        }

        if (node.disposition?.toLowerCase() === 'attachment' ||
            node.dispositionParameters?.filename) {
            if (!node.part) return;

            const rawName = node.dispositionParameters?.filename
                ?? node.parameters?.name
                ?? 'unnamed';
            attachments.push({
                partNumber: node.part,
                filename: sanitizeAttFilename(rawName),
                mimeType: node.type ?? 'application/octet-stream',
                size: node.size ?? 0,
                contentId: node.id ? stripCidBrackets(node.id) : null,
            });
        }
        if (node.childNodes) {
            for (const child of node.childNodes) {
                walk(child);
            }
        }
    }

    walk(structure);
    return attachments;
}

export class ImapEngine {
    private clients: Map<string, ImapFlow> = new Map();
    private existsHandlers: Map<string, () => void> = new Map();
    private lastSeenUid: Map<string, number> = new Map();
    private syncing: Map<string, boolean> = new Map();
    private retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private retryCounts: Map<string, number> = new Map();
    private onNewEmail: ((accountId: string, folderId: string, count: number) => void) | null = null;

    setNewEmailCallback(cb: (accountId: string, folderId: string, count: number) => void) {
        this.onNewEmail = cb;
    }

    async testConnection(params: {
        email: string;
        password: string;
        imap_host: string;
        imap_port: number;
    }): Promise<{ success: boolean; error?: string }> {
        const client = new ImapFlow({
            host: params.imap_host,
            port: params.imap_port,
            secure: params.imap_port === 993,
            auth: { user: params.email, pass: params.password },
            logger: false,
        });

        try {
            await Promise.race([
                client.connect(),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Connection timed out (10s)')), 10_000)
                ),
            ]);
            await client.logout();
            return { success: true };
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            // Strip HTML entities and control chars to prevent XSS via crafted IMAP server responses
            const message = raw.replace(/[<>"'&]/g, '').replace(/[\r\n\0]/g, ' ').slice(0, 500);
            try { await client.logout(); } catch { /* ignore */ }
            return { success: false, error: message };
        }
    }

    async connectAccount(accountId: string): Promise<boolean> {
        const db = getDatabase();
        const account = db.prepare(
            'SELECT id, email, password_encrypted, provider, imap_host, imap_port FROM accounts WHERE id = ?'
        ).get(accountId) as Record<string, unknown>;

        if (!account) throw new Error('Account not found');

        if (!account.password_encrypted) throw new Error('No password stored for account');
        const password = decryptData(Buffer.from(account.password_encrypted as string, 'base64'));

        const host = (account.imap_host as string) ||
            (account.provider === 'gmail' ? 'imap.gmail.com' : 'imap.example.com');
        const port = (account.imap_port as number) || 993;

        const client = new ImapFlow({
            host,
            port,
            secure: port === 993,
            auth: {
                user: account.email as string,
                pass: password
            },
            logger: false
        });

        try {
            await client.connect();
            this.clients.set(accountId, client);

            // Reset retry state on successful connect
            this.retryCounts.set(accountId, 0);

            // Set up reconnect on unexpected close
            client.on('close', () => {
                this.clients.delete(accountId);
                this.scheduleReconnect(accountId);
            });

            this.startIdle(accountId, 'INBOX');
            return true;
        } catch (error) {
            logDebug(`Failed to connect to IMAP for ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    async disconnectAccount(accountId: string) {
        const retryTimeout = this.retryTimeouts.get(accountId);
        if (retryTimeout) {
            clearTimeout(retryTimeout);
            this.retryTimeouts.delete(accountId);
        }
        this.retryCounts.delete(accountId);

        const client = this.clients.get(accountId);
        if (client) {
            const handler = this.existsHandlers.get(accountId);
            if (handler) {
                client.removeListener('exists', handler);
                this.existsHandlers.delete(accountId);
            }
            this.lastSeenUid.delete(accountId);
            this.syncing.delete(accountId);
            await client.logout();
            this.clients.delete(accountId);
        }
    }

    async disconnectAll() {
        const ids = [...this.clients.keys()];
        await Promise.allSettled(ids.map(id => this.disconnectAccount(id)));
    }

    async startIdle(accountId: string, mailbox: string) {
        const client = this.clients.get(accountId);
        if (!client) return;

        const oldHandler = this.existsHandlers.get(accountId);
        if (oldHandler) {
            client.removeListener('exists', oldHandler);
        }

        const handler = () => {
            this.syncNewEmails(accountId, mailbox);
        };
        this.existsHandlers.set(accountId, handler);
        client.on('exists', handler);

        try {
            await client.idle();
        } catch (err) {
            logDebug(`IDLE error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async syncNewEmails(accountId: string, mailbox: string) {
        if (this.syncing.get(accountId)) return;
        this.syncing.set(accountId, true);

        const client = this.clients.get(accountId);
        if (!client) { this.syncing.set(accountId, false); return; }

        const db = getDatabase();
        const folder = db.prepare(
            'SELECT id FROM folders WHERE account_id = ? AND path = ?'
        ).get(accountId, `/${mailbox}`) as { id: string } | undefined;
        if (!folder) { this.syncing.set(accountId, false); return; }

        const lastUid = this.lastSeenUid.get(accountId) ?? 0;
        const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';

        let insertedCount = 0;
        const lock = await client.getMailboxLock(mailbox);
        try {
            const insertStmt = db.prepare(
                `INSERT OR IGNORE INTO emails (id, account_id, folder_id, thread_id, subject,
                 from_name, from_email, to_email, date, snippet, body_text, is_read)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
            );
            const insertAttStmt = db.prepare(
                `INSERT OR IGNORE INTO attachments (id, email_id, filename, mime_type, size, part_number, content_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            const markAttStmt = db.prepare(
                'UPDATE emails SET has_attachments = 1 WHERE id = ?'
            );

            for await (const message of client.fetch(range, {
                envelope: true,
                bodyStructure: true,
                uid: true,
                bodyParts: ['1'],  // First MIME part (usually text/plain)
            })) {
                const uid = message.uid;
                if (lastUid > 0 && uid <= lastUid) continue;

                const emailId = `${accountId}_${uid}`;
                const env = message.envelope;
                if (!env) continue;

                let bodyText = '';
                if (message.bodyParts) {
                    const part = message.bodyParts.get('1');
                    if (part) {
                        bodyText = part.toString();
                    }
                }

                const result = insertStmt.run(
                    emailId, accountId, folder.id,
                    env.messageId ?? emailId,
                    env.subject ?? '(no subject)',
                    env.from?.[0]?.name ?? '',
                    env.from?.[0]?.address ?? '',
                    env.to?.[0]?.address ?? '',
                    env.date?.toISOString() ?? new Date().toISOString(),
                    (env.subject ?? '').slice(0, 100),
                    bodyText,
                );

                if (result.changes > 0) {
                    insertedCount++;

                    // Parse attachment metadata from bodyStructure
                    if (message.bodyStructure) {
                        const atts = extractAttachments(message.bodyStructure as BodyStructureNode);
                        if (atts.length > 0) {
                            markAttStmt.run(emailId);
                            for (const att of atts) {
                                const attId = `${emailId}_att_${att.partNumber}`;
                                insertAttStmt.run(attId, emailId, att.filename, att.mimeType, att.size, att.partNumber, att.contentId);
                            }
                        }
                    }
                }

                if (uid > (this.lastSeenUid.get(accountId) ?? 0)) {
                    this.lastSeenUid.set(accountId, uid);
                }
            }
        } finally {
            lock.release();
            this.syncing.set(accountId, false);
        }

        if (insertedCount > 0) {
            this.onNewEmail?.(accountId, folder.id, insertedCount);
        }
    }

    async listAndSyncFolders(accountId: string): Promise<Array<{ id: string; name: string; path: string; type: string }>> {
        const client = this.clients.get(accountId);
        if (!client) throw new Error('Account not connected');

        const db = getDatabase();
        const mailboxes = await client.list();
        const folders: Array<{ id: string; name: string; path: string; type: string }> = [];

        const insertStmt = db.prepare(
            `INSERT OR IGNORE INTO folders (id, account_id, name, path, type) VALUES (?, ?, ?, ?, ?)`
        );

        for (const mailbox of mailboxes) {
            const folderId = `${accountId}_${mailbox.path}`;
            const folderPath = `/${mailbox.path}`;
            const type = this.classifyMailbox(mailbox as { specialUse?: string; path: string; name: string });

            insertStmt.run(folderId, accountId, mailbox.name, folderPath, type);
            folders.push({ id: folderId, name: mailbox.name, path: folderPath, type });
        }

        return folders;
    }

    async moveMessage(accountId: string, emailUid: number, sourceMailbox: string, destMailbox: string): Promise<boolean> {
        const client = this.clients.get(accountId);
        if (!client) throw new Error('Account not connected');

        const lock = await client.getMailboxLock(sourceMailbox);
        try {
            await client.messageMove(String(emailUid), destMailbox, { uid: true });
            return true;
        } catch {
            return false;
        } finally {
            lock.release();
        }
    }

    async downloadAttachment(
        accountId: string,
        emailUid: number,
        mailbox: string,
        partNumber: string
    ): Promise<Buffer | null> {
        const client = this.clients.get(accountId);
        if (!client) throw new Error('Account not connected');

        const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
        const lock = await client.getMailboxLock(mailbox);
        try {
            const { content } = await client.download(String(emailUid), partNumber, { uid: true });
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            for await (const chunk of content) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalBytes += buf.length;
                if (totalBytes > MAX_ATTACHMENT_BYTES) {
                    throw new Error('Attachment exceeds 25MB limit');
                }
                chunks.push(buf);
            }
            return Buffer.concat(chunks);
        } catch {
            return null;
        } finally {
            lock.release();
        }
    }

    private classifyMailbox(mailbox: { specialUse?: string; path: string; name: string }): string {
        if (mailbox.specialUse) {
            const map: Record<string, string> = {
                '\\Inbox': 'inbox',
                '\\Sent': 'sent',
                '\\Drafts': 'drafts',
                '\\Trash': 'trash',
                '\\Junk': 'junk',
                '\\Archive': 'archive',
                '\\Flagged': 'flagged',
            };
            return map[mailbox.specialUse] ?? 'other';
        }
        const lower = mailbox.path.toLowerCase();
        if (lower === 'inbox') return 'inbox';
        if (lower.includes('sent')) return 'sent';
        if (lower.includes('draft')) return 'drafts';
        if (lower.includes('trash') || lower.includes('deleted')) return 'trash';
        if (lower.includes('junk') || lower.includes('spam')) return 'junk';
        if (lower.includes('archive')) return 'archive';
        return 'other';
    }

    private scheduleReconnect(accountId: string) {
        const count = this.retryCounts.get(accountId) ?? 0;
        if (count >= 5) {
            logDebug(`IMAP reconnect failed after 5 attempts for ${accountId}`);
            this.retryCounts.delete(accountId);
            return;
        }
        const delay = Math.min(1000 * Math.pow(2, count), 30_000);
        this.retryCounts.set(accountId, count + 1);

        const timeout = setTimeout(async () => {
            this.retryTimeouts.delete(accountId);
            try {
                await this.connectAccount(accountId);
            } catch {
                // connectAccount failure will trigger another close event
            }
        }, delay);
        this.retryTimeouts.set(accountId, timeout);
    }
}

export const imapEngine = new ImapEngine();
