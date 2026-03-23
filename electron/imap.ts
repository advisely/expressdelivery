import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getDatabase } from './db.js';
import { decryptData } from './crypto.js';
import { logDebug } from './logger.js';
import { applyRulesToEmail } from './ruleEngine.js';
import { parseAuthResults, getSenderVerification } from './authResults.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB limit for body content

export async function withImapTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    label: string
): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        operation().finally(() => clearTimeout(timer)),
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`IMAP timeout: ${label} (${timeoutMs}ms)`)), timeoutMs);
        }),
    ]);
}

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

export interface SyncSettings {
    inboxIntervalSec: number;
    folderIntervalSec: number;
    reconnectMaxMinutes: number;
}

export class AccountSyncController {
    readonly accountId: string;
    client: ImapFlow | null = null;
    inboxSyncTimer: ReturnType<typeof setInterval> | null = null;
    folderSyncTimer: ReturnType<typeof setInterval> | null = null;
    syncing = false;
    /** Tracks which mailboxes are currently being synced (per-folder guard). */
    syncingFolders: Set<string> = new Set();
    lastSuccessfulSync: number | null = null;
    consecutiveFailures = 0;
    heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    lastSeenUid: Map<string, number> = new Map();
    reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    reconnectAttempts = 0;
    status: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error' = 'disconnected';
    private pendingIntervalUpdate: SyncSettings | null = null;
    private settings: SyncSettings = { inboxIntervalSec: 15, folderIntervalSec: 60, reconnectMaxMinutes: 5 };
    private statusCallback: ((accountId: string, status: string, timestamp: number | null) => void) | null = null;
    /* newEmailCallback is stored here for future use by controller-driven sync.
       Currently, ImapEngine.syncNewEmails() calls the engine-level callback directly. */
    newEmailCb: ((accountId: string, folderId: string, count: number) => void) | null = null;

    constructor(accountId: string, settings?: Partial<SyncSettings>) {
        this.accountId = accountId;
        if (settings) {
            this.settings = { ...this.settings, ...settings };
        }
    }

    setStatusCallback(cb: (accountId: string, status: string, timestamp: number | null) => void): void {
        this.statusCallback = cb;
    }

    setNewEmailCallback(cb: (accountId: string, folderId: string, count: number) => void): void {
        this.newEmailCb = cb;
    }

    emitStatus(): void {
        this.statusCallback?.(this.accountId, this.status, this.lastSuccessfulSync);
    }

    stop(): void {
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        if (this.inboxSyncTimer) { clearInterval(this.inboxSyncTimer); this.inboxSyncTimer = null; }
        if (this.folderSyncTimer) { clearInterval(this.folderSyncTimer); this.folderSyncTimer = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        try { this.client?.close(); } catch { /* force close */ }
        this.client = null;
        this.status = 'disconnected';
        this.syncing = false;
        this.syncingFolders.clear();
    }

    forceDisconnect(reason: 'health' | 'user' | 'shutdown' = 'health'): void {
        if (this.status === 'disconnected') return;
        try { this.client?.close(); } catch { /* force close */ }
        this.client = null;
        this.status = 'disconnected';
        this.syncing = false;
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        if (this.inboxSyncTimer) { clearInterval(this.inboxSyncTimer); this.inboxSyncTimer = null; }
        if (this.folderSyncTimer) { clearInterval(this.folderSyncTimer); this.folderSyncTimer = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        logDebug(`[IMAP:${this.accountId}] Force disconnected (reason: ${reason})`);
        if (reason === 'health') {
            this.scheduleReconnect();
        }
    }

    scheduleReconnect(): void {
        const baseDelay = 1000 * Math.pow(2, this.reconnectAttempts);
        const maxDelay = this.settings.reconnectMaxMinutes * 60 * 1000;
        const capped = Math.min(baseDelay, maxDelay);
        const jitter = capped * (0.8 + Math.random() * 0.4); // ±20%
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            // Reconnect logic will be wired in Task 9
        }, jitter);
    }

    resetOnSuccessfulConnect(): void {
        this.reconnectAttempts = 0;
        this.consecutiveFailures = 0;
        this.lastSuccessfulSync = Date.now();
    }

    startHeartbeat(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(async () => {
            if (!this.client || this.status === 'disconnected') return;
            try {
                await withImapTimeout(() => this.client!.noop(), 5_000, 'heartbeat');
                this.lastSuccessfulSync = Date.now();
                this.consecutiveFailures = 0;
            } catch {
                logDebug(`[IMAP:${this.accountId}] heartbeat timeout`);
                this.forceDisconnect('health');
            }
        }, 120_000);
    }

    /** Queue a sync-interval change to take effect after the current sync cycle. */
    queueIntervalUpdate(settings: SyncSettings): void {
        this.pendingIntervalUpdate = settings;
    }

    /** Apply any queued interval update and return true if intervals were changed. */
    applyPendingIntervalUpdate(): boolean {
        const pending = this.pendingIntervalUpdate;
        if (!pending) return false;
        this.pendingIntervalUpdate = null;
        this.settings = { ...pending };
        this.restartSyncTimers();
        return true;
    }

    private restartSyncTimers(): void {
        if (this.inboxSyncTimer) { clearInterval(this.inboxSyncTimer); this.inboxSyncTimer = null; }
        if (this.folderSyncTimer) { clearInterval(this.folderSyncTimer); this.folderSyncTimer = null; }
        if (this.status !== 'disconnected') {
            this.startSyncTimers();
        }
    }

    updateIntervals(settings: SyncSettings): void {
        if (this.syncing) {
            this.queueIntervalUpdate(settings);
            return;
        }
        this.settings = { ...settings };
        this.restartSyncTimers();
    }

    /** Sync a single folder — wired by ImapEngine to call syncNewEmails.
     *  Can be overridden in tests. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async syncFolder(_mailbox: string): Promise<number> {
        return 0;
    }

    async runInboxSync(): Promise<boolean> {
        if (this.syncing || this.status === 'disconnected' || !this.client) return false;
        this.syncing = true;
        try {
            const db = getDatabase();
            const inboxFolder = db.prepare(
                "SELECT path FROM folders WHERE account_id = ? AND type = 'inbox'"
            ).get(this.accountId) as { path: string } | undefined;
            if (!inboxFolder) return false;
            const mailbox = inboxFolder.path.replace(/^\//, '');
            await withImapTimeout(
                () => this.syncFolder(mailbox),
                60_000,
                `syncNewEmails(${mailbox})`
            );
            this.lastSuccessfulSync = Date.now();
            this.consecutiveFailures = 0;
            this.emitStatus();
            return true;
        } catch (err) {
            this.consecutiveFailures++;
            const msg = err instanceof Error ? err.message : String(err);
            logDebug(`[IMAP:${this.accountId}] Inbox sync failed: ${msg}`);
            if (msg.startsWith('IMAP timeout:')) {
                this.forceDisconnect('health');
            }
            return false;
        } finally {
            this.syncing = false;
            this.applyPendingIntervalUpdate();
        }
    }

    async runFullSync(): Promise<void> {
        if (this.syncing || this.status === 'disconnected' || !this.client) return;
        this.syncing = true;
        try {
            const db = getDatabase();
            const allFolders = db.prepare(
                "SELECT path, type FROM folders WHERE account_id = ? ORDER BY CASE WHEN type = 'inbox' THEN 0 ELSE 1 END"
            ).all(this.accountId) as Array<{ path: string; type: string }>;
            for (const f of allFolders) {
                // Status can change to 'disconnected' during async operations (forceDisconnect)
                if ((this.status as string) === 'disconnected') break;
                const mailbox = f.path.replace(/^\//, '');
                try {
                    await withImapTimeout(
                        () => this.syncFolder(mailbox),
                        60_000,
                        `syncNewEmails(${mailbox})`
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logDebug(`[IMAP:${this.accountId}] Folder sync error ${f.path}: ${msg}`);
                    if (msg.startsWith('IMAP timeout:')) {
                        this.forceDisconnect('health');
                        return;
                    }
                }
            }
            this.lastSuccessfulSync = Date.now();
            this.consecutiveFailures = 0;
        } catch (err) {
            this.consecutiveFailures++;
            logDebug(`[IMAP:${this.accountId}] Full sync failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            this.syncing = false;
            this.applyPendingIntervalUpdate();
        }
    }

    startSyncTimers(): void {
        if (this.inboxSyncTimer) clearInterval(this.inboxSyncTimer);
        if (this.folderSyncTimer) clearInterval(this.folderSyncTimer);
        this.inboxSyncTimer = setInterval(() => { this.runInboxSync(); }, this.settings.inboxIntervalSec * 1000);
        this.folderSyncTimer = setInterval(() => { this.runFullSync(); }, this.settings.folderIntervalSec * 1000);
    }
}

export class ImapEngine {
    /** Per-account controllers — the single source of truth for connection state. */
    controllers: Map<string, AccountSyncController> = new Map();
    private newEmailCallback: ((accountId: string, folderId: string, count: number) => void) | null = null;
    private statusCallback: ((accountId: string, status: string, timestamp: number | null) => void) | null = null;

    // ─── Callback wiring ───────────────────────────────────────────────────────

    setNewEmailCallback(cb: (accountId: string, folderId: string, count: number) => void): void {
        this.newEmailCallback = cb;
        // Propagate to all existing controllers
        for (const ctrl of this.controllers.values()) {
            ctrl.setNewEmailCallback(cb);
        }
    }

    setStatusCallback(cb: (accountId: string, status: string, timestamp: number | null) => void): void {
        this.statusCallback = cb;
        for (const ctrl of this.controllers.values()) {
            ctrl.setStatusCallback(cb);
        }
    }

    // ─── Status queries ────────────────────────────────────────────────────────

    isConnected(accountId: string): boolean {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl) return false;
        if (ctrl.status !== 'connected' && ctrl.status !== 'syncing') return false;
        // Stale guard: if lastSuccessfulSync > 180s ago, treat as disconnected
        if (ctrl.lastSuccessfulSync !== null && Date.now() - ctrl.lastSuccessfulSync > 180_000) return false;
        return true;
    }

    isReconnecting(accountId: string): boolean {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl) return false;
        return ctrl.reconnectTimer !== null;
    }

    getStatus(accountId: string): { status: string; lastSync: number | null; consecutiveFailures: number; reconnectAttempts: number } {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl) return { status: 'none', lastSync: null, consecutiveFailures: 0, reconnectAttempts: 0 };
        return {
            status: ctrl.status,
            lastSync: ctrl.lastSuccessfulSync,
            consecutiveFailures: ctrl.consecutiveFailures,
            reconnectAttempts: ctrl.reconnectAttempts,
        };
    }

    updateSyncIntervals(settings: SyncSettings): void {
        for (const ctrl of this.controllers.values()) {
            ctrl.updateIntervals(settings);
        }
    }

    // ─── Controller lifecycle ──────────────────────────────────────────────────

    /** Stop and remove the controller for an account. */
    stopController(accountId: string): void {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl) return;
        ctrl.forceDisconnect('user');
        this.controllers.delete(accountId);
    }

    /** Primary entry point: create a controller, connect, sync, start timers. */
    async startAccount(accountId: string): Promise<void> {
        // Replace any existing controller for this account
        if (this.controllers.has(accountId)) {
            this.stopController(accountId);
        }
        const ctrl = new AccountSyncController(accountId);
        if (this.statusCallback) ctrl.setStatusCallback(this.statusCallback);
        if (this.newEmailCallback) ctrl.setNewEmailCallback(this.newEmailCallback);
        // Wire syncFolder so the controller delegates to the engine's syncNewEmails
        ctrl.syncFolder = (mailbox: string) => this.syncNewEmails(accountId, mailbox);
        // Wire reconnect callback so the controller can trigger a full reconnect
        ctrl.scheduleReconnect = () => {
            const baseDelay = 1000 * Math.pow(2, ctrl.reconnectAttempts);
            const maxDelay = 5 * 60 * 1000; // default 5 minutes
            const capped = Math.min(baseDelay, maxDelay);
            const jitter = capped * (0.8 + Math.random() * 0.4);
            ctrl.reconnectAttempts++;
            ctrl.reconnectTimer = setTimeout(() => {
                ctrl.reconnectTimer = null;
                this.startAccount(accountId).catch((err) => {
                    logDebug(`[IMAP:${accountId}] startAccount (reconnect) failed: ${err instanceof Error ? err.message : String(err)}`);
                });
            }, jitter);
        };
        this.controllers.set(accountId, ctrl);

        ctrl.status = 'connecting';
        ctrl.emitStatus();
        try {
            const startTime = performance.now();
            await this.connectAccountToController(ctrl);
            logDebug(`[IMAP:${accountId}] Connected in ${(performance.now() - startTime).toFixed(0)}ms`);

            // List and sync folders; inbox first, then other folders non-blocking
            const folders = await this.listAndSyncFolders(accountId);
            logDebug(`[IMAP:${accountId}] Found ${folders.length} folders`);
            const inbox = folders.find(f => f.type === 'inbox');
            if (inbox) {
                const inboxSynced = await this.syncNewEmails(accountId, inbox.path.replace(/^\//, ''));
                logDebug(`[IMAP:${accountId}] Inbox initial sync: ${inboxSynced} new emails`);
            }
            for (const folder of folders) {
                if (folder.type === 'inbox') continue;
                try {
                    await this.syncNewEmails(accountId, folder.path.replace(/^\//, ''));
                } catch { /* non-inbox sync errors are non-blocking */ }
            }

            ctrl.resetOnSuccessfulConnect();
            ctrl.status = 'connected';
            ctrl.startHeartbeat();
            ctrl.startSyncTimers();
            ctrl.emitStatus();
            logDebug(`[IMAP:${accountId}] startAccount complete — timers started (inbox: ${15}s, folders: ${60}s, heartbeat: 120s)`);
        } catch (err) {
            ctrl.status = 'error';
            ctrl.emitStatus();
            logDebug(`[IMAP:${accountId}] startAccount failed: ${err instanceof Error ? err.message : String(err)}`);
            ctrl.scheduleReconnect();
        }
    }

    /** Connect an ImapFlow client and store it on the controller. */
    private async connectAccountToController(ctrl: AccountSyncController): Promise<void> {
        const accountId = ctrl.accountId;
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
            auth: { user: account.email as string, pass: password },
            logger: false,
        });

        await client.connect();
        ctrl.client = client;

        // On unexpected close: trigger health-based reconnect via the controller
        client.on('close', () => {
            logDebug(`[IMAP:${accountId}] Connection closed — triggering health reconnect`);
            ctrl.forceDisconnect('health');
        });

        // Log IMAP errors that don't trigger 'close'
        client.on('error', (err: Error) => {
            const safe = err.message.replace(/[<>"'&]/g, '').replace(/[\r\n\0]/g, ' ').slice(0, 500);
            logDebug(`[IMAP:${accountId}] Client error: ${safe}`);
        });

        // Note: IDLE is NOT started here. The polling sync timers on the controller
        // handle new email detection. IDLE + polling conflict because both compete
        // for mailbox locks and cause "Command failed" errors.
    }

    // ─── Legacy connectAccount (used by main.ts directly) ─────────────────────

    /** Legacy connection path used by main.ts startup and account editing flows.
     *  Preserves the old boolean return contract. Prefer startAccount() for new code. */
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
            auth: { user: account.email as string, pass: password },
            logger: false,
        });

        try {
            await client.connect();

            // Upsert controller for this account
            let ctrl = this.controllers.get(accountId);
            if (!ctrl) {
                ctrl = new AccountSyncController(accountId);
                if (this.statusCallback) ctrl.setStatusCallback(this.statusCallback);
                if (this.newEmailCallback) ctrl.setNewEmailCallback(this.newEmailCallback);
                ctrl.syncFolder = (mailbox: string) => this.syncNewEmails(accountId, mailbox);
                ctrl.scheduleReconnect = () => {
                    const baseDelay = 1000 * Math.pow(2, ctrl!.reconnectAttempts);
                    const maxDelay = 5 * 60 * 1000;
                    const capped = Math.min(baseDelay, maxDelay);
                    const jitter = capped * (0.8 + Math.random() * 0.4);
                    ctrl!.reconnectAttempts++;
                    ctrl!.reconnectTimer = setTimeout(() => {
                        ctrl!.reconnectTimer = null;
                        this.connectAccount(accountId).catch((err) => {
                            logDebug(`[IMAP:${accountId}] reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
                        });
                    }, jitter);
                };
                this.controllers.set(accountId, ctrl);
            }
            ctrl.client = client;
            ctrl.status = 'connected';
            ctrl.resetOnSuccessfulConnect();

            // On unexpected close: trigger health-based reconnect via the controller
            client.on('close', () => {
                logDebug(`[IMAP:${accountId}] Connection closed — triggering health reconnect`);
                ctrl!.forceDisconnect('health');
            });

            // Log IMAP errors that don't trigger 'close'
            client.on('error', (err: Error) => {
                const safe = err.message.replace(/[<>"'&]/g, '').replace(/[\r\n\0]/g, ' ').slice(0, 500);
                logDebug(`[IMAP:${accountId}] Client error: ${safe}`);
            });

            // Note: IDLE is NOT started here.
            return true;
        } catch (error) {
            logDebug(`Failed to connect to IMAP for ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    // ─── ensureConnected ───────────────────────────────────────────────────────

    /** Ensure IMAP client is connected, attempting reconnect if needed. */
    async ensureConnected(accountId: string): Promise<boolean> {
        if (this.isConnected(accountId)) return true;
        // Cancel any pending reconnect timer so we reconnect immediately
        const ctrl = this.controllers.get(accountId);
        if (ctrl?.reconnectTimer) {
            clearTimeout(ctrl.reconnectTimer);
            ctrl.reconnectTimer = null;
        }
        try {
            return await this.connectAccount(accountId);
        } catch {
            return false;
        }
    }

    // ─── disconnectAccount / disconnectAll ─────────────────────────────────────

    async disconnectAccount(accountId: string): Promise<void> {
        const ctrl = this.controllers.get(accountId);
        if (ctrl) {
            try { await ctrl.client?.logout(); } catch { /* best effort */ }
            ctrl.stop();
        }
        this.controllers.delete(accountId);
    }

    async disconnectAll(): Promise<void> {
        const ids = [...this.controllers.keys()];
        await Promise.allSettled(ids.map(id => this.disconnectAccount(id)));
    }

    // ─── testConnection (standalone — does not use controllers) ───────────────

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

    // ─── startIdle (not actively used — preserved for future IDLE support) ─────

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async startIdle(accountId: string, _mailbox: string): Promise<void> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return;

        try {
            await client.idle();
        } catch (err) {
            logDebug(`IDLE error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // ─── syncNewEmails ─────────────────────────────────────────────────────────

    async syncNewEmails(accountId: string, mailbox: string): Promise<number> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;

        // Per-folder syncing guard: one active sync per mailbox per account.
        // Uses controller.syncingFolders (Set<string>) rather than the old global Map.
        const syncKey = mailbox;
        if (!ctrl) return 0;
        if (ctrl.syncingFolders.has(syncKey)) return 0;
        ctrl.syncingFolders.add(syncKey);

        let insertedCount = 0;
        try {
        if (!client) return 0;

        const db = getDatabase();
        const folder = db.prepare(
            'SELECT id, type FROM folders WHERE account_id = ? AND path = ?'
        ).get(accountId, `/${mailbox}`) as { id: string; type: string | null } | undefined;
        if (!folder) return 0;
        const isInbox = folder.type === 'inbox';

        const lastUid = ctrl.lastSeenUid.get(mailbox) ?? 0;
        const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            const insertStmt = db.prepare(
                `INSERT OR IGNORE INTO emails (id, account_id, folder_id, thread_id, message_id, subject,
                 from_name, from_email, to_email, date, snippet, body_text, body_html, is_read, list_unsubscribe,
                 auth_spf, auth_dkim, auth_dmarc, sender_verified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
            );
            const insertAttStmt = db.prepare(
                `INSERT OR IGNORE INTO attachments (id, email_id, filename, mime_type, size, part_number, content_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            const markAttStmt = db.prepare(
                'UPDATE emails SET has_attachments = 1 WHERE id = ?'
            );
            const updateBodyStmt = db.prepare(
                `UPDATE emails SET body_text = ?, body_html = ?
                 WHERE id = ? AND (body_html IS NULL OR body_html = '')`
            );

            // Fetch envelope + bodyStructure + full message source in ONE command.
            // Individual UID FETCH commands fail on some servers (e.g. privateemail.com)
            // with "Invalid messageset", so we must get everything in the batch fetch.
            // source maxLength caps download to 2MB per message to avoid OOM on huge emails.
            // IMAPFlow throws "Command failed" if the UID range has no matches.
            try { for await (const message of client.fetch(range, {
                envelope: true,
                bodyStructure: true,
                source: { maxLength: MAX_BODY_BYTES },
                uid: true,
            })) {
                const uid = message.uid;
                if (lastUid > 0 && uid <= lastUid) continue;

                // IMAP UIDs are per-mailbox; include folder ID for non-INBOX to avoid collisions.
                // INBOX keeps legacy format (${accountId}_${uid}) for backward compatibility.
                const emailId = isInbox ? `${accountId}_${uid}` : `${folder.id}_${uid}`;
                const env = message.envelope;
                if (!env) continue;

                // Parse body from raw RFC822 source using mailparser
                let bodyText = '';
                let bodyHtml: string | null = null;
                let listUnsubscribe: string | null = null;
                let authResultsHeader: string | null = null;
                if (message.source && message.source.length > 0) {
                    try {
                        const parsed = await simpleParser(message.source, {
                            skipHtmlToText: true,
                            skipTextToHtml: true,
                            skipImageLinks: true,
                        });
                        bodyText = parsed.text ?? '';
                        bodyHtml = typeof parsed.html === 'string' ? parsed.html : null;
                        const listUnsubVal = parsed.headers?.get('list-unsubscribe');
                        if (typeof listUnsubVal === 'string' && listUnsubVal.trim()) {
                            listUnsubscribe = listUnsubVal.slice(0, 500);
                        }
                        // Extract Authentication-Results header for SPF/DKIM/DMARC
                        const authVal = parsed.headers?.get('authentication-results');
                        if (typeof authVal === 'string' && authVal.trim()) {
                            authResultsHeader = authVal.slice(0, 2000);
                        }
                    } catch (parseErr) {
                        logDebug(`[syncNewEmails] mailparser error for ${emailId}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
                    }
                }

                // Compute thread_id: inherit from parent via In-Reply-To, otherwise use own messageId
                const messageId = env.messageId ?? emailId;
                let threadId = messageId;
                if (env.inReplyTo) {
                    const parent = db.prepare(
                        'SELECT thread_id FROM emails WHERE message_id = ?'
                    ).get(env.inReplyTo) as { thread_id: string } | undefined;
                    if (parent?.thread_id) threadId = parent.thread_id;
                }

                // Parse authentication results
                const authResults = parseAuthResults(authResultsHeader);
                const senderVerified = getSenderVerification(authResults);

                const result = insertStmt.run(
                    emailId, accountId, folder.id,
                    threadId, messageId,
                    env.subject ?? '(no subject)',
                    env.from?.[0]?.name ?? '',
                    env.from?.[0]?.address ?? '',
                    env.to?.[0]?.address ?? '',
                    env.date?.toISOString() ?? new Date().toISOString(),
                    (bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 150),
                    bodyText,
                    bodyHtml,
                    listUnsubscribe,
                    authResults.spf,
                    authResults.dkim,
                    authResults.dmarc,
                    senderVerified,
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

                    // Apply mail rules to newly inserted email
                    applyRulesToEmail(emailId, accountId);

                    // Auto-spam classification: score the email and update spam_score
                    try {
                        const { classifyEmail } = await import('./spamFilter.js');
                        const spamScore = classifyEmail(accountId, `${env.subject ?? ''} ${bodyText}`);
                        if (spamScore !== null) {
                            db.prepare('UPDATE emails SET spam_score = ? WHERE id = ?').run(spamScore, emailId);
                        }
                    } catch { /* spam classifier not trained yet — skip */ }
                } else if (bodyText || bodyHtml) {
                    // Row already exists but may have empty body from a previous sync
                    // that didn't fetch source. Backfill the body content.
                    updateBodyStmt.run(bodyText, bodyHtml, emailId);
                }

                if (uid > (ctrl.lastSeenUid.get(mailbox) ?? 0)) {
                    ctrl.lastSeenUid.set(mailbox, uid);
                }
            }
            } catch (fetchErr) {
                // "Command failed" is normal when there are no new messages
                // (UID range beyond existing messages). Only log non-standard errors.
                const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                if (msg !== 'Command failed') {
                    logDebug(`[syncNewEmails] fetch error for ${accountId}: ${msg}`);
                }
            }
        } finally {
            lock.release();
        }

        if (insertedCount > 0) {
            this.newEmailCallback?.(accountId, folder.id, insertedCount);
        }
        } finally {
            ctrl.syncingFolders.delete(syncKey);
        }
        return insertedCount;
    }

    // ─── listAndSyncFolders ────────────────────────────────────────────────────

    async listAndSyncFolders(accountId: string): Promise<Array<{ id: string; name: string; path: string; type: string }>> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) throw new Error('Account not connected');

        const db = getDatabase();
        const mailboxes = await withImapTimeout(
            () => client.list(),
            15_000,
            'client.list()'
        );
        const folders: Array<{ id: string; name: string; path: string; type: string }> = [];

        const insertStmt = db.prepare(
            `INSERT OR IGNORE INTO folders (id, account_id, name, path, type, sort_order)
             VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders WHERE account_id = ?))`
        );

        db.transaction(() => {
            for (const mailbox of mailboxes) {
                const folderId = `${accountId}_${mailbox.path}`;
                const folderPath = `/${mailbox.path}`;
                const type = this.classifyMailbox(mailbox as { specialUse?: string; path: string; name: string });

                insertStmt.run(folderId, accountId, mailbox.name, folderPath, type, accountId);
                folders.push({ id: folderId, name: mailbox.name, path: folderPath, type });
            }
        })();

        return folders;
    }

    // ─── IMAP operations ───────────────────────────────────────────────────────

    async moveMessage(accountId: string, emailUid: number, sourceMailbox: string, destMailbox: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) throw new Error('Account not connected');

        const lock = await withImapTimeout(
            () => client.getMailboxLock(sourceMailbox),
            10_000,
            `getMailboxLock(${sourceMailbox})`
        );
        try {
            await client.messageMove(String(emailUid), destMailbox, { uid: true });
            return true;
        } catch (err) {
            logDebug(`[IMAP] moveMessage error (uid=${emailUid}, ${sourceMailbox} → ${destMailbox}): ${err instanceof Error ? err.message : String(err)}`);
            return false;
        } finally {
            lock.release();
        }
    }

    async appendToSent(accountId: string, rawMessage: Buffer | string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;

        const db = getDatabase();
        const sentFolder = db.prepare(
            "SELECT path FROM folders WHERE account_id = ? AND type = 'sent' LIMIT 1"
        ).get(accountId) as { path: string } | undefined;
        if (!sentFolder) return false;

        const mailbox = sentFolder.path.replace(/^\//, '');
        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            await client.append(mailbox, rawMessage, ['\\Seen']);
            return true;
        } catch (err) {
            logDebug(`[appendToSent] Failed for ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
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
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) throw new Error('Account not connected');

        const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
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

    async markAsRead(accountId: string, emailUid: number, mailbox: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            await client.messageFlagsAdd(String(emailUid), ['\\Seen'], { uid: true });
            return true;
        } catch {
            return false;
        } finally {
            lock.release();
        }
    }

    async markAsUnread(accountId: string, emailUid: number, mailbox: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            await client.messageFlagsRemove(String(emailUid), ['\\Seen'], { uid: true });
            return true;
        } catch {
            return false;
        } finally {
            lock.release();
        }
    }

    async deleteMessage(accountId: string, emailUid: number, mailbox: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            await client.messageFlagsAdd(String(emailUid), ['\\Deleted'], { uid: true });
            await client.messageDelete(String(emailUid), { uid: true });
            return true;
        } catch {
            return false;
        } finally {
            lock.release();
        }
    }

    /** Re-fetch body for a single email (for repairing garbled charset decoding) */
    async refetchEmailBody(
        accountId: string,
        emailUid: number,
        mailbox: string
    ): Promise<{ bodyText: string; bodyHtml: string | null } | null> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return null;

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            // Use range format "uid:uid" and fetch full source — some IMAP servers
            // (e.g. privateemail.com) reject single-UID FETCH but accept ranges.
            // Parse the RFC822 source with mailparser for charset-aware body extraction.
            const uidRange = `${emailUid}:${emailUid}`;
            let source: Buffer | null = null;
            for await (const message of client.fetch(uidRange, {
                source: { maxLength: MAX_BODY_BYTES },
                uid: true,
            })) {
                if (message.source && message.source.length > 0) {
                    source = message.source;
                }
            }

            if (!source) return null;

            const parsed = await simpleParser(source, {
                skipHtmlToText: true,
                skipTextToHtml: true,
                skipImageLinks: true,
            });

            const bodyText = parsed.text ?? '';
            const bodyHtml = typeof parsed.html === 'string' ? parsed.html : null;

            if (!bodyText && !bodyHtml) return null;
            return { bodyText, bodyHtml };
        } catch (err) {
            logDebug(`[refetchEmailBody] error for uid=${emailUid}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        } finally {
            lock.release();
        }
    }

    async fetchRawSource(accountId: string, uid: number): Promise<string> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) throw new Error('Not connected');

        const db = getDatabase();
        // Look up the folder for this specific email's UID so we can lock the right mailbox
        const emailRow = db.prepare(
            'SELECT folder_id FROM emails WHERE id = ?'
        ).get(`${accountId}_${uid}`) as { folder_id: string } | undefined;

        let mailboxPath: string;
        if (emailRow?.folder_id) {
            const folderRow = db.prepare(
                'SELECT path FROM folders WHERE id = ?'
            ).get(emailRow.folder_id) as { path: string } | undefined;
            mailboxPath = folderRow?.path?.replace(/^\//, '') || 'INBOX';
        } else {
            // Fallback: find inbox for this account
            const inboxRow = db.prepare(
                "SELECT path FROM folders WHERE account_id = ? AND type = 'inbox'"
            ).get(accountId) as { path: string } | undefined;
            mailboxPath = inboxRow?.path?.replace(/^\//, '') || 'INBOX';
        }

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailboxPath),
            10_000,
            `getMailboxLock(${mailboxPath})`
        );
        try {
            let raw = '';
            for await (const msg of client.fetch(String(uid), { source: true, uid: true })) {
                if (msg.source) {
                    const MAX_RAW_BYTES = 512 * 1024;
                    const capped = msg.source.slice(0, MAX_RAW_BYTES);
                    raw = capped.toString('utf-8');
                    if (msg.source.length > MAX_RAW_BYTES) {
                        raw += '\n\n[Source truncated — showing first 512 KB]';
                    }
                }
            }
            return raw;
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

    async createMailbox(accountId: string, path: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;
        try {
            await client.mailboxCreate(path);
            return true;
        } catch (err) {
            logDebug(`[createMailbox] error: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    async renameMailbox(accountId: string, oldPath: string, newPath: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;
        try {
            await client.mailboxRename(oldPath, newPath);
            return true;
        } catch (err) {
            logDebug(`[renameMailbox] error: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    async deleteMailbox(accountId: string, path: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;
        try {
            await client.mailboxDelete(path);
            return true;
        } catch (err) {
            logDebug(`[deleteMailbox] error: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    async markAllRead(accountId: string, mailbox: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        const client = ctrl?.client;
        if (!client) return false;
        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            await client.messageFlagsAdd('1:*', ['\\Seen'], { uid: true });
            return true;
        } catch (err) {
            logDebug(`[markAllRead] error: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        } finally {
            lock.release();
        }
    }
}

export const imapEngine = new ImapEngine();
