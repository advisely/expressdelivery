// Tests for maybeRevokeOAuthCredentials helper (Task 17 / D11.1).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';

const {
    mockGetOAuthCredential,
    mockGetDecryptedRefreshToken,
    mockGoogleRevoke,
    mockMicrosoftRevoke,
    mockLogDebug,
} = vi.hoisted(() => ({
    mockGetOAuthCredential: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockGetDecryptedRefreshToken: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockGoogleRevoke: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockMicrosoftRevoke: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    mockLogDebug: vi.fn(),
}));

vi.mock('../db.js', () => ({ getOAuthCredential: mockGetOAuthCredential }));
vi.mock('./tokenManager.js', () => ({
    getAuthTokenManager: () => ({ getDecryptedRefreshToken: mockGetDecryptedRefreshToken }),
}));
vi.mock('../oauth/google.js', () => ({ revokeRefreshToken: mockGoogleRevoke }));
vi.mock('../oauth/microsoft.js', () => ({ revokeRefreshToken: mockMicrosoftRevoke }));
vi.mock('../logger.js', () => ({ logDebug: mockLogDebug }));

const { maybeRevokeOAuthCredentials } = await import('./accountRevoke.js');

const fakeDb = {} as Database;

function makeGoogleCred() {
    return {
        accountId: 'acc-1', provider: 'google' as const,
        accessTokenEncrypted: 'a', refreshTokenEncrypted: 'r', expiresAt: 0,
        scope: null, tokenType: null,
        providerAccountEmail: null, providerAccountId: null,
        createdAt: 0, updatedAt: 0,
    };
}

describe('maybeRevokeOAuthCredentials', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDecryptedRefreshToken.mockResolvedValue('MOCK-REFRESH-TOKEN');
        mockGoogleRevoke.mockResolvedValue(undefined);
        mockMicrosoftRevoke.mockResolvedValue(undefined);
    });

    it('no credential row → no-op (attempted=false)', async () => {
        mockGetOAuthCredential.mockReturnValue(null);
        const r = await maybeRevokeOAuthCredentials(fakeDb, 'acc-1');
        expect(r).toEqual({ attempted: false, revoked: false });
        expect(mockGoogleRevoke).not.toHaveBeenCalled();
        expect(mockMicrosoftRevoke).not.toHaveBeenCalled();
    });

    it('google credential → calls googleRevoke with plaintext refresh token', async () => {
        mockGetOAuthCredential.mockReturnValue(makeGoogleCred());
        const r = await maybeRevokeOAuthCredentials(fakeDb, 'acc-1');
        expect(r.attempted).toBe(true);
        expect(r.revoked).toBe(true);
        expect(r.provider).toBe('google');
        expect(mockGoogleRevoke).toHaveBeenCalledWith('MOCK-REFRESH-TOKEN');
        expect(mockMicrosoftRevoke).not.toHaveBeenCalled();
    });

    it('google revoke throws → returns attempted=true, revoked=false (swallowed)', async () => {
        mockGetOAuthCredential.mockReturnValue(makeGoogleCred());
        mockGoogleRevoke.mockRejectedValue(new Error('network error'));
        const r = await maybeRevokeOAuthCredentials(fakeDb, 'acc-1');
        expect(r.attempted).toBe(true);
        expect(r.revoked).toBe(false);
        // Caller can still delete — helper never throws
    });

    it('microsoft_personal credential → calls microsoftRevoke (no-op adapter)', async () => {
        mockGetOAuthCredential.mockReturnValue({
            ...makeGoogleCred(),
            provider: 'microsoft_personal' as const,
        });
        const r = await maybeRevokeOAuthCredentials(fakeDb, 'acc-1');
        expect(r.attempted).toBe(true);
        expect(r.revoked).toBe(true);
        expect(r.provider).toBe('microsoft_personal');
        expect(mockMicrosoftRevoke).toHaveBeenCalledOnce();
        expect(mockGoogleRevoke).not.toHaveBeenCalled();
    });

    it('microsoft_business credential → calls microsoftRevoke', async () => {
        mockGetOAuthCredential.mockReturnValue({
            ...makeGoogleCred(),
            provider: 'microsoft_business' as const,
        });
        const r = await maybeRevokeOAuthCredentials(fakeDb, 'acc-1');
        expect(r.attempted).toBe(true);
        expect(r.revoked).toBe(true);
        expect(mockMicrosoftRevoke).toHaveBeenCalledOnce();
    });

    it('getDecryptedRefreshToken throws → returns revoked=false (swallowed)', async () => {
        mockGetOAuthCredential.mockReturnValue(makeGoogleCred());
        mockGetDecryptedRefreshToken.mockRejectedValue(new Error('no credential'));
        const r = await maybeRevokeOAuthCredentials(fakeDb, 'acc-1');
        expect(r.attempted).toBe(true);
        expect(r.revoked).toBe(false);
        expect(mockGoogleRevoke).not.toHaveBeenCalled();
    });

    it('getOAuthCredential throws → returns attempted=false (swallowed)', async () => {
        mockGetOAuthCredential.mockImplementation(() => { throw new Error('DB locked'); });
        const r = await maybeRevokeOAuthCredentials(fakeDb, 'acc-1');
        expect(r).toEqual({ attempted: false, revoked: false });
    });
});
