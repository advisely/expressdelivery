import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { refreshAccessToken, revokeRefreshToken } from './google.js';

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
