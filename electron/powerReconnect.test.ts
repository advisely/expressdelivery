import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogDebug } = vi.hoisted(() => ({
    mockLogDebug: vi.fn(),
}));

vi.mock('./logger.js', () => ({
    logDebug: mockLogDebug,
}));

import { handlePowerResume, attachPowerMonitor, type PowerReconnectController, type PowerReconnectEngine } from './powerReconnect.js';

type Reason = 'health' | 'user' | 'shutdown';
interface FakeController extends PowerReconnectController {
    forceDisconnect: ((reason: Reason) => void) & ReturnType<typeof vi.fn>;
}

interface FakeEngine extends PowerReconnectEngine {
    controllers: Map<string, FakeController>;
    startAccount: ((accountId: string) => Promise<void>) & ReturnType<typeof vi.fn>;
}

function makeEngine(accountIds: string[], startImpl?: (id: string) => Promise<void>): FakeEngine {
    const controllers = new Map<string, FakeController>();
    for (const id of accountIds) {
        controllers.set(id, {
            reconnectAttempts: 5,
            forceDisconnect: vi.fn<(reason: Reason) => void>() as FakeController['forceDisconnect'],
        });
    }
    const startAccount = vi.fn(startImpl ?? (async () => { /* noop */ })) as FakeEngine['startAccount'];
    return { controllers, startAccount };
}

describe('handlePowerResume', () => {
    beforeEach(() => {
        mockLogDebug.mockReset();
    });

    it('force-disconnects every known controller with reason "health"', async () => {
        const engine = makeEngine(['acc-a', 'acc-b']);
        await handlePowerResume(engine);

        expect(engine.controllers.get('acc-a')!.forceDisconnect).toHaveBeenCalledWith('health');
        expect(engine.controllers.get('acc-b')!.forceDisconnect).toHaveBeenCalledWith('health');
    });

    it('resets reconnectAttempts to 0 on every controller before reconnect', async () => {
        const engine = makeEngine(['acc-a', 'acc-b']);
        // startAccount must observe a zeroed counter when it's called
        engine.startAccount.mockImplementation(async (id: string) => {
            expect(engine.controllers.get(id)!.reconnectAttempts).toBe(0);
        });

        await handlePowerResume(engine);

        expect(engine.controllers.get('acc-a')!.reconnectAttempts).toBe(0);
        expect(engine.controllers.get('acc-b')!.reconnectAttempts).toBe(0);
    });

    it('calls startAccount for every known account', async () => {
        const engine = makeEngine(['acc-a', 'acc-b', 'acc-c']);
        await handlePowerResume(engine);

        expect(engine.startAccount).toHaveBeenCalledWith('acc-a');
        expect(engine.startAccount).toHaveBeenCalledWith('acc-b');
        expect(engine.startAccount).toHaveBeenCalledWith('acc-c');
        expect(engine.startAccount).toHaveBeenCalledTimes(3);
    });

    it('is a safe no-op when there are no accounts', async () => {
        const engine = makeEngine([]);
        await expect(handlePowerResume(engine)).resolves.toBeUndefined();
        expect(engine.startAccount).not.toHaveBeenCalled();
    });

    it('continues with remaining accounts when one startAccount rejects', async () => {
        const engine = makeEngine(['acc-a', 'acc-b', 'acc-c'], async (id: string) => {
            if (id === 'acc-b') throw new Error('boom');
        });

        await handlePowerResume(engine);

        expect(engine.startAccount).toHaveBeenCalledWith('acc-a');
        expect(engine.startAccount).toHaveBeenCalledWith('acc-b');
        expect(engine.startAccount).toHaveBeenCalledWith('acc-c');
        // The failure must be logged, not swallowed silently
        const logged = mockLogDebug.mock.calls.map(c => String(c[0]));
        expect(logged.some(m => m.includes('acc-b') && m.toLowerCase().includes('boom'))).toBe(true);
    });
});

describe('attachPowerMonitor', () => {
    function makeMonitor() {
        const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
        return {
            handlers,
            on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
                if (!handlers.has(event)) handlers.set(event, new Set());
                handlers.get(event)!.add(cb);
            }),
            off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
                handlers.get(event)?.delete(cb);
            }),
        };
    }

    it('subscribes to resume and unlock-screen events', () => {
        const engine = makeEngine(['acc-a']);
        const monitor = makeMonitor();

        attachPowerMonitor(engine, monitor);

        expect(monitor.on).toHaveBeenCalledWith('resume', expect.any(Function));
        expect(monitor.on).toHaveBeenCalledWith('unlock-screen', expect.any(Function));
    });

    it('triggers reconnect when resume fires', async () => {
        const engine = makeEngine(['acc-a']);
        const monitor = makeMonitor();

        attachPowerMonitor(engine, monitor);
        // Fire the resume event
        const resumeHandlers = monitor.handlers.get('resume');
        expect(resumeHandlers).toBeDefined();
        for (const h of resumeHandlers!) h();
        // Allow the async handler to settle
        await new Promise(r => setImmediate(r));

        expect(engine.controllers.get('acc-a')!.forceDisconnect).toHaveBeenCalledWith('health');
        expect(engine.startAccount).toHaveBeenCalledWith('acc-a');
    });

    it('returns a disposer that removes both listeners', () => {
        const engine = makeEngine([]);
        const monitor = makeMonitor();

        const dispose = attachPowerMonitor(engine, monitor);
        dispose();

        expect(monitor.off).toHaveBeenCalledWith('resume', expect.any(Function));
        expect(monitor.off).toHaveBeenCalledWith('unlock-screen', expect.any(Function));
        expect(monitor.handlers.get('resume')?.size ?? 0).toBe(0);
        expect(monitor.handlers.get('unlock-screen')?.size ?? 0).toBe(0);
    });

    it('debounces overlapping wake events so reconnect runs once', async () => {
        const engine = makeEngine(['acc-a']);
        const monitor = makeMonitor();

        attachPowerMonitor(engine, monitor);
        // Fire resume and unlock-screen back-to-back (common pattern on Windows wake)
        for (const h of monitor.handlers.get('resume')!) h();
        for (const h of monitor.handlers.get('unlock-screen')!) h();
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        // startAccount should have been called exactly once for the one account,
        // not twice, because the second wake event coalesces into the in-flight run
        expect(engine.startAccount).toHaveBeenCalledTimes(1);
    });
});

describe('createReconnectTrigger', () => {
    it('coalesces a resume and a network:online burst into a single reconnect', async () => {
        const engine = makeEngine(['acc-a']);
        const { createReconnectTrigger } = await import('./powerReconnect.js');

        const trigger = createReconnectTrigger(engine);
        // Simulate powerMonitor 'resume' and renderer 'network:online' firing within
        // the same event loop tick — both paths use the same trigger.
        trigger();
        trigger();
        trigger();
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        expect(engine.startAccount).toHaveBeenCalledTimes(1);
    });

    it('allows a follow-up reconnect after the first completes', async () => {
        const engine = makeEngine(['acc-a']);
        const { createReconnectTrigger } = await import('./powerReconnect.js');

        const trigger = createReconnectTrigger(engine);
        trigger();
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        // After the first reconnect settles, a later trigger must not be swallowed
        trigger();
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        expect(engine.startAccount).toHaveBeenCalledTimes(2);
    });
});
