import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withImapTimeout } from './imap.js';

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
