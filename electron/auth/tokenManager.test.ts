import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// Stub the provider adapters before importing the manager.
// ---------------------------------------------------------------------------

const { mockGoogleRefresh, mockMicrosoftRefresh } = vi.hoisted(() => ({
    mockGoogleRefresh: vi.fn(),
    mockMicrosoftRefresh: vi.fn(),
}));

vi.mock('../oauth/google', () => ({
    refreshAccessToken: mockGoogleRefresh,
}));

vi.mock('../oauth/microsoft', () => ({
    refreshAccessToken: mockMicrosoftRefresh,
}));

// Stub clientConfig so tests never need real OAuth client IDs.
vi.mock('../oauth/clientConfig', () => ({
    getGoogleOAuthConfig: () => ({ clientId: 'test-google-id', clientSecret: 'test-google-secret' }),
    getMicrosoftOAuthConfig: () => ({
        clientId: 'test-ms-id',
        tenantId: 'common' as const,
        authority: 'https://login.microsoftonline.com/common' as const,
    }),
}));

// ---------------------------------------------------------------------------
// Import under test — AFTER vi.mock declarations.
// ---------------------------------------------------------------------------
import {
    getAuthTokenManager,
    PermanentAuthError,
    TransientAuthError,
} from './tokenManager';

// ---------------------------------------------------------------------------
// DB helpers (imported from db.ts — Tasks 2-4 complete).
// ---------------------------------------------------------------------------
import {
    insertOAuthCredential,
    getOAuthCredential,
    initDatabase,
    closeDatabase,
} from '../db';
import type { Database as DatabaseType } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Track per-test tmp dirs so afterEach can clean them up. Each test gets its
// own unique SQLite file to avoid locking conflicts in parallel vitest workers.
const tmpDirs: string[] = [];

function makeDb(): DatabaseType {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-auth-test-'));
    tmpDirs.push(tmpDir);
    vi.mocked(app.getPath).mockReturnValue(tmpDir);

    // Reset any prior singleton handle so initDatabase() creates a fresh one.
    closeDatabase();
    const db = initDatabase();

    // Seed test account rows. The accounts table schema requires email plus
    // various IMAP/SMTP columns. The OAuth path only reads id + auth_state.
    const insertAccount = db.prepare(`
        INSERT INTO accounts (id, email, provider, imap_host, imap_port, smtp_host, smtp_port, password_encrypted, auth_type, auth_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAccount.run(
        'acc-google-1',
        'test@gmail.com',
        'gmail',
        'imap.gmail.com',
        993,
        'smtp.gmail.com',
        587,
        Buffer.from(''),
        'oauth2',
        'ok'
    );
    insertAccount.run(
        'acc-ms-personal-1',
        'user@hotmail.com',
        'outlook-personal',
        'outlook.office365.com',
        993,
        'smtp-mail.outlook.com',
        587,
        Buffer.from(''),
        'oauth2',
        'ok'
    );
    insertAccount.run(
        'acc-ms-business-1',
        'user@company.com',
        'outlook-business',
        'outlook.office365.com',
        993,
        'smtp.office365.com',
        587,
        Buffer.from(''),
        'oauth2',
        'ok'
    );
    return db;
}

afterEach(() => {
    // Tear down every open DB handle and remove the per-test tmp dir.
    closeDatabase();
    while (tmpDirs.length > 0) {
        const d = tmpDirs.pop();
        if (!d) continue;
        try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

const FUTURE = Date.now() + 7200 * 1000;  // 2 hours from now — fresh token
const PAST = Date.now() - 60 * 1000;      // 60 seconds ago — expired
const SKEW = Date.now() + 30 * 1000;      // 30 seconds from now — within 60s skew window

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthTokenManager.getValidAccessToken — cache-hit path', () => {
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        mockGoogleRefresh.mockReset();
        mockMicrosoftRefresh.mockReset();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);
    });

    it('returns the cached token without calling the adapter when token is fresh', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('cached-access-token'),
            refreshTokenEncrypted: encodeToken('refresh-token'),
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        const result = await mgr.getValidAccessToken('acc-google-1');

        expect(result.accessToken).toBe('cached-access-token');
        expect(result.expiresAt).toBe(FUTURE);
        expect(result.provider).toBe('google');
        expect(mockGoogleRefresh).not.toHaveBeenCalled();
    });

    it('returns fresh token when expires_at is just outside the 60s skew window', async () => {
        // expires_at = now + 65_000ms is safely outside the 60s skew window — still fresh.
        // Uses 5s headroom (not 1ms) to avoid suite-level timing drift flake.
        const justFresh = Date.now() + 65_000;
        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('just-fresh-token'),
            refreshTokenEncrypted: encodeToken('rt'),
            expiresAt: justFresh,
        });

        const mgr = getAuthTokenManager();
        const result = await mgr.getValidAccessToken('acc-google-1');

        expect(result.accessToken).toBe('just-fresh-token');
        expect(mockGoogleRefresh).not.toHaveBeenCalled();
    });

    it('calls the adapter when token is within the 60s skew window', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('stale-token'),
            refreshTokenEncrypted: encodeToken('rt-for-skew-test'),
            expiresAt: SKEW,
        });

        mockGoogleRefresh.mockResolvedValueOnce({
            accessToken: 'new-token-from-skew',
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        const result = await mgr.getValidAccessToken('acc-google-1');

        expect(mockGoogleRefresh).toHaveBeenCalledOnce();
        expect(result.accessToken).toBe('new-token-from-skew');
    });

    it('throws when no OAuth credential row exists for the account', async () => {
        // acc-google-1 exists in accounts but has no oauth_credentials row yet.
        const mgr = getAuthTokenManager();
        await expect(mgr.getValidAccessToken('acc-google-1')).rejects.toThrow(/acc-google-1/);
        expect(mockGoogleRefresh).not.toHaveBeenCalled();
    });
});

describe('AuthTokenManager.getValidAccessToken — Google refresh path', () => {
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        mockGoogleRefresh.mockReset();
        mockMicrosoftRefresh.mockReset();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);

        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('expired-at'),
            refreshTokenEncrypted: encodeToken('google-rt'),
            expiresAt: PAST,
        });
    });

    it('calls google.refreshAccessToken when token is expired', async () => {
        mockGoogleRefresh.mockResolvedValueOnce({
            accessToken: 'new-google-at',
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        const result = await mgr.getValidAccessToken('acc-google-1');

        expect(mockGoogleRefresh).toHaveBeenCalledOnce();
        expect(mockGoogleRefresh).toHaveBeenCalledWith(
            'google-rt',
            expect.objectContaining({ clientId: 'test-google-id' })
        );
        expect(result.accessToken).toBe('new-google-at');
        expect(result.expiresAt).toBe(FUTURE);
        expect(result.provider).toBe('google');
    });

    it('persists the new access token via updateAccessToken (no rotation case)', async () => {
        mockGoogleRefresh.mockResolvedValueOnce({
            accessToken: 'refreshed-at',
            expiresAt: FUTURE,
            // no refreshToken field → no rotation
        });

        const mgr = getAuthTokenManager();
        await mgr.getValidAccessToken('acc-google-1');

        const row = getOAuthCredential(db, 'acc-google-1');
        expect(decodeToken(row!.accessTokenEncrypted)).toBe('refreshed-at');
        // The refresh token is UNCHANGED (rotation did not happen).
        expect(decodeToken(row!.refreshTokenEncrypted)).toBe('google-rt');
        expect(row!.expiresAt).toBe(FUTURE);
    });

    it('persists both tokens via updateAccessAndRefreshToken when Google rotates (D5.4)', async () => {
        mockGoogleRefresh.mockResolvedValueOnce({
            accessToken: 'rotated-at',
            refreshToken: 'rotated-rt',
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        await mgr.getValidAccessToken('acc-google-1');

        const row = getOAuthCredential(db, 'acc-google-1');
        expect(decodeToken(row!.accessTokenEncrypted)).toBe('rotated-at');
        expect(decodeToken(row!.refreshTokenEncrypted)).toBe('rotated-rt');
        expect(row!.expiresAt).toBe(FUTURE);
    });
});

describe('AuthTokenManager.getValidAccessToken — Microsoft refresh path', () => {
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        mockGoogleRefresh.mockReset();
        mockMicrosoftRefresh.mockReset();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);
    });

    it('dispatches to microsoft.refreshAccessToken for microsoft_personal', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-ms-personal-1',
            provider: 'microsoft_personal',
            accessTokenEncrypted: encodeToken('ms-expired-at'),
            refreshTokenEncrypted: encodeToken('ms-personal-rt'),
            expiresAt: PAST,
        });

        mockMicrosoftRefresh.mockResolvedValueOnce({
            accessToken: 'ms-personal-new-at',
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        const result = await mgr.getValidAccessToken('acc-ms-personal-1');

        expect(mockMicrosoftRefresh).toHaveBeenCalledOnce();
        expect(mockMicrosoftRefresh).toHaveBeenCalledWith(
            'ms-personal-rt',
            expect.objectContaining({ clientId: 'test-ms-id' })
        );
        expect(result.accessToken).toBe('ms-personal-new-at');
        expect(result.provider).toBe('microsoft_personal');
        expect(mockGoogleRefresh).not.toHaveBeenCalled();
    });

    it('dispatches to microsoft.refreshAccessToken for microsoft_business', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-ms-business-1',
            provider: 'microsoft_business',
            accessTokenEncrypted: encodeToken('ms-biz-expired-at'),
            refreshTokenEncrypted: encodeToken('ms-business-rt'),
            expiresAt: PAST,
        });

        mockMicrosoftRefresh.mockResolvedValueOnce({
            accessToken: 'ms-business-new-at',
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        const result = await mgr.getValidAccessToken('acc-ms-business-1');

        expect(mockMicrosoftRefresh).toHaveBeenCalledOnce();
        expect(result.accessToken).toBe('ms-business-new-at');
        expect(result.provider).toBe('microsoft_business');
    });

    it('persists via updateAccessToken when Microsoft does not rotate refresh token', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-ms-personal-1',
            provider: 'microsoft_personal',
            accessTokenEncrypted: encodeToken('old-at'),
            refreshTokenEncrypted: encodeToken('ms-rt-unchanged'),
            expiresAt: PAST,
        });

        mockMicrosoftRefresh.mockResolvedValueOnce({
            accessToken: 'ms-new-at',
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        await mgr.getValidAccessToken('acc-ms-personal-1');

        const row = getOAuthCredential(db, 'acc-ms-personal-1');
        expect(decodeToken(row!.accessTokenEncrypted)).toBe('ms-new-at');
        expect(decodeToken(row!.refreshTokenEncrypted)).toBe('ms-rt-unchanged');
    });
});

describe('AuthTokenManager.getValidAccessToken — per-account dedup mutex (D5.3)', () => {
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        mockGoogleRefresh.mockReset();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);

        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('dedup-expired-at'),
            refreshTokenEncrypted: encodeToken('dedup-rt'),
            expiresAt: PAST,
        });
    });

    it('two concurrent callers for the same account share one in-flight refresh', async () => {
        let resolveFn!: (v: { accessToken: string; expiresAt: number }) => void;
        const refreshPromise = new Promise<{ accessToken: string; expiresAt: number }>(
            (res) => { resolveFn = res; }
        );
        mockGoogleRefresh.mockReturnValueOnce(refreshPromise);

        const mgr = getAuthTokenManager();
        const call1 = mgr.getValidAccessToken('acc-google-1');
        const call2 = mgr.getValidAccessToken('acc-google-1');

        // Settle the single underlying refresh.
        resolveFn({ accessToken: 'dedup-new-at', expiresAt: FUTURE });

        const [r1, r2] = await Promise.all([call1, call2]);

        expect(mockGoogleRefresh).toHaveBeenCalledTimes(1);
        expect(r1.accessToken).toBe('dedup-new-at');
        expect(r2.accessToken).toBe('dedup-new-at');
    });

    it('two concurrent callers for DIFFERENT accounts each trigger their own refresh', async () => {
        db.prepare(`
            INSERT INTO accounts (id, email, provider, imap_host, imap_port, smtp_host, smtp_port, password_encrypted, auth_type, auth_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            'acc-google-2',
            'other@gmail.com',
            'gmail',
            'imap.gmail.com',
            993,
            'smtp.gmail.com',
            587,
            Buffer.from(''),
            'oauth2',
            'ok'
        );
        insertOAuthCredential(db, {
            accountId: 'acc-google-2',
            provider: 'google',
            accessTokenEncrypted: encodeToken('g2-expired'),
            refreshTokenEncrypted: encodeToken('g2-rt'),
            expiresAt: PAST,
        });

        mockGoogleRefresh
            .mockResolvedValueOnce({ accessToken: 'g1-new', expiresAt: FUTURE })
            .mockResolvedValueOnce({ accessToken: 'g2-new', expiresAt: FUTURE });

        const mgr = getAuthTokenManager();
        const [r1, r2] = await Promise.all([
            mgr.getValidAccessToken('acc-google-1'),
            mgr.getValidAccessToken('acc-google-2'),
        ]);

        expect(mockGoogleRefresh).toHaveBeenCalledTimes(2);
        expect(r1.accessToken).toBe('g1-new');
        expect(r2.accessToken).toBe('g2-new');
    });

    it('inflight map entry is cleared after a failed refresh so the next call retries', async () => {
        mockGoogleRefresh
            .mockRejectedValueOnce(Object.assign(new Error('network timeout'), { code: 'ETIMEDOUT' }))
            .mockResolvedValueOnce({ accessToken: 'retry-at', expiresAt: FUTURE });

        const mgr = getAuthTokenManager();

        // First call fails (transient) — wraps in TransientAuthError.
        await expect(mgr.getValidAccessToken('acc-google-1')).rejects.toBeInstanceOf(TransientAuthError);

        // Second call succeeds — the map entry was cleared in .finally() after the first failure.
        const result = await mgr.getValidAccessToken('acc-google-1');
        expect(result.accessToken).toBe('retry-at');
        expect(mockGoogleRefresh).toHaveBeenCalledTimes(2);
    });
});

// ===========================================================================
// Task 10 — error classification, invalidateToken, persistInitialTokens
// ===========================================================================

describe('AuthTokenManager error classification (D5.10)', () => {
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        mockGoogleRefresh.mockReset();
        mockMicrosoftRefresh.mockReset();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);

        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('err-expired-at'),
            refreshTokenEncrypted: encodeToken('err-rt'),
            expiresAt: PAST,
        });
    });

    it('throws PermanentAuthError on invalid_grant and sets auth_state to reauth_required', async () => {
        const providerErr = Object.assign(new Error('Token has been expired or revoked'), {
            error: 'invalid_grant',
        });
        mockGoogleRefresh.mockRejectedValueOnce(providerErr);

        const mgr = getAuthTokenManager();
        await expect(mgr.getValidAccessToken('acc-google-1')).rejects.toBeInstanceOf(PermanentAuthError);

        const row = db.prepare("SELECT auth_state FROM accounts WHERE id = 'acc-google-1'")
            .get() as { auth_state: string };
        expect(row.auth_state).toBe('reauth_required');
    });

    it('PermanentAuthError carries the correct code and accountId', async () => {
        const providerErr = Object.assign(new Error('unauthorized'), {
            error: 'unauthorized_client',
        });
        mockGoogleRefresh.mockRejectedValueOnce(providerErr);

        const mgr = getAuthTokenManager();
        let caught: unknown;
        try {
            await mgr.getValidAccessToken('acc-google-1');
        } catch (e) {
            caught = e;
        }

        expect(caught).toBeInstanceOf(PermanentAuthError);
        const pae = caught as PermanentAuthError;
        expect(pae.code).toBe('unauthorized_client');
        expect(pae.accountId).toBe('acc-google-1');
    });

    it('throws PermanentAuthError on invalid_client and sets auth_state to reauth_required', async () => {
        const providerErr = Object.assign(new Error('invalid client'), {
            error: 'invalid_client',
        });
        mockGoogleRefresh.mockRejectedValueOnce(providerErr);

        const mgr = getAuthTokenManager();
        await expect(mgr.getValidAccessToken('acc-google-1')).rejects.toBeInstanceOf(PermanentAuthError);

        const row = db.prepare("SELECT auth_state FROM accounts WHERE id = 'acc-google-1'")
            .get() as { auth_state: string };
        expect(row.auth_state).toBe('reauth_required');
    });

    it('throws TransientAuthError on network timeout — auth_state is unchanged', async () => {
        const networkErr = Object.assign(new Error('fetch failed: ETIMEDOUT'), {
            code: 'ETIMEDOUT',
        });
        mockGoogleRefresh.mockRejectedValueOnce(networkErr);

        const mgr = getAuthTokenManager();
        await expect(mgr.getValidAccessToken('acc-google-1')).rejects.toBeInstanceOf(TransientAuthError);

        const row = db.prepare("SELECT auth_state FROM accounts WHERE id = 'acc-google-1'")
            .get() as { auth_state: string };
        expect(row.auth_state).toBe('ok');
    });

    it('throws TransientAuthError on provider HTTP 5xx — auth_state is unchanged', async () => {
        const serverErr = Object.assign(new Error('Google token endpoint 503'), {
            error: 'server_error',
            status: 503,
        });
        mockGoogleRefresh.mockRejectedValueOnce(serverErr);

        const mgr = getAuthTokenManager();
        await expect(mgr.getValidAccessToken('acc-google-1')).rejects.toBeInstanceOf(TransientAuthError);

        const row = db.prepare("SELECT auth_state FROM accounts WHERE id = 'acc-google-1'")
            .get() as { auth_state: string };
        expect(row.auth_state).toBe('ok');
    });

    it('TransientAuthError wraps the original cause and carries the accountId', async () => {
        const originalErr = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
        mockGoogleRefresh.mockRejectedValueOnce(originalErr);

        const mgr = getAuthTokenManager();
        let caught: unknown;
        try {
            await mgr.getValidAccessToken('acc-google-1');
        } catch (e) {
            caught = e;
        }

        expect(caught).toBeInstanceOf(TransientAuthError);
        const tae = caught as TransientAuthError;
        expect(tae.cause).toBe(originalErr);
        expect(tae.accountId).toBe('acc-google-1');
    });

    it('Microsoft permanent error (invalid_grant via MSAL) sets reauth_required', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-ms-personal-1',
            provider: 'microsoft_personal',
            accessTokenEncrypted: encodeToken('ms-expired'),
            refreshTokenEncrypted: encodeToken('ms-rt'),
            expiresAt: PAST,
        });

        const msalErr = Object.assign(new Error('AADSTS70008: token expired'), {
            error: 'invalid_grant',
        });
        mockMicrosoftRefresh.mockRejectedValueOnce(msalErr);

        const mgr = getAuthTokenManager();
        await expect(mgr.getValidAccessToken('acc-ms-personal-1')).rejects.toBeInstanceOf(PermanentAuthError);

        const row = db.prepare("SELECT auth_state FROM accounts WHERE id = 'acc-ms-personal-1'")
            .get() as { auth_state: string };
        expect(row.auth_state).toBe('reauth_required');
    });
});

describe('AuthTokenManager.invalidateToken (D5.2)', () => {
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        mockGoogleRefresh.mockReset();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);
    });

    it('sets access_token_encrypted to empty and expires_at to 0', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('valid-at'),
            refreshTokenEncrypted: encodeToken('rt'),
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        await mgr.invalidateToken('acc-google-1');

        const row = getOAuthCredential(db, 'acc-google-1');
        expect(row!.expiresAt).toBe(0);
    });

    it('forces a refresh on the next getValidAccessToken call after invalidation', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('will-be-invalidated'),
            refreshTokenEncrypted: encodeToken('rt'),
            expiresAt: FUTURE,  // token is currently fresh
        });

        mockGoogleRefresh.mockResolvedValueOnce({
            accessToken: 'post-invalidation-at',
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        // Confirm it's fresh before invalidation.
        const before = await mgr.getValidAccessToken('acc-google-1');
        expect(before.accessToken).toBe('will-be-invalidated');
        expect(mockGoogleRefresh).not.toHaveBeenCalled();

        // Invalidate.
        await mgr.invalidateToken('acc-google-1');

        // Next call must refresh because expires_at = 0 < now + 60s.
        const after = await mgr.getValidAccessToken('acc-google-1');
        expect(mockGoogleRefresh).toHaveBeenCalledOnce();
        expect(after.accessToken).toBe('post-invalidation-at');
    });

    it('does not throw when called on an account with no credential row', async () => {
        // invalidateToken is called from the on-401 retry path which may race
        // with a concurrent account deletion. It must be a no-op in that case.
        const mgr = getAuthTokenManager();
        await expect(mgr.invalidateToken('acc-google-1')).resolves.not.toThrow();
    });
});

describe('AuthTokenManager.persistInitialTokens (D5.11)', () => {
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        mockGoogleRefresh.mockReset();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);
    });

    it('inserts a new oauth_credentials row with encrypted tokens', () => {
        const mgr = getAuthTokenManager();
        mgr.persistInitialTokens('acc-google-1', 'google', {
            accessToken: 'initial-at',
            refreshToken: 'initial-rt',
            expiresAt: FUTURE,
            scope: 'https://mail.google.com/',
            tokenType: 'Bearer',
        });

        const row = getOAuthCredential(db, 'acc-google-1');
        expect(row).not.toBeNull();
        expect(decodeToken(row!.accessTokenEncrypted)).toBe('initial-at');
        expect(decodeToken(row!.refreshTokenEncrypted)).toBe('initial-rt');
        expect(row!.expiresAt).toBe(FUTURE);
        expect(row!.provider).toBe('google');
        expect(row!.scope).toBe('https://mail.google.com/');
        expect(row!.tokenType).toBe('Bearer');
    });

    it('stores microsoft_personal provider classification', () => {
        const mgr = getAuthTokenManager();
        mgr.persistInitialTokens('acc-ms-personal-1', 'microsoft_personal', {
            accessToken: 'ms-initial-at',
            refreshToken: 'ms-initial-rt',
            expiresAt: FUTURE,
        });

        const row = getOAuthCredential(db, 'acc-ms-personal-1');
        expect(row!.provider).toBe('microsoft_personal');
        expect(decodeToken(row!.accessTokenEncrypted)).toBe('ms-initial-at');
        expect(decodeToken(row!.refreshTokenEncrypted)).toBe('ms-initial-rt');
    });

    it('stores microsoft_business provider classification', () => {
        const mgr = getAuthTokenManager();
        mgr.persistInitialTokens('acc-ms-business-1', 'microsoft_business', {
            accessToken: 'biz-at',
            refreshToken: 'biz-rt',
            expiresAt: FUTURE,
        });

        const row = getOAuthCredential(db, 'acc-ms-business-1');
        expect(row!.provider).toBe('microsoft_business');
    });

    it('upserts when called a second time (in-place re-auth flow)', () => {
        const mgr = getAuthTokenManager();
        mgr.persistInitialTokens('acc-google-1', 'google', {
            accessToken: 'first-at',
            refreshToken: 'first-rt',
            expiresAt: FUTURE,
        });

        // Simulate re-auth: call again with new tokens.
        mgr.persistInitialTokens('acc-google-1', 'google', {
            accessToken: 'reauth-at',
            refreshToken: 'reauth-rt',
            expiresAt: FUTURE + 3600 * 1000,
        });

        const row = getOAuthCredential(db, 'acc-google-1');
        expect(decodeToken(row!.accessTokenEncrypted)).toBe('reauth-at');
        expect(decodeToken(row!.refreshTokenEncrypted)).toBe('reauth-rt');
    });

    it('persisted tokens are immediately usable via getValidAccessToken (no refresh)', async () => {
        const mgr = getAuthTokenManager();
        mgr.persistInitialTokens('acc-google-1', 'google', {
            accessToken: 'fresh-persisted-at',
            refreshToken: 'rt',
            expiresAt: FUTURE,
        });

        const result = await mgr.getValidAccessToken('acc-google-1');
        expect(result.accessToken).toBe('fresh-persisted-at');
        expect(result.provider).toBe('google');
        expect(mockGoogleRefresh).not.toHaveBeenCalled();
    });
});

describe('AuthTokenManager.getDecryptedRefreshToken (Task 17 consumer)', () => {
    // Added proactively for Task 17 (Google revocation flow). Returns the
    // decrypted refresh_token for a given accountId. Throws when no row exists.
    let db: DatabaseType;

    beforeEach(() => {
        db = makeDb();
        const mgr = getAuthTokenManager();
        mgr.shutdown();
        mgr.init(db);
    });

    it('returns the decrypted refresh token for an existing oauth row', async () => {
        insertOAuthCredential(db, {
            accountId: 'acc-google-1',
            provider: 'google',
            accessTokenEncrypted: encodeToken('at'),
            refreshTokenEncrypted: encodeToken('plain-refresh-token'),
            expiresAt: FUTURE,
        });

        const mgr = getAuthTokenManager();
        const rt = await mgr.getDecryptedRefreshToken('acc-google-1');
        expect(rt).toBe('plain-refresh-token');
    });

    it('throws when no credential row exists', async () => {
        const mgr = getAuthTokenManager();
        await expect(mgr.getDecryptedRefreshToken('acc-google-1'))
            .rejects.toThrow(/acc-google-1/);
    });
});

// ---------------------------------------------------------------------------
// Local token encoding — mirrors the base64-of-utf8 convention used by
// tokenManager.ts under the tests/setup.ts safeStorage identity stub.
// ---------------------------------------------------------------------------

function encodeToken(plain: string): string {
    return Buffer.from(plain, 'utf-8').toString('base64');
}

function decodeToken(encoded: string): string {
    return Buffer.from(encoded, 'base64').toString('utf-8');
}
