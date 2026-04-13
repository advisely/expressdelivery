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

import {
    classifyMicrosoftAccount,
    refreshAccessToken,
    revokeRefreshToken,
    startInteractiveFlow,
} from './microsoft.js';

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

describe('microsoft.classifyMicrosoftAccount', () => {
    it('classifies the personal magic GUID tenant as microsoft_personal', () => {
        expect(classifyMicrosoftAccount('9188040d-6c67-4c5b-b112-36a304b66dad')).toBe(
            'microsoft_personal'
        );
    });

    it('classifies any other valid GUID as microsoft_business', () => {
        expect(classifyMicrosoftAccount('11111111-2222-3333-4444-555555555555')).toBe(
            'microsoft_business'
        );
    });

    it('throws on missing tid claim', () => {
        expect(() => classifyMicrosoftAccount('')).toThrow(/tid/);
    });

    it('throws on malformed tid (not a GUID)', () => {
        expect(() => classifyMicrosoftAccount('not-a-guid')).toThrow(/tid/);
    });

    it('handles uppercase GUID form of the personal tenant', () => {
        expect(classifyMicrosoftAccount('9188040D-6C67-4C5B-B112-36A304B66DAD')).toBe(
            'microsoft_personal'
        );
    });
});

describe('microsoft.startInteractiveFlow', () => {
    beforeEach(() => {
        mockAcquireTokenInteractive.mockReset();
    });

    it('passes the openBrowser callback through to MSAL and returns tokens', async () => {
        let openBrowserCalled = false;
        const urlPassed = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?...';
        mockAcquireTokenInteractive.mockImplementation(
            async (req: { openBrowser: (url: string) => Promise<void> }) => {
                await req.openBrowser(urlPassed);
                openBrowserCalled = true;
                return {
                    accessToken: 'AT',
                    refreshToken: 'RT',
                    expiresOn: new Date(Date.now() + 3600 * 1000),
                    scopes: ['Mail.Send'],
                    tokenType: 'Bearer',
                    idToken: 'fake.id.token',
                    idTokenClaims: {
                        tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
                        email: 'user@hotmail.com',
                        sub: 'msuser123',
                        preferred_username: 'user@hotmail.com',
                    },
                };
            }
        );

        const onAuthUrl = vi.fn().mockResolvedValue(undefined);
        const result = await startInteractiveFlow({
            clientConfig: {
                clientId: 'cid',
                tenantId: 'common',
                authority: 'https://login.microsoftonline.com/common',
            },
            onAuthUrl,
            abortSignal: new AbortController().signal,
        });

        expect(openBrowserCalled).toBe(true);
        expect(onAuthUrl).toHaveBeenCalledWith(urlPassed);
        expect(result.accessToken).toBe('AT');
        expect(result.refreshToken).toBe('RT');
        expect(result.idTokenClaims.tid).toBe('9188040d-6c67-4c5b-b112-36a304b66dad');
        expect(result.idTokenClaims.email).toBe('user@hotmail.com');
        expect(result.classifiedProvider).toBe('microsoft_personal');
    });

    it('classifies a business tid as microsoft_business', async () => {
        mockAcquireTokenInteractive.mockResolvedValueOnce({
            accessToken: 'AT',
            refreshToken: 'RT',
            expiresOn: new Date(Date.now() + 3600 * 1000),
            scopes: [],
            tokenType: 'Bearer',
            idToken: 'fake',
            idTokenClaims: {
                tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                email: 'user@company.com',
                sub: 'workuser456',
                preferred_username: 'user@company.com',
            },
        });

        const result = await startInteractiveFlow({
            clientConfig: {
                clientId: 'cid',
                tenantId: 'common',
                authority: 'https://login.microsoftonline.com/common',
            },
            onAuthUrl: vi.fn().mockResolvedValue(undefined),
            abortSignal: new AbortController().signal,
        });

        expect(result.classifiedProvider).toBe('microsoft_business');
    });

    it('rejects when MSAL does not return a refresh token (offline_access missing)', async () => {
        mockAcquireTokenInteractive.mockResolvedValueOnce({
            accessToken: 'AT',
            // no refreshToken
            expiresOn: new Date(Date.now() + 3600 * 1000),
            scopes: [],
            tokenType: 'Bearer',
            idToken: 'fake',
            idTokenClaims: {
                tid: '11111111-2222-3333-4444-555555555555',
                email: 'u@c.com',
                sub: 's',
                preferred_username: 'u@c.com',
            },
        });

        await expect(
            startInteractiveFlow({
                clientConfig: {
                    clientId: 'cid',
                    tenantId: 'common',
                    authority: 'https://login.microsoftonline.com/common',
                },
                onAuthUrl: vi.fn().mockResolvedValue(undefined),
                abortSignal: new AbortController().signal,
            })
        ).rejects.toThrow(/refresh token/i);
    });
});
