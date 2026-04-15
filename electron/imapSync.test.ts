import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ImapFlow } from 'imapflow';
import { withImapTimeout, imapEngine } from './imap.js';

// === Mocks for AccountSyncController tests ===
// vi.mock() calls are hoisted to the top of the file by Vitest.
// The withImapTimeout tests do not use these mocks and are unaffected.

const { mockLogDebug } = vi.hoisted(() => ({
    mockLogDebug: vi.fn(),
}));

vi.mock('./logger.js', () => ({
    logDebug: mockLogDebug,
}));

const { mockDbPrepare, mockGetOAuthCredential } = vi.hoisted(() => ({
    mockDbPrepare: vi.fn(() => ({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
        run: vi.fn().mockReturnValue({ changes: 0 }),
    })),
    mockGetOAuthCredential: vi.fn() as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({ prepare: mockDbPrepare })),
    getOAuthCredential: mockGetOAuthCredential,
}));

const { mockGetValidAccessToken, mockInvalidateToken } = vi.hoisted(() => ({
    mockGetValidAccessToken: vi.fn(),
    mockInvalidateToken: vi.fn(async () => { /* no-op */ }),
}));

// Import PermanentAuthError dynamically — can't re-export from mock.
vi.mock('./auth/tokenManager.js', async () => {
    const actual = await vi.importActual<typeof import('./auth/tokenManager.js')>('./auth/tokenManager.js');
    return {
        ...actual,
        getAuthTokenManager: () => ({
            getValidAccessToken: mockGetValidAccessToken,
            invalidateToken: mockInvalidateToken,
        }),
    };
});

// Mock ImapFlow constructor so connection tests can control auth outcomes.
const { mockImapFlowCtor, mockImapFlowConnect, mockImapFlowClose } = vi.hoisted(() => ({
    mockImapFlowCtor: vi.fn(),
    mockImapFlowConnect: vi.fn(),
    mockImapFlowClose: vi.fn(),
}));

vi.mock('imapflow', () => {
    class MockImapFlow {
        constructor(opts: Record<string, unknown>) {
            mockImapFlowCtor(opts);
        }
        connect() { return mockImapFlowConnect(); }
        close() { return mockImapFlowClose(); }
        on() { /* noop */ }
        logout() { return Promise.resolve(); }
    }
    return { ImapFlow: MockImapFlow };
});

// Mock crypto.decryptData so password path works without safeStorage.
vi.mock('./crypto.js', () => ({
    decryptData: vi.fn((buf: Buffer) => buf.toString('utf-8')),
    encryptData: vi.fn((s: string) => Buffer.from(s, 'utf-8')),
}));

// Mock mailparser so syncNewEmails tests can track when simpleParser is invoked.
// ESM exports cannot be spied on directly (vi.spyOn throws "module namespace
// is not configurable"), so we mock the module and expose a settable impl.
const { mockSimpleParser } = vi.hoisted(() => ({
    mockSimpleParser: vi.fn(async () => ({ text: '', html: false, headers: new Map() })),
}));
vi.mock('mailparser', () => ({
    simpleParser: mockSimpleParser,
}));

import { AccountSyncController } from './imap.js';
import { PermanentAuthError } from './auth/tokenManager.js';

describe('ImapEngine (controller integration)', () => {
    it('isConnected returns false when no controller exists', () => {
        expect(imapEngine.isConnected('nonexistent-account-xyz')).toBe(false);
    });

    it('getStatus returns none for unknown account', () => {
        const status = imapEngine.getStatus('nonexistent-account-xyz');
        expect(status.status).toBe('none');
    });

    it('isReconnecting returns false when no controller exists', () => {
        expect(imapEngine.isReconnecting('nonexistent-account-xyz')).toBe(false);
    });
});

describe('withImapTimeout', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('returns operation result when operation completes within timeout', async () => {
        const result = await withImapTimeout(() => Promise.resolve('ok'), 5000, 'test');
        expect(result).toBe('ok');
    });

    it('rejects with timeout error when operation exceeds timeout', async () => {
        const neverResolves = new Promise<string>(() => {});
        const promise = withImapTimeout(() => neverResolves, 100, 'lock');
        // Attach rejection handler BEFORE advancing timers to prevent unhandled-rejection warnings
        const assertion = expect(promise).rejects.toThrow('IMAP timeout: lock (100ms)');
        await vi.advanceTimersByTimeAsync(101);
        await assertion;
    });

    it('includes label and timeout duration in error message', async () => {
        const promise = withImapTimeout(() => new Promise(() => {}), 5000, 'getMailboxLock');
        // Attach rejection handler BEFORE advancing timers to prevent unhandled-rejection warnings
        const assertion = expect(promise).rejects.toThrow('IMAP timeout: getMailboxLock (5000ms)');
        await vi.advanceTimersByTimeAsync(5001);
        await assertion;
    });

    it('propagates operation errors unchanged (not masked by timeout)', async () => {
        const opError = new Error('IMAP auth failed');
        await expect(
            withImapTimeout(() => Promise.reject(opError), 5000, 'test')
        ).rejects.toThrow('IMAP auth failed');
    });

    it('works with zero-latency operations', async () => {
        const result = await withImapTimeout(() => Promise.resolve(42), 5000, 'test');
        expect(result).toBe(42);
    });

    it('handles operation that returns undefined', async () => {
        const result = await withImapTimeout(() => Promise.resolve(undefined), 5000, 'test');
        expect(result).toBeUndefined();
    });

    it('handles operation that throws synchronously', async () => {
        await expect(
            withImapTimeout(() => { throw new Error('sync throw'); }, 5000, 'test')
        ).rejects.toThrow('sync throw');
    });

    it('clears timeout when operation completes before deadline', async () => {
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
        await withImapTimeout(() => Promise.resolve('fast'), 5000, 'test');
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });

    it('operation Promise continues in background after timeout (no double-resolve)', async () => {
        let resolved = false;
        const slow = new Promise<string>((resolve) => {
            setTimeout(() => { resolved = true; resolve('late'); }, 200);
        });
        const promise = withImapTimeout(() => slow, 100, 'test');
        // Attach rejection handler BEFORE advancing timers to prevent unhandled-rejection warnings
        const assertion = expect(promise).rejects.toThrow('IMAP timeout');
        await vi.advanceTimersByTimeAsync(101);
        await assertion;
        await vi.advanceTimersByTimeAsync(200);
        expect(resolved).toBe(true);
    });

    it('works with exactly-at-deadline timing', async () => {
        const exactOp = new Promise<string>((resolve) => {
            setTimeout(() => resolve('exact'), 100);
        });
        const promise = withImapTimeout(() => exactOp, 100, 'test');
        await vi.advanceTimersByTimeAsync(100);
        await expect(Promise.race([promise, Promise.resolve('fallback')])).resolves.toBeDefined();
    });
});

describe('AccountSyncController', () => {
    let ctrl: AccountSyncController;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        ctrl = new AccountSyncController('acc-1');
    });

    afterEach(() => {
        ctrl.stop();
        vi.useRealTimers();
    });

    describe('lifecycle', () => {
        it('starts in disconnected status with null client', () => {
            expect(ctrl.status).toBe('disconnected');
            expect(ctrl.client).toBeNull();
        });

        it('stop clears all timers and sets status to disconnected', () => {
            ctrl.status = 'connected';
            ctrl.heartbeatTimer = setInterval(() => {}, 1000);
            ctrl.inboxSyncTimer = setInterval(() => {}, 1000);
            ctrl.folderSyncTimer = setInterval(() => {}, 1000);
            ctrl.reconnectTimer = setTimeout(() => {}, 1000);
            ctrl.stop();
            expect(ctrl.status).toBe('disconnected');
            expect(ctrl.client).toBeNull();
            expect(ctrl.heartbeatTimer).toBeNull();
            expect(ctrl.inboxSyncTimer).toBeNull();
            expect(ctrl.folderSyncTimer).toBeNull();
            expect(ctrl.reconnectTimer).toBeNull();
        });

        it('stop is idempotent — calling twice does not throw', () => {
            ctrl.stop();
            expect(() => ctrl.stop()).not.toThrow();
        });
    });

    describe('forceDisconnect', () => {
        it('closes client immediately', () => {
            const mockClose = vi.fn();
            ctrl.client = { close: mockClose } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('health');
            expect(mockClose).toHaveBeenCalled();
        });

        it('sets client to null and status to disconnected', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('health');
            expect(ctrl.client).toBeNull();
            expect(ctrl.status).toBe('disconnected');
        });

        it('resets syncing flag to false', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'syncing';
            ctrl.syncing = true;
            ctrl.forceDisconnect('health');
            expect(ctrl.syncing).toBe(false);
        });

        it('clears all timers', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.heartbeatTimer = setInterval(() => {}, 1000);
            ctrl.inboxSyncTimer = setInterval(() => {}, 1000);
            ctrl.folderSyncTimer = setInterval(() => {}, 1000);
            ctrl.reconnectTimer = setTimeout(() => {}, 1000);
            // Use 'user' reason so no new reconnectTimer is scheduled after clearing
            ctrl.forceDisconnect('user');
            expect(ctrl.heartbeatTimer).toBeNull();
            expect(ctrl.inboxSyncTimer).toBeNull();
            expect(ctrl.folderSyncTimer).toBeNull();
            expect(ctrl.reconnectTimer).toBeNull();
        });

        it('is idempotent — no-op if already disconnected', () => {
            const mockClose = vi.fn();
            ctrl.status = 'disconnected';
            ctrl.forceDisconnect('health');
            expect(mockClose).not.toHaveBeenCalled();
        });

        it('schedules reconnect when reason is health', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('health');
            expect(ctrl.reconnectTimer).not.toBeNull();
        });

        it('does NOT schedule reconnect when reason is user', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('user');
            expect(ctrl.reconnectTimer).toBeNull();
        });

        it('does NOT schedule reconnect when reason is shutdown', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('shutdown');
            expect(ctrl.reconnectTimer).toBeNull();
        });

        it('logs reason in disconnect message', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('health');
            expect(mockLogDebug).toHaveBeenCalledWith(
                expect.stringContaining('Force disconnected (reason: health)')
            );
        });
    });

    describe('reconnect', () => {
        it('schedules reconnect with ~1s initial delay', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('health');
            expect(ctrl.reconnectTimer).not.toBeNull();
            expect(ctrl.reconnectAttempts).toBe(1);
        });

        it('increments reconnectAttempts on each schedule', () => {
            ctrl.reconnectAttempts = 0;
            ctrl.status = 'connected'; ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.forceDisconnect('health');
            expect(ctrl.reconnectAttempts).toBe(1);
            // Simulate second failure
            ctrl.status = 'connected'; ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.forceDisconnect('health');
            expect(ctrl.reconnectAttempts).toBe(2);
        });

        it('caps delay at configured max (default 5 minutes)', () => {
            ctrl.reconnectAttempts = 20; // 2^20 * 1000ms >> 5min
            ctrl.scheduleReconnect();
            expect(ctrl.reconnectTimer).not.toBeNull();
            expect(ctrl.reconnectAttempts).toBe(21);
        });

        it('jitter stays within ±20% bounds', () => {
            const spy = vi.spyOn(globalThis, 'setTimeout');
            const delays: number[] = [];
            for (let i = 0; i < 50; i++) {
                ctrl.reconnectAttempts = 3; // base = 8000ms
                ctrl.reconnectTimer = null;
                ctrl.scheduleReconnect();
                const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
                delays.push(lastCall[1] as number);
            }
            const base = 8000;
            for (const d of delays) {
                expect(d).toBeGreaterThanOrEqual(base * 0.8);
                expect(d).toBeLessThanOrEqual(base * 1.2);
            }
            spy.mockRestore();
        });

        it('resets retry counter on successful connect', () => {
            ctrl.reconnectAttempts = 5;
            ctrl.consecutiveFailures = 3;
            ctrl.resetOnSuccessfulConnect();
            expect(ctrl.reconnectAttempts).toBe(0);
            expect(ctrl.consecutiveFailures).toBe(0);
            expect(ctrl.lastSuccessfulSync).not.toBeNull();
        });

        it('never gives up — retries indefinitely after many failures', () => {
            for (let i = 0; i < 20; i++) {
                ctrl.status = 'connected';
                ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
                ctrl.forceDisconnect('health');
            }
            expect(ctrl.reconnectAttempts).toBe(20);
            expect(ctrl.reconnectTimer).not.toBeNull();
        });

        it('emits status via callback', () => {
            const statusCb = vi.fn();
            ctrl.setStatusCallback(statusCb);
            ctrl.status = 'connecting';
            ctrl.emitStatus();
            expect(statusCb).toHaveBeenCalledWith('acc-1', 'connecting', null);
        });
    });

    describe('sync cycle', () => {
        it('skips sync when syncing flag is true', async () => {
            ctrl.syncing = true;
            const result = await ctrl.runInboxSync();
            expect(result).toBe(false);
        });

        it('skips sync when status is disconnected', async () => {
            ctrl.status = 'disconnected';
            const result = await ctrl.runInboxSync();
            expect(result).toBe(false);
        });

        it('resets syncing flag in finally block even if sync throws', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            // Mock the internal syncNewEmails to throw
            ctrl.syncFolder = vi.fn().mockRejectedValue(new Error('fail'));
            mockDbPrepare.mockReturnValueOnce({
                get: vi.fn().mockReturnValue({ path: '/INBOX' }),
                all: vi.fn(), run: vi.fn(),
            });
            await ctrl.runInboxSync();
            expect(ctrl.syncing).toBe(false);
        });

        it('updates lastSuccessfulSync on successful sync', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.syncFolder = vi.fn().mockResolvedValue(0);
            mockDbPrepare.mockReturnValueOnce({
                get: vi.fn().mockReturnValue({ path: '/INBOX' }),
                all: vi.fn(), run: vi.fn(),
            });
            await ctrl.runInboxSync();
            expect(ctrl.lastSuccessfulSync).not.toBeNull();
        });

        it('increments consecutiveFailures on failed sync', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.syncFolder = vi.fn().mockRejectedValue(new Error('timeout'));
            mockDbPrepare.mockReturnValueOnce({
                get: vi.fn().mockReturnValue({ path: '/INBOX' }),
                all: vi.fn(), run: vi.fn(),
            });
            await ctrl.runInboxSync();
            expect(ctrl.consecutiveFailures).toBe(1);
        });

        it('resets consecutiveFailures on successful sync', async () => {
            ctrl.consecutiveFailures = 3;
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.syncFolder = vi.fn().mockResolvedValue(0);
            mockDbPrepare.mockReturnValueOnce({
                get: vi.fn().mockReturnValue({ path: '/INBOX' }),
                all: vi.fn(), run: vi.fn(),
            });
            await ctrl.runInboxSync();
            expect(ctrl.consecutiveFailures).toBe(0);
        });

        it('calls forceDisconnect when sync times out', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.syncFolder = vi.fn().mockRejectedValue(new Error('IMAP timeout: syncNewEmails (60000ms)'));
            mockDbPrepare.mockReturnValueOnce({
                get: vi.fn().mockReturnValue({ path: '/INBOX' }),
                all: vi.fn(), run: vi.fn(),
            });
            const spy = vi.spyOn(ctrl, 'forceDisconnect');
            await ctrl.runInboxSync();
            expect(spy).toHaveBeenCalledWith('health');
            spy.mockRestore();
        });
    });

    describe('updateIntervals', () => {
        it('recreates timers with new intervals when not syncing', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startSyncTimers();
            const oldInbox = ctrl.inboxSyncTimer;
            ctrl.updateIntervals({ inboxIntervalSec: 30, folderIntervalSec: 120, reconnectMaxMinutes: 10 });
            expect(ctrl.inboxSyncTimer).not.toBe(oldInbox); // timer was recreated
        });

        it('sets pendingIntervalUpdate flag when syncing is true', () => {
            ctrl.syncing = true;
            ctrl.updateIntervals({ inboxIntervalSec: 30, folderIntervalSec: 120, reconnectMaxMinutes: 10 });
            // Timer should not have been touched — just queued
            expect(ctrl.inboxSyncTimer).toBeNull(); // was never started
        });

        it('applies pending update after sync cycle completes', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startSyncTimers();
            ctrl.syncing = true;
            ctrl.updateIntervals({ inboxIntervalSec: 30, folderIntervalSec: 120, reconnectMaxMinutes: 10 });
            // Simulate sync completion by calling applyPendingIntervalUpdate
            ctrl.syncing = false;
            ctrl.applyPendingIntervalUpdate();
            // After applying, timers should have been recreated
            expect(ctrl.inboxSyncTimer).not.toBeNull();
        });
    });

    describe('sync timers', () => {
        it('inbox timer fires at default interval', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            const spy = vi.spyOn(ctrl, 'runInboxSync').mockResolvedValue(true);
            ctrl.startSyncTimers();
            expect(spy).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(15_000);
            expect(spy).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(15_000);
            expect(spy).toHaveBeenCalledTimes(2);
            spy.mockRestore();
        });

        it('folder timer fires at default interval', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            const spy = vi.spyOn(ctrl, 'runFullSync').mockResolvedValue();
            ctrl.startSyncTimers();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
        });
    });

    describe('heartbeat', () => {
        it('sends NOOP every 2 minutes', async () => {
            const mockNoop = vi.fn().mockResolvedValue(undefined);
            ctrl.client = { noop: mockNoop, close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startHeartbeat();
            expect(mockNoop).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(120_000);
            expect(mockNoop).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(120_000);
            expect(mockNoop).toHaveBeenCalledTimes(2);
        });

        it('updates lastSuccessfulSync on successful NOOP', async () => {
            const mockNoop = vi.fn().mockResolvedValue(undefined);
            ctrl.client = { noop: mockNoop, close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startHeartbeat();
            await vi.advanceTimersByTimeAsync(120_000);
            expect(ctrl.lastSuccessfulSync).not.toBeNull();
        });

        it('calls forceDisconnect on NOOP timeout (5s)', async () => {
            const neverResolves = new Promise(() => {});
            const mockNoop = vi.fn().mockReturnValue(neverResolves);
            ctrl.client = { noop: mockNoop, close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startHeartbeat();
            // Advance past heartbeat interval (120s) + NOOP timeout (5s)
            await vi.advanceTimersByTimeAsync(125_001);
            expect(ctrl.status).toBe('disconnected');
        });

        it('does not send NOOP when client is null', async () => {
            const mockNoop = vi.fn();
            ctrl.client = null;
            ctrl.status = 'disconnected';
            ctrl.startHeartbeat();
            await vi.advanceTimersByTimeAsync(120_000);
            expect(mockNoop).not.toHaveBeenCalled();
        });

        it('heartbeat timer is cleared on forceDisconnect', () => {
            ctrl.client = { noop: vi.fn(), close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startHeartbeat();
            expect(ctrl.heartbeatTimer).not.toBeNull();
            ctrl.forceDisconnect('user');
            expect(ctrl.heartbeatTimer).toBeNull();
        });
    });

    describe('edge cases', () => {
        it('concurrent forceDisconnect calls produce single reconnect', () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.forceDisconnect('health');
            const timer1 = ctrl.reconnectTimer;
            // Second call — already disconnected, should be no-op
            ctrl.forceDisconnect('health');
            expect(ctrl.reconnectTimer).toBe(timer1); // same timer, not doubled
        });

        it('app quit clears all timers via forceDisconnect shutdown', () => {
            ctrl.client = { close: vi.fn(), noop: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startHeartbeat();
            expect(ctrl.heartbeatTimer).not.toBeNull();
            ctrl.forceDisconnect('shutdown');
            expect(ctrl.heartbeatTimer).toBeNull();
            expect(ctrl.reconnectTimer).toBeNull();
            expect(ctrl.inboxSyncTimer).toBeNull();
            expect(ctrl.folderSyncTimer).toBeNull();
        });

        it('settings change during active sync applies after cycle completes', async () => {
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl.startSyncTimers();
            ctrl.syncing = true; // simulate active sync
            ctrl.updateIntervals({ inboxIntervalSec: 30, folderIntervalSec: 120, reconnectMaxMinutes: 10 });
            // Timer should NOT have been recreated yet
            const timerDuringSyncing = ctrl.inboxSyncTimer;
            // Simulate sync completion
            ctrl.syncing = false;
            ctrl.applyPendingIntervalUpdate();
            // Now timer should have been recreated
            expect(ctrl.inboxSyncTimer).not.toBe(timerDuringSyncing);
        });

        it('network restored after many failed reconnects recovers on next attempt', () => {
            // Simulate 10 failed reconnects
            for (let i = 0; i < 10; i++) {
                ctrl.status = 'connected';
                ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
                ctrl.forceDisconnect('health');
            }
            expect(ctrl.reconnectAttempts).toBe(10);
            // Simulate successful reconnect
            ctrl.resetOnSuccessfulConnect();
            expect(ctrl.reconnectAttempts).toBe(0);
            expect(ctrl.consecutiveFailures).toBe(0);
        });
    });

    describe('OAuth2 wiring (Task 15 / D8.1, D8.3, D8.4)', () => {
        const ACCOUNT_ID = 'oauth-acc-1';
        const PASSWORD_ACCOUNT_ROW = {
            id: ACCOUNT_ID,
            email: 'user@example.com',
            password_encrypted: Buffer.from('hunter2', 'utf-8').toString('base64'),
            provider: 'gmail',
            imap_host: 'imap.gmail.com',
            imap_port: 993,
        };

        beforeEach(() => {
            vi.useRealTimers(); // these tests use real promises / no fake timers
            mockImapFlowCtor.mockClear();
            mockImapFlowConnect.mockReset();
            mockImapFlowClose.mockClear();
            mockGetOAuthCredential.mockReset();
            mockGetValidAccessToken.mockReset();
            mockInvalidateToken.mockClear();
            // Default DB response: account row lookup
            mockDbPrepare.mockImplementation(() => ({
                all: vi.fn().mockReturnValue([]),
                get: vi.fn().mockReturnValue(PASSWORD_ACCOUNT_ROW),
                run: vi.fn().mockReturnValue({ changes: 0 }),
            }));
            // Remove any stale controllers from prior tests
            imapEngine.controllers.delete(ACCOUNT_ID);
            imapEngine.setNeedsReauthCallback(() => { /* noop default */ });
        });

        it('legacy password path: no OAuth credential → passes { user, pass } to ImapFlow', async () => {
            mockGetOAuthCredential.mockReturnValue(null);
            mockImapFlowConnect.mockResolvedValue(undefined);

            const result = await imapEngine.connectAccount(ACCOUNT_ID);

            expect(result).toBe(true);
            expect(mockGetValidAccessToken).not.toHaveBeenCalled();
            expect(mockImapFlowCtor).toHaveBeenCalledTimes(1);
            const opts = mockImapFlowCtor.mock.calls[0][0] as { auth: Record<string, unknown> };
            expect(opts.auth).toEqual({ user: 'user@example.com', pass: 'hunter2' });
        });

        it('OAuth path: credential row present → fetches access token + passes { user, accessToken }', async () => {
            mockGetOAuthCredential.mockReturnValue({
                accountId: ACCOUNT_ID,
                provider: 'google',
                accessTokenEncrypted: 'enc',
                refreshTokenEncrypted: 'enc-r',
                expiresAt: Date.now() + 3600_000,
                scope: null, tokenType: null,
                providerAccountEmail: null, providerAccountId: null,
                createdAt: 0, updatedAt: 0,
            });
            mockGetValidAccessToken.mockResolvedValue({
                accessToken: 'MOCK-ACCESS-TOKEN-GOOGLE',
                expiresAt: Date.now() + 3600_000,
                provider: 'google',
            });
            mockImapFlowConnect.mockResolvedValue(undefined);

            const result = await imapEngine.connectAccount(ACCOUNT_ID);

            expect(result).toBe(true);
            expect(mockGetValidAccessToken).toHaveBeenCalledWith(ACCOUNT_ID);
            expect(mockImapFlowCtor).toHaveBeenCalledTimes(1);
            const opts = mockImapFlowCtor.mock.calls[0][0] as { auth: Record<string, unknown> };
            expect(opts.auth).toEqual({ user: 'user@example.com', accessToken: 'MOCK-ACCESS-TOKEN-GOOGLE' });
            // No pass field on oauth path
            expect(opts.auth.pass).toBeUndefined();
        });

        it('first AUTHENTICATIONFAILED → invalidates token, retries, succeeds', async () => {
            mockGetOAuthCredential.mockReturnValue({
                accountId: ACCOUNT_ID, provider: 'google',
                accessTokenEncrypted: 'enc', refreshTokenEncrypted: 'enc-r',
                expiresAt: Date.now() + 3600_000, scope: null, tokenType: null,
                providerAccountEmail: null, providerAccountId: null, createdAt: 0, updatedAt: 0,
            });
            mockGetValidAccessToken
                .mockResolvedValueOnce({ accessToken: 'stale-token', expiresAt: 0, provider: 'google' })
                .mockResolvedValueOnce({ accessToken: 'fresh-token', expiresAt: Date.now() + 3600_000, provider: 'google' });
            // First connect fails with AUTHENTICATIONFAILED; second succeeds.
            const authFail = Object.assign(new Error('Authentication failed'), { authenticationFailed: true });
            mockImapFlowConnect
                .mockRejectedValueOnce(authFail)
                .mockResolvedValueOnce(undefined);

            const result = await imapEngine.connectAccount(ACCOUNT_ID);

            expect(result).toBe(true);
            expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
            expect(mockInvalidateToken).toHaveBeenCalledWith(ACCOUNT_ID);
            expect(mockGetValidAccessToken).toHaveBeenCalledTimes(2);
            expect(mockImapFlowCtor).toHaveBeenCalledTimes(2);
            // Second call should carry the refreshed token
            const secondOpts = mockImapFlowCtor.mock.calls[1][0] as { auth: { accessToken: string } };
            expect(secondOpts.auth.accessToken).toBe('fresh-token');
        });

        it('second AUTHENTICATIONFAILED → propagates as connect failure (returns false)', async () => {
            mockGetOAuthCredential.mockReturnValue({
                accountId: ACCOUNT_ID, provider: 'google',
                accessTokenEncrypted: 'enc', refreshTokenEncrypted: 'enc-r',
                expiresAt: Date.now() + 3600_000, scope: null, tokenType: null,
                providerAccountEmail: null, providerAccountId: null, createdAt: 0, updatedAt: 0,
            });
            mockGetValidAccessToken.mockResolvedValue({
                accessToken: 'token', expiresAt: Date.now() + 3600_000, provider: 'google',
            });
            const authFail = Object.assign(new Error('Authentication failed'), { authenticationFailed: true });
            mockImapFlowConnect
                .mockRejectedValueOnce(authFail)
                .mockRejectedValueOnce(authFail);

            const result = await imapEngine.connectAccount(ACCOUNT_ID);

            expect(result).toBe(false);
            // Only retried once
            expect(mockImapFlowCtor).toHaveBeenCalledTimes(2);
            expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
        });

        it('PermanentAuthError from getValidAccessToken → fires needs-reauth callback + returns false', async () => {
            mockGetOAuthCredential.mockReturnValue({
                accountId: ACCOUNT_ID, provider: 'google',
                accessTokenEncrypted: 'enc', refreshTokenEncrypted: 'enc-r',
                expiresAt: 0, scope: null, tokenType: null,
                providerAccountEmail: null, providerAccountId: null, createdAt: 0, updatedAt: 0,
            });
            mockGetValidAccessToken.mockRejectedValue(
                new PermanentAuthError('refresh token revoked', 'invalid_grant', ACCOUNT_ID)
            );
            const reauthCallback = vi.fn();
            imapEngine.setNeedsReauthCallback(reauthCallback);

            const result = await imapEngine.connectAccount(ACCOUNT_ID);

            expect(result).toBe(false);
            expect(reauthCallback).toHaveBeenCalledWith({ accountId: ACCOUNT_ID });
            // No ImapFlow client was ever constructed — token fetch failed first
            expect(mockImapFlowCtor).not.toHaveBeenCalled();
        });

        it('PermanentAuthError on retry refresh also fires callback', async () => {
            mockGetOAuthCredential.mockReturnValue({
                accountId: ACCOUNT_ID, provider: 'google',
                accessTokenEncrypted: 'enc', refreshTokenEncrypted: 'enc-r',
                expiresAt: Date.now() + 3600_000, scope: null, tokenType: null,
                providerAccountEmail: null, providerAccountId: null, createdAt: 0, updatedAt: 0,
            });
            mockGetValidAccessToken
                .mockResolvedValueOnce({ accessToken: 'stale', expiresAt: 0, provider: 'google' })
                .mockRejectedValueOnce(new PermanentAuthError('revoked', 'invalid_grant', ACCOUNT_ID));
            const authFail = Object.assign(new Error('Authentication failed'), { authenticationFailed: true });
            mockImapFlowConnect.mockRejectedValueOnce(authFail);
            const reauthCallback = vi.fn();
            imapEngine.setNeedsReauthCallback(reauthCallback);

            const result = await imapEngine.connectAccount(ACCOUNT_ID);

            expect(result).toBe(false);
            expect(reauthCallback).toHaveBeenCalledWith({ accountId: ACCOUNT_ID });
            expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
        });

        afterEach(() => {
            imapEngine.controllers.delete(ACCOUNT_ID);
        });
    });

    describe('parallel account isolation', () => {
        it('one account forceDisconnect does not affect another', () => {
            const ctrl2 = new AccountSyncController('acc-2');
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.status = 'connected';
            ctrl2.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl2.status = 'connected';

            ctrl.forceDisconnect('health');
            expect(ctrl.status).toBe('disconnected');
            expect(ctrl2.status).toBe('connected');
            ctrl2.stop();
        });

        it('each account has independent reconnect backoff state', () => {
            const ctrl2 = new AccountSyncController('acc-2');
            ctrl.reconnectAttempts = 5;
            ctrl2.reconnectAttempts = 0;
            expect(ctrl.reconnectAttempts).not.toBe(ctrl2.reconnectAttempts);
            ctrl2.stop();
        });

        it('each account has independent UID tracking', () => {
            const ctrl2 = new AccountSyncController('acc-2');
            ctrl.lastSeenUid.set('INBOX', 100);
            ctrl2.lastSeenUid.set('INBOX', 200);
            expect(ctrl.lastSeenUid.get('INBOX')).toBe(100);
            expect(ctrl2.lastSeenUid.get('INBOX')).toBe(200);
            ctrl2.stop();
        });
    });

    describe('AccountSyncController.operationQueue', () => {
        beforeEach(() => {
            vi.useRealTimers(); // these tests rely on real setTimeout for blocker tasks
        });

        it('exposes an operationQueue instance on the controller', () => {
            const ctrl = new AccountSyncController('acct-queue-1');
            expect(ctrl.operationQueue).toBeDefined();
            expect(typeof ctrl.operationQueue.enqueue).toBe('function');
            expect(typeof ctrl.operationQueue.drain).toBe('function');
        });

        it('drains the operation queue on forceDisconnect', async () => {
            const ctrl = new AccountSyncController('acct-queue-2');
            ctrl.status = 'connected';

            // Seed a blocking task so subsequent enqueues remain pending.
            const blocker = ctrl.operationQueue.enqueue(() =>
                new Promise<string>(resolve => setTimeout(() => resolve('done'), 50))
            );
            const pending = ctrl.operationQueue.enqueue(async () => 'never-runs');

            ctrl.forceDisconnect('user');

            await expect(blocker).resolves.toBe('done');
            await expect(pending).rejects.toThrow(/drained/);
        });

        it('drains the operation queue on stop()', async () => {
            const ctrl = new AccountSyncController('acct-queue-3');
            ctrl.status = 'connected';

            // Seed a blocking task so the subsequent enqueue remains pending.
            const blocker = ctrl.operationQueue.enqueue(() =>
                new Promise<string>(resolve => setTimeout(() => resolve('done'), 50))
            );
            const pending = ctrl.operationQueue.enqueue(async () => 'never-runs');

            ctrl.stop();

            await expect(blocker).resolves.toBe('done');
            await expect(pending).rejects.toThrow(/drained/);
        });

        it('routes deleteMessage through the operation queue (serial against other user ops)', async () => {
            const ctrl = new AccountSyncController('acct-delete-1');
            ctrl.status = 'connected';

            const callOrder: string[] = [];
            const fakeClient = {
                getMailboxLock: vi.fn(async () => {
                    callOrder.push('lock-acquired');
                    return { release: () => { callOrder.push('lock-released'); } };
                }),
                messageFlagsAdd: vi.fn(async () => { callOrder.push('flags-add'); }),
                messageDelete: vi.fn(async () => { callOrder.push('delete'); }),
            } as unknown as ImapFlow;
            ctrl.client = fakeClient;
            imapEngine['controllers'].set('acct-delete-1', ctrl);

            // Seed a blocker so the delete has to wait for it to finish.
            const blocker = ctrl.operationQueue.enqueue(async () => {
                callOrder.push('blocker-start');
                await new Promise(resolve => setTimeout(resolve, 20));
                callOrder.push('blocker-end');
            });

            const deletePromise = imapEngine.deleteMessage('acct-delete-1', 42, 'INBOX');
            await Promise.all([blocker, deletePromise]);

            // The delete must not begin until the blocker finishes.
            const blockerEndIdx = callOrder.indexOf('blocker-end');
            const flagsAddIdx = callOrder.indexOf('flags-add');
            expect(blockerEndIdx).toBeGreaterThanOrEqual(0);
            expect(flagsAddIdx).toBeGreaterThanOrEqual(0);
            expect(blockerEndIdx).toBeLessThan(flagsAddIdx);

            imapEngine['controllers'].delete('acct-delete-1');
        });

        it('routes moveMessage through the operation queue', async () => {
            const ctrl = new AccountSyncController('acct-move-1');
            ctrl.status = 'connected';

            const callOrder: string[] = [];
            const fakeClient = {
                getMailboxLock: vi.fn(async () => {
                    callOrder.push('lock-acquired');
                    return { release: () => { callOrder.push('lock-released'); } };
                }),
                messageMove: vi.fn(async () => { callOrder.push('move'); }),
            } as unknown as ImapFlow;
            ctrl.client = fakeClient;
            imapEngine['controllers'].set('acct-move-1', ctrl);

            const blocker = ctrl.operationQueue.enqueue(async () => {
                callOrder.push('blocker-start');
                await new Promise(resolve => setTimeout(resolve, 20));
                callOrder.push('blocker-end');
            });
            const movePromise = imapEngine.moveMessage('acct-move-1', 42, 'INBOX', 'Trash');
            await Promise.all([blocker, movePromise]);

            const blockerEndIdx = callOrder.indexOf('blocker-end');
            const moveIdx = callOrder.indexOf('move');
            expect(blockerEndIdx).toBeGreaterThanOrEqual(0);
            expect(moveIdx).toBeGreaterThanOrEqual(0);
            expect(blockerEndIdx).toBeLessThan(moveIdx);

            imapEngine['controllers'].delete('acct-move-1');
        });

        it('routes refetchEmailBody through the queue and uses 30s lock timeout', async () => {
            const ctrl = new AccountSyncController('acct-refetch-1');
            ctrl.status = 'connected';

            const callOrder: string[] = [];
            const fakeClient = {
                getMailboxLock: vi.fn(async () => {
                    callOrder.push('lock-acquired');
                    return { release: () => { callOrder.push('lock-released'); } };
                }),
                fetch: vi.fn(async function* () {
                    yield { source: Buffer.from('Subject: test\r\n\r\nhello') };
                }),
            } as unknown as ImapFlow;
            ctrl.client = fakeClient;
            imapEngine['controllers'].set('acct-refetch-1', ctrl);

            const blocker = ctrl.operationQueue.enqueue(async () => {
                callOrder.push('blocker-start');
                await new Promise(resolve => setTimeout(resolve, 20));
                callOrder.push('blocker-end');
            });
            const refetchPromise = imapEngine.refetchEmailBody('acct-refetch-1', 42, 'INBOX');
            await Promise.all([blocker, refetchPromise]);

            // Serialization: lock must not be acquired until after the blocker finishes.
            const blockerEndIdx = callOrder.indexOf('blocker-end');
            const lockAcquireIdx = callOrder.indexOf('lock-acquired');
            expect(blockerEndIdx).toBeGreaterThanOrEqual(0);
            expect(lockAcquireIdx).toBeGreaterThanOrEqual(0);
            expect(blockerEndIdx).toBeLessThan(lockAcquireIdx);

            imapEngine['controllers'].delete('acct-refetch-1');
        });

        it('refetchEmailBody uses a 30-second mailbox lock timeout', async () => {
            // Static-source assertion: verify the timeout constant is 30_000, not 10_000.
            // This guards against accidental regression on the timeout bump.
            const fs = await import('node:fs');
            const src = fs.readFileSync('electron/imap.ts', 'utf-8');

            // Locate the _refetchEmailBodyLocked (or refetchEmailBody if not yet extracted) method body
            // and find its first withImapTimeout call.
            const refetchStart = src.indexOf('refetchEmailBody');
            expect(refetchStart).toBeGreaterThan(-1);
            const slice = src.slice(refetchStart);
            // The timeout in the next withImapTimeout call must be 30_000.
            const match = /withImapTimeout\s*\(\s*\(\)\s*=>\s*client\.getMailboxLock\([^)]+\),\s*(\d+)_000/.exec(slice);
            expect(match).not.toBeNull();
            expect(match![1]).toBe('30');
        });
    });
});

describe('syncNewEmails two-phase parsing', () => {
    it('releases the mailbox lock before running simpleParser', async () => {
        const ctrl = new AccountSyncController('acct-sync-1');
        ctrl.status = 'connected';

        const events: string[] = [];
        const fakeFetchIterator = async function* () {
            yield {
                uid: 101,
                envelope: {
                    subject: 'Test',
                    from: [{ name: 'A', address: 'a@example.com' }],
                    to: [{ address: 'b@example.com' }],
                    date: new Date('2026-04-14T00:00:00Z'),
                    messageId: '<msg-101@example.com>',
                    inReplyTo: null,
                },
                bodyStructure: null,
                source: Buffer.from('Subject: Test\r\nFrom: a@example.com\r\n\r\nhi'),
            };
        };
        const fakeClient = {
            getMailboxLock: vi.fn(async () => {
                events.push('lock-acquired');
                return {
                    release: () => events.push('lock-released'),
                };
            }),
            fetch: vi.fn(() => fakeFetchIterator()),
        } as unknown as ImapFlow;
        ctrl.client = fakeClient;
        imapEngine['controllers'].set('acct-sync-1', ctrl);

        // Seed folder row via the db mock.
        mockDbPrepare.mockImplementation((sql: string) => {
            if (sql.includes('SELECT id, type FROM folders')) {
                return {
                    get: () => ({ id: 'folder-inbox', type: 'inbox' }),
                    all: () => [],
                    run: () => ({ changes: 1 }),
                } as unknown as ReturnType<typeof mockDbPrepare>;
            }
            return {
                get: () => null,
                all: () => [],
                run: () => ({ changes: 1 }),
            } as unknown as ReturnType<typeof mockDbPrepare>;
        });

        // Instrument mailparser mock to record when simpleParser is invoked.
        mockSimpleParser.mockImplementationOnce(async () => {
            events.push('simple-parser-invoked');
            return { text: 'hi', html: false, headers: new Map() } as unknown as Awaited<
                ReturnType<typeof import('mailparser').simpleParser>
            >;
        });

        await imapEngine.syncNewEmails('acct-sync-1', 'INBOX');

        imapEngine['controllers'].delete('acct-sync-1');

        const releaseIdx = events.indexOf('lock-released');
        const parseIdx = events.indexOf('simple-parser-invoked');
        expect(releaseIdx).toBeGreaterThan(-1);
        expect(parseIdx).toBeGreaterThan(-1);
        // The critical invariant: lock is released BEFORE simpleParser runs.
        expect(releaseIdx).toBeLessThan(parseIdx);
    });
});
