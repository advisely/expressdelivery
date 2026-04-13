import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('clientConfig lazy accessors', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllEnvs();
    });

    it('getGoogleOAuthConfig throws clear error when env vars missing', async () => {
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_ID', '');
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_SECRET', '');
        const { getGoogleOAuthConfig } = await import('./clientConfig');
        expect(() => getGoogleOAuthConfig()).toThrow(/VITE_OAUTH_GOOGLE_CLIENT_ID/);
    });

    it('getGoogleOAuthConfig returns config when env vars set', async () => {
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_ID', 'test-google-id');
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_SECRET', 'test-google-secret');
        const { getGoogleOAuthConfig } = await import('./clientConfig');
        const config = getGoogleOAuthConfig();
        expect(config.clientId).toBe('test-google-id');
        expect(config.clientSecret).toBe('test-google-secret');
    });

    it('getGoogleOAuthConfig caches the result on second call', async () => {
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_ID', 'test-google-id');
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_SECRET', 'test-google-secret');
        const { getGoogleOAuthConfig } = await import('./clientConfig');
        const first = getGoogleOAuthConfig();
        const second = getGoogleOAuthConfig();
        expect(first).toBe(second); // same object reference, not just equal
    });

    it('getMicrosoftOAuthConfig throws clear error when env var missing', async () => {
        vi.stubEnv('VITE_OAUTH_MICROSOFT_CLIENT_ID', '');
        const { getMicrosoftOAuthConfig } = await import('./clientConfig');
        expect(() => getMicrosoftOAuthConfig()).toThrow(/VITE_OAUTH_MICROSOFT_CLIENT_ID/);
    });

    it('getMicrosoftOAuthConfig returns config with common authority', async () => {
        vi.stubEnv('VITE_OAUTH_MICROSOFT_CLIENT_ID', 'test-microsoft-id');
        const { getMicrosoftOAuthConfig } = await import('./clientConfig');
        const config = getMicrosoftOAuthConfig();
        expect(config.clientId).toBe('test-microsoft-id');
        expect(config.tenantId).toBe('common');
        expect(config.authority).toBe('https://login.microsoftonline.com/common');
    });

    it('module evaluation does NOT throw when env vars are missing (lazy validation per D10.3)', async () => {
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_ID', '');
        vi.stubEnv('VITE_OAUTH_GOOGLE_CLIENT_SECRET', '');
        vi.stubEnv('VITE_OAUTH_MICROSOFT_CLIENT_ID', '');
        // Importing the module must NOT throw — only calling the accessors should
        await expect(import('./clientConfig')).resolves.toBeTruthy();
    });
});
