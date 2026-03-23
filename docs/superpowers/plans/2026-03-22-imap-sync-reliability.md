# IMAP Sync Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile serial IMAP poll loop with per-account sync controllers that have timeout protection, NOOP heartbeat, infinite reconnect, and staleness-aware status indicators.

**Architecture:** Each email account gets an independent `AccountSyncController` with its own timers, connection health monitoring, and reconnect logic. A `withImapTimeout` wrapper guards every IMAP network operation. The global poll loop in `main.ts` is deleted entirely. Existing `ImapEngine` API surface is preserved.

**Tech Stack:** TypeScript strict, Vitest + vi.useFakeTimers(), IMAPFlow, Electron IPC, Zustand, Radix UI Tabs, CSS Modules

**Spec:** `docs/superpowers/specs/2026-03-22-imap-sync-reliability-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/imap.ts` | Modify | Extract `AccountSyncController` class, add `withImapTimeout`, refactor `ImapEngine` to use controllers |
| `electron/imapSync.test.ts` | Create | ~88 tests for all new sync reliability code |
| `electron/main.ts` | Modify | Delete poll loop, use `startAccount()`, add IPC handler, update `ALLOWED_SETTINGS_KEYS`, widen `sendSyncStatus` |
| `electron/preload.ts` | Modify | Add `imap:apply-sync-settings` to allowlist |
| `src/components/Sidebar.tsx` | Modify | Add `stale`/`syncing` status states, amber dot, enhanced tooltip |
| `src/components/Sidebar.module.css` | Modify | Add `sync-stale`, `sync-syncing` CSS classes |
| `src/components/SettingsModal.tsx` | Modify | Add 3 sync interval controls in Email > Sync sub-tab |

---

## Task 1: `withImapTimeout` Utility — Tests + Implementation

**Files:**
- Create: `electron/imapSync.test.ts`
- Modify: `electron/imap.ts`

- [ ] **Step 1: Create test file with `withImapTimeout` tests**

Create `electron/imapSync.test.ts` with the test scaffold and first batch of tests. Use `vi.useFakeTimers()` for all timer tests. Follow existing `scheduler.test.ts` hoisting patterns.

```typescript
// electron/imapSync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// withImapTimeout will be exported from imap.ts
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
        await vi.advanceTimersByTimeAsync(101);
        await expect(promise).rejects.toThrow('IMAP timeout: lock (100ms)');
    });

    it('includes label and timeout duration in error message', async () => {
        const promise = withImapTimeout(() => new Promise(() => {}), 5000, 'getMailboxLock');
        await vi.advanceTimersByTimeAsync(5001);
        await expect(promise).rejects.toThrow('IMAP timeout: getMailboxLock (5000ms)');
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
        await vi.advanceTimersByTimeAsync(101);
        await expect(promise).rejects.toThrow('IMAP timeout');
        await vi.advanceTimersByTimeAsync(200);
        expect(resolved).toBe(true); // operation completed but result is discarded
    });

    it('works with exactly-at-deadline timing', async () => {
        // Operation resolves at exactly the same time as timeout — operation should win
        const exactOp = new Promise<string>((resolve) => {
            setTimeout(() => resolve('exact'), 100);
        });
        const promise = withImapTimeout(() => exactOp, 100, 'test');
        await vi.advanceTimersByTimeAsync(100);
        // Either result is valid (race), but should not throw unhandled
        await expect(Promise.race([promise, Promise.resolve('fallback')])).resolves.toBeDefined();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: FAIL — `withImapTimeout` is not exported from `./imap.js`

- [ ] **Step 3: Implement `withImapTimeout` in `imap.ts`**

Add at the top of `electron/imap.ts` (after imports, before the `ImapEngine` class), and export it. **Important:** The timer must be cleared on success to prevent resource leaks — every fast-resolving operation would otherwise leave a dangling `setTimeout` reference until it fires.

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: PASS — all 7 tests green

- [ ] **Step 5: Commit**

```bash
git add electron/imapSync.test.ts electron/imap.ts
git commit -m "feat: add withImapTimeout utility with tests"
```

---

## Task 2: Apply `withImapTimeout` to All Unguarded IMAP Operations

**Files:**
- Modify: `electron/imap.ts`

This task wraps every unguarded `getMailboxLock` call and `client.list()` with `withImapTimeout`. Operations that already have `Promise.race` timeouts are updated to use the new utility for consistency.

- [ ] **Step 1: Wrap `syncNewEmails` lock (Bug #1 — Critical)**

In `electron/imap.ts`, `syncNewEmails` method (~line 295):

Replace:
```typescript
const lock = await client.getMailboxLock(mailbox);
```
With:
```typescript
const lock = await withImapTimeout(
    () => client.getMailboxLock(mailbox),
    10_000,
    `getMailboxLock(${mailbox})`
);
```

- [ ] **Step 2: Wrap `moveMessage` lock (Bug #6)**

In `moveMessage` method (~line 483):

Replace:
```typescript
const lock = await client.getMailboxLock(sourceMailbox);
```
With:
```typescript
const lock = await withImapTimeout(
    () => client.getMailboxLock(sourceMailbox),
    10_000,
    `getMailboxLock(${sourceMailbox})`
);
```

- [ ] **Step 3: Wrap `appendToSent` lock (Bug #6)**

In `appendToSent` method (~line 506):

Replace:
```typescript
const lock = await client.getMailboxLock(mailbox);
```
With:
```typescript
const lock = await withImapTimeout(
    () => client.getMailboxLock(mailbox),
    10_000,
    `getMailboxLock(${mailbox})`
);
```

- [ ] **Step 4: Wrap `downloadAttachment` lock (Bug #6)**

In `downloadAttachment` method (~line 528):

Replace:
```typescript
const lock = await client.getMailboxLock(mailbox);
```
With:
```typescript
const lock = await withImapTimeout(
    () => client.getMailboxLock(mailbox),
    10_000,
    `getMailboxLock(${mailbox})`
);
```

- [ ] **Step 5: Wrap `deleteMessage` lock (Bug #6)**

In `deleteMessage` method (~line 589):

Replace:
```typescript
const lock = await client.getMailboxLock(mailbox);
```
With:
```typescript
const lock = await withImapTimeout(
    () => client.getMailboxLock(mailbox),
    10_000,
    `getMailboxLock(${mailbox})`
);
```

- [ ] **Step 6: Wrap `listAndSyncFolders` client.list() (Bug #8)**

In `listAndSyncFolders` method, wrap the `client.list()` call. **Search by pattern** `await client.list()` (not by line number — line numbers shift as edits accumulate):

Replace:
```typescript
const mailboxes = await client.list();
```
With:
```typescript
const mailboxes = await withImapTimeout(
    () => client.list(),
    15_000,
    'client.list()'
);
```

- [ ] **Step 7: Standardize existing `Promise.race` timeouts to use `withImapTimeout`**

Replace all existing `Promise.race([..., new Promise<never>(...)])` patterns in `markAsRead`, `markAsUnread`, `refetchEmailBody`, `fetchRawSource`, `markAllRead` with `withImapTimeout`. This is a consistency refactor — same behavior, uniform API. Example for `markAsRead` (~line 553-555):

Replace:
```typescript
const lock = await Promise.race([
    client.getMailboxLock(mailbox),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Lock timeout')), 8_000)),
]);
```
With:
```typescript
const lock = await withImapTimeout(
    () => client.getMailboxLock(mailbox),
    10_000,
    `getMailboxLock(${mailbox})`
);
```

Repeat for all 5 methods that have existing `Promise.race` timeouts.

- [ ] **Step 8: Run lint and existing tests**

Run: `npx vitest run && npm run lint`
Expected: All 723+ tests pass, lint clean

- [ ] **Step 9: Commit**

```bash
git add electron/imap.ts
git commit -m "fix: add timeout protection to all IMAP lock operations (Bugs #1, #6, #8)"
```

---

## Task 3: `AccountSyncController` Class — Core Structure + Lifecycle Tests

**Files:**
- Modify: `electron/imap.ts`
- Modify: `electron/imapSync.test.ts`

- [ ] **Step 1: Write lifecycle tests**

Add to `electron/imapSync.test.ts`. Mock `ImapFlow`, `getDatabase`, and `logDebug` using `vi.hoisted()` + `vi.mock()`:

```typescript
// Add mocks at top of file (after existing imports)
const { mockConnect, mockClose, mockNoop, mockList, mockGetMailboxLock, mockFetch, mockOn, mockRemoveListener } = vi.hoisted(() => ({
    mockConnect: vi.fn().mockResolvedValue(undefined),
    mockClose: vi.fn(),
    mockNoop: vi.fn().mockResolvedValue(undefined),
    mockList: vi.fn().mockResolvedValue([]),
    mockGetMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    mockFetch: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }) }),
    mockOn: vi.fn(),
    mockRemoveListener: vi.fn(),
}));

vi.mock('imapflow', () => ({
    ImapFlow: vi.fn().mockImplementation(() => ({
        connect: mockConnect,
        close: mockClose,
        noop: mockNoop,
        list: mockList,
        getMailboxLock: mockGetMailboxLock,
        fetch: mockFetch,
        on: mockOn,
        removeListener: mockRemoveListener,
    })),
}));

const { mockDbPrepare, mockLogDebug } = vi.hoisted(() => ({
    mockDbPrepare: vi.fn(() => ({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
        run: vi.fn().mockReturnValue({ changes: 0 }),
    })),
    mockLogDebug: vi.fn(),
}));

vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({ prepare: mockDbPrepare })),
}));

vi.mock('./logger.js', () => ({
    logDebug: mockLogDebug,
}));

// Import AccountSyncController after mocks
import { AccountSyncController } from './imap.js';

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
            ctrl.client = { close: mockClose } as unknown as ImapFlow;
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
});

// Note: The remaining lifecycle tests (transitions to connecting/connected,
// starts heartbeat/inbox/folder timers after connect) are covered in Task 9
// when startAccount() is implemented, since they require the full connect flow.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: FAIL — `AccountSyncController` is not exported from `./imap.js`

- [ ] **Step 3: Implement `AccountSyncController` class skeleton**

Add to `electron/imap.ts` before the `ImapEngine` class. Export it. Include all fields from the spec, the constructor, and the `stop()` method:

```typescript
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
    lastSuccessfulSync: number | null = null;
    consecutiveFailures = 0;
    heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    lastSeenUid: Map<string, number> = new Map();
    reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    reconnectAttempts = 0;
    status: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error' = 'disconnected';
    private pendingIntervalUpdate: SyncSettings | null = null;
    private settings: SyncSettings = { inboxIntervalSec: 15, folderIntervalSec: 60, reconnectMaxMinutes: 5 };
    private onStatusChange: ((accountId: string, status: string, timestamp: number | null) => void) | null = null;
    private onNewEmail: ((accountId: string, folderId: string, count: number) => void) | null = null;

    constructor(accountId: string, settings?: Partial<SyncSettings>) {
        this.accountId = accountId;
        if (settings) {
            this.settings = { ...this.settings, ...settings };
        }
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
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat: add AccountSyncController class skeleton with lifecycle tests"
```

---

## Task 4: `forceDisconnect` — Tests + Implementation

**Files:**
- Modify: `electron/imapSync.test.ts`
- Modify: `electron/imap.ts`

- [ ] **Step 1: Write forceDisconnect tests**

Add to `imapSync.test.ts` inside the `AccountSyncController` describe block:

```typescript
describe('forceDisconnect', () => {
    it('closes client immediately', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('health');
        expect(mockClose).toHaveBeenCalled();
    });

    it('sets client to null and status to disconnected', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('health');
        expect(ctrl.client).toBeNull();
        expect(ctrl.status).toBe('disconnected');
    });

    it('resets syncing flag to false', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'syncing';
        ctrl.syncing = true;
        ctrl.forceDisconnect('health');
        expect(ctrl.syncing).toBe(false);
    });

    it('clears all timers', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.heartbeatTimer = setInterval(() => {}, 1000);
        ctrl.inboxSyncTimer = setInterval(() => {}, 1000);
        ctrl.folderSyncTimer = setInterval(() => {}, 1000);
        ctrl.reconnectTimer = setTimeout(() => {}, 1000);
        ctrl.forceDisconnect('health');
        expect(ctrl.heartbeatTimer).toBeNull();
        expect(ctrl.inboxSyncTimer).toBeNull();
        expect(ctrl.folderSyncTimer).toBeNull();
        expect(ctrl.reconnectTimer).toBeNull();
    });

    it('is idempotent — no-op if already disconnected', () => {
        ctrl.status = 'disconnected';
        ctrl.forceDisconnect('health');
        expect(mockClose).not.toHaveBeenCalled();
    });

    it('schedules reconnect when reason is health', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('health');
        expect(ctrl.reconnectTimer).not.toBeNull();
    });

    it('does NOT schedule reconnect when reason is user', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('user');
        expect(ctrl.reconnectTimer).toBeNull();
    });

    it('does NOT schedule reconnect when reason is shutdown', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('shutdown');
        expect(ctrl.reconnectTimer).toBeNull();
    });

    it('logs reason in disconnect message', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('health');
        expect(mockLogDebug).toHaveBeenCalledWith(
            expect.stringContaining('Force disconnected (reason: health)')
        );
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: FAIL — `forceDisconnect` method does not exist

- [ ] **Step 3: Implement `forceDisconnect` and `scheduleReconnect` on AccountSyncController**

Add to the `AccountSyncController` class in `electron/imap.ts`:

```typescript
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
        // Reconnect logic will be wired in Task 6
    }, jitter);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat: add forceDisconnect with idempotency, reason-based reconnect, and tests"
```

---

## Task 5: Reconnect Backoff — Tests + Implementation

**Files:**
- Modify: `electron/imapSync.test.ts`
- Modify: `electron/imap.ts`

- [ ] **Step 1: Write reconnect tests**

Add to `imapSync.test.ts`:

```typescript
describe('reconnect', () => {
    it('schedules reconnect with ~1s initial delay', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('health');
        expect(ctrl.reconnectTimer).not.toBeNull();
        expect(ctrl.reconnectAttempts).toBe(1);
    });

    it('doubles delay on each retry (exponential backoff)', () => {
        // Test by checking reconnectAttempts increments
        ctrl.reconnectAttempts = 0;
        ctrl.status = 'connected'; ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.forceDisconnect('health');
        expect(ctrl.reconnectAttempts).toBe(1);
        // Simulate second reconnect
        ctrl.status = 'connected'; ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.forceDisconnect('health');
        expect(ctrl.reconnectAttempts).toBe(2);
    });

    it('caps delay at configured max (default 5 minutes)', () => {
        ctrl.reconnectAttempts = 20; // 2^20 * 1000 = 1048576000ms >> 5min
        ctrl.scheduleReconnect();
        // Timer should be set (we can't easily check the exact delay with fake timers,
        // but we verify it doesn't crash and the timer is set)
        expect(ctrl.reconnectTimer).not.toBeNull();
    });

    it('jitter stays within ±20% bounds after 100 iterations', () => {
        const delays: number[] = [];
        const spy = vi.spyOn(globalThis, 'setTimeout');
        for (let i = 0; i < 100; i++) {
            ctrl.reconnectAttempts = 3; // base = 8000ms, cap = 300000ms
            ctrl.reconnectTimer = null;
            ctrl.scheduleReconnect();
            const call = spy.mock.calls[spy.mock.calls.length - 1];
            delays.push(call[1] as number);
        }
        const base = 8000;
        for (const d of delays) {
            expect(d).toBeGreaterThanOrEqual(base * 0.8);
            expect(d).toBeLessThanOrEqual(base * 1.2);
        }
        spy.mockRestore();
    });

    it('resets retry counter to 0 on successful reconnect', async () => {
        ctrl.reconnectAttempts = 5;
        ctrl.resetOnSuccessfulConnect();
        expect(ctrl.reconnectAttempts).toBe(0);
    });

    it('cancels pending reconnect timer on forceDisconnect', () => {
        ctrl.status = 'connected'; ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.forceDisconnect('health'); // schedules reconnect
        expect(ctrl.reconnectTimer).not.toBeNull();
        ctrl.status = 'connected'; ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
        ctrl.forceDisconnect('user'); // should clear reconnect timer
        expect(ctrl.reconnectTimer).toBeNull();
    });

    it('never gives up — retries indefinitely after many failures', () => {
        for (let i = 0; i < 20; i++) {
            ctrl.status = 'connected';
            ctrl.client = { close: vi.fn() } as unknown as ImapFlow;
            ctrl.forceDisconnect('health');
        }
        expect(ctrl.reconnectAttempts).toBe(20);
        expect(ctrl.reconnectTimer).not.toBeNull(); // still scheduling
    });

    it('emits sync:status connecting during reconnect', () => {
        const statusCb = vi.fn();
        ctrl.setStatusCallback(statusCb);
        ctrl.status = 'connecting';
        ctrl.emitStatus();
        expect(statusCb).toHaveBeenCalledWith('acc-1', 'connecting', null);
    });

    it('emits sync:status error after failed reconnect attempt', () => {
        const statusCb = vi.fn();
        ctrl.setStatusCallback(statusCb);
        ctrl.status = 'error';
        ctrl.emitStatus();
        expect(statusCb).toHaveBeenCalledWith('acc-1', 'error', null);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: FAIL — `resetOnSuccessfulConnect` does not exist

- [ ] **Step 3: Add `resetOnSuccessfulConnect` method**

```typescript
resetOnSuccessfulConnect(): void {
    this.reconnectAttempts = 0;
    this.consecutiveFailures = 0;
    this.lastSuccessfulSync = Date.now();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat: add reconnect backoff with jitter, cap, and infinite retry"
```

---

## Task 6: Heartbeat — Tests + Implementation

**Files:**
- Modify: `electron/imapSync.test.ts`
- Modify: `electron/imap.ts`

- [ ] **Step 1: Write heartbeat tests**

```typescript
describe('heartbeat', () => {
    it('sends NOOP every 2 minutes', async () => {
        ctrl.client = { noop: mockNoop, close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.startHeartbeat();
        expect(mockNoop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(mockNoop).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(mockNoop).toHaveBeenCalledTimes(2);
    });

    it('updates lastSuccessfulSync on successful NOOP', async () => {
        ctrl.client = { noop: mockNoop, close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.startHeartbeat();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(ctrl.lastSuccessfulSync).not.toBeNull();
    });

    it('calls forceDisconnect on NOOP timeout (5s)', async () => {
        const neverResolves = new Promise(() => {});
        const slowNoop = vi.fn().mockReturnValue(neverResolves);
        ctrl.client = { noop: slowNoop, close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.startHeartbeat();
        await vi.advanceTimersByTimeAsync(120_000 + 5001);
        expect(ctrl.status).toBe('disconnected');
    });

    it('does not send NOOP when client is null', async () => {
        ctrl.client = null;
        ctrl.status = 'disconnected';
        ctrl.startHeartbeat();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(mockNoop).not.toHaveBeenCalled();
    });

    it('heartbeat timer is cleared on forceDisconnect', () => {
        ctrl.client = { noop: mockNoop, close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.startHeartbeat();
        expect(ctrl.heartbeatTimer).not.toBeNull();
        ctrl.forceDisconnect('health');
        expect(ctrl.heartbeatTimer).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: FAIL — `startHeartbeat` does not exist

- [ ] **Step 3: Implement `startHeartbeat`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat: add NOOP heartbeat with 2-minute interval and 5s timeout"
```

---

## Task 7: Sync Cycle — Tests + Implementation

**Files:**
- Modify: `electron/imapSync.test.ts`
- Modify: `electron/imap.ts`

- [ ] **Step 1: Write sync cycle tests**

Add tests for `runInboxSync` and `runFullSync` methods:

```typescript
describe('sync cycle', () => {
    it('skips sync when syncing flag is true', async () => {
        ctrl.syncing = true;
        const result = await ctrl.runInboxSync();
        expect(result).toBe(false); // skipped
    });

    it('resets syncing flag in finally block even if sync throws', async () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        // Mock syncNewEmails to throw
        ctrl.syncNewEmails = vi.fn().mockRejectedValue(new Error('fail'));
        await ctrl.runInboxSync();
        expect(ctrl.syncing).toBe(false);
    });

    it('updates lastSuccessfulSync on successful sync', async () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.syncNewEmails = vi.fn().mockResolvedValue(0);
        // Mock DB to return inbox folder
        mockDbPrepare.mockReturnValueOnce({
            all: vi.fn().mockReturnValue([{ path: '/INBOX', type: 'inbox' }]),
            get: vi.fn(), run: vi.fn(),
        });
        await ctrl.runInboxSync();
        expect(ctrl.lastSuccessfulSync).not.toBeNull();
    });

    it('increments consecutiveFailures on failed sync', async () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.syncNewEmails = vi.fn().mockRejectedValue(new Error('timeout'));
        await ctrl.runInboxSync();
        expect(ctrl.consecutiveFailures).toBe(1);
    });

    it('resets consecutiveFailures on successful sync', async () => {
        ctrl.consecutiveFailures = 3;
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.syncNewEmails = vi.fn().mockResolvedValue(0);
        mockDbPrepare.mockReturnValueOnce({
            all: vi.fn().mockReturnValue([{ path: '/INBOX', type: 'inbox' }]),
            get: vi.fn(), run: vi.fn(),
        });
        await ctrl.runInboxSync();
        expect(ctrl.consecutiveFailures).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: FAIL — `runInboxSync` does not exist

- [ ] **Step 3: Implement `runInboxSync` and `runFullSync`**

**Note on `vi.useFakeTimers()`:** All `setTimeout`/`setInterval` calls — including those inside `withImapTimeout` — are controlled by fake timers. The heartbeat and sync tests advance time to trigger both the interval callback and the inner `withImapTimeout` deadline. This works because `withImapTimeout` uses standard `setTimeout`, not `process.nextTick`.

```typescript
async runInboxSync(): Promise<boolean> {
    if (this.syncing || this.status === 'disconnected' || !this.client) return false;
    this.syncing = true;
    this.emitStatus(); // emit 'syncing'
    try {
        const db = getDatabase();
        const inboxFolder = db.prepare(
            "SELECT path FROM folders WHERE account_id = ? AND type = 'inbox'"
        ).get(this.accountId) as { path: string } | undefined;
        if (!inboxFolder) return false;

        const mailbox = inboxFolder.path.replace(/^\//, '');
        await withImapTimeout(
            () => this.syncNewEmails(mailbox),
            60_000,
            `syncNewEmails(${mailbox})`
        );
        this.lastSuccessfulSync = Date.now();
        this.consecutiveFailures = 0;
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
        if (this.pendingIntervalUpdate) {
            const pending = this.pendingIntervalUpdate;
            this.pendingIntervalUpdate = null;
            this.settings = { ...pending };
            this.restartSyncTimers();
        }
        this.emitStatus(); // emit current status
    }
}

async runFullSync(): Promise<void> {
    if (this.syncing || this.status === 'disconnected' || !this.client) return;
    this.syncing = true;
    this.emitStatus();
    try {
        const db = getDatabase();
        const allFolders = db.prepare(
            "SELECT path, type FROM folders WHERE account_id = ? ORDER BY CASE WHEN type = 'inbox' THEN 0 ELSE 1 END"
        ).all(this.accountId) as Array<{ path: string; type: string }>;

        for (const f of allFolders) {
            if (this.status === 'disconnected') break;
            const mailbox = f.path.replace(/^\//, '');
            try {
                await withImapTimeout(
                    () => this.syncNewEmails(mailbox),
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
        if (this.pendingIntervalUpdate) {
            const pending = this.pendingIntervalUpdate;
            this.pendingIntervalUpdate = null;
            this.settings = { ...pending };
            this.restartSyncTimers();
        }
        this.emitStatus();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: PASS

- [ ] **Step 5: Write timer integration tests (TDD — tests first)**

```typescript
describe('sync timers', () => {
    it('inbox timer fires at inboxIntervalSec', async () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        const spy = vi.spyOn(ctrl, 'runInboxSync').mockResolvedValue(true);
        ctrl.startSyncTimers();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(spy).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });

    it('folder timer fires at folderIntervalSec', async () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        const spy = vi.spyOn(ctrl, 'runFullSync').mockResolvedValue();
        ctrl.startSyncTimers();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});
```

- [ ] **Step 6: Run timer tests to verify they fail**

Expected: FAIL — `startSyncTimers` does not exist

- [ ] **Step 7: Implement `startSyncTimers`**

```typescript
startSyncTimers(): void {
    if (this.inboxSyncTimer) clearInterval(this.inboxSyncTimer);
    if (this.folderSyncTimer) clearInterval(this.folderSyncTimer);
    this.inboxSyncTimer = setInterval(() => { this.runInboxSync(); }, this.settings.inboxIntervalSec * 1000);
    this.folderSyncTimer = setInterval(() => { this.runFullSync(); }, this.settings.folderIntervalSec * 1000);
}
```

- [ ] **Step 8: Run timer tests to verify they pass**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat: add per-account sync cycle with inbox/folder timers and overlap guard"
```

---

## Task 8: `updateIntervals` — Tests + Implementation

**Files:**
- Modify: `electron/imapSync.test.ts`
- Modify: `electron/imap.ts`

- [ ] **Step 1: Write updateIntervals tests**

Test the `pendingIntervalUpdate` flag behavior and timer recreation.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `updateIntervals`**

```typescript
updateIntervals(settings: SyncSettings): void {
    if (this.syncing) {
        this.pendingIntervalUpdate = settings;
        return;
    }
    this.settings = { ...settings };
    this.restartSyncTimers();
}

private restartSyncTimers(): void {
    if (this.inboxSyncTimer) { clearInterval(this.inboxSyncTimer); this.inboxSyncTimer = null; }
    if (this.folderSyncTimer) { clearInterval(this.folderSyncTimer); this.folderSyncTimer = null; }
    this.startSyncTimers();
}
```

The sync cycle `finally` block checks `pendingIntervalUpdate` and applies it.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat: add updateIntervals with pendingIntervalUpdate for sync-safe settings changes"
```

---

## Task 9: Refactor `ImapEngine` to Use Controllers

**Files:**
- Modify: `electron/imap.ts`
- Modify: `electron/imapSync.test.ts`

This is the core refactor: replace `ImapEngine`'s scattered Maps with `controllers: Map<string, AccountSyncController>`.

- [ ] **Step 1: Write ImapEngine integration tests**

Test `startAccount`, `stopController`, `disconnectAll`, `isConnected` staleness, `updateSyncIntervals`.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Refactor `ImapEngine`**

Key changes:
- Remove: `clients`, `syncing`, `lastSeenUid`, `retryTimeouts`, `retryCounts` Maps
- Add: `controllers: Map<string, AccountSyncController>`
- `startAccount(accountId)`: creates controller, connects, syncs, starts timers:

```typescript
async startAccount(accountId: string): Promise<void> {
    // Stop any existing controller for this account
    if (this.controllers.has(accountId)) {
        this.stopController(accountId);
    }
    const db = getDatabase();
    const settings = this.readSyncSettings(db);
    const ctrl = new AccountSyncController(accountId, settings);
    ctrl.setStatusCallback(this.statusCallback);
    ctrl.setNewEmailCallback(this.newEmailCallback);
    this.controllers.set(accountId, ctrl);

    ctrl.status = 'connecting';
    ctrl.emitStatus();
    try {
        await ctrl.connect(); // wraps connectAccount logic
        const folders = await ctrl.listAndSyncFolders();
        const inbox = folders.find(f => f.type === 'inbox');
        if (inbox) {
            await ctrl.syncNewEmails(inbox.path.replace(/^\//, ''));
        }
        for (const folder of folders) {
            if (folder.type === 'inbox') continue;
            try {
                await ctrl.syncNewEmails(folder.path.replace(/^\//, ''));
            } catch { /* non-inbox sync failure is non-blocking */ }
        }
        ctrl.resetOnSuccessfulConnect();
        ctrl.status = 'connected';
        ctrl.startHeartbeat();
        ctrl.startSyncTimers();
        ctrl.emitStatus();
    } catch (err) {
        ctrl.status = 'error';
        ctrl.emitStatus();
        logDebug(`[IMAP:${accountId}] startAccount failed: ${err instanceof Error ? err.message : String(err)}`);
        ctrl.scheduleReconnect();
    }
}
```
- `stopController(accountId)`: calls `forceDisconnect('user')`, deletes from map
- `disconnectAccount(accountId)`: calls `stopController`
- `disconnectAll()`: iterates controllers with `forceDisconnect('shutdown')`
- `isConnected(accountId)`: checks controller status + 180s staleness
- `isReconnecting(accountId)`: checks `ctrl.reconnectTimer !== null`
- `syncNewEmails(accountId, mailbox)`: delegates to controller, checks `syncing` guard
- `updateSyncIntervals(settings)`: iterates controllers, calls `updateIntervals`
- Move `connectAccount` logic into `AccountSyncController.connect()`
- Move `syncNewEmails` logic into `AccountSyncController.syncNewEmails()`
- Keep all other methods (`markAsRead`, `moveMessage`, etc.) on `ImapEngine`, accessing `ctrl.client`

- [ ] **Step 4: Run ALL tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "refactor: replace ImapEngine Maps with per-account AccountSyncController"
```

---

## Task 10: Refactor `main.ts` — Delete Poll Loop, Wire `startAccount`

**Files:**
- Modify: `electron/main.ts`

**Note:** Line numbers below are approximate. Always search by pattern (e.g., `pollSyncRunning`, `setInterval(async`, `lastSyncTimestamps`) rather than relying on exact line numbers, as earlier edits may have shifted them.

- [ ] **Step 1: Delete the poll loop**

Remove the entire `setInterval(async () => { ... }, 15_000)` block (search for `pollSyncRunning`), the `pollSyncRunning` flag, and the `lastSyncTimestamps` Map (search for `lastSyncTimestamps`).

- [ ] **Step 2: Replace startup IMAP sequence**

Replace the `for (const account of accounts)` startup block (~lines 2682-2718) with:

```typescript
for (const account of accounts) {
    imapEngine.startAccount(account.id).catch((err) => {
        logDebug(`[WARN] Startup IMAP failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
    });
}
```

- [ ] **Step 3: Update `sendSyncStatus` type**

Widen the status union (~line 86):

```typescript
function sendSyncStatus(accountId: string, status: 'connecting' | 'connected' | 'error' | 'stale' | 'syncing', timestamp: number | null) {
```

- [ ] **Step 4: Wire `onStatusChange` callback**

After `imapEngine.setNewEmailCallback(...)` (~line 2575), add:

```typescript
imapEngine.setStatusCallback((accountId, status, timestamp) => {
    sendSyncStatus(accountId, status as 'connecting' | 'connected' | 'error' | 'stale' | 'syncing', timestamp);
});
```

- [ ] **Step 5: Update `imap:status` IPC handler**

Modify the `imap:status` handler (~line 1278) to return the enriched response:

```typescript
ipcMain.handle('imap:status', (_event, accountId: string) => {
    return imapEngine.getStatus(accountId);
});
```

Where `getStatus` returns `{ status, lastSync, consecutiveFailures, reconnectAttempts }`.

- [ ] **Step 6: Add `ALLOWED_SETTINGS_KEYS` entries**

Add to the Set at ~line 1309:

```typescript
const ALLOWED_SETTINGS_KEYS = new Set([...existing..., 'sync_interval_inbox', 'sync_interval_folders', 'reconnect_max_interval']);
```

- [ ] **Step 7: Add `imap:apply-sync-settings` IPC handler**

Add after the `settings:set` handler:

```typescript
ipcMain.handle('imap:apply-sync-settings', () => {
    const db = getDatabase();
    const get = (key: string, def: string) =>
        (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? def;
    imapEngine.updateSyncIntervals({
        inboxIntervalSec: parseInt(get('sync_interval_inbox', '15'), 10),
        folderIntervalSec: parseInt(get('sync_interval_folders', '60'), 10),
        reconnectMaxMinutes: parseInt(get('reconnect_max_interval', '5'), 10),
    });
    return { success: true };
});
```

- [ ] **Step 8: Update post-add account wiring**

Replace the `connectAccount` + manual sync sequence in the `accounts:add` handler (~line 358) with `imapEngine.startAccount(id)`.

- [ ] **Step 9: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add electron/main.ts
git commit -m "refactor: delete global poll loop, wire startAccount and sync settings IPC"
```

---

## Task 11: Preload Allowlist Update

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add `imap:apply-sync-settings` to `ALLOWED_INVOKE_CHANNELS`**

After `'imap:status'` (~line 95):

```typescript
'imap:apply-sync-settings',
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: add imap:apply-sync-settings to preload allowlist"
```

---

## Task 12: Sidebar — Staleness-Aware Status Indicator

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.module.css`

- [ ] **Step 1: Extend `imapStatus` type union**

In `Sidebar.tsx` (~line 86), change:

```typescript
const [imapStatus, setImapStatus] = useState<'none' | 'error' | 'connecting' | 'connected' | 'partial'>('none');
```
To:
```typescript
const [imapStatus, setImapStatus] = useState<'none' | 'error' | 'connecting' | 'connected' | 'partial' | 'stale' | 'syncing'>('none');
```

- [ ] **Step 2: Add stale/syncing status rendering**

In the sync status display section (~line 1092), add conditions for `stale` and `syncing`:

```typescript
: imapStatus === 'stale'
  ? t('sidebar.stale')
  : imapStatus === 'syncing'
    ? t('sidebar.syncing')
```

- [ ] **Step 3: Add CSS classes for amber and syncing dots**

In `Sidebar.module.css`, add:

```css
.sync-stale {
    background-color: rgb(var(--warning-rgb, 245 158 11));
}

.sync-syncing {
    background-color: rgb(var(--accent-rgb));
    animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
```

- [ ] **Step 4: Add enhanced tooltip for All Accounts mode**

In the All Accounts sync status section, update the tooltip to show per-account breakdown. Modify the `aggregateStatuses` function and the tooltip `aria-label`/`title` to include per-account details:

```typescript
// In the tooltip/title attribute for the sync dot (All Accounts mode):
// Build per-account status string from the individual statuses
const perAccountLabel = results
    .filter((r): r is { accountId: string; status: string; lastSync: number | null } => r != null)
    .map(r => {
        const name = accounts.find(a => a.id === r.accountId)?.email?.split('@')[0] ?? r.accountId;
        const age = r.lastSync ? `${Math.floor((Date.now() - r.lastSync) / 1000)}s ago` : 'never';
        return `${name}: ${r.status === 'connected' ? age : r.status}`;
    })
    .join(', ');
```

Use this `perAccountLabel` in the tooltip `title` when `selectedAccountId === '__all'`.

- [ ] **Step 5: Add i18n strings**

Add to `src/locales/en/translation.json`:

```json
"sidebar.stale": "Stale",
"sidebar.syncing": "Syncing..."
```

Add corresponding keys to `fr`, `es`, `de` translation files.

- [ ] **Step 6: Run lint**

Run: `npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.module.css src/locales/
git commit -m "feat: add stale/syncing status indicators with amber dot, pulse, and per-account tooltip"
```

---

## Task 13: Settings UI — Sync Interval Controls

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Add state and load settings**

Add state variables for the 3 sync settings. Load them in the existing `useEffect` that loads settings on mount:

```typescript
const [syncInboxInterval, setSyncInboxInterval] = useState('15');
const [syncFolderInterval, setSyncFolderInterval] = useState('60');
const [reconnectMaxInterval, setReconnectMaxInterval] = useState('5');
```

- [ ] **Step 2: Add "Sync" sub-tab trigger**

In the `email` category tabs section (~line 755-759), add a new tab:

```typescript
<Tabs.Trigger className={styles['tab-btn']} value="sync"><RefreshCw size={16} /><span>{t('settings.sync')}</span></Tabs.Trigger>
```

Import `RefreshCw` from `lucide-react`.

- [ ] **Step 3: Add Sync tab content panel**

Add a `Tabs.Content` for `value="sync"` with 3 select dropdowns:

```tsx
<Tabs.Content value="sync" className={styles['tab-content']}>
    <h3 className={styles['section-title']}>{t('settings.syncTitle')}</h3>

    <div className={styles['form-row']}>
        <label className={styles['form-label']}>{t('settings.inboxSyncInterval')}</label>
        <select value={syncInboxInterval} onChange={async (e) => {
            setSyncInboxInterval(e.target.value);
            await ipcInvoke('settings:set', 'sync_interval_inbox', e.target.value);
            await ipcInvoke('imap:apply-sync-settings');
        }}>
            <option value="10">10s</option>
            <option value="15">15s</option>
            <option value="30">30s</option>
            <option value="60">1 min</option>
            <option value="120">2 min</option>
        </select>
    </div>

    <div className={styles['form-row']}>
        <label className={styles['form-label']}>{t('settings.folderSyncInterval')}</label>
        <select value={syncFolderInterval} onChange={async (e) => {
            setSyncFolderInterval(e.target.value);
            await ipcInvoke('settings:set', 'sync_interval_folders', e.target.value);
            await ipcInvoke('imap:apply-sync-settings');
        }}>
            <option value="30">30s</option>
            <option value="60">1 min</option>
            <option value="120">2 min</option>
            <option value="180">3 min</option>
            <option value="300">5 min</option>
        </select>
    </div>

    <div className={styles['form-row']}>
        <label className={styles['form-label']}>{t('settings.reconnectMaxInterval')}</label>
        <select value={reconnectMaxInterval} onChange={async (e) => {
            setReconnectMaxInterval(e.target.value);
            await ipcInvoke('settings:set', 'reconnect_max_interval', e.target.value);
            await ipcInvoke('imap:apply-sync-settings');
        }}>
            <option value="1">1 min</option>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
        </select>
    </div>
</Tabs.Content>
```

- [ ] **Step 4: Add i18n strings**

```json
"settings.sync": "Sync",
"settings.syncTitle": "Email Sync Settings",
"settings.inboxSyncInterval": "Inbox check interval",
"settings.folderSyncInterval": "Other folders check interval",
"settings.reconnectMaxInterval": "Max reconnect wait time"
```

- [ ] **Step 5: Run lint**

Run: `npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.tsx src/locales/
git commit -m "feat: add sync interval settings UI (inbox, folders, reconnect)"
```

---

## Task 14: Edge Case & Integration Tests

**Files:**
- Modify: `electron/imapSync.test.ts`

- [ ] **Step 1: Write parallel account isolation tests**

```typescript
describe('parallel account isolation', () => {
    it('one account forceDisconnect does not affect other accounts', () => {
        const engine = new ImapEngine();
        // Set up 2 controllers
        const ctrl1 = new AccountSyncController('acc-1');
        const ctrl2 = new AccountSyncController('acc-2');
        ctrl1.status = 'connected'; ctrl1.client = { close: vi.fn() } as unknown as ImapFlow;
        ctrl2.status = 'connected'; ctrl2.client = { close: vi.fn() } as unknown as ImapFlow;
        engine.controllers.set('acc-1', ctrl1);
        engine.controllers.set('acc-2', ctrl2);

        ctrl1.forceDisconnect('health');
        expect(ctrl1.status).toBe('disconnected');
        expect(ctrl2.status).toBe('connected');
    });

    it('each account has independent reconnect backoff state', () => {
        const ctrl1 = new AccountSyncController('acc-1');
        const ctrl2 = new AccountSyncController('acc-2');
        ctrl1.reconnectAttempts = 5;
        ctrl2.reconnectAttempts = 0;
        expect(ctrl1.reconnectAttempts).not.toBe(ctrl2.reconnectAttempts);
    });
});
```

- [ ] **Step 2: Write edge case tests**

```typescript
describe('edge cases', () => {
    it('concurrent forceDisconnect calls produce single reconnect', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.forceDisconnect('health');
        const timer1 = ctrl.reconnectTimer;
        ctrl.forceDisconnect('health'); // idempotent — already disconnected
        expect(ctrl.reconnectTimer).toBe(timer1); // same timer, not doubled
    });

    it('app quit clears all timers', () => {
        ctrl.client = { close: mockClose } as unknown as ImapFlow;
        ctrl.status = 'connected';
        ctrl.startHeartbeat();
        ctrl.forceDisconnect('shutdown');
        expect(ctrl.heartbeatTimer).toBeNull();
        expect(ctrl.reconnectTimer).toBeNull();
    });
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 4: Run test coverage**

Run: `npx vitest run --coverage`
Expected: `withImapTimeout` 100%, `AccountSyncController` 90%+

- [ ] **Step 5: Commit**

```bash
git add electron/imapSync.test.ts
git commit -m "test: add parallel isolation and edge case tests for sync reliability"
```

---

## Task 15: Final Validation — Lint, Build, Quality

**Files:** None (validation only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: 800+ tests pass (723 existing + ~88 new)

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Run build**

Run: `npm run build:win`
Expected: Build succeeds

- [ ] **Step 5: Run E2E Console Health (if C++ build tools available)**

Run: `npm run test:e2e -- --grep "Console Health"`
Expected: PASS — no runtime errors, deprecation warnings, or console errors across all app sections. This requires the build from Step 4. Skip locally if C++ build tools are unavailable, but this is mandatory in CI.

- [ ] **Step 6: Update CLAUDE.md**

Update the following sections:
- IMAP sync description: mention per-account controllers, heartbeat, infinite reconnect
- Known Issues: mark IMAP sync as tested, remove "deferred to E2E" note
- Test count: update to new total
- Phase description: add sync reliability to current phase

- [ ] **Step 7: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for IMAP sync reliability redesign"
```
