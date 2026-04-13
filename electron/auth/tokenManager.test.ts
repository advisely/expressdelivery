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
import { getAuthTokenManager } from './tokenManager';

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
        // expires_at = now + 60_001ms is just outside the 60s skew window — still fresh.
        const justFresh = Date.now() + 60_001;
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

        // First call fails (transient) — map entry is cleared in .finally().
        await expect(mgr.getValidAccessToken('acc-google-1')).rejects.toThrow('network timeout');

        // Second call succeeds — the map entry was cleared so a fresh refresh is attempted.
        const result = await mgr.getValidAccessToken('acc-google-1');
        expect(result.accessToken).toBe('retry-at');
        expect(mockGoogleRefresh).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// Local token encoding — mirrors the base64-of-utf8 convention used by
// tokenManager.ts under the src/setupTests.ts safeStorage identity stub.
// ---------------------------------------------------------------------------

function encodeToken(plain: string): string {
    return Buffer.from(plain, 'utf-8').toString('base64');
}

function decodeToken(encoded: string): string {
    return Buffer.from(encoded, 'base64').toString('utf-8');
}
