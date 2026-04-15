# Yahoo Delete Lock-Contention Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the race between background IMAP sync and user-initiated delete/move/body-refetch on Yahoo (and all other) accounts so that deleting a newly-arrived email succeeds within one second, every time.

**Architecture:** Three coordinated changes: (1) introduce a per-account FIFO async queue on `AccountSyncController` that serializes user-initiated IMAP operations without blocking background sync; (2) refactor `syncNewEmails` to do raw-source fetch inside the mailbox lock and MIME parsing outside the lock, with 100-message chunking to bound memory; (3) raise `refetchEmailBody` lock timeout from 10s to 30s so all user-action paths share one budget.

**Tech Stack:** TypeScript 5.9 strict, Electron 41, IMAPFlow, Vitest 4 + jsdom, better-sqlite3.

**Spec reference:** `docs/superpowers/specs/2026-04-14-yahoo-delete-lock-fix-design.md`.

**Invariant to preserve:** Mailbox locks must only protect IMAP fetch/state operations, not MIME parsing or DB-heavy post-processing.

---

## File Structure

| File | Purpose |
|---|---|
| `electron/asyncQueue.ts` (**new**) | `AsyncQueue` class — FIFO serial executor with `enqueue()`, `drain()`, and empty-queue fast path |
| `electron/asyncQueue.test.ts` (**new**) | Unit tests: FIFO ordering, independent rejection, drain, empty-queue latency |
| `electron/imap.ts` (**modified**) | Add `operationQueue` field on `AccountSyncController`; route `deleteMessage` / `moveMessage` / `refetchEmailBody` through queue; refactor `syncNewEmails` to two-phase + chunked; drain queue on `forceDisconnect` |
| `electron/imapSync.test.ts` (**modified**) | Add regression tests: sync correctness (golden snapshot), malformed-message isolation, lock-release-before-parse sentinel, chunked large-delta path |
| `package.json` (**modified**) | Bump `version` to `1.17.4` |
| `CLAUDE.md` (**modified**) | Update status line to `v1.17.4` and test count |

No changes to `electron/main.ts` — the existing IPC handlers call `imapEngine.deleteMessage` / `moveMessage` / `refetchEmailBody`, and we queue inside those methods rather than at the handler level. No changes to `electron/db.ts`, `electron/scheduler.ts`, or any renderer file.

---

## Task 1: AsyncQueue class — FIFO serial executor

**Files:**
- Create: `electron/asyncQueue.ts`
- Test: `electron/asyncQueue.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `electron/asyncQueue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { AsyncQueue, QueueDrainedError } from './asyncQueue.js';

describe('AsyncQueue', () => {
    it('resolves tasks in FIFO order', async () => {
        const queue = new AsyncQueue();
        const log: number[] = [];

        const p1 = queue.enqueue(async () => { await Promise.resolve(); log.push(1); return 1; });
        const p2 = queue.enqueue(async () => { await Promise.resolve(); log.push(2); return 2; });
        const p3 = queue.enqueue(async () => { await Promise.resolve(); log.push(3); return 3; });

        const results = await Promise.all([p1, p2, p3]);
        expect(results).toEqual([1, 2, 3]);
        expect(log).toEqual([1, 2, 3]);
    });

    it('allows other tasks to continue after one task rejects', async () => {
        const queue = new AsyncQueue();
        const task1 = queue.enqueue(async () => 'a');
        const task2 = queue.enqueue(async () => { throw new Error('boom'); });
        const task3 = queue.enqueue(async () => 'c');

        await expect(task1).resolves.toBe('a');
        await expect(task2).rejects.toThrow('boom');
        await expect(task3).resolves.toBe('c');
    });

    it('serializes overlapping execution (no two tasks run concurrently)', async () => {
        const queue = new AsyncQueue();
        let concurrent = 0;
        let maxConcurrent = 0;

        const makeTask = () => queue.enqueue(async () => {
            concurrent++;
            if (concurrent > maxConcurrent) maxConcurrent = concurrent;
            await new Promise(resolve => setTimeout(resolve, 5));
            concurrent--;
        });

        await Promise.all([makeTask(), makeTask(), makeTask(), makeTask()]);
        expect(maxConcurrent).toBe(1);
    });

    it('executes a single task on the next microtask when queue is empty', async () => {
        const queue = new AsyncQueue();
        const spy = vi.fn(async () => 'done');
        const result = await queue.enqueue(spy);
        expect(result).toBe('done');
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('drain() rejects all pending tasks with QueueDrainedError', async () => {
        const queue = new AsyncQueue();
        const blockingTask = queue.enqueue(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return 'first';
        });
        const pending1 = queue.enqueue(async () => 'second');
        const pending2 = queue.enqueue(async () => 'third');

        queue.drain();

        await expect(blockingTask).resolves.toBe('first');
        await expect(pending1).rejects.toBeInstanceOf(QueueDrainedError);
        await expect(pending2).rejects.toBeInstanceOf(QueueDrainedError);
    });

    it('QueueDrainedError has a clear message', () => {
        const err = new QueueDrainedError('test-account');
        expect(err.message).toContain('test-account');
        expect(err.name).toBe('QueueDrainedError');
    });
});
```

- [ ] **Step 2: Run tests — expect failure on missing module**

Run: `npx vitest run electron/asyncQueue.test.ts`
Expected: FAIL — `Cannot find module './asyncQueue.js'`.

- [ ] **Step 3: Implement `AsyncQueue`**

Create `electron/asyncQueue.ts`:

```ts
export class QueueDrainedError extends Error {
    constructor(accountId: string) {
        super(`Operation queue drained for account ${accountId}`);
        this.name = 'QueueDrainedError';
    }
}

type QueuedTask<T> = {
    run: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
};

export class AsyncQueue {
    private readonly accountId: string;
    private readonly queue: QueuedTask<unknown>[] = [];
    private running = false;
    private drained = false;

    constructor(accountId = 'unknown') {
        this.accountId = accountId;
    }

    enqueue<T>(task: () => Promise<T>): Promise<T> {
        if (this.drained) {
            return Promise.reject(new QueueDrainedError(this.accountId));
        }
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ run: task, resolve: resolve as (v: unknown) => void, reject });
            if (!this.running) {
                void this.dispatch();
            }
        });
    }

    drain(): void {
        this.drained = true;
        const pending = this.queue.splice(0, this.queue.length);
        for (const task of pending) {
            task.reject(new QueueDrainedError(this.accountId));
        }
    }

    get size(): number {
        return this.queue.length;
    }

    private async dispatch(): Promise<void> {
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const task = this.queue.shift()!;
                try {
                    const result = await task.run();
                    task.resolve(result);
                } catch (err) {
                    task.reject(err);
                }
            }
        } finally {
            this.running = false;
        }
    }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run electron/asyncQueue.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Lint the new files**

Run: `npm run lint -- electron/asyncQueue.ts electron/asyncQueue.test.ts`
Expected: zero warnings, zero errors.

- [ ] **Step 6: Commit**

```bash
git add electron/asyncQueue.ts electron/asyncQueue.test.ts
git commit -m "feat(imap): add AsyncQueue FIFO serial executor with drain support"
```

---

## Task 2: Wire AsyncQueue into AccountSyncController

**Files:**
- Modify: `electron/imap.ts:116-167` (controller class)
- Test: `electron/imapSync.test.ts` (new describe block)

- [ ] **Step 1: Write the failing test**

Append to `electron/imapSync.test.ts` inside the existing `describe('ImapEngine (controller integration)', ...)` block or add a new describe:

```ts
describe('AccountSyncController.operationQueue', () => {
    it('exposes an operationQueue instance', () => {
        const ctrl = new AccountSyncController('acct-queue-1');
        expect(ctrl.operationQueue).toBeDefined();
        expect(typeof ctrl.operationQueue.enqueue).toBe('function');
    });

    it('drains the operation queue on forceDisconnect', async () => {
        const ctrl = new AccountSyncController('acct-queue-2');
        ctrl.status = 'connected';
        // Seed a blocking task so subsequent enqueues are pending.
        const blocker = ctrl.operationQueue.enqueue(() =>
            new Promise<string>(resolve => setTimeout(() => resolve('done'), 50))
        );
        const pending = ctrl.operationQueue.enqueue(async () => 'never-runs');

        ctrl.forceDisconnect('user');

        await expect(blocker).resolves.toBe('done');
        await expect(pending).rejects.toThrow(/drained/);
    });
});
```

- [ ] **Step 2: Run tests — expect failure on missing property**

Run: `npx vitest run electron/imapSync.test.ts -t "operationQueue"`
Expected: FAIL — `ctrl.operationQueue is undefined` or compile error.

- [ ] **Step 3: Add `operationQueue` field to controller**

Edit `electron/imap.ts`. Add an import near the other imports at the top of the file:

```ts
import { AsyncQueue } from './asyncQueue.js';
```

Inside the `AccountSyncController` class declaration (around line 117-136), add the field near the other instance fields:

```ts
    readonly operationQueue: AsyncQueue;
```

Initialize it in the constructor (around line 138-143):

```ts
    constructor(accountId: string, settings?: Partial<SyncSettings>) {
        this.accountId = accountId;
        this.operationQueue = new AsyncQueue(accountId);
        if (settings) {
            this.settings = { ...this.settings, ...settings };
        }
    }
```

In `forceDisconnect` (around line 169-183), drain the queue before the `logDebug` line:

```ts
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
        this.operationQueue.drain();
        logDebug(`[IMAP:${this.accountId}] Force disconnected (reason: ${reason})`);
        if (reason === 'health') {
            this.scheduleReconnect();
        }
    }
```

Also drain in `stop()` (around line 157-167) after `this.syncingFolders.clear();`:

```ts
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
        this.operationQueue.drain();
    }
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "operationQueue"`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Run the full imapSync suite to check for regressions**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat(imap): attach operationQueue to AccountSyncController with drain on disconnect"
```

---

## Task 3: Route `deleteMessage` through the operation queue

**Files:**
- Modify: `electron/imap.ts:1210-1229` (deleteMessage method)
- Test: `electron/imapSync.test.ts` (new case)

- [ ] **Step 1: Write the failing test**

Append to the `describe('AccountSyncController.operationQueue', ...)` block:

```ts
it('routes deleteMessage through the operation queue (serial against other user ops)', async () => {
    const ctrl = new AccountSyncController('acct-delete-1');
    ctrl.status = 'connected';

    // Inject a fake client with a recording messageFlagsAdd / messageDelete
    const callOrder: string[] = [];
    const fakeClient = {
        getMailboxLock: vi.fn(async () => {
            callOrder.push('lock-acquired');
            return { release: () => callOrder.push('lock-released') };
        }),
        messageFlagsAdd: vi.fn(async () => { callOrder.push('flags-add'); }),
        messageDelete: vi.fn(async () => { callOrder.push('delete'); }),
    } as unknown as ImapFlow;
    ctrl.client = fakeClient;
    imapEngine['controllers'].set('acct-delete-1', ctrl);

    // Enqueue a blocking custom op first to prove serialization.
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
    expect(blockerEndIdx).toBeLessThan(flagsAddIdx);

    imapEngine['controllers'].delete('acct-delete-1');
});
```

- [ ] **Step 2: Run tests — expect failure (delete still bypasses queue)**

Run: `npx vitest run electron/imapSync.test.ts -t "deleteMessage through the operation queue"`
Expected: FAIL — `blockerEndIdx` is greater than `flagsAddIdx` because delete runs in parallel with blocker.

- [ ] **Step 3: Refactor `deleteMessage` to route through the queue**

Edit `electron/imap.ts` around line 1210. Extract the lock-acquiring body into a private method and wrap the public method in a queue call:

```ts
    async deleteMessage(accountId: string, emailUid: number, mailbox: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl?.client) return false;
        return ctrl.operationQueue.enqueue(() =>
            this._deleteMessageLocked(ctrl, emailUid, mailbox)
        );
    }

    private async _deleteMessageLocked(
        ctrl: AccountSyncController,
        emailUid: number,
        mailbox: string,
    ): Promise<boolean> {
        const client = ctrl.client;
        if (!client) return false;

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            30_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            await client.messageFlagsAdd(String(emailUid), ['\\Deleted'], { uid: true });
            await client.messageDelete(String(emailUid), { uid: true });
            return true;
        } catch (err) {
            logDebug(`[deleteMessage] error for uid=${emailUid} on ${mailbox}: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        } finally {
            lock.release();
        }
    }
```

Note: the previous `catch {}` was silent; we added a `logDebug` per the silent-failure-prevention rule in CLAUDE.md.

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "deleteMessage through the operation queue"`
Expected: PASS.

- [ ] **Step 5: Run the full imapSync suite**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat(imap): route deleteMessage through operationQueue"
```

---

## Task 4: Route `moveMessage` through the operation queue

**Files:**
- Modify: `electron/imap.ts:1081-1104` (moveMessage method)
- Test: `electron/imapSync.test.ts` (new case)

- [ ] **Step 1: Write the failing test**

Append to the operationQueue describe:

```ts
it('routes moveMessage through the operation queue', async () => {
    const ctrl = new AccountSyncController('acct-move-1');
    ctrl.status = 'connected';

    const callOrder: string[] = [];
    const fakeClient = {
        getMailboxLock: vi.fn(async () => {
            callOrder.push('lock-acquired');
            return { release: () => callOrder.push('lock-released') };
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

    expect(callOrder.indexOf('blocker-end')).toBeLessThan(callOrder.indexOf('move'));
    imapEngine['controllers'].delete('acct-move-1');
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run electron/imapSync.test.ts -t "moveMessage through the operation queue"`
Expected: FAIL — move runs in parallel with blocker.

- [ ] **Step 3: Refactor `moveMessage` to route through the queue**

Edit `electron/imap.ts` around line 1081:

```ts
    async moveMessage(accountId: string, emailUid: number, sourceMailbox: string, destMailbox: string): Promise<boolean> {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl?.client) throw new Error('Account not connected');
        return ctrl.operationQueue.enqueue(() =>
            this._moveMessageLocked(ctrl, emailUid, sourceMailbox, destMailbox)
        );
    }

    private async _moveMessageLocked(
        ctrl: AccountSyncController,
        emailUid: number,
        sourceMailbox: string,
        destMailbox: string,
    ): Promise<boolean> {
        const client = ctrl.client;
        if (!client) return false;

        const lock = await withImapTimeout(
            () => client.getMailboxLock(sourceMailbox),
            30_000,
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "moveMessage through the operation queue"`
Expected: PASS.

- [ ] **Step 5: Full suite check**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "feat(imap): route moveMessage through operationQueue"
```

---

## Task 5: Route `refetchEmailBody` through queue AND raise its timeout to 30s

**Files:**
- Modify: `electron/imap.ts:1231-1280` (refetchEmailBody method)
- Test: `electron/imapSync.test.ts` (new case)

- [ ] **Step 1: Write the failing test**

Append to the operationQueue describe:

```ts
it('routes refetchEmailBody through the queue and uses 30s lock timeout', async () => {
    const ctrl = new AccountSyncController('acct-refetch-1');
    ctrl.status = 'connected';

    const callOrder: string[] = [];
    let lockTimeout = 0;
    const fakeClient = {
        getMailboxLock: vi.fn(async () => {
            callOrder.push('lock-acquired');
            return { release: () => callOrder.push('lock-released') };
        }),
        fetch: vi.fn(async function* () {
            yield { source: Buffer.from('Subject: test\r\n\r\nhello') };
        }),
    } as unknown as ImapFlow;
    ctrl.client = fakeClient;
    imapEngine['controllers'].set('acct-refetch-1', ctrl);

    // Spy on withImapTimeout indirectly by instrumenting getMailboxLock timing expectation —
    // instead, assert serialization via the queue blocker pattern.
    const blocker = ctrl.operationQueue.enqueue(async () => {
        callOrder.push('blocker-start');
        await new Promise(resolve => setTimeout(resolve, 20));
        callOrder.push('blocker-end');
    });
    const refetchPromise = imapEngine.refetchEmailBody('acct-refetch-1', 42, 'INBOX');
    await Promise.all([blocker, refetchPromise]);

    expect(callOrder.indexOf('blocker-end')).toBeLessThan(callOrder.indexOf('lock-acquired'));
    imapEngine['controllers'].delete('acct-refetch-1');

    // Also assert the timeout constant is 30_000 by grepping the source.
    const fs = await import('node:fs');
    const src = fs.readFileSync('electron/imap.ts', 'utf-8');
    const refetchMatch = src.match(/refetchEmailBody[\s\S]*?getMailboxLock[\s\S]*?(\d+)_000[\s\S]*?getMailboxLock/);
    // The first numeric timeout after refetchEmailBody declaration must be 30.
    const timeoutAfterRefetch = src.slice(src.indexOf('refetchEmailBody')).match(/(\d+)_000/);
    expect(timeoutAfterRefetch?.[1]).toBe('30');
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run electron/imapSync.test.ts -t "refetchEmailBody through the queue"`
Expected: FAIL — timeout currently 10_000 and the method bypasses the queue.

- [ ] **Step 3: Refactor `refetchEmailBody`**

Edit `electron/imap.ts` around line 1231:

```ts
    /** Re-fetch body for a single email (for repairing garbled charset decoding) */
    async refetchEmailBody(
        accountId: string,
        emailUid: number,
        mailbox: string
    ): Promise<{ bodyText: string; bodyHtml: string | null } | null> {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl?.client) return null;
        return ctrl.operationQueue.enqueue(() =>
            this._refetchEmailBodyLocked(ctrl, emailUid, mailbox)
        );
    }

    private async _refetchEmailBodyLocked(
        ctrl: AccountSyncController,
        emailUid: number,
        mailbox: string,
    ): Promise<{ bodyText: string; bodyHtml: string | null } | null> {
        const client = ctrl.client;
        if (!client) return null;

        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            30_000,
            `getMailboxLock(${mailbox})`
        );
        try {
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "refetchEmailBody through the queue"`
Expected: PASS.

- [ ] **Step 5: Full suite check**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "fix(imap): route refetchEmailBody through queue and bump lock timeout to 30s"
```

---

## Task 6: Refactor `syncNewEmails` into two-phase (parse outside lock)

**Files:**
- Modify: `electron/imap.ts:859-1043` (syncNewEmails method)
- Test: `electron/imapSync.test.ts` (new case: lock-release-before-parse sentinel)

- [ ] **Step 1: Write the failing sentinel test**

Append to `electron/imapSync.test.ts` in a new describe block:

```ts
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

        // Instrument simpleParser via the mailparser mock so we can record when it runs.
        const mailparser = await import('mailparser');
        const origParse = mailparser.simpleParser;
        const parseSpy = vi.spyOn(mailparser, 'simpleParser').mockImplementation(async (input) => {
            events.push('simple-parser-invoked');
            return origParse(input);
        });

        // Seed folder row via the db mock.
        mockDbPrepare.mockImplementation((sql: string) => {
            if (sql.includes('SELECT id, type FROM folders')) {
                return { get: () => ({ id: 'folder-inbox', type: 'inbox' }), all: () => [], run: () => ({ changes: 0 }) };
            }
            return { get: () => null, all: () => [], run: () => ({ changes: 1 }) };
        });

        await imapEngine.syncNewEmails('acct-sync-1', 'INBOX');

        parseSpy.mockRestore();
        imapEngine['controllers'].delete('acct-sync-1');

        const releaseIdx = events.indexOf('lock-released');
        const parseIdx = events.indexOf('simple-parser-invoked');
        expect(releaseIdx).toBeGreaterThan(-1);
        expect(parseIdx).toBeGreaterThan(-1);
        expect(releaseIdx).toBeLessThan(parseIdx);
    });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run electron/imapSync.test.ts -t "releases the mailbox lock before running simpleParser"`
Expected: FAIL — in the current code, `simpleParser` runs inside the lock so `parseIdx < releaseIdx`.

- [ ] **Step 3: Refactor `syncNewEmails` to two-phase pattern**

Edit `electron/imap.ts` replacing the body of the method starting at line 859. The new structure:

```ts
interface FetchedMessage {
    uid: number;
    envelope: NonNullable<Awaited<ReturnType<ImapFlow['fetchOne']>>>['envelope'];
    bodyStructure: BodyStructureNode | null;
    source: Buffer | null;
}

async syncNewEmails(accountId: string, mailbox: string): Promise<number> {
    const ctrl = this.controllers.get(accountId);
    const client = ctrl?.client;

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

        // ── Phase 1: fetch raw sources inside the mailbox lock ─────────────
        const fetched: FetchedMessage[] = [];
        const lock = await withImapTimeout(
            () => client.getMailboxLock(mailbox),
            10_000,
            `getMailboxLock(${mailbox})`
        );
        try {
            try {
                for await (const message of client.fetch(range, {
                    envelope: true,
                    bodyStructure: true,
                    source: { maxLength: MAX_BODY_BYTES },
                    uid: true,
                })) {
                    const uid = message.uid;
                    if (lastUid > 0 && uid <= lastUid) continue;
                    fetched.push({
                        uid,
                        envelope: message.envelope ?? null,
                        bodyStructure: (message.bodyStructure as BodyStructureNode | undefined) ?? null,
                        source: message.source ?? null,
                    });
                }
            } catch (fetchErr) {
                const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                if (msg !== 'Command failed') {
                    logDebug(`[syncNewEmails] fetch error for ${accountId}: ${msg}`);
                }
            }
        } finally {
            lock.release();
        }

        // ── Phase 2: parse and persist outside the lock ────────────────────
        insertedCount = await this.persistFetchedMessages(
            accountId,
            folder,
            isInbox,
            ctrl,
            mailbox,
            fetched
        );

        if (insertedCount > 0) {
            this.newEmailCallback?.(accountId, folder.id, insertedCount);
        }
    } finally {
        ctrl.syncingFolders.delete(syncKey);
    }
    return insertedCount;
}

private async persistFetchedMessages(
    accountId: string,
    folder: { id: string; type: string | null },
    isInbox: boolean,
    ctrl: AccountSyncController,
    mailbox: string,
    fetched: FetchedMessage[],
): Promise<number> {
    if (fetched.length === 0) return 0;
    const db = getDatabase();

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

    let insertedCount = 0;
    for (const msg of fetched) {
        const emailId = isInbox ? `${accountId}_${msg.uid}` : `${folder.id}_${msg.uid}`;
        const env = msg.envelope;
        if (!env) continue;

        let bodyText = '';
        let bodyHtml: string | null = null;
        let listUnsubscribe: string | null = null;
        let authResultsHeader: string | null = null;
        if (msg.source && msg.source.length > 0) {
            try {
                const parsed = await simpleParser(msg.source, {
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
                const authVal = parsed.headers?.get('authentication-results');
                if (typeof authVal === 'string' && authVal.trim()) {
                    authResultsHeader = authVal.slice(0, 2000);
                }
            } catch (parseErr) {
                logDebug(`[syncNewEmails] mailparser error for ${emailId}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
                continue;
            }
        }

        const messageId = env.messageId ?? emailId;
        let threadId = messageId;
        if (env.inReplyTo) {
            const parent = db.prepare(
                'SELECT thread_id FROM emails WHERE message_id = ?'
            ).get(env.inReplyTo) as { thread_id: string } | undefined;
            if (parent?.thread_id) threadId = parent.thread_id;
        }

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

            if (msg.bodyStructure) {
                const atts = extractAttachments(msg.bodyStructure);
                if (atts.length > 0) {
                    markAttStmt.run(emailId);
                    for (const att of atts) {
                        const attId = `${emailId}_att_${att.partNumber}`;
                        insertAttStmt.run(attId, emailId, att.filename, att.mimeType, att.size, att.partNumber, att.contentId);
                    }
                }
            }

            applyRulesToEmail(emailId, accountId);

            try {
                const { classifyEmail } = await import('./spamFilter.js');
                const spamScore = classifyEmail(accountId, `${env.subject ?? ''} ${bodyText}`);
                if (spamScore !== null) {
                    db.prepare('UPDATE emails SET spam_score = ? WHERE id = ?').run(spamScore, emailId);
                }
            } catch { /* spam classifier not trained yet — skip */ }
        } else if (bodyText || bodyHtml) {
            updateBodyStmt.run(bodyText, bodyHtml, emailId);
        }

        if (msg.uid > (ctrl.lastSeenUid.get(mailbox) ?? 0)) {
            ctrl.lastSeenUid.set(mailbox, msg.uid);
        }
    }

    return insertedCount;
}
```

Notes on the refactor:
- `FetchedMessage` is a new local interface co-located in the same file near the top (add it alongside `AttachmentMeta`).
- The per-message `simpleParser` try/catch now `continue`s instead of falling through with an empty body — one bad message must not pollute the DB row, it must be skipped entirely.
- `ctrl.lastSeenUid` is only advanced after a successful per-message parse, so a crash in the middle does not cause UID skipping on the next run.

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "releases the mailbox lock before running simpleParser"`
Expected: PASS.

- [ ] **Step 5: Full suite check**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: all tests pass. If any existing syncNewEmails tests fail because of the structural rewrite, update them to match the new two-phase flow — but only if the assertions are still meaningful. Do not delete coverage.

- [ ] **Step 6: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "fix(imap): move MIME parsing out of mailbox lock in syncNewEmails"
```

---

## Task 7: Add 100-message chunking to `syncNewEmails`

**Files:**
- Modify: `electron/imap.ts` (syncNewEmails + persistFetchedMessages)
- Test: `electron/imapSync.test.ts` (new case: large-delta chunking)

- [ ] **Step 1: Write the failing test**

Append to the `describe('syncNewEmails two-phase parsing', ...)` block:

```ts
it('processes a large delta in chunks of 100 messages, yielding the lock between chunks', async () => {
    const ctrl = new AccountSyncController('acct-chunk-1');
    ctrl.status = 'connected';

    const lockHolds: Array<{ acquire: number; release: number }> = [];
    let currentAcquire = 0;
    const fetchBatches: number[][] = [];  // UIDs per fetch() call

    const fakeFetchIterator = (range: string) => {
        // Parse range "N:M" or "N:*"; for the test we generate 250 messages total,
        // returned 100 at a time via chunk-aware range parsing.
        const m = /^(\d+):(\d+|\*)$/.exec(range);
        const start = m ? parseInt(m[1], 10) : 1;
        const end = m && m[2] !== '*' ? parseInt(m[2], 10) : 250;
        const firstBatch = Math.min(end - start + 1, 100);
        const uids: number[] = [];
        for (let i = 0; i < firstBatch; i++) uids.push(start + i);
        fetchBatches.push([...uids]);

        return (async function* () {
            for (const uid of uids) {
                yield {
                    uid,
                    envelope: {
                        subject: `Msg ${uid}`,
                        from: [{ address: `sender${uid}@example.com` }],
                        to: [{ address: 'b@example.com' }],
                        date: new Date(),
                        messageId: `<msg-${uid}@example.com>`,
                        inReplyTo: null,
                    },
                    bodyStructure: null,
                    source: Buffer.from(`Subject: Msg ${uid}\r\n\r\nhi ${uid}`),
                };
            }
        })();
    };

    const fakeClient = {
        getMailboxLock: vi.fn(async () => {
            currentAcquire = Date.now();
            return {
                release: () => lockHolds.push({ acquire: currentAcquire, release: Date.now() }),
            };
        }),
        fetch: vi.fn((range: string) => fakeFetchIterator(range)),
    } as unknown as ImapFlow;
    ctrl.client = fakeClient;
    imapEngine['controllers'].set('acct-chunk-1', ctrl);

    // Pre-seed lastSeenUid so the range is "1:*" and total available = 250.
    mockDbPrepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, type FROM folders')) {
            return { get: () => ({ id: 'folder-inbox', type: 'inbox' }), all: () => [], run: () => ({ changes: 1 }) };
        }
        return { get: () => null, all: () => [], run: () => ({ changes: 1 }) };
    });

    // Override LARGE_DELTA_CHUNK_SIZE expectation: lock should be acquired and released
    // at least 3 times for 250 messages (100 + 100 + 50).
    await imapEngine.syncNewEmails('acct-chunk-1', 'INBOX');

    expect(lockHolds.length).toBeGreaterThanOrEqual(3);
    // Each fetch batch should have size ≤ 100.
    for (const batch of fetchBatches) {
        expect(batch.length).toBeLessThanOrEqual(100);
    }
    imapEngine['controllers'].delete('acct-chunk-1');
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run electron/imapSync.test.ts -t "processes a large delta in chunks"`
Expected: FAIL — current implementation acquires the lock exactly once.

- [ ] **Step 3: Add chunked loop to `syncNewEmails`**

Edit `electron/imap.ts`. Add a module-level constant near the top of the file:

```ts
const SYNC_CHUNK_SIZE = 100;
```

Replace the Phase 1 fetch block inside `syncNewEmails` with a chunked loop. The key change: instead of one `for await` loop under one lock, run a `do { acquire; fetch up to CHUNK; release; persist chunk } while (chunk was full)` pattern:

```ts
// ── Phase 1+2 interleaved: fetch up to SYNC_CHUNK_SIZE per lock hold ───
let nextRangeStart = lastUid + 1;
let largeDeltaLogged = false;

// eslint-disable-next-line no-constant-condition
while (true) {
    if ((ctrl.status as string) === 'disconnected') break;

    const chunkRange = `${nextRangeStart}:*`;
    const chunk: FetchedMessage[] = [];

    const lock = await withImapTimeout(
        () => client.getMailboxLock(mailbox),
        10_000,
        `getMailboxLock(${mailbox})`
    );
    try {
        try {
            for await (const message of client.fetch(chunkRange, {
                envelope: true,
                bodyStructure: true,
                source: { maxLength: MAX_BODY_BYTES },
                uid: true,
            })) {
                const uid = message.uid;
                if (uid < nextRangeStart) continue;
                chunk.push({
                    uid,
                    envelope: message.envelope ?? null,
                    bodyStructure: (message.bodyStructure as BodyStructureNode | undefined) ?? null,
                    source: message.source ?? null,
                });
                if (chunk.length >= SYNC_CHUNK_SIZE) break;
            }
        } catch (fetchErr) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            if (msg !== 'Command failed') {
                logDebug(`[syncNewEmails] fetch error for ${accountId}: ${msg}`);
            }
        }
    } finally {
        lock.release();
    }

    if (chunk.length === 0) break;

    if (chunk.length >= SYNC_CHUNK_SIZE && !largeDeltaLogged) {
        logDebug(`[SYNC] large delta detected: chunking account=${accountId} folder=${mailbox}`);
        largeDeltaLogged = true;
    }

    insertedCount += await this.persistFetchedMessages(
        accountId, folder, isInbox, ctrl, mailbox, chunk
    );

    // Advance start past the last uid we saw.
    const lastInChunk = chunk[chunk.length - 1].uid;
    nextRangeStart = lastInChunk + 1;

    // If chunk didn't fill, we're done — no more messages in this range.
    if (chunk.length < SYNC_CHUNK_SIZE) break;

    // Yield to microtask queue between chunks so user-queued ops can interleave.
    await Promise.resolve();
}
```

Note: the `while (true)` is intentional — the loop body has four exit conditions (empty chunk, disconnected, chunk < SYNC_CHUNK_SIZE, fetch error).

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "processes a large delta in chunks"`
Expected: PASS.

- [ ] **Step 5: Verify the lock-release-before-parse sentinel test still passes**

Run: `npx vitest run electron/imapSync.test.ts -t "releases the mailbox lock before running simpleParser"`
Expected: PASS — persist runs after lock release on each chunk.

- [ ] **Step 6: Full suite check**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "fix(imap): chunk syncNewEmails into 100-message batches to bound lock hold time"
```

---

## Task 8: Regression test — malformed message isolation

**Files:**
- Test: `electron/imapSync.test.ts` (new case)

- [ ] **Step 1: Write the test**

Append to `describe('syncNewEmails two-phase parsing', ...)`:

```ts
it('skips a malformed message mid-batch without aborting the rest', async () => {
    const ctrl = new AccountSyncController('acct-bad-1');
    ctrl.status = 'connected';

    const fakeClient = {
        getMailboxLock: vi.fn(async () => ({ release: () => undefined })),
        fetch: vi.fn(() => (async function* () {
            yield { uid: 1, envelope: { subject: 'good-1', from: [{ address: 'a@x' }], to: [{ address: 'b@x' }], date: new Date(), messageId: '<1@x>' }, bodyStructure: null, source: Buffer.from('Subject: good-1\r\n\r\nhi') };
            yield { uid: 2, envelope: { subject: 'bad', from: [{ address: 'a@x' }], to: [{ address: 'b@x' }], date: new Date(), messageId: '<2@x>' }, bodyStructure: null, source: Buffer.from('THROW_PLEASE') };
            yield { uid: 3, envelope: { subject: 'good-3', from: [{ address: 'a@x' }], to: [{ address: 'b@x' }], date: new Date(), messageId: '<3@x>' }, bodyStructure: null, source: Buffer.from('Subject: good-3\r\n\r\nhi') };
        })()),
    } as unknown as ImapFlow;
    ctrl.client = fakeClient;
    imapEngine['controllers'].set('acct-bad-1', ctrl);

    const mailparser = await import('mailparser');
    const parseSpy = vi.spyOn(mailparser, 'simpleParser').mockImplementation(async (input) => {
        const buf = input as Buffer;
        if (buf.toString().includes('THROW_PLEASE')) throw new Error('mailparser boom');
        return { text: 'hi', html: false, headers: new Map() } as unknown as ReturnType<typeof mailparser.simpleParser> extends Promise<infer R> ? R : never;
    });

    const inserts: string[] = [];
    mockDbPrepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, type FROM folders')) {
            return { get: () => ({ id: 'folder-inbox', type: 'inbox' }), all: () => [], run: () => ({ changes: 1 }) };
        }
        if (sql.startsWith('INSERT OR IGNORE INTO emails')) {
            return { run: (id: string) => { inserts.push(id); return { changes: 1 }; }, get: () => null, all: () => [] };
        }
        return { get: () => null, all: () => [], run: () => ({ changes: 0 }) };
    });

    const count = await imapEngine.syncNewEmails('acct-bad-1', 'INBOX');

    parseSpy.mockRestore();
    imapEngine['controllers'].delete('acct-bad-1');

    expect(count).toBe(2); // messages 1 and 3 persisted, 2 skipped
    expect(inserts).toEqual(['acct-bad-1_1', 'acct-bad-1_3']);
    expect(mockLogDebug).toHaveBeenCalledWith(
        expect.stringContaining('mailparser error for acct-bad-1_2')
    );
});
```

- [ ] **Step 2: Run — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "skips a malformed message mid-batch"`
Expected: PASS — the two-phase refactor from Task 6 already handles this via the `continue` in the catch block.

If it fails because of mock-setup issues, fix the mock (do NOT weaken the assertion). The test proves:
1. Total inserted = 2 (not 3, not 0).
2. Inserted UIDs are 1 and 3, skipping 2.
3. `logDebug` was called for the malformed message.

- [ ] **Step 3: Commit**

```bash
git add electron/imapSync.test.ts
git commit -m "test(imap): malformed message mid-batch is skipped, batch completes"
```

---

## Task 9: Regression test — sync correctness (field-by-field)

**Files:**
- Test: `electron/imapSync.test.ts` (new case)

- [ ] **Step 1: Write the test**

Append to `describe('syncNewEmails two-phase parsing', ...)`:

```ts
it('persists identical fields (subject, from, to, body_text) after refactor', async () => {
    const ctrl = new AccountSyncController('acct-fields-1');
    ctrl.status = 'connected';

    const fixture = {
        uid: 7,
        envelope: {
            subject: 'Quarterly Report',
            from: [{ name: 'Alice Example', address: 'alice@example.com' }],
            to: [{ address: 'bob@example.com' }],
            date: new Date('2026-04-10T14:30:00Z'),
            messageId: '<qr-7@example.com>',
            inReplyTo: null,
        },
        bodyStructure: null,
        source: Buffer.from(
            'Subject: Quarterly Report\r\n' +
            'From: Alice Example <alice@example.com>\r\n' +
            'To: bob@example.com\r\n' +
            'Date: Fri, 10 Apr 2026 14:30:00 +0000\r\n' +
            '\r\n' +
            'Q1 numbers attached.\r\n'
        ),
    };

    const fakeClient = {
        getMailboxLock: vi.fn(async () => ({ release: () => undefined })),
        fetch: vi.fn(() => (async function* () { yield fixture; })()),
    } as unknown as ImapFlow;
    ctrl.client = fakeClient;
    imapEngine['controllers'].set('acct-fields-1', ctrl);

    const persistedRows: unknown[][] = [];
    mockDbPrepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id, type FROM folders')) {
            return { get: () => ({ id: 'folder-inbox', type: 'inbox' }), all: () => [], run: () => ({ changes: 1 }) };
        }
        if (sql.startsWith('INSERT OR IGNORE INTO emails')) {
            return {
                run: (...args: unknown[]) => { persistedRows.push(args); return { changes: 1 }; },
                get: () => null,
                all: () => [],
            };
        }
        return { get: () => null, all: () => [], run: () => ({ changes: 0 }) };
    });

    await imapEngine.syncNewEmails('acct-fields-1', 'INBOX');

    expect(persistedRows.length).toBe(1);
    const [id, accountId, folderId, threadId, messageId, subject, fromName, fromEmail, toEmail] = persistedRows[0];
    expect(id).toBe('acct-fields-1_7');
    expect(accountId).toBe('acct-fields-1');
    expect(folderId).toBe('folder-inbox');
    expect(threadId).toBe('<qr-7@example.com>');
    expect(messageId).toBe('<qr-7@example.com>');
    expect(subject).toBe('Quarterly Report');
    expect(fromName).toBe('Alice Example');
    expect(fromEmail).toBe('alice@example.com');
    expect(toEmail).toBe('bob@example.com');

    imapEngine['controllers'].delete('acct-fields-1');
});
```

- [ ] **Step 2: Run — expect pass**

Run: `npx vitest run electron/imapSync.test.ts -t "persists identical fields"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add electron/imapSync.test.ts
git commit -m "test(imap): sync correctness regression — field-by-field persisted row check"
```

---

## Task 10: Run the full quality pipeline

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: zero warnings.

If warnings appear in files you touched, fix them. Do not `// eslint-disable` without a reason comment.

- [ ] **Step 2: Full Vitest run**

Run: `npm run test`
Expected: all tests pass (existing 1002 + new cases from Tasks 1-9 ≈ 1013 total).

- [ ] **Step 3: Semgrep SAST scan**

Run the Semgrep skill via the MCP plugin:

```
/plugin semgrep-sast scan electron/imap.ts electron/asyncQueue.ts
```

Expected: zero new findings.

- [ ] **Step 4: Build for Windows**

Run: `npm run build:win`
Expected: clean build, no TypeScript errors, packaged binary produced in `release/`.

- [ ] **Step 5: Launch the packaged binary**

Run: `./release/win-unpacked/ExpressDelivery.exe` (or double-click in Explorer)
Expected: app launches, existing accounts load, inbox displays.

- [ ] **Step 6: E2E Console Health**

Run: `npm run test:e2e -- --grep "Console Health"`
Expected: 8 tests green, zero console errors across all major app sections.

- [ ] **Step 7: If any step fails, fix and re-run the full pipeline**

Do not proceed to the release steps until every step in Task 10 is green.

---

## Task 11: Manual smoke test — Yahoo delete race

- [ ] **Step 1: Connect a Yahoo test account (or use an existing one from dev)**

Add the Yahoo account in the app settings. Wait for initial sync to complete.

- [ ] **Step 2: Send yourself a test email**

From another account, send an email to the Yahoo address. Wait for it to appear in the Inbox (should be within 15 seconds of the inbox sync interval).

- [ ] **Step 3: Delete the new email immediately**

As soon as the email appears in the list, click it and press Delete (or the trash icon).

- [ ] **Step 4: Verify**

Expected: the email is removed from the ExpressDelivery list within ~1 second AND removed from the Yahoo web UI on refresh. No spinner hang.

- [ ] **Step 5: Repeat 10 times across different folders**

Inbox, a custom folder, Archive. Must succeed every time.

- [ ] **Step 6: Cross-provider regression — Gmail**

Do the same test on a Gmail OAuth account. Must still work identically to v1.17.3.

- [ ] **Step 7: Cross-provider regression — Outlook personal**

Same test on a personal Outlook.com account. Must still work.

- [ ] **Step 8: If any test fails, stop and diagnose**

Do not bump the version or tag until the manual smoke passes on all three providers.

---

## Task 12: Version bump, CLAUDE.md update, release notes, tag

- [ ] **Step 1: Bump version in `package.json`**

Edit `package.json`:

```json
{
  "version": "1.17.4",
  ...
}
```

- [ ] **Step 2: Update CLAUDE.md status line**

Edit `CLAUDE.md` line 3 (the first description paragraph). Change `v1.17.3` to `v1.17.4` and update the test count to reflect the new tests (existing 1002 + 6 new cases ≈ 1008+; confirm exact count by running `npm run test -- --reporter=verbose | tail -5`).

- [ ] **Step 3: Run `npm run test` one more time to confirm the count**

Run: `npm run test`
Expected: updated test total matches what you wrote in CLAUDE.md.

- [ ] **Step 4: Commit the version bump**

```bash
git add package.json CLAUDE.md
git commit -m "release: v1.17.4 — Yahoo delete lock-contention fix"
```

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin fix/yahoo-delete-lock
gh pr create --title "v1.17.4: Yahoo delete lock-contention fix" --body "$(cat <<'EOF'
## Summary

- Move `simpleParser` out of the mailbox lock in `syncNewEmails` so background sync no longer holds the lock for 20+ seconds on large Yahoo Archive folders
- Add `AsyncQueue` to `AccountSyncController` serializing user-initiated IMAP ops (delete, move, refetchEmailBody) so they never race each other
- Raise `refetchEmailBody` lock timeout from 10s to 30s to match other user-action paths
- 100-message chunking on large sync deltas so the lock yields between chunks

Design spec: `docs/superpowers/specs/2026-04-14-yahoo-delete-lock-fix-design.md`.
Plan: `docs/superpowers/plans/2026-04-14-yahoo-delete-lock-fix.md`.

## Test plan
- [x] New `AsyncQueue` unit tests (FIFO, rejection isolation, drain, empty-queue fast path)
- [x] `syncNewEmails` lock-release-before-parse sentinel test
- [x] `syncNewEmails` 100-message chunking test
- [x] Malformed message mid-batch isolation test
- [x] Field-by-field sync correctness regression test
- [x] `deleteMessage` / `moveMessage` / `refetchEmailBody` queue routing tests
- [x] Full lint, Vitest, Semgrep, build:win, E2E Console Health
- [x] Manual smoke: Yahoo delete-on-arrival × 10 across 3 folders
- [x] Manual regression: Gmail, Outlook personal delete-on-arrival

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After PR is approved and merged, tag and release**

```bash
git checkout main
git pull
git tag v1.17.4
git push origin v1.17.4
```

GitHub Actions `release.yml` will build and publish NSIS + AppImage/deb/rpm + DMG to GitHub Releases. electron-updater delivers silently to existing installs on next launch.

---

## Self-Review

Spec coverage check (against `docs/superpowers/specs/2026-04-14-yahoo-delete-lock-fix-design.md`):

- Spec §2 invariant (lock protects IMAP only, not parsing): enforced by Task 6.
- Spec §3.1 raise `refetchEmailBody` timeout: Task 5.
- Spec §3.2 two-phase parsing: Task 6.
- Spec §3.2 100-message chunking ceiling + large-delta log: Task 7.
- Spec §3.2 chunk-level yield to operation queue: Task 7 step 3 (`await Promise.resolve()`).
- Spec §3.3 per-account operation queue with in-scope/out-of-scope lists: Tasks 1-5 (queue created, delete/move/refetchEmailBody routed; sync paths untouched).
- Spec §3.4 FIFO, independent rejection, empty-queue fast path, drain on disconnect: Task 1 tests + Task 2 drain.
- Spec §8 acceptance: Yahoo delete-on-arrival manual smoke (Task 11), non-Yahoo regression (Task 11 steps 6-7), sync correctness regression (Task 9), queue unit tests (Task 1), lock-release sentinel (Task 6).
- Spec §9 release: Task 12.

Placeholder scan: no TBD/TODO/FIXME/"as above" references. Every code block is complete.

Type consistency: `AsyncQueue` is the same name across Tasks 1-5. `QueueDrainedError` matches. `FetchedMessage` is defined once in Task 6 and reused in Task 7. `persistFetchedMessages` signature is consistent between Task 6 (definition) and Task 7 (caller).

Gaps: none. The plan covers every spec requirement with a concrete task.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-14-yahoo-delete-lock-fix.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because the tasks are TDD-style and each task's success gate is clear.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review. Keeps everything in one context window but makes the session long.

Which approach?
