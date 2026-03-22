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

const { mockDbPrepare } = vi.hoisted(() => ({
    mockDbPrepare: vi.fn(() => ({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
        run: vi.fn().mockReturnValue({ changes: 0 }),
    })),
}));

vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({ prepare: mockDbPrepare })),
}));

import { AccountSyncController } from './imap.js';

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
});
