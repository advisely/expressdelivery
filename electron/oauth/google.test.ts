import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import http from 'node:http';
import { refreshAccessToken, revokeRefreshToken, startInteractiveFlow } from './google.js';

describe('google.refreshAccessToken', () => {
    beforeEach(() => {
        nock.disableNetConnect();
    });

    afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
    });

    it('exchanges a refresh token for a new access token', async () => {
        nock('https://oauth2.googleapis.com')
            .post('/token')
            .reply(200, {
                access_token: 'new_access_token_value',
                expires_in: 3599,
                scope: 'https://mail.google.com/',
                token_type: 'Bearer',
            });

        const result = await refreshAccessToken('refresh_token_value', {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
        });

        expect(result.accessToken).toBe('new_access_token_value');
        expect(result.expiresAt).toBeGreaterThan(Date.now());
        expect(result.expiresAt).toBeLessThan(Date.now() + 3600 * 1000 + 1000);
        expect(result.scope).toBe('https://mail.google.com/');
        expect(result.tokenType).toBe('Bearer');
        expect(result.refreshToken).toBeUndefined(); // Google did not rotate
    });

    it('passes the new refresh token through when Google rotates (D5.4)', async () => {
        nock('https://oauth2.googleapis.com')
            .post('/token')
            .reply(200, {
                access_token: 'new_at',
                refresh_token: 'rotated_rt',
                expires_in: 3600,
                scope: 'https://mail.google.com/',
                token_type: 'Bearer',
            });

        const result = await refreshAccessToken('old_rt', {
            clientId: 'cid',
            clientSecret: 'csec',
        });

        expect(result.refreshToken).toBe('rotated_rt');
    });

    it('throws with invalid_grant code on permanent failure', async () => {
        nock('https://oauth2.googleapis.com')
            .post('/token')
            .reply(400, {
                error: 'invalid_grant',
                error_description: 'Token has been expired or revoked.',
            });

        await expect(
            refreshAccessToken('bad_rt', { clientId: 'cid', clientSecret: 'csec' })
        ).rejects.toMatchObject({ error: 'invalid_grant' });
    });

    it('throws on transient HTTP 500 with a non-permanent error shape', async () => {
        nock('https://oauth2.googleapis.com')
            .post('/token')
            .reply(500, { error: 'server_error' });

        await expect(
            refreshAccessToken('rt', { clientId: 'cid', clientSecret: 'csec' })
        ).rejects.toBeDefined();
    });

    it('sends the correct POST body with refresh_token grant type', async () => {
        // nock parses application/x-www-form-urlencoded bodies into an object
        // before handing them to the matcher callback. We inspect that object
        // directly rather than re-stringifying it to the wire format.
        let captured: Record<string, string> | null = null;
        nock('https://oauth2.googleapis.com')
            .post('/token', body => {
                captured = body as Record<string, string>;
                return true;
            })
            .reply(200, { access_token: 'at', expires_in: 3600, scope: '', token_type: 'Bearer' });

        await refreshAccessToken('rt_value', { clientId: 'cid', clientSecret: 'csec' });

        expect(captured).not.toBeNull();
        expect(captured!.grant_type).toBe('refresh_token');
        expect(captured!.refresh_token).toBe('rt_value');
        expect(captured!.client_id).toBe('cid');
        expect(captured!.client_secret).toBe('csec');
    });
});

describe('google.revokeRefreshToken', () => {
    beforeEach(() => nock.disableNetConnect());
    afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
    });

    it('POSTs to the revoke endpoint with the refresh token', async () => {
        nock('https://oauth2.googleapis.com')
            .post('/revoke', body => {
                const s = typeof body === 'string' ? body : JSON.stringify(body);
                return s.includes('token=rt_to_revoke');
            })
            .reply(200);

        await expect(revokeRefreshToken('rt_to_revoke')).resolves.toBeUndefined();
    });

    it('does not throw when revoke endpoint returns 400 (token already invalid)', async () => {
        nock('https://oauth2.googleapis.com')
            .post('/revoke')
            .reply(400, { error: 'invalid_token' });

        // Best-effort revocation: errors are swallowed at the adapter level.
        // The caller (AuthTokenManager / accounts:delete handler) will catch
        // and log via logDebug per D11.1 + D11.10.
        await expect(revokeRefreshToken('rt')).resolves.toBeUndefined();
    });
});

describe('google.startInteractiveFlow', () => {
    beforeEach(() => nock.disableNetConnect());
    afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
    });

    function fakeOnAuthUrl(simulateCallback: (port: number, code: string, state: string) => void) {
        return async (url: string) => {
            const parsed = new URL(url);
            const redirectUri = parsed.searchParams.get('redirect_uri') || '';
            const portMatch = redirectUri.match(/:(\d+)/);
            const port = portMatch ? parseInt(portMatch[1], 10) : 0;
            const state = parsed.searchParams.get('state') || '';
            // Simulate the user completing OAuth in the browser by hitting
            // the loopback server with the expected callback.
            setTimeout(() => simulateCallback(port, 'fake_auth_code', state), 50);
        };
    }

    it('completes the flow when the loopback server receives a valid callback', async () => {
        // Allow loopback traffic for the test's own simulated callback
        nock.enableNetConnect('127.0.0.1');
        nock('https://oauth2.googleapis.com')
            .post('/token')
            .reply(200, {
                access_token: 'AT_value',
                refresh_token: 'RT_value',
                expires_in: 3599,
                scope: 'https://mail.google.com/',
                token_type: 'Bearer',
                id_token: 'fake.id.token',
            });

        const abortController = new AbortController();
        const onAuthUrl = fakeOnAuthUrl((port, code, state) => {
            const req = http.request(
                { hostname: '127.0.0.1', port, path: `/callback?code=${code}&state=${state}` },
                () => {}
            );
            req.end();
        });

        const result = await startInteractiveFlow({
            clientConfig: { clientId: 'cid', clientSecret: 'csec' },
            onAuthUrl,
            abortSignal: abortController.signal,
        });

        expect(result.accessToken).toBe('AT_value');
        expect(result.refreshToken).toBe('RT_value');
        expect(result.idToken).toBe('fake.id.token');
        expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('rejects when the callback state does not match', async () => {
        nock.enableNetConnect('127.0.0.1');
        const abortController = new AbortController();
        const onAuthUrl = fakeOnAuthUrl(port => {
            const req = http.request(
                { hostname: '127.0.0.1', port, path: `/callback?code=fake&state=WRONG_STATE` },
                () => {}
            );
            req.end();
        });

        await expect(
            startInteractiveFlow({
                clientConfig: { clientId: 'cid', clientSecret: 'csec' },
                onAuthUrl,
                abortSignal: abortController.signal,
            })
        ).rejects.toThrow(/state/i);
    });

    it('rejects with a cancelled error when the abort signal fires', async () => {
        const abortController = new AbortController();
        const onAuthUrl = async (): Promise<void> => {
            // Don't simulate a callback; abort instead
            setTimeout(() => abortController.abort(), 50);
        };

        await expect(
            startInteractiveFlow({
                clientConfig: { clientId: 'cid', clientSecret: 'csec' },
                onAuthUrl,
                abortSignal: abortController.signal,
            })
        ).rejects.toMatchObject({ code: 'cancelled' });
    });

    it('shuts down the loopback server cleanly after a successful callback', async () => {
        nock.enableNetConnect('127.0.0.1');
        nock('https://oauth2.googleapis.com')
            .post('/token')
            .reply(200, {
                access_token: 'AT',
                refresh_token: 'RT',
                expires_in: 3600,
                scope: '',
                token_type: 'Bearer',
                id_token: 't',
            });

        let portUsed = 0;
        const abortController = new AbortController();
        const onAuthUrl = fakeOnAuthUrl((port, code, state) => {
            portUsed = port;
            const req = http.request(
                { hostname: '127.0.0.1', port, path: `/callback?code=${code}&state=${state}` },
                () => {}
            );
            req.end();
        });

        await startInteractiveFlow({
            clientConfig: { clientId: 'cid', clientSecret: 'csec' },
            onAuthUrl,
            abortSignal: abortController.signal,
        });

        // Server should be shut down — a new request to the same port should fail
        await expect(
            new Promise<void>((resolve, reject) => {
                const req = http.request(
                    { hostname: '127.0.0.1', port: portUsed, path: '/', timeout: 500 },
                    () => {
                        reject(new Error('server still listening'));
                    }
                );
                req.on('error', () => resolve());
                req.on('timeout', () => {
                    req.destroy();
                    resolve();
                });
                req.end();
            })
        ).resolves.toBeUndefined();
    });
});
