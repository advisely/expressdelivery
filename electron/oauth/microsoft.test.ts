import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockAcquireTokenByRefreshToken, mockAcquireTokenInteractive } = vi.hoisted(() => ({
    mockAcquireTokenByRefreshToken: vi.fn(),
    mockAcquireTokenInteractive: vi.fn(),
}));

vi.mock('@azure/msal-node', () => {
    class PublicClientApplication {
        acquireTokenByRefreshToken = mockAcquireTokenByRefreshToken;
        acquireTokenInteractive = mockAcquireTokenInteractive;
    }
    return { PublicClientApplication };
});

import { refreshAccessToken, revokeRefreshToken } from './microsoft.js';

describe('microsoft.refreshAccessToken', () => {
    beforeEach(() => {
        mockAcquireTokenByRefreshToken.mockReset();
    });

    it('returns the new access token from MSAL', async () => {
        mockAcquireTokenByRefreshToken.mockResolvedValueOnce({
            accessToken: 'new_at',
            expiresOn: new Date(Date.now() + 3600 * 1000),
            scopes: ['Mail.Send'],
            tokenType: 'Bearer',
        });

        const result = await refreshAccessToken('rt_value', {
            clientId: 'cid',
            tenantId: 'common',
            authority: 'https://login.microsoftonline.com/common',
        });

        expect(result.accessToken).toBe('new_at');
        expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('passes the new refresh token through if MSAL returned one (D5.4)', async () => {
        mockAcquireTokenByRefreshToken.mockResolvedValueOnce({
            accessToken: 'at',
            refreshToken: 'rotated_rt',
            expiresOn: new Date(Date.now() + 3600 * 1000),
            scopes: [],
            tokenType: 'Bearer',
        });

        const result = await refreshAccessToken('old_rt', {
            clientId: 'cid',
            tenantId: 'common',
            authority: 'https://login.microsoftonline.com/common',
        });

        expect(result.refreshToken).toBe('rotated_rt');
    });

    it('throws with invalid_grant on permanent failure', async () => {
        const msalErr = Object.assign(new Error('AADSTS70008: refresh token expired'), {
            errorCode: 'invalid_grant',
            errorMessage: 'AADSTS70008',
        });
        mockAcquireTokenByRefreshToken.mockRejectedValueOnce(msalErr);

        await expect(
            refreshAccessToken('bad_rt', {
                clientId: 'cid',
                tenantId: 'common',
                authority: 'https://login.microsoftonline.com/common',
            })
        ).rejects.toMatchObject({ error: 'invalid_grant' });
    });
});

describe('microsoft.revokeRefreshToken', () => {
    it('is a no-op that logs (Microsoft has no per-token revoke endpoint)', async () => {
        // Per D11.1, Microsoft does not provide a clean per-token revoke
        // endpoint. We just delete the local credential row and let the
        // refresh token age out naturally on Microsoft's side.
        await expect(revokeRefreshToken('rt_value')).resolves.toBeUndefined();
    });
});
