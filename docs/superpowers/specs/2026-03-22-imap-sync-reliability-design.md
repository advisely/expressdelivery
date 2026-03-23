# IMAP Sync Reliability Redesign

**Date:** 2026-03-22
**Status:** Approved
**Scope:** `electron/imap.ts`, `electron/main.ts`, `src/components/Sidebar.tsx`, `src/components/SettingsModal.tsx`

## Problem Statement

The current IMAP sync architecture has 7 confirmed bugs that cause emails to silently stop arriving. The root cause is a single-threaded, serial poll loop with no timeout protection, no connection health monitoring, and a reconnect strategy that permanently gives up after 5 failures. This architecture cannot scale beyond 1-2 accounts.

### Confirmed Bugs

| # | Severity | Issue |
|---|----------|-------|
| 1 | Critical | `syncNewEmails` has no timeout on `getMailboxLock` — hangs forever on dead TCP, blocks poll loop permanently |
| 2 | Critical | `pollSyncRunning` is a single global flag — one hung account blocks sync for ALL accounts |
| 3 | High | `isConnected()` only checks `clients.has()` — cannot detect half-open TCP connections |
| 4 | High | Reconnect gives up after 5 attempts with no recovery — stays dead until app restart |
| 5 | Medium | Sync status indicator shows last-known state — no staleness detection (shows green when poll is stuck) |
| 6 | Medium | `moveMessage`, `deleteMessage`, `appendToSent`, and `downloadAttachment` have no lock timeout |
| 7 | Low | Comment says "5-second polling" but actual interval is 15s (resolved by poll loop deletion) |
| 8 | Medium | `listAndSyncFolders` calls `client.list()` with no timeout — hangs on dead TCP |

### Target Scale

9 accounts across diverse providers (Gmail, Outlook, Yahoo, iCloud, privateemail, etc.), each with different IDLE behavior, timeout policies, and connection quirks.

## Design

### 1. Core Architecture — AccountSyncController

Replace the single `setInterval` poll loop and scattered state maps in `ImapEngine` with a dedicated controller per account.

**Current state (broken):**

```
ImapEngine {
  clients: Map<accountId, ImapFlow>
  syncing: Map<syncKey, boolean>
  lastSeenUid: Map<syncKey, number>
  retryTimeouts: Map<accountId, timeout>
  retryCounts: Map<accountId, number>
}
+ main.ts: single setInterval(15s) with global pollSyncRunning flag
```

**New state (per-account isolation):**

```
ImapEngine {
  controllers: Map<accountId, AccountSyncController>
}

AccountSyncController {
  // Identity
  accountId: string

  // Connection
  client: ImapFlow | null

  // Sync loop (replaces global poll)
  inboxSyncTimer: NodeJS.Timeout | null
  folderSyncTimer: NodeJS.Timeout | null
  syncing: boolean

  // Health monitoring
  lastSuccessfulSync: number | null
  consecutiveFailures: number
  heartbeatTimer: NodeJS.Timeout | null

  // UID tracking (moved from ImapEngine maps)
  lastSeenUid: Map<folderSyncKey, number>

  // Reconnect (replaces 5-and-die)
  reconnectTimer: NodeJS.Timeout | null
  reconnectAttempts: number

  // State machine
  status: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error'
}
```

**Key behavioral changes:**

- Each account runs its own independent timer — one stuck account cannot block others
- `syncing` is per-account (not per-folder) — simpler, prevents lock contention within the same account's IMAP connection
- `status` is a proper state machine, not inferred from Map membership
- `lastSuccessfulSync` enables staleness detection
- `consecutiveFailures` drives health reporting

**API surface preserved:** `ImapEngine` retains existing public methods with the same signatures. All IPC handlers in `main.ts` continue calling `imapEngine.methodName()` unchanged. The controller is an internal implementation detail.

**New public method — `startAccount()`:**

```typescript
async startAccount(accountId: string): Promise<void> {
  // 1. Create AccountSyncController for this account
  // 2. Connect to IMAP (connectAccount logic)
  // 3. List and sync folders (listAndSyncFolders)
  // 4. Sync inbox first, then remaining folders
  // 5. Start heartbeat, inbox sync, and folder sync timers
  // 6. Emit sync:status 'connected' on success, 'error' on failure
}
```

This replaces the manual `connectAccount()` + `listAndSyncFolders()` + `syncNewEmails()` + timer setup sequence currently spread across ~40 lines in `main.ts` startup. `connectAccount()` remains as an internal method used by `startAccount()` and `scheduleReconnect()`. `startAccount()` is the only method called from `main.ts` during startup and after account creation.

### 2. Timeout Protection — Universal IMAP Operation Wrapper

Every IMAP operation that touches the network gets a timeout via a single utility:

```typescript
async function withImapTimeout<T>(
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

The `.finally(() => clearTimeout(timer))` prevents resource leaks — without it, every fast-resolving operation would leave a dangling `setTimeout` reference until it fires.

**Orphaned lock protection:** When a `getMailboxLock` timeout fires, `Promise.race` rejects but the underlying lock acquisition may still complete in the background, leaving a lock that nothing will ever release. To prevent this, **any lock-timeout error triggers `forceDisconnect()`**, which calls `client.close()` and destroys the connection — releasing all pending locks and aborting all in-flight operations. This is the correct recovery because a lock timeout already indicates a dead or dying connection.

**Hardcoded timeouts (safety guards, not user-configurable):**

| Operation | Timeout | Rationale |
|-----------|---------|-----------|
| `getMailboxLock` | 10s | Selecting a mailbox should be near-instant; >10s = dead connection |
| `syncNewEmails` (full operation) | 60s | Large folders may have many new emails to fetch |
| `NOOP` heartbeat | 5s | Pure ping — if this hangs, connection is dead |
| `connect` | 15s | Slightly above current 10s for slow providers |
| `fetch` per-message processing | 30s | Individual message download (2MB cap already exists) |
| `client.list()` | 15s | Folder listing; hangs on dead TCP if unguarded |

**Coverage:** Every `getMailboxLock` call in `imap.ts` gets the wrapper — no exceptions (`syncNewEmails`, `moveMessage`, `deleteMessage`, `appendToSent`, `downloadAttachment`, `markAsRead`, `markAsUnread`, `refetchEmailBody`, `fetchRawSource`, `markAllRead`). Additionally, `client.list()` in `listAndSyncFolders` and `client.noop()` in the heartbeat are wrapped. This fixes Bug #1, Bug #6, and Bug #8.

### 3. Connection Health — NOOP Heartbeat

**Problem:** `isConnected()` checks `clients.has()` which cannot detect half-open TCP (server died but no FIN/RST reached the client).

**Solution:** Each `AccountSyncController` runs a NOOP heartbeat:

- **Interval:** 2 minutes (hardcoded). IMAP RFC 2177 recommends clients send data every 29 minutes; 2 minutes is conservative and matches Thunderbird's approach.
- **Mechanism:** `await withImapTimeout(() => client.noop(), 5000, 'heartbeat')`
- **On failure:** Immediately `forceDisconnect()` → `scheduleReconnect()`. Log the failure with `[IMAP:${accountId}] heartbeat timeout`.
- **On success:** Update `lastSuccessfulSync` timestamp, reset `consecutiveFailures`.

**`lastSuccessfulSync` is updated by all of the following events:**
- Successful NOOP heartbeat
- Successful sync cycle completion (inbox or full)
- Successful reconnect + initial sync

This ensures the staleness window is always bounded to the heartbeat interval (2 minutes) even when sync cycles are long-running.

**Improved `isConnected()`:**

```typescript
isConnected(accountId: string): boolean {
  const ctrl = this.controllers.get(accountId);
  if (!ctrl?.client) return false;
  // 180s threshold = 1.5x heartbeat interval (120s), providing safety margin.
  // Between 60s-180s the UI shows amber "stale" but isConnected() still returns true,
  // allowing in-flight operations to proceed. Beyond 180s, the connection is considered dead.
  if (ctrl.lastSuccessfulSync && Date.now() - ctrl.lastSuccessfulSync > 180_000) return false;
  return ctrl.status === 'connected' || ctrl.status === 'syncing';
}
```

This fixes Bug #3.

### 4. Reconnect — Never Give Up

**Current:** 5 retries with exponential backoff (1s to 30s cap), then permanently dead until app restart.

**New:** Infinite retry with capped backoff.

**Hardcoded (not user-adjustable):**

- Base delay: 1 second
- Backoff multiplier: 2x exponential
- Jitter: +/-20% random (prevents thundering herd when multiple accounts reconnect simultaneously after a network outage)

**User-configurable:**

- Max reconnect interval: default 5 minutes, range 1-30 minutes. Stored in `settings` table as `reconnect_max_interval`. Backoff sequence: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s (cap), 300s, 300s, ...

**On successful reconnect:** Reset retry counter to 0, run full folder resync, emit `sync:status` with `connected`, update `lastSuccessfulSync`.

**`forceDisconnect()` — new method:**

```typescript
forceDisconnect(accountId: string, reason: 'health' | 'user' | 'shutdown' = 'health'): void {
  const ctrl = this.controllers.get(accountId);
  if (!ctrl) return;
  // Idempotent: no-op if already disconnected (prevents duplicate reconnect timers
  // when heartbeat timeout and lock timeout race on the same dead connection)
  if (ctrl.status === 'disconnected') return;
  // Destroy IMAPFlow client immediately (no graceful logout)
  try { ctrl.client?.close(); } catch { /* force close */ }
  ctrl.client = null;
  ctrl.status = 'disconnected';
  ctrl.syncing = false; // Reset so teardown doesn't block future sync cycles
  // Clear all timers
  if (ctrl.heartbeatTimer) { clearInterval(ctrl.heartbeatTimer); ctrl.heartbeatTimer = null; }
  if (ctrl.inboxSyncTimer) { clearInterval(ctrl.inboxSyncTimer); ctrl.inboxSyncTimer = null; }
  if (ctrl.folderSyncTimer) { clearInterval(ctrl.folderSyncTimer); ctrl.folderSyncTimer = null; }
  if (ctrl.reconnectTimer) { clearTimeout(ctrl.reconnectTimer); ctrl.reconnectTimer = null; }
  // Log reason
  logDebug(`[IMAP:${accountId}] Force disconnected (reason: ${reason})`);
  // Only schedule reconnect for health failures — not for user-initiated
  // disconnects (account removal) or app shutdown.
  // IMPORTANT: Only stopController() may call forceDisconnect with 'user'.
  // Internal health/timeout paths always use 'health'. This ensures the
  // controller is removed from the map on user-initiated disconnect
  // (stopController deletes after forceDisconnect), preventing zombie controllers.
  if (reason === 'health') {
    this.scheduleReconnect(accountId);
  }
}
```

**`stopController()` — for user-initiated disconnect and app shutdown:**

```typescript
stopController(accountId: string): void {
  this.forceDisconnect(accountId, 'user');
  this.controllers.delete(accountId);
}
```

`disconnectAccount()` calls `stopController()`. The existing `disconnectAll()` method is updated internally to call `forceDisconnect(id, 'shutdown')` for each controller instead of the old per-client logout loop. The public method name `disconnectAll()` is preserved (no rename) so the `before-quit` handler in `main.ts` continues to work without changes.

This fixes Bug #4.

### 5. Parallel Sync Loop

**Current:** Serial `for (const acct of accts)` with global `pollSyncRunning` flag in `main.ts`.

**New:** Each `AccountSyncController` owns its own sync timers. The `setInterval` poll loop in `main.ts` is **deleted entirely**.

**Hardcoded:**

- Folders within a single account sync serially (IMAP allows only one selected mailbox per connection)
- Inbox always syncs first within each account

**User-configurable:**

- Inbox sync interval: default 15s, range 10-120s. Stored as `sync_interval_inbox`.
- Other folders sync interval: default 60s, range 30-300s. Stored as `sync_interval_folders`.

**Sync cycle for one account:**

```
1. Check connection health (is client alive? was last NOOP ok?)
2. If dead → forceDisconnect + scheduleReconnect, exit this cycle
3. Sync INBOX via withImapTimeout(syncNewEmails, 60s)
4. If this is an inbox-only cycle → done
   If this is a full cycle → continue to remaining folders
5. Sync remaining folders serially, each via withImapTimeout
6. Update lastSuccessfulSync, reset consecutiveFailures
7. Emit sync:status to renderer
8. Timer schedules next tick automatically
```

The inbox timer fires every `inboxInterval` (default 15s). The folder timer fires every `folderInterval` (default 60s) and syncs all folders including inbox. When both fire simultaneously, the `syncing` flag prevents overlap.

**External sync requests (IPC `folders:sync`):** When the renderer calls `folders:sync` (user clicks a folder or refreshes), it calls `imapEngine.syncNewEmails(accountId, mailbox)` directly. If the controller's `syncing` flag is `true` (a timer-driven cycle is in progress), the external sync is **skipped** and returns `{ success: true, synced: 0 }`. This is safe because the timer cycle will complete within 60s and the `email:new` event will refresh the UI automatically. This prevents lock contention on the single IMAP connection.

**Account removal during sync:** If `stopController()` is called while `syncing === true`, the controller calls `forceDisconnect('user')` which closes the client immediately. The in-flight `syncNewEmails` call (which holds a reference to the now-closed client) will throw an error from IMAPFlow. This error is caught by the sync cycle's existing try/catch, which exits cleanly because `ctrl.status === 'disconnected'` — no reconnect is scheduled.

This fixes Bug #2.

### 6. Sync Status — Staleness-Aware Indicator

**Current:** Green/connecting/error based on last-known push from main process. No staleness detection.

**New status states (hardcoded logic):**

| State | Condition | Indicator |
|-------|-----------|-----------|
| `connected` | Last successful sync < 60s ago | Green dot |
| `stale` | Last successful sync 60s-180s ago | Amber dot + "Xm ago" |
| `syncing` | Sync currently in progress | Green dot + pulse animation |
| `connecting` | Reconnect in progress | Blue dot + spinner |
| `error` | Last successful sync > 180s ago OR connection dead | Red dot |
| `none` | No account configured | Gray dot |

**Sidebar tooltip (All Accounts mode):** Shows per-account breakdown, e.g., "Gmail: 5s ago, Yahoo: stale (2m ago), Outlook: reconnecting".

**`imap:status` IPC response enriched:**

```typescript
{
  status: 'connected' | 'stale' | 'syncing' | 'connecting' | 'error' | 'none',
  lastSync: number | null,
  consecutiveFailures: number,
  reconnectAttempts: number
}
```

**Push path (`sync:status`) updated:** The `sendSyncStatus()` helper in `main.ts` is updated to accept the full status union including `'stale'` and `'syncing'`. Staleness classification (60s/180s thresholds) is computed inside the `AccountSyncController` and pushed via `sync:status` — the Sidebar does NOT compute staleness client-side. The controller emits `sync:status` with `'syncing'` when a cycle starts, `'connected'` when it completes successfully, and `'stale'` when the heartbeat detects the last successful sync exceeds 60s. This ensures the amber dot is reachable via both the push path (real-time) and the pull path (`imap:status` polling).

This fixes Bug #5.

### 7. Settings UI

Three new fields in Settings > Email, stored in the existing `settings` key-value table (no migration needed):

| Setting | Key | Default | Range | UI Control |
|---------|-----|---------|-------|------------|
| Inbox sync interval | `sync_interval_inbox` | 15 | 10-120 (seconds) | Select dropdown |
| Other folders interval | `sync_interval_folders` | 60 | 30-300 (seconds) | Select dropdown |
| Max reconnect interval | `reconnect_max_interval` | 5 | 1-30 (minutes) | Select dropdown |

IPC handlers needed:

- Read: existing `settings:get` (already works for any key)
- Write: existing `settings:set` (requires adding all 3 keys to `ALLOWED_SETTINGS_KEYS` in `main.ts`)
- Apply: new `imap:apply-sync-settings` — tells running controllers to update their timer intervals without reconnecting

**`ALLOWED_SETTINGS_KEYS` update required:** Add `sync_interval_inbox`, `sync_interval_folders`, and `reconnect_max_interval` to the `ALLOWED_SETTINGS_KEYS` Set in `main.ts`. Without this, `settings:set` will throw "Setting key not allowed" at runtime.

Settings are read once at `AccountSyncController` construction and re-applied via `imap:apply-sync-settings`.

**`imap:apply-sync-settings` IPC handler:**

```typescript
// In main.ts — registered with ipcMain.handle
ipcMain.handle('imap:apply-sync-settings', () => {
  const db = getDatabase();
  const inboxInterval = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'sync_interval_inbox'").get() as { value: string } | undefined)?.value ?? '15', 10
  );
  const folderInterval = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'sync_interval_folders'").get() as { value: string } | undefined)?.value ?? '60', 10
  );
  const reconnectMax = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'reconnect_max_interval'").get() as { value: string } | undefined)?.value ?? '5', 10
  );
  imapEngine.updateSyncIntervals({
    inboxIntervalSec: inboxInterval,
    folderIntervalSec: folderInterval,
    reconnectMaxMinutes: reconnectMax,
  });
  return { success: true };
});
```

**`updateSyncIntervals` type:**

```typescript
interface SyncSettings {
  inboxIntervalSec: number;   // 10-120
  folderIntervalSec: number;  // 30-300
  reconnectMaxMinutes: number; // 1-30
}

// On ImapEngine:
updateSyncIntervals(settings: SyncSettings): void {
  for (const ctrl of this.controllers.values()) {
    ctrl.updateIntervals(settings);
  }
}
```

**Settings application flow:** When `settings:set` is called for any sync-related key, the renderer also calls `imap:apply-sync-settings`. Each controller's `updateIntervals()` method:

1. Stores the new interval values
2. If `syncing === false`: immediately clears and recreates timers with new values
3. If `syncing === true`: sets a `pendingIntervalUpdate` flag. When the current sync cycle completes (in the sync loop's `finally` block), it checks this flag and recreates timers then. This avoids blocking the Node.js event loop (no busy-wait) and guarantees the update applies within at most 60s (the max sync timeout).
4. The new interval takes effect on the very next tick after timer recreation

This is a renderer→main IPC call (`ipcInvoke`), so `imap:apply-sync-settings` must be added to `ALLOWED_INVOKE_CHANNELS` in `electron/preload.ts`.

### 8. Error Handling and Logging

All hardcoded:

- All timeout errors logged via `logDebug()` with `[IMAP:${accountId}]` prefix
- `forceDisconnect` logs the reason (heartbeat timeout, lock timeout, fetch timeout, manual)
- Consecutive failure counter included in `imap:status` IPC response
- All `catch` blocks follow existing silent-failure-prevention rules (log or explain why silent)
- Bug #7 (stale comment) resolved by deletion: the poll loop and its comment are removed entirely

### 9. Migration Path

The refactor is internal to `ImapEngine`. External API surface is preserved:

- `connectAccount(accountId)` — now creates an `AccountSyncController` and starts its timers
- `disconnectAccount(accountId)` — now stops the controller and clears all its timers
- `syncNewEmails(accountId, mailbox)` — unchanged logic, now called by the controller instead of main.ts
- `isConnected(accountId)` — now checks controller status + staleness
- `isReconnecting(accountId)` — now checks controller reconnect state

**Deleted from main.ts:**

- The `setInterval(async () => { ... }, 15_000)` poll loop (~45 lines)
- The `pollSyncRunning` flag
- The `lastSyncTimestamps` Map (moved into controllers)

**New in main.ts:**

- Startup calls `imapEngine.startAccount(accountId)` instead of manual `connectAccount` + sync sequence
- `imap:apply-sync-settings` IPC handler (reads settings, calls `imapEngine.updateSyncIntervals()`)

### 10. Testing Strategy

**New test file:** `electron/imapSync.test.ts` — comprehensive unit tests for all new sync reliability code.

**Mocking approach:** Mock `ImapFlow` client methods (`connect`, `getMailboxLock`, `fetch`, `noop`, `list`, `close`, `logout`) and `getDatabase()` using `vi.hoisted()` + `vi.mock()` (matching existing `scheduler.test.ts` patterns). Use `vi.useFakeTimers()` for all timer-dependent tests. Mock `logDebug()` to verify logging.

**Test file structure:**

```
describe('withImapTimeout')
describe('AccountSyncController')
  describe('lifecycle')
  describe('sync cycle')
  describe('heartbeat')
  describe('reconnect')
  describe('forceDisconnect')
  describe('updateIntervals')
describe('ImapEngine (controller integration)')
  describe('startAccount / stopController')
  describe('isConnected staleness')
  describe('parallel account isolation')
```

#### 10.1 `withImapTimeout` Tests (~10 tests)

```
describe('withImapTimeout')
  it('returns operation result when operation completes within timeout')
  it('rejects with timeout error when operation exceeds timeout')
  it('includes label and timeout duration in error message')
  it('propagates operation errors unchanged (not masked by timeout)')
  it('operation continues in background after timeout (verify no double-resolve)')
  it('clears timeout when operation completes before deadline')
  it('works with zero-latency operations')
  it('works with exactly-at-deadline timing')
  it('handles operation that returns undefined')
  it('handles operation that throws synchronously')
```

#### 10.2 AccountSyncController — Lifecycle (~8 tests)

```
describe('lifecycle')
  it('starts in disconnected status with null client')
  it('transitions to connecting → connected on successful connect')
  it('transitions to error on failed connect and schedules reconnect')
  it('starts heartbeat timer after connect')
  it('starts inbox sync timer after connect')
  it('starts folder sync timer after connect')
  it('stop clears all timers and sets status to disconnected')
  it('stop is idempotent — calling twice does not throw')
```

#### 10.3 AccountSyncController — Sync Cycle (~14 tests)

```
describe('sync cycle')
  it('syncs inbox on inbox timer tick')
  it('syncs all folders on folder timer tick (inbox first)')
  it('skips sync when syncing flag is true (prevents overlap)')
  it('resets syncing flag in finally block even if sync throws')
  it('updates lastSuccessfulSync on successful sync')
  it('increments consecutiveFailures on failed sync')
  it('resets consecutiveFailures on successful sync')
  it('emits sync:status connected after successful sync')
  it('emits sync:status error after failed sync')
  it('calls forceDisconnect when getMailboxLock times out')
  it('calls forceDisconnect when syncNewEmails times out (60s)')
  it('continues syncing other folders if one folder throws')
  it('skips external folders:sync IPC request when syncing flag is true')
  it('external folders:sync succeeds when syncing flag is false')
```

#### 10.4 AccountSyncController — Heartbeat (~8 tests)

```
describe('heartbeat')
  it('sends NOOP every 2 minutes')
  it('updates lastSuccessfulSync on successful NOOP')
  it('resets consecutiveFailures on successful NOOP')
  it('calls forceDisconnect on NOOP timeout (5s)')
  it('logs heartbeat timeout with account ID')
  it('does not send NOOP when client is null (disconnected)')
  it('heartbeat timer is cleared on forceDisconnect')
  it('heartbeat and sync timer can coexist without deadlock')
```

#### 10.5 AccountSyncController — Reconnect (~12 tests)

```
describe('reconnect')
  it('schedules reconnect with 1s initial delay')
  it('doubles delay on each retry (exponential backoff)')
  it('caps delay at configured max (default 5 minutes)')
  it('applies ±20% jitter to delay')
  it('jitter stays within bounds after 100 iterations (fuzz test)')
  it('never gives up — retries indefinitely')
  it('resets retry counter to 0 on successful reconnect')
  it('runs full folder resync after successful reconnect')
  it('emits sync:status connecting during reconnect')
  it('emits sync:status connected after successful reconnect')
  it('emits sync:status error after failed reconnect attempt')
  it('cancels pending reconnect timer on forceDisconnect')
```

#### 10.6 AccountSyncController — forceDisconnect (~10 tests)

```
describe('forceDisconnect')
  it('closes client immediately')
  it('sets client to null and status to disconnected')
  it('resets syncing flag to false')
  it('clears heartbeat, inbox, folder, and reconnect timers')
  it('is idempotent — no-op if already disconnected')
  it('prevents duplicate reconnect timers on concurrent calls')
  it('schedules reconnect when reason is health')
  it('does NOT schedule reconnect when reason is user')
  it('does NOT schedule reconnect when reason is shutdown')
  it('logs reason in disconnect message')
```

#### 10.7 AccountSyncController — updateIntervals (~6 tests)

```
describe('updateIntervals')
  it('recreates timers with new intervals when not syncing')
  it('sets pendingIntervalUpdate flag when syncing is true')
  it('applies pending update in sync cycle finally block')
  it('validates interval ranges (clamps out-of-range values)')
  it('new inbox timer fires at updated interval')
  it('new folder timer fires at updated interval')
```

#### 10.8 ImapEngine — Controller Integration (~12 tests)

```
describe('startAccount / stopController')
  it('creates controller and connects on startAccount')
  it('starts all timers on startAccount')
  it('stopController calls forceDisconnect with user reason')
  it('stopController removes controller from map')
  it('disconnectAll calls forceDisconnect with shutdown reason for each controller')
  it('disconnectAll does not schedule reconnects')

describe('isConnected staleness')
  it('returns true when status is connected and lastSuccessfulSync < 180s')
  it('returns false when client is null')
  it('returns false when lastSuccessfulSync > 180s (stale)')
  it('returns true when lastSuccessfulSync is null (fresh connect, no sync yet)')
  it('returns true when status is syncing')
  it('returns false when status is disconnected')

describe('parallel account isolation')
  it('9 accounts sync concurrently without blocking each other')
  it('one account timeout does not affect other accounts')
  it('one account forceDisconnect does not affect other accounts')
  it('each account maintains independent UID tracking')
  it('each account has independent reconnect backoff state')
```

#### 10.9 Edge Cases & Regression Tests (~8 tests)

```
describe('edge cases')
  it('account removal during active sync exits cleanly (no reconnect)')
  it('app quit during active sync clears all timers (no leaked intervals)')
  it('settings change during active sync applies after cycle completes')
  it('rapid account add/remove does not leak controllers')
  it('network restored after 10 failed reconnects recovers on next attempt')
  it('IMAP server returns empty UID range — no crash, no email:new event')
  it('concurrent heartbeat timeout and lock timeout produce single forceDisconnect')
  it('reconnect during reconnect (ensureConnected called while reconnecting) cancels pending timer')
```

#### 10.10 Test Coverage Targets

| Module | Target | Notes |
|--------|--------|-------|
| `withImapTimeout` | 100% lines/branches | Small utility, full coverage trivial |
| `AccountSyncController` | 95%+ lines, 90%+ branches | All state transitions, timer paths, error paths |
| `ImapEngine` (new controller methods) | 90%+ lines | `startAccount`, `stopController`, `updateSyncIntervals`, `isConnected` |
| `forceDisconnect` | 100% branches | All 3 reasons, idempotency, timer cleanup |
| `reconnect backoff` | 100% branches | Jitter bounds, cap, infinite retry |

**Estimated total:** ~88 new tests in `electron/imapSync.test.ts`

#### 10.11 Existing Test Updates

- `electron/main.phase6.test.ts`: Update `imap:status` response shape assertions to include `consecutiveFailures` and `reconnectAttempts` fields
- `src/components/Sidebar.test.tsx` (if exists): Add `stale` and `syncing` status rendering tests
- E2E Console Health: Covers runtime errors in production build (no changes needed, existing test sufficient)

## Files Changed

| File | Change |
|------|--------|
| `electron/imap.ts` | Major refactor: extract `AccountSyncController` class, add `withImapTimeout`, add NOOP heartbeat, infinite reconnect, `forceDisconnect`, per-account sync timers |
| `electron/main.ts` | Delete poll loop (~45 lines), replace startup sequence with `startAccount()`, add `imap:apply-sync-settings` IPC handler, add `sync_interval_inbox`/`sync_interval_folders`/`reconnect_max_interval` to `ALLOWED_SETTINGS_KEYS`, widen `sendSyncStatus()` union to include `'stale'`/`'syncing'` |
| `src/components/Sidebar.tsx` | Extend `imapStatus` TypeScript union to `'none' \| 'error' \| 'connecting' \| 'connected' \| 'partial' \| 'stale' \| 'syncing'`, add amber dot CSS, enhanced tooltip for All Accounts |
| `src/components/Sidebar.module.css` | Add `sync-stale` and `sync-syncing` CSS classes |
| `src/components/SettingsModal.tsx` | Add 3 sync interval controls in Email section |
| `electron/preload.ts` | Add `imap:apply-sync-settings` to channel allowlist |
| `electron/imapSync.test.ts` | **New file:** ~88 tests covering `withImapTimeout`, `AccountSyncController` (lifecycle, sync cycle, heartbeat, reconnect, forceDisconnect, updateIntervals), `ImapEngine` controller integration, parallel isolation, edge cases |

## Non-Goals

- IDLE support (deferred — adds complexity for marginal benefit over 15s polling)
- Per-provider timeout tuning (uniform timeouts work; can be revisited if a specific provider causes issues)
- Multiple IMAP connections per account (single connection is sufficient for polling)
- Database schema changes (none needed)
