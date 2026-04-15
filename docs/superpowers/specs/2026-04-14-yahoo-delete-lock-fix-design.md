# Yahoo Delete Lock-Contention Fix — Design Spec

**Date:** 2026-04-14
**Target release:** v1.17.4 (hotfix)
**Branch:** `fix/yahoo-delete-lock` from `main`
**Status:** Approved with changes (incorporated below)

## 1. Problem Statement

Deleting a newly-arrived email on Yahoo accounts fails or hangs for several seconds to several minutes after the message lands. The user must wait before delete succeeds. The issue reproduces most aggressively on Yahoo (82-folder accounts with large Archive) but is structurally possible on any IMAP provider.

Traced root cause (confirmed via codebase walkthrough):

1. **Long critical section in `syncNewEmails`** — `electron/imap.ts:884-1033` runs `simpleParser` on every incoming message *inside* the `getMailboxLock()` critical section. `simpleParser` is CPU-bound and can cost 500ms+ per large multipart message. On a large folder delta, lock hold-time climbs into the 20+ second range.
2. **Asymmetric timeouts** — `electron/imap.ts:1236` `refetchEmailBody` uses a 10s mailbox-lock timeout, while `moveMessage` / `deleteMessage` (same file, lines ~1081 and ~1210) were bumped to 30s in v1.17.3. When a user opens a just-arrived email, `refetchEmailBody` acquires the lock; a subsequent delete competes for the same lock with a 30s window against an operation that can hold for up to 10s, and on Yahoo these hold durations stack up across folder sweeps.
3. **No serialization between concurrent user ops on a mailbox** — two user actions on the same folder (open-to-read, then delete) race via IMAPFlow's internal mutex rather than being queued cleanly.

Out of scope as a cause: `electron/scheduler.ts` (SQLite polling only, no IMAP work).

## 2. Invariants

The design establishes one load-bearing invariant that future changes must preserve:

> **Mailbox locks must only protect IMAP fetch and state operations, not MIME parsing or DB-heavy post-processing.**

Any future contributor adding work inside a `getMailboxLock()` block must be able to justify that the work is either a network round-trip to the IMAP server or a state transition that strictly requires the lock to be held.

## 3. Solution

Three coordinated changes, ordered from smallest to largest:

### 3.1 Raise `refetchEmailBody` lock timeout 10s → 30s

One-line change at `electron/imap.ts:1236`. Aligns all user-action paths to the same 30s ceiling so they can't lose races to each other via timeout asymmetry alone.

### 3.2 Move body parsing out of the mailbox lock in `syncNewEmails`

Refactor the critical section at `electron/imap.ts:884-1033`:

**Before (current):** inside `getMailboxLock`, for each new message: fetch → `simpleParser` → insert into SQLite → release lock at end.

**After:** two-phase.

- **Phase 1 (inside lock):** fetch raw source bytes + UID + flags + envelope headers into an in-memory array of `{uid, rawSource, flags, envelope}`. Release lock immediately after the IMAP fetch completes.
- **Phase 2 (outside lock):** iterate the array, run `simpleParser` per message in a `try/catch` so one bad message does not abort the batch, then insert rows.

Each per-message parse exception is caught and logged via `logDebug` with the UID, and the sync continues to the next message. The existing `lastSeenUid` cursor advancement moves to the end of Phase 2 so a crashed parse doesn't skip UIDs on next run.

**Unbounded-accumulation guardrail.** Phase 1 must never accumulate an unlimited number of raw messages in memory. The spec mandates chunked processing:

- Hard ceiling: `MAX_CHUNK_SIZE = 100` messages per in-memory batch.
- If the folder delta exceeds this (e.g., first sync after a long offline period, or a server-side reflow), Phase 1 fetches `MAX_CHUNK_SIZE` raw messages, releases the lock, runs Phase 2 on that chunk, then re-acquires the lock for the next chunk. This yields to the operation queue between chunks so user actions interleave.
- When a chunk exceeding `MAX_CHUNK_SIZE` is detected, `logDebug` emits a single `[SYNC] large delta detected: n=... folder=...` line (one per occurrence, not per message).
- No chunking path is skipped: even a 5-message delta goes through the two-phase loop (it just completes in a single chunk).

### 3.3 Per-account user-action operation queue

New class `AsyncQueue` attached to `AccountSyncController`. Precise scope:

**In-scope (routed through the queue):**
- User-initiated delete (`moveMessage` to Trash).
- User-initiated move between folders.
- User-initiated `refetchEmailBody`. **Rationale:** although `refetchEmailBody` is not mutating, it is lock-sensitive — it acquires `getMailboxLock()` and therefore can lose races with mutating ops. Queueing it eliminates the race. The cost (serialization against other user actions) is negligible because the user only refetches the email they're currently reading.
- User-initiated bulk actions (multi-select delete/move) — each message in the batch becomes one queued task, preserving FIFO order across the batch.

**Explicitly out-of-scope (MUST NOT be routed through the queue, to avoid background-sync starvation and throughput regression):**
- `syncNewEmails` and any background sync tick.
- IDLE notifications and server-pushed EXISTS events.
- `runFullSync` and its per-folder scans.
- Initial connection handshake, folder list refresh, NOOP heartbeat.

Background sync continues to use `getMailboxLock()` directly. The queue and sync share the same underlying IMAPFlow mutex via that lock, which is sufficient for correctness — the queue's job is to serialize *user actions against each other*, not to gate sync.

### 3.4 Queue behavior semantics

**FIFO and call order:** operations are dispatched in the order they are enqueued. A `moveMessage(A)` enqueued before `deleteMessage(B)` will begin execution before `deleteMessage(B)` begins execution.

**Per-task independence:** each queued task's promise resolves or rejects independently. A task failure rejects **only** that task's promise and does not poison the queue — the next task proceeds immediately. The queue does not retry on failure; retry policy remains the caller's responsibility (for instance, the on-401 OAuth retry in `sendMail.ts`).

**Cancellation:** no explicit cancellation API in v1.17.4. An in-flight task runs to completion (or error); queued-but-not-yet-started tasks remain queued. Account removal triggers `AccountSyncController.forceDisconnect`, which drains the queue by rejecting all pending tasks with a `QueueDrainedError`.

**Empty-queue behavior:** when the queue is empty, `enqueue` executes the task directly on the next microtask rather than introducing spurious latency.

## 4. Files Touched

| File | Change |
|---|---|
| `electron/imap.ts` | Add `AsyncQueue` class. Add `operationQueue: AsyncQueue` field to `AccountSyncController`. Refactor `syncNewEmails` to two-phase + chunked. Bump `refetchEmailBody` lock timeout to 30s. Route `moveMessage`, `deleteMessage`, `refetchEmailBody` through `operationQueue.enqueue(...)` when called from user-action entry points. |
| `electron/main.ts` | Delete/move/refetch IPC handlers call the new queueing entry points. |
| `electron/__tests__/imap-operationQueue.test.ts` | **New.** Unit tests for `AsyncQueue` (FIFO, independent rejection, drain, empty-queue fast path). |
| `electron/__tests__/imap-syncNewEmails.test.ts` | **Updated.** Regression tests for two-phase parsing, lock-release sentinel, per-message parse failure isolation, chunked large-delta path. |

No changes to `electron/db.ts`, `electron/scheduler.ts`, or any renderer file. No schema version bump.

## 5. Data Flow

```
User clicks delete on email E in folder F on account A
  │
  ▼
Renderer: ipc.invoke('emails:delete', {id: E})
  │
  ▼
main.ts handler resolves {accountId: A, folderId: F, uid}
  │
  ▼
imapEngine.deleteMessage(A, F, uid)
  │
  ▼
AccountSyncController[A].operationQueue.enqueue(() => _deleteMessageInternal(F, uid))
  │                                                  │
  │ (FIFO against other user actions on A)          │
  ▼                                                  ▼
Queue dispatcher awaits prior tasks             getMailboxLock(F, 30s)
                                                    │
                                                    ▼
                                                 store +\Deleted, EXPUNGE
                                                    │
                                                    ▼
                                                 release lock
                                                    │
                                                    ▼
                                                 task promise resolves
  │
  ▼
main.ts handler returns {success: true}
  │
  ▼
Renderer optimistically removes from UI + triggers folder refresh
```

Concurrent to this, a background `syncNewEmails` tick on folder F can be running. It acquires `getMailboxLock(F, 10s)` independently, holding it only for the raw-source fetch phase. The delete task's 30s budget comfortably accommodates a bounded sync hold.

## 6. Error Handling

- **Phase 1 fetch failure in `syncNewEmails`:** log, release lock, skip this sync tick, do not advance `lastSeenUid`. Existing reconnect backoff handles transient IMAP failures.
- **Phase 2 parse failure on a single message:** log with UID, skip that message, continue iterating. Do not abort the batch. Do not advance `lastSeenUid` past unparsed messages.
- **Queue task failure:** rejects the enqueued promise with the underlying error (`EAUTH`, `ETIMEOUT`, etc.). Caller handles. Other queued tasks proceed normally.
- **Lock acquisition timeout (30s) on user action:** task rejects with `MailboxLockTimeoutError` carrying the folder and operation. Main-process handler surfaces a toast in the renderer. Local DB is NOT mutated on this path — user can retry.
- **Account disconnect during queued task:** in-flight task runs until the underlying IMAPFlow client rejects; pending tasks drain with `QueueDrainedError`.

## 7. Risks and Side Effects

| Risk | Mitigation |
|---|---|
| Phase 2 parse exceptions could drop messages silently | Each exception logs with UID + folder; new test enforces log emission on injected bad message |
| Chunking changes memory profile | Hard ceiling of 100 messages per chunk; worst-case memory is bounded by `100 × average_raw_size` ≈ a few MB |
| Queue starvation if a task hangs indefinitely | `getMailboxLock` enforces 30s ceiling; `withImapTimeout` wraps all lock bodies; any hang surfaces as timeout error, next task proceeds |
| Memory leak if queue references accumulate | Queue uses a simple `Promise` chain; completed tasks release closures immediately |
| Regression on non-Yahoo providers (Gmail, Outlook, iCloud, custom IMAP) | Explicit regression acceptance criterion below |
| Sync correctness after refactor | Regression test asserts parsed rows contain identical fields to pre-refactor baseline |
| Account removal during in-flight op | `forceDisconnect` drains the queue with typed error; renderer gets a clear "account removed" response |

## 8. Acceptance Criteria

**Functional:**
- New email arrives on a Yahoo account; user deletes it within 1 second of arrival; delete succeeds within 1 second on the server, visible in both ExpressDelivery and Yahoo web UI. Repeated 10 times across at least 3 different folders (Inbox, a custom folder, Archive).
- Opening a newly-arrived email (body refetch) followed immediately by delete on the same message: delete succeeds without timeout.
- Multi-select delete of 20 messages: all 20 removed server-side in order, no timeouts, no duplicate deletes.

**Regression — non-Yahoo:**
- Gmail OAuth account: delete, move, bulk delete, refetch all work identically to v1.17.3 (manual smoke, plus existing Vitest suite).
- Microsoft Outlook (personal + business): same.
- Custom IMAP (iCloud, generic): same.

**Regression — sync correctness:**
- New regression test in `imap-syncNewEmails.test.ts` feeds a fixture batch of 10 raw messages through the two-phase path and asserts the resulting SQLite rows contain byte-identical `subject`, `from`, `to`, `cc`, `bcc`, `date`, `body_text`, `body_html`, `attachments` (metadata), and `content_id` fields compared to a golden snapshot captured from v1.17.3 single-phase output for the same fixtures.
- The test also injects one malformed message mid-batch and asserts (a) the malformed message is skipped, (b) the other 9 are persisted correctly, (c) `logDebug` is called once with the malformed UID.

**Structural:**
- New unit test `imap-operationQueue.test.ts` covers: FIFO ordering (5 tasks resolve in enqueue order), independent rejection (task 3 rejects, tasks 4 and 5 still succeed), empty-queue fast path (single task resolves within 1 tick), drain on `forceDisconnect` (pending tasks reject with `QueueDrainedError`).
- Sentinel test proves `simpleParser` is called *after* lock release: injection point emits a sentinel when the lock's `release()` fires; assertion verifies parse calls come after the sentinel.

**Quality gate (all must pass before merge):**
- `npm run lint` — zero warnings.
- `npm run test` — all Vitest tests pass (existing 1002 + new cases).
- Semgrep SAST scan — zero new findings.
- `npm run build:win` — clean build, packaged binary launches.
- `npm run test:e2e -- --grep "Console Health"` — all 8 tests green.

## 9. Release

- Branch from `main`, merge via PR after quality gate passes.
- Tag `v1.17.4`, push, GitHub Actions `release.yml` publishes NSIS + AppImage/deb/rpm + DMG.
- Release notes: single entry — "Fix: deleting a newly-arrived email on Yahoo accounts no longer waits for background sync to release the mailbox lock."
- No user-facing UI change; no schema migration; electron-updater delivers silently to existing installs on next launch.

## 10. Open Questions

None. All ambiguity resolved in this spec.
