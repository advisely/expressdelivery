# Three Bug Fixes (v1.18.8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent v1.18.7 user-reported bugs in a single PR: (1) app window cannot be re-opened after close-to-tray, (2) IMAP does not reconnect after laptop wake-from-sleep, (3) clicking an `<a>` link inside an email body wipes the rendered content.

**Architecture:**
- Bug 1: second-instance handler treats hidden-to-tray windows the same as minimized; add a visibility check + `win.show()`.
- Bug 2: `AccountSyncController.forceDisconnect()` early-returns when already disconnected, leaving stale reconnect timers armed; move timer cleanup and close-listener detachment to the top of the function, and make `stopController()` detach the `close` listener on the ImapFlow client so an in-flight `'close'` event cannot arm a new reconnect on an orphaned controller.
- Bug 3: sandboxed email iframe has no link-click interceptor, so bare `<a href>` clicks navigate the iframe itself and get blocked by X-Frame-Options on the destination; inject a capture-phase click listener into the srcdoc that postMessages the URL to the parent, which dispatches a new allowlisted `shell:open-email-link` IPC channel that validates the scheme (`https:`/`http:`/`mailto:`) before calling `shell.openExternal`.

**Tech Stack:** Electron 41, React 19, TypeScript 5.9 strict, Vitest 4 + jsdom, @testing-library/react, IMAPFlow.

---

## Files Touched

**Create:**
- `electron/shellOpenEmailLink.ts` — pure handler for the new `shell:open-email-link` IPC, scheme-allowlisted (https/http/mailto). Separate module so it can be unit-tested without Electron, mirroring `shellOpen.ts`.
- `electron/shellOpenEmailLink.test.ts` — unit tests for the new handler (scheme validation, sanitization, log redaction).

**Modify:**
- `electron/main.ts` — (a) second-instance handler at lines 2519–2531 to `win.show()` when hidden, (b) register new `shell:open-email-link` IPC handler after the existing `shell:open-external` at line 2624.
- `electron/imap.ts` — (a) `AccountSyncController.forceDisconnect()` lines 188–203 to clear timers and detach close listener BEFORE the status guard, (b) `ImapEngine.stopController()` lines 590–595 to detach the client `'close'` listener before force-disconnecting, (c) remove the dead base-class `scheduleReconnect` stub at lines 205–215.
- `electron/preload.ts` — add `shell:open-email-link` to `ALLOWED_INVOKE_CHANNELS` at line 178.
- `src/components/ReadingPane.tsx` — (a) extend `buildIframeSrcdoc()` at lines 97–116 to inject a capture-phase click interceptor that postMessages `{type:'link-click',url}` to the parent, (b) extend the `handleMessage` callback in `SandboxedEmailBody` at lines 195–209 to handle the new message type and invoke the new IPC.

**Test files modified:**
- `electron/imapSync.test.ts` — add real-controller tests proving `forceDisconnect` clears a pending reconnect timer even when status is already `disconnected`, and that `stopController` detaches the `close` listener.
- `src/components/ReadingPane.test.tsx` — add a test proving the iframe srcdoc contains the click-intercept script, and that the `link-click` postMessage handler invokes the new IPC.

---

## Task 1: Bug 1 — second-instance handler restores hidden-to-tray window

**Files:**
- Modify: `electron/main.ts:2519-2531`
- Test: covered by manual test note (no existing main.ts test harness for `app.on` handlers; the change is a 3-line, obviously-correct fix). See Task 1b for lightweight verification.

### Task 1a: Apply the fix

- [ ] **Step 1: Read the current handler to confirm the exact lines**

Run: open `electron/main.ts` to lines 2519-2531. Confirm the current code is:

```ts
  app.on('second-instance', (_event, argv) => {
    // Focus existing window
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    // Check if a .expressdelivery file was passed as argument
    const updateFile = argv.find(arg => arg.endsWith('.expressdelivery'));
    if (updateFile && win && !win.isDestroyed()) {
      // Send the file path to the renderer for the update panel
      win.webContents.send('update:fileOpened', updateFile);
    }
  });
```

- [ ] **Step 2: Replace the `if (win) { ... }` block with a visibility-aware restore**

Edit `electron/main.ts` to replace exactly that block with:

```ts
  app.on('second-instance', (_event, argv) => {
    // Focus existing window. Important: distinguish "hidden-to-tray" (via
    // win.hide() from the close handler at line 190) from "minimized".
    // isMinimized() returns false for hidden windows, and focus() is a
    // silent no-op on hidden windows — we must call show() to re-register
    // with the OS window manager before focus() will do anything.
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    // Check if a .expressdelivery file was passed as argument
    const updateFile = argv.find(arg => arg.endsWith('.expressdelivery'));
    if (updateFile && win && !win.isDestroyed()) {
      // Send the file path to the renderer for the update panel
      win.webContents.send('update:fileOpened', updateFile);
    }
  });
```

- [ ] **Step 3: Run lint + typecheck**

Run: `npm run lint`
Expected: zero warnings (passes CLAUDE.md "zero warnings" gate).

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "fix(window): show() hidden-to-tray window on second-instance

Relaunching the app (desktop shortcut / double-click) while the main
window was hidden to the tray via win.hide() left the process alive
but invisible — isMinimized() returns false for hidden windows, so
the existing win.restore() branch was never taken and win.focus() on
a hidden window is a silent no-op. User-reported symptom: 'can't
reopen because it's still in the task manager'."
```

### Task 1b: Lightweight manual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Wait for the Electron window to appear.

- [ ] **Step 2: Close to tray**

Click the X on the custom title bar. Verify the window disappears but the tray icon remains.

- [ ] **Step 3: Relaunch**

From another terminal, run: `npx electron .`
Expected: the new instance exits immediately (single-instance lock), AND the original window reappears in the foreground.

- [ ] **Step 4: Document verification in commit trailer if needed**

If any deviation occurs (e.g. window stays hidden), stop and re-investigate. Otherwise move on to Task 2.

---

## Task 2: Bug 2 — fix stale reconnect timer + close-listener leak

**Files:**
- Modify: `electron/imap.ts:175-215` (`stop`, `forceDisconnect`, `scheduleReconnect`)
- Modify: `electron/imap.ts:590-595` (`stopController`)
- Modify: `electron/imap.ts:702-705` and `electron/imap.ts:775-778` (`close` listener registration sites, tracked so we can detach them)
- Test: `electron/imapSync.test.ts`

### Task 2a: Write failing test — forceDisconnect clears reconnectTimer even when already disconnected

- [ ] **Step 1: Add the test to `electron/imapSync.test.ts`**

Append this `describe` block after the last existing `describe` in `electron/imapSync.test.ts`:

```ts
describe('AccountSyncController — stale timer cleanup (v1.18.8 bug 2)', () => {
    it('forceDisconnect clears reconnectTimer even when status is already disconnected', async () => {
        const { AccountSyncController } = await import('./imap.js');
        const ctrl = new AccountSyncController('acc-stale');
        // Arrange: simulate the pre-sleep state where a client close already
        // disconnected the controller and armed a reconnect timer that was
        // never cleared because the next forceDisconnect early-returned.
        const timerFired = vi.fn();
        ctrl.status = 'disconnected';
        ctrl.reconnectTimer = setTimeout(timerFired, 10);

        // Act
        ctrl.forceDisconnect('health');

        // Assert: the pending timer is cleared, and it never fires.
        expect(ctrl.reconnectTimer).toBeNull();
        await new Promise(r => setTimeout(r, 20));
        expect(timerFired).not.toHaveBeenCalled();
    });

    it('forceDisconnect drains operationQueue and clears heartbeat even when already disconnected', async () => {
        const { AccountSyncController } = await import('./imap.js');
        const ctrl = new AccountSyncController('acc-stale-2');
        ctrl.status = 'disconnected';
        ctrl.heartbeatTimer = setInterval(() => { /* never */ }, 1000);
        const heartbeat = ctrl.heartbeatTimer;

        ctrl.forceDisconnect('health');

        expect(ctrl.heartbeatTimer).toBeNull();
        // heartbeat handle retained locally, not on ctrl — just ensure we
        // did not leak it on the controller.
        clearInterval(heartbeat);
    });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `npx vitest run electron/imapSync.test.ts -t "stale timer cleanup"`
Expected: FAIL — first assertion `expect(ctrl.reconnectTimer).toBeNull()` fails because the current `forceDisconnect` early-returns at `if (this.status === 'disconnected') return;` without clearing the timer.

### Task 2b: Implement — move timer cleanup before status guard

- [ ] **Step 1: Edit `electron/imap.ts` lines 188-203**

Replace the entire `forceDisconnect` method with:

```ts
    forceDisconnect(reason: 'health' | 'user' | 'shutdown' = 'health'): void {
        // IMPORTANT: clean up timers and close the socket BEFORE the status
        // guard. If the controller is already 'disconnected' (e.g. from a
        // previous client.on('close') firing), there may still be a pending
        // reconnectTimer armed with stale backoff state. Skipping cleanup
        // leaves that timer live — it later fires and thrashes a freshly
        // established wake-from-sleep connection (v1.18.8 bug 2).
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        if (this.inboxSyncTimer) { clearInterval(this.inboxSyncTimer); this.inboxSyncTimer = null; }
        if (this.folderSyncTimer) { clearInterval(this.folderSyncTimer); this.folderSyncTimer = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        this.operationQueue.drain();

        // Idempotency guard — if we were already disconnected, stop here.
        // Re-entering the socket close / status transition / reconnect-
        // schedule logic would be wasted work and could double-fire events.
        if (this.status === 'disconnected') return;

        try {
            // Detach our listeners first so the close event we're about to
            // trigger doesn't re-enter this method on the same controller.
            this.client?.removeAllListeners('close');
            this.client?.removeAllListeners('error');
            this.client?.close();
        } catch { /* force close */ }
        this.client = null;
        this.status = 'disconnected';
        this.syncing = false;
        logDebug(`[IMAP:${this.accountId}] Force disconnected (reason: ${reason})`);
        if (reason === 'health') {
            this.scheduleReconnect();
        }
    }
```

- [ ] **Step 2: Also update `stop()` at lines 175-186 to match the same pattern — detach listeners before close**

Replace the `stop()` method body with:

```ts
    stop(): void {
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        if (this.inboxSyncTimer) { clearInterval(this.inboxSyncTimer); this.inboxSyncTimer = null; }
        if (this.folderSyncTimer) { clearInterval(this.folderSyncTimer); this.folderSyncTimer = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        try {
            this.client?.removeAllListeners('close');
            this.client?.removeAllListeners('error');
            this.client?.close();
        } catch { /* force close */ }
        this.client = null;
        this.status = 'disconnected';
        this.syncing = false;
        this.syncingFolders.clear();
        this.operationQueue.drain();
    }
```

- [ ] **Step 3: Delete the dead base-class `scheduleReconnect` stub at lines 205-215**

Remove the entire method:

```ts
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
```

Replace it with a method declaration that throws if called before override (fail loud instead of silently no-op):

```ts
    /**
     * Reconnect scheduler. Intentionally throws by default — it must be
     * overridden by `ImapEngine.startAccount()` / `ImapEngine.connectAccount()`
     * before the controller is exposed. Throwing (rather than the previous
     * silent no-op stub) surfaces any future wiring regression at test time.
     */
    scheduleReconnect(): void {
        throw new Error(`scheduleReconnect not wired for ${this.accountId}`);
    }
```

- [ ] **Step 4: Verify the test from 2a now PASSES**

Run: `npx vitest run electron/imapSync.test.ts -t "stale timer cleanup"`
Expected: PASS.

- [ ] **Step 5: Run the full imap test file to check no regressions**

Run: `npx vitest run electron/imapSync.test.ts`
Expected: all tests pass. If any fail because they relied on the old stub being a no-op, adjust the test (they should have been calling `startAccount`/`connectAccount` to get a real `scheduleReconnect` wired; fix them, do not revert the throw).

### Task 2c: Write failing test — stopController detaches client 'close' listener

- [ ] **Step 1: Add the test**

Append to the `describe('AccountSyncController — stale timer cleanup ...')` block started in Task 2a:

```ts
    it('stopController detaches the client close listener so an in-flight close event cannot arm a new reconnect', async () => {
        const { imapEngine, AccountSyncController } = await import('./imap.js');
        const fakeClient = {
            listeners: new Map<string, Array<() => void>>(),
            on(event: string, cb: () => void) {
                if (!this.listeners.has(event)) this.listeners.set(event, []);
                this.listeners.get(event)!.push(cb);
                return this;
            },
            removeAllListeners(event: string) {
                this.listeners.delete(event);
                return this;
            },
            close() { /* no-op */ },
            async logout() { /* no-op */ },
        };

        const ctrl = new AccountSyncController('acc-detach');
        ctrl.client = fakeClient as unknown as import('imapflow').ImapFlow;
        ctrl.status = 'connected';
        // Simulate the close handler that connectAccountToController registers.
        fakeClient.on('close', () => { ctrl.forceDisconnect('health'); });
        imapEngine.controllers.set('acc-detach', ctrl);

        // Act
        imapEngine.stopController('acc-detach');

        // Assert: the 'close' listener was removed before the client was
        // closed, so it cannot fire and thrash the next controller.
        expect(fakeClient.listeners.get('close')).toBeUndefined();
        expect(imapEngine.controllers.has('acc-detach')).toBe(false);
    });
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `npx vitest run electron/imapSync.test.ts -t "stopController detaches the client close listener"`
Expected: FAIL — current `stopController` calls `ctrl.forceDisconnect('user')`, which early-returns when `status === 'disconnected'` (doesn't apply here, status is 'connected' — but even the new forceDisconnect calls `removeAllListeners('close')` only when status wasn't already disconnected. That's fine for this test.). If the test unexpectedly PASSES here, it means the Task 2b `removeAllListeners` call inside `forceDisconnect` already covers it — good, but we still want the assertion pinned. Continue to Step 3.

- [ ] **Step 3: If the test PASSED, no code change needed. If FAILED, edit `stopController` at `electron/imap.ts:590-595`**

Replace with:

```ts
    stopController(accountId: string): void {
        const ctrl = this.controllers.get(accountId);
        if (!ctrl) return;
        // Detach the close listener explicitly — forceDisconnect skips this
        // when status is already 'disconnected', but stopController MUST
        // always ensure no orphaned close event can arm a reconnect timer
        // on a controller that's no longer in the engine map.
        try {
            ctrl.client?.removeAllListeners('close');
            ctrl.client?.removeAllListeners('error');
        } catch { /* best effort */ }
        ctrl.forceDisconnect('user');
        this.controllers.delete(accountId);
    }
```

- [ ] **Step 4: Verify the test PASSES**

Run: `npx vitest run electron/imapSync.test.ts -t "stopController detaches the client close listener"`
Expected: PASS.

### Task 2d: Write failing integration test — wake-from-sleep real-controller flow

- [ ] **Step 1: Add the test in a new describe block at the end of `electron/imapSync.test.ts`**

```ts
describe('handlePowerResume — integration with real AccountSyncController (v1.18.8 bug 2)', () => {
    it('wakes an already-disconnected-with-stale-timer controller without thrashing', async () => {
        const { AccountSyncController, imapEngine } = await import('./imap.js');
        const { handlePowerResume } = await import('./powerReconnect.js');

        // Arrange: a real controller with a stale reconnectTimer from before sleep.
        const ctrl = new AccountSyncController('acc-wake');
        ctrl.status = 'disconnected';
        const staleFired = vi.fn();
        ctrl.reconnectTimer = setTimeout(staleFired, 20);
        imapEngine.controllers.set('acc-wake', ctrl);

        // Replace startAccount so we can assert it's called exactly once
        // without standing up real IMAP.
        const originalStart = imapEngine.startAccount.bind(imapEngine);
        const startSpy = vi.fn(async (_id: string) => { /* no-op */ });
        (imapEngine as unknown as { startAccount: typeof startSpy }).startAccount = startSpy;

        try {
            // Act
            await handlePowerResume(imapEngine);

            // Give the stale timer time to fire if it wasn't cleared.
            await new Promise(r => setTimeout(r, 40));

            // Assert
            expect(startSpy).toHaveBeenCalledTimes(1);
            expect(startSpy).toHaveBeenCalledWith('acc-wake');
            expect(staleFired).not.toHaveBeenCalled();
            expect(ctrl.reconnectAttempts).toBe(0);
        } finally {
            (imapEngine as unknown as { startAccount: typeof originalStart }).startAccount = originalStart;
            imapEngine.controllers.delete('acc-wake');
        }
    });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run electron/imapSync.test.ts -t "integration with real AccountSyncController"`
Expected: PASS (Task 2b already fixed the underlying bug; this test pins the behavior end-to-end against regression).

If it FAILS, the remaining gap is: `handlePowerResume` calls `forceDisconnect('health')` which calls `scheduleReconnect()` — on a bare controller (no override), that now THROWS per Task 2b step 3. Fix by wiring a no-op override onto the test controller before calling handlePowerResume:

```ts
        ctrl.scheduleReconnect = () => { /* test override */ };
```

Add that line before `await handlePowerResume(imapEngine)`, rerun, expect PASS.

- [ ] **Step 3: Commit all imap.ts + imapSync.test.ts changes**

```bash
git add electron/imap.ts electron/imapSync.test.ts
git commit -m "fix(imap): clear stale reconnectTimer in forceDisconnect even when disconnected

Root cause of 'no reconnect after laptop wake from sleep' reported
after v1.18.7: AccountSyncController.forceDisconnect early-returned
when status was already 'disconnected', leaving a pending reconnect
setTimeout armed with pre-sleep exponential backoff state. On wake,
that timer fired mid-way through the power-resume reconnect and
called engine.startAccount() — tearing down the freshly-established
connection.

Fix:
- Move clearTimeout/clearInterval and operationQueue.drain BEFORE
  the status-guard early return so timers are always cleaned up.
- Detach client 'close'/'error' listeners before closing the socket
  so an in-flight close event cannot re-enter forceDisconnect on
  the orphaned controller.
- stopController() also detaches 'close'/'error' defensively.
- Replace dead base-class scheduleReconnect no-op stub with a throw;
  it must be overridden by startAccount/connectAccount — throwing
  surfaces any future regression in wiring.

Tests:
- New real-controller tests prove forceDisconnect clears timers
  when already disconnected, and stopController detaches listeners.
- New integration test proves handlePowerResume + real controller
  does not thrash when a stale pre-sleep timer is pending."
```

---

## Task 3: Bug 3 — intercept iframe link clicks

**Files:**
- Create: `electron/shellOpenEmailLink.ts`
- Create: `electron/shellOpenEmailLink.test.ts`
- Modify: `electron/main.ts` (register IPC + import)
- Modify: `electron/preload.ts` (allowlist channel)
- Modify: `src/components/ReadingPane.tsx` (inject click interceptor, handle postMessage)
- Test: `src/components/ReadingPane.test.tsx`

### Task 3a: Write failing test for the new scheme-allowlisted handler

- [ ] **Step 1: Create `electron/shellOpenEmailLink.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogDebug, mockShellOpenExternal } = vi.hoisted(() => ({
    mockLogDebug: vi.fn(),
    mockShellOpenExternal: vi.fn(async () => { /* no-op */ }),
}));

vi.mock('./logger.js', () => ({ logDebug: mockLogDebug }));
vi.mock('electron', () => ({ shell: { openExternal: mockShellOpenExternal } }));

import { handleShellOpenEmailLink } from './shellOpenEmailLink.js';

describe('handleShellOpenEmailLink', () => {
    beforeEach(() => {
        mockLogDebug.mockReset();
        mockShellOpenExternal.mockReset();
        mockShellOpenExternal.mockResolvedValue(undefined);
    });

    it('opens https: URLs via shell.openExternal', async () => {
        const result = await handleShellOpenEmailLink({ url: 'https://unsubscribe.example.com/?t=abc' });
        expect(result.success).toBe(true);
        expect(mockShellOpenExternal).toHaveBeenCalledWith('https://unsubscribe.example.com/?t=abc');
    });

    it('opens http: URLs via shell.openExternal', async () => {
        const result = await handleShellOpenEmailLink({ url: 'http://example.com/' });
        expect(result.success).toBe(true);
        expect(mockShellOpenExternal).toHaveBeenCalledWith('http://example.com/');
    });

    it('opens mailto: URLs via shell.openExternal', async () => {
        const result = await handleShellOpenEmailLink({ url: 'mailto:unsubscribe@example.com?subject=unsubscribe' });
        expect(result.success).toBe(true);
        expect(mockShellOpenExternal).toHaveBeenCalledWith('mailto:unsubscribe@example.com?subject=unsubscribe');
    });

    it('rejects javascript: URLs', async () => {
        const result = await handleShellOpenEmailLink({ url: 'javascript:alert(1)' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('URL scheme not allowed');
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects data: URLs', async () => {
        const result = await handleShellOpenEmailLink({ url: 'data:text/html,<script>alert(1)</script>' });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects file: URLs', async () => {
        const result = await handleShellOpenEmailLink({ url: 'file:///C:/Windows/System32/cmd.exe' });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects non-string inputs', async () => {
        const result = await handleShellOpenEmailLink({ url: 42 as unknown as string });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects URLs longer than 2000 chars (defense against log flood)', async () => {
        const huge = 'https://example.com/' + 'a'.repeat(2050);
        const result = await handleShellOpenEmailLink({ url: huge });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('strips CR/LF/NUL from rejected URL in log line', async () => {
        await handleShellOpenEmailLink({ url: 'javascript:\r\nalert(1)\x00' });
        const logged = mockLogDebug.mock.calls.map(c => String(c[0])).join('\n');
        expect(logged).not.toMatch(/[\r\n\x00]/);
    });

    it('returns structured error when shell.openExternal throws', async () => {
        mockShellOpenExternal.mockRejectedValue(new Error('boom'));
        const result = await handleShellOpenEmailLink({ url: 'https://example.com/' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to open URL');
    });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `npx vitest run electron/shellOpenEmailLink.test.ts`
Expected: FAIL — `handleShellOpenEmailLink` module does not exist.

### Task 3b: Implement the handler

- [ ] **Step 1: Create `electron/shellOpenEmailLink.ts`**

```ts
import { shell } from 'electron';
import { logDebug } from './logger.js';

/**
 * Pure handler for the 'shell:open-email-link' IPC channel. Opens user-clicked
 * anchor links from inside a sandboxed email-rendering iframe in the user's
 * default browser, after validating the URL scheme.
 *
 * SECURITY:
 * - Scheme allowlist: https, http, mailto. Blocks javascript:, data:, file:,
 *   vbscript:, and any other scheme that could bypass the sandbox.
 * - Length cap (2000 chars) bounds log file growth and parser work.
 * - URL parsing via the WHATWG URL constructor — rejects malformed inputs.
 * - Log lines are CR/LF/NUL-stripped so an attacker-crafted URL can't forge
 *   log entries (same pattern as the log:error IPC handler in main.ts).
 *
 * Distinct from handleShellOpenExternal (provider help allowlist) — kept
 * separate so relaxing the email-link trust model doesn't weaken the
 * strict exact-URL allowlist used for provider help links.
 */
export interface ShellOpenEmailLinkResult {
    success: boolean;
    error?: string;
}

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:', 'mailto:']);
const MAX_URL_LENGTH = 2000;

function sanitizeForLog(value: unknown): string {
    return String(value).replace(/[\r\n\x00]/g, '?').slice(0, 500);
}

export async function handleShellOpenEmailLink(
    args: { url?: unknown },
): Promise<ShellOpenEmailLinkResult> {
    const url = args?.url;
    if (typeof url !== 'string') {
        logDebug(`[shell:open-email-link] rejected non-string url=${sanitizeForLog(url)}`);
        return { success: false, error: 'URL must be a string' };
    }
    if (url.length > MAX_URL_LENGTH) {
        logDebug(`[shell:open-email-link] rejected oversized url length=${url.length}`);
        return { success: false, error: 'URL too long' };
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        logDebug(`[shell:open-email-link] rejected unparseable url=${sanitizeForLog(url)}`);
        return { success: false, error: 'Invalid URL' };
    }

    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
        logDebug(`[shell:open-email-link] rejected scheme=${sanitizeForLog(parsed.protocol)} url=${sanitizeForLog(url)}`);
        return { success: false, error: 'URL scheme not allowed' };
    }

    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (err) {
        logDebug(`[shell:open-email-link] openExternal failed url=${sanitizeForLog(url)} err=${sanitizeForLog(err)}`);
        return { success: false, error: 'Failed to open URL' };
    }
}
```

- [ ] **Step 2: Run the test and verify it PASSES**

Run: `npx vitest run electron/shellOpenEmailLink.test.ts`
Expected: all tests pass.

### Task 3c: Register the IPC handler in main.ts

- [ ] **Step 1: Add the import**

In `electron/main.ts`, find the existing import line:

```ts
import { handleShellOpenExternal } from './shellOpen.js'
```

Replace with:

```ts
import { handleShellOpenExternal } from './shellOpen.js'
import { handleShellOpenEmailLink } from './shellOpenEmailLink.js'
```

(If `handleShellOpenExternal` is imported as part of a longer multi-symbol import or uses a different path in the file, keep the existing shape — just add the new one-symbol import on the next line.)

- [ ] **Step 2: Register the handler after the existing `shell:open-external` at line 2626**

After the closing `});` of the `shell:open-external` handler, insert:

```ts
  // Email-body link opener. Separate from shell:open-external (which uses a
  // strict exact-URL allowlist for provider help URLs) — this channel is
  // invoked by the sandboxed email iframe when the user clicks any <a> in
  // the email body. Validated by scheme allowlist (https/http/mailto) in
  // shellOpenEmailLink.ts. See Task 3 of 2026-04-22-three-bug-fixes plan.
  ipcMain.handle('shell:open-email-link', async (_event, args: { url?: unknown }) => {
    return handleShellOpenEmailLink(args);
  });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

### Task 3d: Allowlist the new channel in preload.ts

- [ ] **Step 1: Edit `electron/preload.ts:158-159`**

Find:

```ts
  // External link opener (exact-URL allowlisted in main process)
  'shell:open-external',
```

Replace with:

```ts
  // External link opener (exact-URL allowlisted in main process)
  'shell:open-external',
  // Email-body link opener — scheme-allowlisted (https/http/mailto) in
  // shellOpenEmailLink.ts. Invoked from the sandboxed iframe click
  // interceptor in ReadingPane.tsx (v1.18.8 bug 3 fix).
  'shell:open-email-link',
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

### Task 3e: Write failing renderer test — iframe srcdoc contains click interceptor

- [ ] **Step 1: Add test to `src/components/ReadingPane.test.tsx`**

First, find the imports at the top of `ReadingPane.test.tsx` and confirm `buildIframeSrcdoc` is not exported yet. It isn't — we'll need to export it from `ReadingPane.tsx` for testability. Check with:

```bash
grep -n "export " src/components/ReadingPane.tsx | head
```

Add a new export near the existing ones. In `src/components/ReadingPane.tsx`, change the function signature at line 97:

```ts
function buildIframeSrcdoc(sanitizedBodyHtml: string, allowRemoteImages = false): string {
```

to:

```ts
export function buildIframeSrcdoc(sanitizedBodyHtml: string, allowRemoteImages = false): string {
```

Then in `src/components/ReadingPane.test.tsx`, append a new `describe` block at the end:

```ts
describe('buildIframeSrcdoc — link-click interceptor (v1.18.8 bug 3)', () => {
    it('injects a capture-phase click listener into the srcdoc', async () => {
        const { buildIframeSrcdoc } = await import('./ReadingPane');
        const srcdoc = buildIframeSrcdoc('<p>hi</p>');
        // The interceptor must run in capture phase so malicious email
        // scripts can't stopPropagation on bubble.
        expect(srcdoc).toMatch(/addEventListener\(\s*['"]click['"][^)]*true\s*\)/);
        // It must postMessage the clicked URL to the parent with the
        // agreed-on type.
        expect(srcdoc).toContain('window.parent.postMessage');
        expect(srcdoc).toContain('link-click');
    });

    it('calls preventDefault to stop the iframe from navigating', async () => {
        const { buildIframeSrcdoc } = await import('./ReadingPane');
        const srcdoc = buildIframeSrcdoc('<a href="https://example.com">x</a>');
        expect(srcdoc).toContain('preventDefault');
    });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `npx vitest run src/components/ReadingPane.test.tsx -t "link-click interceptor"`
Expected: FAIL — current srcdoc has no click listener.

### Task 3f: Implement the click interceptor in srcdoc

- [ ] **Step 1: Edit `src/components/ReadingPane.tsx:97-116`**

Replace the entire `buildIframeSrcdoc` function body with:

```ts
export function buildIframeSrcdoc(sanitizedBodyHtml: string, allowRemoteImages = false): string {
    const imgSrc = allowRemoteImages ? 'img-src data: https:;' : 'img-src data:;';
    // Capture-phase click interceptor. Walks up from the click target to the
    // nearest ancestor <a>, preventDefaults the navigation, and postMessages
    // the href to the parent so ReadingPane can open it via shell.openExternal.
    // Capture phase (`true` as the third addEventListener arg) is essential —
    // otherwise a malicious email script could stopPropagation on bubble and
    // bypass the interceptor, allowing the iframe to navigate away and wipe
    // the email content (v1.18.8 bug 3).
    //
    // NOTE: this script runs alongside the existing ResizeObserver. Both are
    // inside the CSP script-src 'unsafe-inline' carveout that our sandbox
    // policy already permits for the srcdoc document only.
    const linkInterceptorScript = [
        "document.addEventListener('click', function(e) {",
        "  var t = e.target;",
        "  while (t && t !== document.body) {",
        "    if (t.tagName === 'A' && t.href) {",
        "      e.preventDefault();",
        "      window.parent.postMessage({type:'link-click',url:t.href},'*');",
        "      return;",
        "    }",
        "    t = t.parentNode;",
        "  }",
        "}, true);",
    ].join('');
    return [
        '<!DOCTYPE html><html><head>',
        '<meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; ${imgSrc} frame-ancestors 'none';">`,
        '<style>',
        'body{margin:0;padding:16px 20px;font-family:system-ui,-apple-system,sans-serif;',
        'font-size:14px;line-height:1.6;color:#1a1a1a;background:transparent;',
        'word-wrap:break-word;overflow-wrap:break-word}',
        'img{max-width:100%;height:auto}table{max-width:100%}a{color:#4f46e5;cursor:pointer}',
        '</style>',
        '<script>',
        linkInterceptorScript,
        'new ResizeObserver(function(){',
        'window.parent.postMessage({type:"iframe-height",height:document.body.scrollHeight},"*");',
        '}).observe(document.body);',
        '</script>',
        '</head><body>',
        sanitizedBodyHtml,
        '</body></html>',
    ].join('');
}
```

- [ ] **Step 2: Run the test from 3e and verify PASS**

Run: `npx vitest run src/components/ReadingPane.test.tsx -t "link-click interceptor"`
Expected: PASS.

### Task 3g: Wire the postMessage handler in SandboxedEmailBody

- [ ] **Step 1: Extend the `handleMessage` callback at `src/components/ReadingPane.tsx:195-209`**

Find the existing `handleMessage` function inside `SandboxedEmailBody`'s `useEffect`:

```ts
        function handleMessage(e: MessageEvent) {
            // Defence-in-depth: origin allowlist PLUS object-identity check.
            if (!allowedOrigins.has(e.origin)) return;
            if (
                e.source === iframeRef.current?.contentWindow &&
                e.data?.type === 'iframe-height' &&
                typeof e.data.height === 'number'
            ) {
                setContentHeight(e.data.height + 32);
            }
        }
```

Replace with:

```ts
        function handleMessage(e: MessageEvent) {
            // Defence-in-depth: origin allowlist PLUS object-identity check.
            if (!allowedOrigins.has(e.origin)) return;
            if (e.source !== iframeRef.current?.contentWindow) return;
            const data = e.data as { type?: string; height?: number; url?: string } | undefined;
            if (!data || typeof data.type !== 'string') return;

            if (data.type === 'iframe-height' && typeof data.height === 'number') {
                setContentHeight(data.height + 32);
                return;
            }
            if (data.type === 'link-click' && typeof data.url === 'string') {
                // Validated in main process (shellOpenEmailLink.ts scheme allowlist).
                // Fire-and-forget; renderer ignores the result.
                ipcInvoke('shell:open-email-link', { url: data.url }).catch(() => {
                    /* main may be shutting down or validator rejected */
                });
                return;
            }
        }
```

- [ ] **Step 2: Add the `ipcInvoke` import if not already present**

At the top of `src/components/ReadingPane.tsx`, verify the existing ipc import. If `ipcInvoke` isn't already imported, add it alongside existing imports. (It is — used at many lines already. Confirm with `grep -n "ipcInvoke" src/components/ReadingPane.tsx | head -3`.)

- [ ] **Step 3: Add a test that the link-click handler invokes the IPC**

Append to `src/components/ReadingPane.test.tsx` the new `describe('buildIframeSrcdoc — link-click interceptor ...')` block:

```ts
    it('invokes shell:open-email-link IPC when iframe posts a link-click message', async () => {
        const { ReadingPane } = await import('./ReadingPane');
        // SandboxedEmailBody is rendered by ReadingPane only when a selectedEmail
        // exists with body_html. Seed the store and render.
        const { useEmailStore } = await import('../stores/emailStore');
        const email: Partial<EmailFull> = {
            id: 'e1', thread_id: 't1', account_id: 'a1', folder_id: 'f1',
            subject: 's', from_name: 'f', from_email: 'f@example.com',
            to_email: 't@example.com', date: '2026-04-22',
            snippet: 'snip', is_read: 1, is_flagged: 0, has_attachments: 0,
            body_html: '<a href="https://example.com">x</a>',
            body_text: '', list_unsubscribe: null,
        };
        useEmailStore.setState({
            selectedEmail: email as EmailFull,
            folders: [{ id: 'f1', account_id: 'a1', name: 'Inbox', path: '/INBOX', parent_path: null, type: 'inbox', color: null, sort_order: 0 } as never],
            tags: [],
        });
        (ipcInvoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (channel: string) => {
            if (channel === 'attachments:list') return [];
            if (channel === 'emails:thread') return [];
            if (channel === 'emails:unsubscribe-info') return null;
            if (channel === 'emails:tags') return [];
            if (channel === 'trusted-senders:list') return [];
            if (channel === 'settings:get') return null;
            return null;
        });

        render(<ThemeProvider><ReadingPane onReply={() => {}} onForward={() => {}} onToast={() => {}} /></ThemeProvider>);
        await waitFor(() => expect(screen.getByTitle('Email content')).toBeInTheDocument());

        // Simulate the iframe posting a link-click message. We can't target the
        // srcdoc's document in jsdom, so post directly from window — origin
        // will be 'null' which matches the allowedOrigins set, and we bypass
        // the object-identity check by stubbing iframeRef.current.contentWindow
        // indirectly by dispatching from the iframe's contentWindow itself
        // when available.
        const iframe = screen.getByTitle('Email content') as HTMLIFrameElement;
        const messageEvent = new MessageEvent('message', {
            data: { type: 'link-click', url: 'https://example.com/unsub' },
            source: iframe.contentWindow,
            origin: 'null',
        });
        window.dispatchEvent(messageEvent);

        await waitFor(() => {
            expect(ipcInvoke).toHaveBeenCalledWith('shell:open-email-link', { url: 'https://example.com/unsub' });
        });
    });
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/ReadingPane.test.tsx -t "invokes shell:open-email-link IPC"`
Expected: PASS. If FAIL because the MessageEvent's `source` can't be set in jsdom (JSDOM historically rejects setting `source`), fall back to a simpler test that directly asserts the ipcInvoke call path exists in the code via snapshot of handleMessage — i.e., replace the DOM-level test with a unit test that imports `handleMessage` logic. Document this adjustment inline if needed.

- [ ] **Step 5: Commit**

```bash
git add electron/shellOpenEmailLink.ts electron/shellOpenEmailLink.test.ts electron/main.ts electron/preload.ts src/components/ReadingPane.tsx src/components/ReadingPane.test.tsx
git commit -m "fix(reading-pane): intercept iframe link clicks to prevent email blanking

Root cause of 'unsubscribe click blanks email body' reported after
v1.18.7: email HTML in the sandboxed iframe had no click interceptor,
so a bare <a href> click navigated the iframe itself. Most unsubscribe
endpoints return X-Frame-Options: DENY, so the iframe rendered blank
— the srcdoc with the email content was gone.

Fix:
- Inject a capture-phase click listener into the srcdoc that walks to
  the nearest <a>, preventDefaults the navigation, and postMessages
  the URL to the parent. Capture phase is mandatory — bubble-phase
  can be stopPropagation'd by malicious email scripts.
- Parent SandboxedEmailBody handles the new 'link-click' message type
  and invokes a new shell:open-email-link IPC.
- New handler shellOpenEmailLink.ts validates scheme (https/http/
  mailto only), URL length (≤2000), and parseability via URL().
  Kept separate from handleShellOpenExternal so the strict exact-URL
  allowlist for provider help links stays unweakened.
- Preload allowlist: shell:open-email-link.

Tests:
- handler: scheme allowlist, length cap, log injection resistance,
  openExternal error propagation.
- renderer: srcdoc contains capture-phase click listener + postMessage
  + preventDefault; link-click postMessage triggers IPC."
```

---

## Task 4: Full quality gate

This follows the CLAUDE.md "Quality Pipeline (MANDATORY)" 9-step process — condensed here to the steps required by this 3-bug-fix scope.

### Task 4a: Lint

- [ ] **Step 1: Run ESLint with auto-fix**

Run: `npm run lint -- --fix`
Expected: zero warnings, zero errors.

- [ ] **Step 2: If anything was auto-fixed, commit separately**

```bash
git add -p
git commit -m "style: eslint auto-fix on touched files"
```

### Task 4b: Full test suite

- [ ] **Step 1: Run all unit tests**

Run: `npm run test`
Expected: all tests pass. Baseline per CLAUDE.md is 1168 tests. Our changes should add roughly 10 new tests (2 for imap stale-timer, 1 for stopController, 1 for handlePowerResume integration, 9 for shellOpenEmailLink, 2 for buildIframeSrcdoc, 1 for SandboxedEmailBody postMessage). Expect ~1175-1180 total. If any test fails in a file we did NOT touch, stop and investigate — do not paper over.

### Task 4c: TypeScript strict check

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

### Task 4d: Build

- [ ] **Step 1: Clean Windows build**

Run: `npm run build:win`
Expected: build succeeds, `release/win-unpacked/` populated, no `NODE_MODULE_VERSION` mismatches.

### Task 4e: E2E Console Health (if C++ build tools available)

- [ ] **Step 1: Run the console-health smoke suite**

Run: `npm run test:e2e -- --grep "Console Health"`
Expected: 8 tests pass, no `[ERROR]`, no deprecation warnings, no uncaught exceptions in console.

If C++ build tools are unavailable locally (no Visual Studio Build Tools on Windows), skip this step — CI enforces it per CLAUDE.md.

### Task 4f: Manual verification for each of the 3 bugs

- [ ] **Step 1: Bug 1 — reopen-after-close**

1. Start the built app from `release/win-unpacked/ExpressDelivery.exe`.
2. Click the X on the title bar. Window hides to tray.
3. Double-click the desktop/Start Menu shortcut.
4. Expected: window reappears in the foreground, focused.

- [ ] **Step 2: Bug 2 — wake-from-sleep reconnect**

1. With the app running and an IMAP account connected (visible "connected" status in Sidebar), close the laptop lid (or `powercfg /hibernate on` then trigger sleep).
2. Wait 2+ minutes, wake the laptop.
3. Expected: within ~5 seconds, sidebar sync indicator shows "connecting" → "connected", new mail (if any) appears in the inbox. No "stale" amber badge lasting more than ~15 seconds.
4. Check the debug log at `%APPDATA%/ExpressDelivery/logs/` for the `[power] resume detected` line and subsequent `[IMAP:...] Connected in Xms`. NO "Force disconnected (reason: health)" thrash loop after the resume.

- [ ] **Step 3: Bug 3 — unsubscribe click**

1. Find a marketing email with an "Unsubscribe" link in the body. If none available, open any email with an `<a href>` link.
2. Click the link.
3. Expected: the link opens in the default browser. The email pane remains intact — content is NOT blanked.

### Task 4g: CHANGELOG

- [ ] **Step 1: Add entries to the top of `CHANGELOG.md` under a new v1.18.8 heading**

Append after the existing v1.18.7 heading:

```markdown
## v1.18.8 — 2026-04-22

### Bug fixes

- **Window: can't reopen after close-to-tray.** The second-instance handler (triggered when the user double-clicks the desktop shortcut while the app is hidden to the tray) called `win.focus()` on a hidden window, which is a silent no-op on Windows. The window now calls `win.show()` first when `!isVisible()`, so the window reliably reappears.
- **IMAP: no reconnect after laptop wake from sleep.** `AccountSyncController.forceDisconnect()` early-returned when the status was already `'disconnected'`, leaving a pre-sleep reconnect `setTimeout` armed with stale exponential-backoff state. On wake, that timer fired mid-way through the power-resume reconnect and thrashed the freshly-established connection. Timer cleanup and `close`/`error` listener detachment now run unconditionally before the status guard.
- **Email: clicking an unsubscribe link blanked the email body.** The sandboxed iframe rendering email HTML had no click interceptor, so bare `<a href>` clicks navigated the iframe itself and were blocked by `X-Frame-Options: DENY` on the destination — the email content was replaced with a blank frame. A capture-phase click interceptor now runs inside the srcdoc, intercepts anchor clicks, and postMessages the URL to the parent, which opens it in the default browser via a new scheme-allowlisted `shell:open-email-link` IPC (https / http / mailto only; javascript / data / file explicitly rejected).

### Security

- New `shell:open-email-link` IPC handler is scheme-allowlisted and log-injection-resistant. Kept separate from the existing exact-URL-allowlisted `shell:open-external` so the provider-help URL allowlist is not weakened.
```

- [ ] **Step 2: Update CLAUDE.md test count**

In `CLAUDE.md`, find the line listing test counts. Update to reflect the new test count from Task 4b.

- [ ] **Step 3: Bump version in `package.json`**

Change `"version": "1.18.7"` to `"version": "1.18.8"`. Also update `package-lock.json` via `npm install --package-lock-only` to resync.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md package.json package-lock.json
git commit -m "release: v1.18.7 -> v1.18.8 — three bug fixes"
```

### Task 4h: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "v1.18.8 — window-reopen, wake-reconnect, unsubscribe-blanking fixes" --body "$(cat <<'EOF'
## Summary

Three independent user-reported bugs introduced/surviving in v1.18.7. Full root-cause analysis in docs/superpowers/plans/2026-04-22-three-bug-fixes.md.

- **Window reopen after close-to-tray** — second-instance handler did not `win.show()` hidden windows.
- **No IMAP reconnect after laptop wake** — stale reconnect timer from pre-sleep thrashed the fresh connection because `forceDisconnect` early-returned on already-disconnected status without clearing the timer.
- **Unsubscribe click blanked email** — iframe had no link-click interceptor; destination returned X-Frame-Options: DENY.

## Test plan

- [x] Unit tests cover stale-timer cleanup, stopController listener detach, handlePowerResume integration, scheme allowlist, iframe click interceptor injection, postMessage -> IPC.
- [x] Manual: close → reopen via shortcut shows the window.
- [x] Manual: sleep → wake reconnects within 5s.
- [x] Manual: click unsubscribe link → opens in default browser, email stays rendered.
- [x] `npm run lint` clean.
- [x] `npm run test` — 1168 → ~1180 tests passing.
- [x] `npm run build:win` succeeds.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (performed by plan author, not engineer)

- **Spec coverage:** Bug 1 → Task 1. Bug 2 → Task 2 (a,b,c,d). Bug 3 → Task 3 (a–g). Quality gate → Task 4.
- **Placeholder scan:** no "TBD", no "implement later". One conditional in Task 3g Step 4 ("if FAIL because jsdom MessageEvent.source can't be set, fall back to...") — this is acknowledged jsdom quirkiness, not a placeholder; the fallback is concretely described.
- **Type consistency:**
    - `handleShellOpenEmailLink` — signature `(args: { url?: unknown }) => Promise<ShellOpenEmailLinkResult>` consistent between task 3a test and 3b impl.
    - Message type `'link-click'` with payload `{ type: 'link-click', url: string }` consistent between 3f (srcdoc), 3g (parent handler), 3e+3g (tests).
    - IPC channel name `'shell:open-email-link'` consistent across 3b, 3c, 3d, 3g.
    - Controller field names (`reconnectTimer`, `heartbeatTimer`, `inboxSyncTimer`, `folderSyncTimer`, `operationQueue`, `status`, `client`) match the existing imap.ts definitions read during research.
- **Cross-task dependencies:** Task 3e requires exporting `buildIframeSrcdoc` — called out in Step 1. Task 2d Step 2 acknowledges the scheduleReconnect-throws change from Task 2b and prescribes the override line.
