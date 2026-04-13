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

import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';

import { logDebug } from '../logger.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const LOOPBACK_TIMEOUT_MS = 60_000;

const GOOGLE_SCOPES = ['https://mail.google.com/', 'openid', 'email', 'profile'].join(' ');

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

// -----------------------------------------------------------------------------
// Interactive flow (D3.1, D3.2, D3.5, D11.2)
// -----------------------------------------------------------------------------

export interface InteractiveFlowParams {
    clientConfig: GoogleOAuthClientConfig;
    onAuthUrl: (url: string) => Promise<void>;
    abortSignal: AbortSignal;
}

export interface GoogleInteractiveResult {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    idToken: string;
    scope: string;
    tokenType: string;
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    // PKCE per RFC 7636: 32 cryptographically random bytes, base64url encoded.
    // NEVER Math.random — must be crypto-grade because this is the CSRF
    // defense for installed-app OAuth.
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
}

async function pickFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        // Bind to 127.0.0.1 explicitly — never 0.0.0.0. The loopback-only
        // binding is half the security model for desktop OAuth (PKCE is
        // the other half).
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                const freePort = addr.port;
                server.close(() => resolve(freePort));
            } else {
                server.close();
                reject(new Error('Could not pick free port'));
            }
        });
        server.on('error', reject);
    });
}

const SUCCESS_HTML =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in complete</title>' +
    '<style>body{font-family:system-ui;text-align:center;padding-top:80px}</style></head>' +
    '<body><h1>Sign in complete</h1><p>You can close this tab and return to ExpressDelivery.</p></body></html>';

const ERROR_HTML =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in error</title>' +
    '<style>body{font-family:system-ui;text-align:center;padding-top:80px}</style></head>' +
    '<body><h1>Sign in error</h1><p>Please return to ExpressDelivery and try again.</p></body></html>';

export async function startInteractiveFlow(
    params: InteractiveFlowParams
): Promise<GoogleInteractiveResult> {
    const { clientConfig, onAuthUrl, abortSignal } = params;
    const { codeVerifier, codeChallenge } = generatePKCE();
    // State token for CSRF defense — validated against the callback's
    // state parameter BEFORE exchanging the code for tokens.
    const state = crypto.randomBytes(32).toString('hex');
    const port = await pickFreePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    return new Promise<GoogleInteractiveResult>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            fn();
        };

        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url || '', `http://127.0.0.1:${port}`);
            if (url.pathname !== '/callback') {
                res.writeHead(404).end();
                return;
            }
            const callbackCode = url.searchParams.get('code');
            const callbackState = url.searchParams.get('state');
            const callbackError = url.searchParams.get('error');

            if (callbackError) {
                res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML);
                server.close();
                settle(() =>
                    reject(
                        Object.assign(new Error(`OAuth error: ${callbackError}`), {
                            code: callbackError,
                        })
                    )
                );
                return;
            }
            if (callbackState !== state) {
                res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML);
                server.close();
                settle(() => reject(new Error('OAuth state mismatch — possible CSRF')));
                return;
            }
            if (!callbackCode) {
                res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML);
                server.close();
                settle(() => reject(new Error('OAuth callback missing code parameter')));
                return;
            }

            // Exchange the code for tokens.
            try {
                const tokenParams = new URLSearchParams({
                    client_id: clientConfig.clientId,
                    client_secret: clientConfig.clientSecret,
                    code: callbackCode,
                    code_verifier: codeVerifier,
                    grant_type: 'authorization_code',
                    redirect_uri: redirectUri,
                });
                const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: tokenParams.toString(),
                });
                const tokenBody = (await tokenResp.json()) as Record<string, unknown>;
                if (!tokenResp.ok || 'error' in tokenBody) {
                    res.writeHead(400, { 'Content-Type': 'text/html' }).end(ERROR_HTML);
                    server.close();
                    settle(() =>
                        reject(
                            new Error(
                                `Token exchange failed: ${String(tokenBody.error) || tokenResp.statusText}`
                            )
                        )
                    );
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_HTML);
                server.close();
                settle(() =>
                    resolve({
                        accessToken: tokenBody.access_token as string,
                        refreshToken: tokenBody.refresh_token as string,
                        expiresAt: Date.now() + (tokenBody.expires_in as number) * 1000,
                        idToken: tokenBody.id_token as string,
                        scope: (tokenBody.scope as string) || '',
                        tokenType: (tokenBody.token_type as string) || 'Bearer',
                    })
                );
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/html' }).end(ERROR_HTML);
                server.close();
                settle(() => reject(err));
            }
        });

        server.listen(port, '127.0.0.1', async () => {
            // Build auth URL and hand it to the caller's system-browser
            // launcher (shell.openExternal at the IPC layer).
            const authUrl = new URL(GOOGLE_AUTH_URL);
            authUrl.searchParams.set('client_id', clientConfig.clientId);
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('scope', GOOGLE_SCOPES);
            authUrl.searchParams.set('code_challenge', codeChallenge);
            authUrl.searchParams.set('code_challenge_method', 'S256');
            authUrl.searchParams.set('state', state);
            // access_type=offline + prompt=consent forces Google to return
            // a refresh_token on every interactive flow (rather than only
            // on first consent), which is what we need for long-lived
            // sessions.
            authUrl.searchParams.set('access_type', 'offline');
            authUrl.searchParams.set('prompt', 'consent');

            try {
                await onAuthUrl(authUrl.toString());
            } catch (err) {
                server.close();
                settle(() => reject(err));
            }
        });

        // Hard timeout — if the user never completes the flow, we don't
        // leave an abandoned loopback listener running forever.
        const timeoutHandle = setTimeout(() => {
            server.close();
            settle(() =>
                reject(Object.assign(new Error('OAuth flow timed out'), { code: 'timeout' }))
            );
        }, LOOPBACK_TIMEOUT_MS);

        // Abort handling (D11.2) — caller can cancel via AbortSignal.
        abortSignal.addEventListener('abort', () => {
            clearTimeout(timeoutHandle);
            server.close();
            settle(() =>
                reject(Object.assign(new Error('OAuth flow cancelled'), { code: 'cancelled' }))
            );
        });

        server.on('close', () => clearTimeout(timeoutHandle));
    });
}
