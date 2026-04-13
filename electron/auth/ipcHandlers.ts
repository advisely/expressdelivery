// Phase 2 OAuth IPC handlers (§10.1, D9.1-D9.4, D11.3, D11.5b, D8.2).
//
// Registered by registerAuthIpcHandlers(), called once from electron/main.ts.
// Security:
//   - accountId-bearing handlers validate ownership before DB access
//   - errors returned as { success: false, error } — no stack traces to renderer
//   - D11.3 activeOAuthFlow singleton blocks concurrent flows
//   - D11.5b account rows created ONLY after successful OAuth completion
//   - D8.2 reauth transaction order: persistInitialTokens first, password clear last
// D11.10: all logDebug calls use [OAUTH] prefix.

import { ipcMain, shell } from 'electron';
import crypto from 'node:crypto';
import { getDatabase } from '../db.js';
import { logDebug } from '../logger.js';
import { getAuthTokenManager, type TokenProvider } from './tokenManager.js';
import { startInteractiveFlow as googleStartFlow } from '../oauth/google.js';
import { startInteractiveFlow as microsoftStartFlow } from '../oauth/microsoft.js';
import { getGoogleOAuthConfig, getMicrosoftOAuthConfig } from '../oauth/clientConfig.js';
import { stripCRLF } from '../utils.js';

type OAuthProviderInput = 'google' | 'microsoft';

// D11.3: singleton prevents concurrent OAuth flows.
let activeOAuthFlow: {
    provider: OAuthProviderInput;
    accountId?: string;
    abortController: AbortController;
} | null = null;

function clearActiveFlow(): void {
    activeOAuthFlow = null;
}

/**
 * Decode the payload segment of a JWT without signature verification. Used
 * only to extract `email` / `sub` claims from the id_token returned by the
 * Google interactive flow. The id_token was obtained over TLS from Google's
 * token endpoint within the same OAuth transaction, so signature verification
 * at this layer would be ceremonial — we trust the TLS channel, same as
 * googleapis itself does in the interactive flow path.
 */
interface IdTokenClaims {
    email?: string;
    sub?: string;
    preferred_username?: string;
}
function decodeIdTokenClaims(idToken: string): IdTokenClaims {
    try {
        const parts = idToken.split('.');
        if (parts.length < 2) return {};
        const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
        const parsed = JSON.parse(payload) as IdTokenClaims;
        return parsed ?? {};
    } catch {
        return {};
    }
}

/**
 * Map an input provider + optional classifiedProvider from the Microsoft
 * interactive flow to the canonical TokenProvider enum persisted in
 * oauth_credentials.provider.
 */
function resolveTokenProvider(
    input: OAuthProviderInput,
    classified?: 'microsoft_personal' | 'microsoft_business',
): TokenProvider {
    if (input === 'google') return 'google';
    return classified ?? 'microsoft_business';
}

/**
 * Map a TokenProvider back to the `accounts.provider` column value. Done in
 * one place so the mapping stays consistent across signup and reauth paths.
 */
function tokenProviderToAccountProvider(tp: TokenProvider): string {
    if (tp === 'google') return 'gmail';
    if (tp === 'microsoft_personal') return 'outlook-personal';
    return 'outlook-business';
}

function safeErrorMessage(err: unknown, cap = 300): string {
    const raw = err instanceof Error ? err.message : String(err);
    // Strip control chars and cap length — no stack traces escape to renderer.
    return raw.replace(/[\r\n\0]/g, ' ').slice(0, cap);
}

export function registerAuthIpcHandlers(): void {
    // ── auth:start-oauth-flow ─────────────────────────────────────────────────
    ipcMain.handle('auth:start-oauth-flow', async (_event, params: {
        provider: OAuthProviderInput;
        presetId?: string;
        email?: string;
    }) => {
        if (activeOAuthFlow) {
            return { success: false, error: 'Another sign-in is already in progress' };
        }
        const abortController = new AbortController();
        activeOAuthFlow = { provider: params.provider, abortController };

        try {
            let accessToken: string;
            let refreshToken: string;
            let expiresAt: number;
            let scope: string;
            let tokenType: string;
            let claims: IdTokenClaims;
            let classifiedProvider: 'microsoft_personal' | 'microsoft_business' | undefined;

            if (params.provider === 'google') {
                const result = await googleStartFlow({
                    clientConfig: getGoogleOAuthConfig(),
                    onAuthUrl: async (url: string) => { await shell.openExternal(url); },
                    abortSignal: abortController.signal,
                });
                accessToken = result.accessToken;
                refreshToken = result.refreshToken;
                expiresAt = result.expiresAt;
                scope = result.scope;
                tokenType = result.tokenType;
                claims = decodeIdTokenClaims(result.idToken);
                classifiedProvider = undefined;
            } else {
                const result = await microsoftStartFlow({
                    clientConfig: getMicrosoftOAuthConfig(),
                    onAuthUrl: async (url: string) => { await shell.openExternal(url); },
                    abortSignal: abortController.signal,
                });
                accessToken = result.accessToken;
                refreshToken = result.refreshToken;
                expiresAt = result.expiresAt;
                scope = result.scope;
                tokenType = result.tokenType;
                claims = {
                    email: result.idTokenClaims.email ?? result.idTokenClaims.preferred_username,
                    sub: result.idTokenClaims.sub,
                };
                classifiedProvider = result.classifiedProvider;
            }

            clearActiveFlow();

            const email = claims.email;
            if (!email) {
                return { success: false, error: 'OAuth provider did not return an email claim' };
            }

            // D11.5b: create account row ONLY after successful OAuth completion.
            const accountId = crypto.randomUUID();
            const tokenProvider = resolveTokenProvider(params.provider, classifiedProvider);
            const accountProvider = tokenProviderToAccountProvider(tokenProvider);
            const sanitizedEmail = stripCRLF(email);

            const db = getDatabase();
            // D11.5b: wrap account row insert + token persistence in a single
            // transaction so we never end up with an account row without
            // credentials (or vice versa).
            const insertAccountAndTokens = db.transaction(() => {
                db.prepare(
                    `INSERT INTO accounts (id, email, provider, auth_type, auth_state, imap_port, smtp_port)
                     VALUES (?, ?, ?, 'oauth2', 'ok', 993, 587)`
                ).run(accountId, sanitizedEmail, accountProvider);
                getAuthTokenManager().persistInitialTokens(accountId, tokenProvider, {
                    accessToken,
                    refreshToken,
                    expiresAt,
                    scope,
                    tokenType,
                });
            });
            insertAccountAndTokens();

            logDebug(`[OAUTH] auth:start-oauth-flow success: account ${accountId} provider=${tokenProvider}`);
            return { success: true, accountId, classifiedProvider };
        } catch (err) {
            clearActiveFlow();
            const msg = safeErrorMessage(err, 500);
            logDebug(`[OAUTH] auth:start-oauth-flow error: ${msg}`);
            return { success: false, error: safeErrorMessage(err) };
        }
    });

    // ── auth:start-reauth-flow ────────────────────────────────────────────────
    ipcMain.handle('auth:start-reauth-flow', async (_event, params: { accountId: string }) => {
        if (!params || typeof params.accountId !== 'string') {
            return { success: false, error: 'accountId is required' };
        }

        const db = getDatabase();
        const account = db.prepare(
            'SELECT id, email, provider, auth_type, password_encrypted FROM accounts WHERE id = ?'
        ).get(params.accountId) as Record<string, unknown> | undefined;

        if (!account) {
            return { success: false, error: 'Account not found' };
        }
        if (activeOAuthFlow) {
            return { success: false, error: 'Another sign-in is already in progress' };
        }

        const currentProvider = (account.provider as string | null) ?? '';
        const isGoogle = currentProvider === 'gmail' || currentProvider === 'google';
        const isLegacyOutlookPassword =
            currentProvider === 'outlook' && (account.auth_type as string) === 'password';

        const abortController = new AbortController();
        activeOAuthFlow = {
            provider: isGoogle ? 'google' : 'microsoft',
            accountId: params.accountId,
            abortController,
        };

        try {
            let accessToken: string;
            let refreshToken: string;
            let expiresAt: number;
            let scope: string;
            let tokenType: string;
            let classifiedProvider: 'microsoft_personal' | 'microsoft_business' | undefined;

            if (isGoogle) {
                const result = await googleStartFlow({
                    clientConfig: getGoogleOAuthConfig(),
                    onAuthUrl: async (url: string) => { await shell.openExternal(url); },
                    abortSignal: abortController.signal,
                });
                accessToken = result.accessToken;
                refreshToken = result.refreshToken;
                expiresAt = result.expiresAt;
                scope = result.scope;
                tokenType = result.tokenType;
                classifiedProvider = undefined;
            } else {
                const result = await microsoftStartFlow({
                    clientConfig: getMicrosoftOAuthConfig(),
                    onAuthUrl: async (url: string) => { await shell.openExternal(url); },
                    abortSignal: abortController.signal,
                });
                accessToken = result.accessToken;
                refreshToken = result.refreshToken;
                expiresAt = result.expiresAt;
                scope = result.scope;
                tokenType = result.tokenType;
                classifiedProvider = result.classifiedProvider;
            }

            clearActiveFlow();

            const tokenProvider = resolveTokenProvider(
                isGoogle ? 'google' : 'microsoft',
                classifiedProvider,
            );
            const newProvider = tokenProviderToAccountProvider(tokenProvider);

            // D8.2 transaction order: persistInitialTokens MUST succeed before
            // we update the accounts row. If persistInitialTokens throws, the
            // UPDATE is never reached and password_encrypted is preserved —
            // the account remains usable in legacy password mode and the user
            // can retry the reauth flow.
            const applyReauth = db.transaction(() => {
                getAuthTokenManager().persistInitialTokens(params.accountId, tokenProvider, {
                    accessToken,
                    refreshToken,
                    expiresAt,
                    scope,
                    tokenType,
                });
                // For legacy outlook (auth_type='password') AND for any oauth2
                // account, we rewrite auth_type='oauth2', update provider to
                // the canonical form, clear password_encrypted, and set
                // auth_state='ok'. persistInitialTokens already called
                // setAuthState('ok') but being explicit keeps the flow
                // self-contained.
                db.prepare(
                    `UPDATE accounts
                        SET auth_type = 'oauth2',
                            provider = ?,
                            auth_state = 'ok',
                            password_encrypted = NULL
                      WHERE id = ?`
                ).run(newProvider, params.accountId);
            });
            applyReauth();

            logDebug(
                `[OAUTH] auth:start-reauth-flow success for account ${params.accountId} ` +
                `provider=${tokenProvider} legacyOutlookMigration=${isLegacyOutlookPassword}`
            );
            return { success: true };
        } catch (err) {
            clearActiveFlow();
            const msg = safeErrorMessage(err, 500);
            logDebug(`[OAUTH] auth:start-reauth-flow error for ${params.accountId}: ${msg}`);
            return { success: false, error: safeErrorMessage(err) };
        }
    });

    // ── auth:cancel-flow ──────────────────────────────────────────────────────
    ipcMain.handle('auth:cancel-flow', async () => {
        try {
            if (activeOAuthFlow) {
                activeOAuthFlow.abortController.abort();
                clearActiveFlow();
            }
            return { success: true };
        } catch (err) {
            // Best-effort: cancel must never throw to the renderer.
            logDebug(`[OAUTH] auth:cancel-flow swallowed error: ${safeErrorMessage(err, 200)}`);
            return { success: true };
        }
    });

    // ── auth:flow-status ──────────────────────────────────────────────────────
    ipcMain.handle('auth:flow-status', async () => {
        if (!activeOAuthFlow) return { inFlight: false };
        return { inFlight: true, provider: activeOAuthFlow.provider };
    });

    // ── auth:get-state ────────────────────────────────────────────────────────
    // Returns the accounts.auth_state tristate ('ok' | 'recommended_reauth' |
    // 'reauth_required') per db.ts AuthState. The renderer uses this to
    // decide whether to show the sidebar reauth badge.
    ipcMain.handle('auth:get-state', async (_event, params: { accountId: string }) => {
        try {
            if (!params || typeof params.accountId !== 'string') {
                return { success: false, error: 'accountId is required' };
            }
            const row = getDatabase().prepare(
                'SELECT auth_state FROM accounts WHERE id = ?'
            ).get(params.accountId) as { auth_state: string } | undefined;
            if (!row) return { success: false, error: 'Account not found' };
            return { state: row.auth_state };
        } catch (err) {
            const msg = safeErrorMessage(err, 200);
            logDebug(`[OAUTH] auth:get-state error: ${msg}`);
            return { success: false, error: msg };
        }
    });
}
