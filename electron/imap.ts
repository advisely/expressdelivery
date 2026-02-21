import { ImapFlow } from 'imapflow';
import { getDatabase } from './db.js';
import { decryptData } from './crypto.js';

export class ImapEngine {
    private clients: Map<string, ImapFlow> = new Map();

    /**
     * Initialize and connect an IMAP client for a specific account.
     */
    async connectAccount(accountId: string): Promise<boolean> {
        const db = getDatabase();
        // Assuming you select the account by id and it has imap_host, imap_port, etc.
        // For now we assume typical config format in the DB
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Record<string, unknown>;

        if (!account) throw new Error('Account not found');

        const password = decryptData(Buffer.from(account.password_encrypted as string, 'base64'));

        const client = new ImapFlow({
            host: account.provider === 'gmail' ? 'imap.gmail.com' : 'imap.example.com', // TBD per provider
            port: 993,
            secure: true,
            auth: {
                user: account.email as string,
                pass: password
            },
            logger: false
        });

        try {
            await client.connect();
            this.clients.set(accountId, client);

            // Start listening to the inbox
            this.startIdle(accountId, 'INBOX');
            return true;
        } catch (error) {
            console.error(`Failed to connect to IMAP for ${account.email}`, error);
            return false;
        }
    }

    /**
     * Disconnect an IMAP client.
     */
    async disconnectAccount(accountId: string) {
        const client = this.clients.get(accountId);
        if (client) {
            await client.logout();
            this.clients.delete(accountId);
        }
    }

    /**
     * Listen for new emails using IMAP IDLE on a specific mailbox.
     */
    async startIdle(accountId: string, mailbox: string) {
        const client = this.clients.get(accountId);
        if (!client) return;

        const lock = await client.getMailboxLock(mailbox);
        try {
            client.on('exists', (data) => {
                console.log(`New email exists for ${accountId}:`, data);
                // Trigger sync of new emails here mapping to the local database
                this.syncNewEmails(accountId, mailbox);
            });
            // Idle handles push notifications automatically when getMailboxLock is active
            await client.idle();
        } catch (err) {
            console.error('IDLE error', err);
        } finally {
            lock.release();
        }
    }

    async syncNewEmails(accountId: string, mailbox: string) {
        // Basic sync logic using 'imapflow'
        // This will be expanded later
        console.log(`Syncing ${mailbox} for ${accountId}...`);
    }
}

export const imapEngine = new ImapEngine();
