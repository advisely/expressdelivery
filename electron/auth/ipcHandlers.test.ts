// Phase 2 OAuth IPC handler tests (§10.1, D9.1-D9.4, D11.3, D11.5b, D8.2).
//
// Tests register the handlers by importing ipcHandlers.js after mocks are
// wired, then retrieve the handler function from the mockIpcMainHandle call
// log and invoke it directly. This avoids needing a real Electron context.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockIpcMainHandle, mockShellOpenExternal,
    mockStartGoogleFlow, mockStartMicrosoftFlow,
    mockGetAuthTokenManager, mockPersistInitialTokens,
    mockDbGet, mockDbRun, mockDbPrepare, mockLogDebug,
    mockGetGoogleOAuthConfig, mockGetMicrosoftOAuthConfig,
} = vi.hoisted(() => ({
    mockIpcMainHandle: vi.fn(),
    mockShellOpenExternal: vi.fn().mockResolvedValue(undefined),
    mockStartGoogleFlow: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockStartMicrosoftFlow: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockGetAuthTokenManager: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockPersistInitialTokens: vi.fn(() => undefined),
    mockDbGet: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockDbRun: vi.fn(),
    mockDbPrepare: vi.fn(() => ({ get: mockDbGet, run: mockDbRun, all: vi.fn() })),
    mockLogDebug: vi.fn(),
    mockGetGoogleOAuthConfig: vi.fn(() => ({ clientId: 'gid', clientSecret: 'gs' })),
    mockGetMicrosoftOAuthConfig: vi.fn(() => ({ clientId: 'mid', tenantId: 'common', authority: 'https://login.microsoftonline.com/common' })),
}));

vi.mock('electron', () => ({
    ipcMain: { handle: mockIpcMainHandle },
    shell: { openExternal: mockShellOpenExternal },
}));
vi.mock('../oauth/google.js', () => ({ startInteractiveFlow: mockStartGoogleFlow }));
vi.mock('../oauth/microsoft.js', () => ({ startInteractiveFlow: mockStartMicrosoftFlow }));
vi.mock('./tokenManager.js', () => ({ getAuthTokenManager: mockGetAuthTokenManager }));
vi.mock('../db.js', () => ({
    getDatabase: vi.fn(() => ({
        prepare: mockDbPrepare,
        // Pass-through transaction: runs the supplied function immediately.
        // Real better-sqlite3 transactions execute synchronously; we replicate
        // that synchronous semantics so errors propagate the same way.
        transaction: (fn: () => unknown) => () => fn(),
    })),
}));
vi.mock('../logger.js', () => ({ logDebug: mockLogDebug }));
vi.mock('../oauth/clientConfig.js', () => ({
    getGoogleOAuthConfig: mockGetGoogleOAuthConfig,
    getMicrosoftOAuthConfig: mockGetMicrosoftOAuthConfig,
}));

// Handler cache — populated once at module load by registerAuthIpcHandlers().
// vi.clearAllMocks() wipes the mockIpcMainHandle call log between tests, so
// we can't look handlers up from the log; we snapshot them here on import.
const handlerMap = new Map<string, (_e: unknown, ...a: unknown[]) => Promise<unknown>>();

function getHandler(ch: string): ((_e: unknown, ...a: unknown[]) => Promise<unknown>) | undefined {
    return handlerMap.get(ch);
}

// Construct a minimal unsigned JWT payload so google idToken parsing extracts
// `email` and `sub` claims. Header + signature segments are irrelevant — the
// implementation only reads the middle segment.
function makeFakeIdToken(claims: Record<string, string>): string {
    const header = Buffer.from('{}', 'utf-8').toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url');
    return `${header}.${payload}.sig`;
}

const GOOGLE_TOKEN_RESULT = {
    accessToken: 'at-google',
    refreshToken: 'rt-google',
    expiresAt: 9999999999000,
    idToken: makeFakeIdToken({ email: 'u@gmail.com', sub: 'google-sub-1' }),
    scope: 'https://mail.google.com/',
    tokenType: 'Bearer',
};
const MS_TOKEN_RESULT = {
    accessToken: 'at-ms',
    refreshToken: 'rt-ms',
    expiresAt: 9999999999000,
    idToken: 'header.payload.sig',
    idTokenClaims: { email: 'u@hotmail.com', sub: 'ms-sub-1', tid: '9188040d-6c67-4c5b-b112-36a304b66dad' },
    classifiedProvider: 'microsoft_personal' as const,
    scope: 'https://outlook.office.com/SMTP.Send',
    tokenType: 'Bearer',
};

// Import AFTER mocks are configured, then register handlers. The register
// call populates mockIpcMainHandle via the mocked ipcMain.handle; we snapshot
// the handler refs into handlerMap so subsequent vi.clearAllMocks() calls
// can't wipe them.
const { registerAuthIpcHandlers } = await import('./ipcHandlers.js');
registerAuthIpcHandlers();
for (const call of mockIpcMainHandle.mock.calls) {
    const [channel, handler] = call as [string, (_e: unknown, ...a: unknown[]) => Promise<unknown>];
    handlerMap.set(channel, handler);
}

describe('auth:start-oauth-flow', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Always reset the in-flight singleton between tests by calling cancel.
        mockGetAuthTokenManager.mockReturnValue({ persistInitialTokens: mockPersistInitialTokens });
        mockDbPrepare.mockImplementation(() => ({ get: mockDbGet.mockReturnValue(null), run: mockDbRun, all: vi.fn() }));
        const cancelH = getHandler('auth:cancel-flow')!;
        await cancelH(null, {});
    });

    it('google flow: returns { success: true, accountId }', async () => {
        mockStartGoogleFlow.mockResolvedValue(GOOGLE_TOKEN_RESULT);
        const h = getHandler('auth:start-oauth-flow')!;
        const r = await h(null, { provider: 'google', presetId: 'gmail' }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(typeof r.accountId).toBe('string');
        expect(mockStartGoogleFlow).toHaveBeenCalledOnce();
        expect(mockPersistInitialTokens).toHaveBeenCalledOnce();
    });

    it('microsoft flow: returns classifiedProvider in response', async () => {
        mockStartMicrosoftFlow.mockResolvedValue(MS_TOKEN_RESULT);
        const h = getHandler('auth:start-oauth-flow')!;
        const r = await h(null, { provider: 'microsoft', presetId: 'outlook-personal' }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(r.classifiedProvider).toBe('microsoft_personal');
    });

    it('returns { success: false, error } on flow error (no stack trace)', async () => {
        mockStartGoogleFlow.mockRejectedValue(new Error('user cancelled'));
        const h = getHandler('auth:start-oauth-flow')!;
        const r = await h(null, { provider: 'google', presetId: 'gmail' }) as Record<string, unknown>;
        expect(r.success).toBe(false);
        expect(typeof r.error).toBe('string');
        expect(r.error as string).not.toMatch(/\s+at\s+.*\.(ts|js):/);
    });

    it('D11.3: rejects second concurrent call with "another sign-in" message', async () => {
        mockStartGoogleFlow.mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const h = getHandler('auth:start-oauth-flow')!;
        const first = h(null, { provider: 'google', presetId: 'gmail' });
        const second = await h(null, { provider: 'google', presetId: 'gmail' }) as Record<string, unknown>;
        expect(second.success).toBe(false);
        expect(second.error).toMatch(/another sign-in/i);
        first.catch(() => { /* expected never-resolves */ });
    });

    it('D11.5b: no account row created when flow throws', async () => {
        mockStartGoogleFlow.mockRejectedValue(new Error('network error'));
        const h = getHandler('auth:start-oauth-flow')!;
        await h(null, { provider: 'google', presetId: 'gmail' });
        expect(mockDbRun).not.toHaveBeenCalled();
        expect(mockPersistInitialTokens).not.toHaveBeenCalled();
    });

    it('opens auth URL via shell.openExternal', async () => {
        mockStartGoogleFlow.mockImplementation(async ({ onAuthUrl }: { onAuthUrl: (u: string) => Promise<void> }) => {
            await onAuthUrl('https://accounts.google.com/o/oauth2/auth?x=1');
            return GOOGLE_TOKEN_RESULT;
        });
        const h = getHandler('auth:start-oauth-flow')!;
        await h(null, { provider: 'google', presetId: 'gmail' });
        expect(mockShellOpenExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?x=1');
    });
});

describe('auth:start-reauth-flow', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mockGetAuthTokenManager.mockReturnValue({ persistInitialTokens: mockPersistInitialTokens });
        const cancelH = getHandler('auth:cancel-flow')!;
        await cancelH(null, {});
    });

    it('gmail account: calls google flow and returns success', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue({
                id: 'ra1', email: 'u@gmail.com', provider: 'gmail',
                auth_type: 'password', auth_state: 'recommended_reauth',
                password_encrypted: 'enc',
            }),
            run: mockDbRun, all: vi.fn(),
        }));
        mockStartGoogleFlow.mockResolvedValue(GOOGLE_TOKEN_RESULT);
        const h = getHandler('auth:start-reauth-flow')!;
        const r = await h(null, { accountId: 'ra1' }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(mockStartGoogleFlow).toHaveBeenCalledOnce();
        expect(mockPersistInitialTokens).toHaveBeenCalledOnce();
    });

    it('cross-account guard: unknown accountId returns { success: false }', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue(null), run: mockDbRun, all: vi.fn(),
        }));
        const h = getHandler('auth:start-reauth-flow')!;
        const r = await h(null, { accountId: 'ghost' }) as Record<string, unknown>;
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/not found/i);
    });

    it('D8.2 rollback: password_encrypted not cleared when persistInitialTokens throws', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue({
                id: 'ra2', email: 'u@gmail.com', provider: 'gmail',
                auth_type: 'password', password_encrypted: 'enc',
            }),
            run: mockDbRun, all: vi.fn(),
        }));
        mockStartGoogleFlow.mockResolvedValue(GOOGLE_TOKEN_RESULT);
        mockPersistInitialTokens.mockImplementationOnce(() => { throw new Error('DB error'); });
        const h = getHandler('auth:start-reauth-flow')!;
        const r = await h(null, { accountId: 'ra2' }) as Record<string, unknown>;
        expect(r.success).toBe(false);
        // The UPDATE SET password_encrypted=NULL must NOT have run
        const nullUpdate = mockDbRun.mock.calls.find(
            (call: unknown[]) => String(call[0] ?? '').includes('NULL')
        );
        expect(nullUpdate).toBeUndefined();
    });

    it('outlook legacy account: calls microsoft flow', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue({
                id: 'ra3', email: 'u@hotmail.com', provider: 'outlook',
                auth_type: 'password', password_encrypted: 'enc',
            }),
            run: mockDbRun, all: vi.fn(),
        }));
        mockStartMicrosoftFlow.mockResolvedValue(MS_TOKEN_RESULT);
        const h = getHandler('auth:start-reauth-flow')!;
        const r = await h(null, { accountId: 'ra3' }) as Record<string, unknown>;
        expect(r.success).toBe(true);
        expect(mockStartMicrosoftFlow).toHaveBeenCalledOnce();
    });
});

describe('auth:cancel-flow', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const cancelH = getHandler('auth:cancel-flow')!;
        await cancelH(null, {});
    });

    it('returns { success: true } when no flow is active (idempotent)', async () => {
        const h = getHandler('auth:cancel-flow')!;
        expect((await h(null, {}) as Record<string, unknown>).success).toBe(true);
    });

    it('aborts the AbortController when a flow is in flight', async () => {
        let abortFired = false;
        mockStartGoogleFlow.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
            new Promise((_, rej) => {
                abortSignal.addEventListener('abort', () => { abortFired = true; rej(new Error('aborted')); });
            })
        );
        mockGetAuthTokenManager.mockReturnValue({ persistInitialTokens: mockPersistInitialTokens });
        mockDbPrepare.mockImplementation(() => ({ get: vi.fn().mockReturnValue(null), run: vi.fn(), all: vi.fn() }));

        const startH = getHandler('auth:start-oauth-flow')!;
        const cancelH = getHandler('auth:cancel-flow')!;
        const inFlight = startH(null, { provider: 'google', presetId: 'gmail' });
        // Yield one microtask so startH's handler runs past the activeOAuthFlow assignment
        await Promise.resolve();
        await cancelH(null, {});
        await inFlight.catch(() => { /* cancelled */ });
        expect(abortFired).toBe(true);
    });
});

describe('auth:flow-status', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const cancelH = getHandler('auth:cancel-flow')!;
        await cancelH(null, {});
    });

    it('returns { inFlight: false } when no flow is active', async () => {
        const h = getHandler('auth:flow-status')!;
        const r = await h(null, {}) as Record<string, unknown>;
        expect(r.inFlight).toBe(false);
    });
});

describe('auth:get-state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns { state } for a known account (3-state tristate)', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue({ auth_state: 'recommended_reauth' }),
            run: vi.fn(), all: vi.fn(),
        }));
        const h = getHandler('auth:get-state')!;
        const r = await h(null, { accountId: 'a1' }) as Record<string, unknown>;
        expect(r.state).toBe('recommended_reauth');
    });

    it('returns state=ok for healthy account', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue({ auth_state: 'ok' }),
            run: vi.fn(), all: vi.fn(),
        }));
        const h = getHandler('auth:get-state')!;
        const r = await h(null, { accountId: 'a2' }) as Record<string, unknown>;
        expect(r.state).toBe('ok');
    });

    it('returns state=reauth_required for dead tokens', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue({ auth_state: 'reauth_required' }),
            run: vi.fn(), all: vi.fn(),
        }));
        const h = getHandler('auth:get-state')!;
        const r = await h(null, { accountId: 'a3' }) as Record<string, unknown>;
        expect(r.state).toBe('reauth_required');
    });

    it('cross-account guard: unknown accountId returns { success: false }', async () => {
        mockDbPrepare.mockImplementation(() => ({
            get: mockDbGet.mockReturnValue(null), run: vi.fn(), all: vi.fn(),
        }));
        const h = getHandler('auth:get-state')!;
        const r = await h(null, { accountId: 'ghost' }) as Record<string, unknown>;
        expect(r.success).toBe(false);
    });
});
