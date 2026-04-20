import { logDebug } from './logger.js';

/**
 * Structural interface of the bits of `ImapEngine` we actually touch. Keeping
 * this narrow means the unit test can pass a plain fake instead of bootstrapping
 * a real engine + database, and the function is trivially reusable for any
 * future per-account lifecycle manager.
 */
export interface PowerReconnectController {
    reconnectAttempts: number;
    forceDisconnect(reason: 'health' | 'user' | 'shutdown'): void;
}

export interface PowerReconnectEngine {
    controllers: Map<string, PowerReconnectController>;
    startAccount(accountId: string): Promise<void>;
}

/**
 * Shape of `Electron.PowerMonitor` we use. Declared locally so the module stays
 * testable without pulling Electron into the test runtime (Electron globals
 * don't exist in vitest's jsdom environment).
 */
export interface PowerMonitorLike {
    on(event: 'resume' | 'unlock-screen', listener: () => void): unknown;
    off(event: 'resume' | 'unlock-screen', listener: () => void): unknown;
}

/**
 * Tear down every active IMAP connection and restart it. Called on OS resume
 * and screen-unlock events — the TCP sockets have usually been silently killed
 * during suspend, and without this the next poll waits up to 60s for a timeout
 * plus exponential reconnect backoff before the user sees new mail.
 *
 * Accounts are reconnected in parallel because `startAccount` does its own
 * inbox initial-sync. Per-account failures are logged and ignored so one bad
 * account can't block the others.
 */
export async function handlePowerResume(engine: PowerReconnectEngine): Promise<void> {
    const accountIds = [...engine.controllers.keys()];
    if (accountIds.length === 0) return;

    logDebug(`[power] resume detected — reconnecting ${accountIds.length} account(s)`);

    for (const id of accountIds) {
        const ctrl = engine.controllers.get(id);
        if (!ctrl) continue;
        try {
            ctrl.forceDisconnect('health');
        } catch (err) {
            logDebug(`[power] forceDisconnect(${id}) threw: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Clear the exponential-backoff counter so the fresh connect attempt
        // isn't penalised by failures that happened before the machine slept.
        ctrl.reconnectAttempts = 0;
    }

    const results = await Promise.allSettled(
        accountIds.map(id => engine.startAccount(id))
    );
    results.forEach((result, idx) => {
        if (result.status === 'rejected') {
            const id = accountIds[idx];
            const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
            logDebug(`[power] startAccount(${id}) failed after resume: ${msg}`);
        }
    });
}

/**
 * Build a debounced reconnect trigger. Multiple callers (the powerMonitor
 * `resume` / `unlock-screen` events and the renderer `network:online` IPC)
 * all share one trigger so a burst of events collapses into a single
 * reconnect run. A later call, once the previous run has settled, is allowed.
 */
export function createReconnectTrigger(engine: PowerReconnectEngine): () => void {
    let inflight: Promise<void> | null = null;
    return () => {
        if (inflight) return;
        inflight = handlePowerResume(engine)
            .catch((err) => {
                logDebug(`[power] handlePowerResume threw: ${err instanceof Error ? err.message : String(err)}`);
            })
            .finally(() => { inflight = null; });
    };
}

/**
 * Subscribe to OS wake / unlock events and trigger a full reconnect. Returns a
 * disposer that removes the listeners (used on app quit and in tests).
 *
 * A small in-flight guard coalesces overlapping wake events: Windows often
 * fires `resume` and `unlock-screen` within a few ms of each other, and there's
 * no value in running the reconnect twice.
 */
export function attachPowerMonitor(
    engine: PowerReconnectEngine,
    monitor: PowerMonitorLike,
    sharedTrigger?: () => void,
): () => void {
    const trigger = sharedTrigger ?? createReconnectTrigger(engine);
    const onResume = (): void => { trigger(); };
    const onUnlock = (): void => { trigger(); };

    monitor.on('resume', onResume);
    monitor.on('unlock-screen', onUnlock);

    return () => {
        monitor.off('resume', onResume);
        monitor.off('unlock-screen', onUnlock);
    };
}
