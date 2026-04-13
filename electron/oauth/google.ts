// Google OAuth provider adapter (Phase 2).
//
// Spec D3.4, D5.7, D9.5, D9.6, D11.1, §6.1
//
// Stateless functions wrapping the Google OAuth2 token and revoke
// endpoints using raw fetch. All HTTP traffic goes to
// oauth2.googleapis.com. Tests use nock to intercept and assert on the
// wire shape. This file exposes:
//   - refreshAccessToken: exchange a refresh token for a new access token
//   - revokeRefreshToken:  best-effort revocation on account delete
// The interactive flow (with loopback server) is in this same file but
// lives in the next task.

import { logDebug } from '../logger.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export interface GoogleOAuthClientConfig {
    clientId: string;
    clientSecret: string;
}

export interface GoogleRefreshResult {
    accessToken: string;
    refreshToken?: string; // only present if Google rotated (D5.4)
    expiresAt: number;
    scope?: string;
    tokenType?: string;
}

interface GoogleTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
}

interface GoogleErrorResponse {
    error: string;
    error_description?: string;
}

export async function refreshAccessToken(
    refreshToken: string,
    clientConfig: GoogleOAuthClientConfig
): Promise<GoogleRefreshResult> {
    const params = new URLSearchParams({
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    const body = (await response.json()) as GoogleTokenResponse | GoogleErrorResponse;

    if (!response.ok || 'error' in body) {
        const errBody = body as GoogleErrorResponse;
        const err: Error & { error?: string; error_description?: string; status?: number } = new Error(
            `Google token refresh failed: ${errBody.error || response.statusText}`
        );
        err.error = errBody.error;
        err.error_description = errBody.error_description;
        err.status = response.status;
        throw err;
    }

    const success = body as GoogleTokenResponse;
    return {
        accessToken: success.access_token,
        refreshToken: success.refresh_token, // undefined unless rotated
        expiresAt: Date.now() + success.expires_in * 1000,
        scope: success.scope,
        tokenType: success.token_type,
    };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
    // Best-effort revocation per D11.1. Errors are swallowed; the caller
    // wraps this in try/catch and logs failures via logDebug.
    try {
        const params = new URLSearchParams({ token: refreshToken });
        const response = await fetch(GOOGLE_REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        if (!response.ok) {
            logDebug(`[OAUTH] [GOOGLE] revoke returned ${response.status} (best-effort, swallowed)`);
        }
    } catch (err) {
        logDebug(`[OAUTH] [GOOGLE] revoke threw (best-effort, swallowed): ${String(err).slice(0, 200)}`);
    }
}
