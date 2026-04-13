// Lazy accessor functions for OAuth client config (Phase 2 D10.3).
//
// Per Decision D10.3 in the Phase 2 spec, validation of OAuth client config
// is LAZY — only executed when OAuth functionality is actually initialized.
// The module must NEVER throw at top-level evaluation, because doing so
// would crash unrelated code paths that happen to import this module
// indirectly (tests, preload, etc.).
//
// Per Decision D10.1, client values are injected at build time via Vite
// `define` plugin reading from environment variables. The release.yml
// workflow maps OAUTH_* repository secrets to VITE_OAUTH_* env vars per
// Decision D10.4. Local dev contributors set their own values in
// .env.local per Decision D10.5.
//
// Per RFC 8252 and Google's own docs, the client_secret for desktop apps
// is "obviously not treated as a secret" because it's embedded in the
// binary. The real security boundary for installed apps is the loopback
// redirect URI (only the running process on 127.0.0.1:<random-port> can
// capture the redirect) plus PKCE.

export interface GoogleOAuthConfig {
    clientId: string;
    clientSecret: string;
}

export interface MicrosoftOAuthConfig {
    clientId: string;
    tenantId: 'common';
    authority: 'https://login.microsoftonline.com/common';
}

let cachedGoogleConfig: GoogleOAuthConfig | null = null;
let cachedMicrosoftConfig: MicrosoftOAuthConfig | null = null;

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
    if (cachedGoogleConfig) return cachedGoogleConfig;
    const clientId = import.meta.env.VITE_OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = import.meta.env.VITE_OAUTH_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error(
            'Google OAuth client config is not set. Add VITE_OAUTH_GOOGLE_CLIENT_ID and ' +
                'VITE_OAUTH_GOOGLE_CLIENT_SECRET to .env.local for development. See CONTRIBUTING.md.'
        );
    }
    cachedGoogleConfig = { clientId, clientSecret };
    return cachedGoogleConfig;
}

export function getMicrosoftOAuthConfig(): MicrosoftOAuthConfig {
    if (cachedMicrosoftConfig) return cachedMicrosoftConfig;
    const clientId = import.meta.env.VITE_OAUTH_MICROSOFT_CLIENT_ID;
    if (!clientId) {
        throw new Error(
            'Microsoft OAuth client config is not set. Add VITE_OAUTH_MICROSOFT_CLIENT_ID to ' +
                '.env.local for development. See CONTRIBUTING.md.'
        );
    }
    cachedMicrosoftConfig = {
        clientId,
        tenantId: 'common',
        authority: 'https://login.microsoftonline.com/common',
    };
    return cachedMicrosoftConfig;
}

// Test-only helper to reset cached state between tests. NOT exported in
// production builds via tree-shaking — the function is only called from
// vi.resetModules() context which discards the entire module instance.
export function __resetForTests(): void {
    cachedGoogleConfig = null;
    cachedMicrosoftConfig = null;
}
