// AuthTokenManager — main-process singleton for OAuth token lifecycle.
//
// Spec §5, D5.1 (JIT pre-flight + on-401 reactive retry), D5.2 (singleton),
// D5.3 (per-account refresh dedup), D5.4 (refresh-token rotation), D5.5
// (atomic persistence), D5.6 (ownership boundaries), D5.10 (permanent vs
// transient error classification), D5.11 (persistInitialTokens for initial
// OAuth sign-in and in-place re-auth).
//
// Encryption: all token values stored in SQLite as base64(encryptData(plain)).
// Callers receive plain-text access tokens; the encryption boundary lives
// entirely inside this module.
//
// Never import safeStorage directly — use the encryptData/decryptData helpers
// from electron/crypto.ts so tests can substitute the safeStorage stub from
// src/setupTests.ts without monkey-patching Electron internals.

import { encryptData, decryptData } from '../crypto.js';
import {
    getOAuthCredential,
    insertOAuthCredential,
    updateAccessToken,
    updateAccessAndRefreshToken,
    setAuthState,
} from '../db.js';
import { refreshAccessToken as googleRefresh } from '../oauth/google.js';
import { refreshAccessToken as microsoftRefresh } from '../oauth/microsoft.js';
import { getGoogleOAuthConfig, getMicrosoftOAuthConfig } from '../oauth/clientConfig.js';
import { logDebug } from '../logger.js';
import type { Database } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Public types (re-exported for callers: AccountSyncController, smtp.ts, etc.)
// ---------------------------------------------------------------------------

export type TokenProvider = 'google' | 'microsoft_personal' | 'microsoft_business';

export interface TokenResult {
    accessToken: string;
    expiresAt: number;
    provider: TokenProvider;
}

export class PermanentAuthError extends Error {
    readonly code: 'invalid_grant' | 'unauthorized_client' | 'invalid_client';
    readonly accountId: string;

    constructor(
        message: string,
        code: 'invalid_grant' | 'unauthorized_client' | 'invalid_client',
        accountId: string,
    ) {
        super(message);
        this.name = 'PermanentAuthError';
        this.code = code;
        this.accountId = accountId;
    }
}

export class TransientAuthError extends Error {
    readonly cause: unknown;
    readonly accountId: string;

    constructor(message: string, cause: unknown, accountId: string) {
        super(message);
        this.name = 'TransientAuthError';
        this.cause = cause;
        this.accountId = accountId;
    }
}

export interface PersistInitialTokensParams {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scope?: string;
    tokenType?: string;
}

export interface AuthTokenManagerInterface {
    init(db: Database): void;
    getValidAccessToken(accountId: string): Promise<TokenResult>;
    invalidateToken(accountId: string): Promise<void>;
    persistInitialTokens(
        accountId: string,
        provider: TokenProvider,
        tokens: PersistInitialTokensParams,
    ): void;
    /**
     * Returns the plaintext refresh token for an account. Used by the Task 17
     * account-delete flow to revoke the token at Google before deleting the
     * local credential row. Throws when no oauth_credentials row exists.
     */
    getDecryptedRefreshToken(accountId: string): Promise<string>;
    shutdown(): void;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const SKEW_SECONDS = 60;

// Permanent OAuth error codes per D5.10. Network errors, 5xx, rate-limit
// (429), and timeouts are absent — they are transient.
const PERMANENT_OAUTH_ERROR_CODES = new Set([
    'invalid_grant',         // refresh token revoked, expired, or deleted account
    'unauthorized_client',   // client not authorized for this grant type
    'invalid_client',        // client credentials mismatch
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function encryptToken(plain: string): string {
    // encryptData returns Buffer; store as base64 TEXT to match the
    // accounts.password_encrypted column convention.
    return encryptData(plain).toString('base64');
}

function decryptToken(encrypted: string): string {
    return decryptData(Buffer.from(encrypted, 'base64'));
}

function redactAccount(accountId: string): string {
    // Log-safe: show only the first two and last two characters of the id.
    if (accountId.length <= 4) return '***';
    return `${accountId.slice(0, 2)}***${accountId.slice(-2)}`;
}

function redactToken(plain: string): string {
    if (plain.length <= 8) return '***';
    return `${plain.slice(0, 8)}...`;
}

function extractErrorCode(err: unknown): string | undefined {
    if (typeof err !== 'object' || err === null) return undefined;
    const e = err as Record<string, unknown>;
    if (typeof e['error'] === 'string') return e['error'];
    if (typeof e['code'] === 'string') return e['code'];
    return undefined;
}

function isPermanentOAuthError(err: unknown): boolean {
    const code = extractErrorCode(err);
    return code !== undefined && PERMANENT_OAUTH_ERROR_CODES.has(code);
}

// ---------------------------------------------------------------------------
// AuthTokenManager implementation
// ---------------------------------------------------------------------------

class AuthTokenManagerImpl implements AuthTokenManagerInterface {
    private db: Database | null = null;

    // Per-account in-flight refresh promises — dedup map (D5.3). Keyed on
    // accountId (accounts.id TEXT PRIMARY KEY).
    private readonly inFlight = new Map<string, Promise<TokenResult>>();

    init(db: Database): void {
        this.db = db;
    }

    shutdown(): void {
        this.db = null;
        this.inFlight.clear();
    }

    async getValidAccessToken(accountId: string): Promise<TokenResult> {
        const db = this.requireDb();

        const row = getOAuthCredential(db, accountId);
        if (!row) {
            throw new Error(
                `AuthTokenManager: no OAuth credential row found for account ${accountId}. ` +
                `Ensure the account was set up via OAuth (auth_type='oauth2').`,
            );
        }

        const now = Date.now();
        // JIT pre-flight (D5.1): cached token is still valid if it has more
        // than SKEW_SECONDS of lifetime remaining.
        if (row.expiresAt > now + SKEW_SECONDS * 1000) {
            const accessToken = decryptToken(row.accessTokenEncrypted);
            return {
                accessToken,
                expiresAt: row.expiresAt,
                provider: row.provider as TokenProvider,
            };
        }

        // Token expired or within skew window — refresh required.
        // Check dedup map first (D5.3).
        const existing = this.inFlight.get(accountId);
        if (existing) {
            logDebug(`[OAUTH] dedup: account ${redactAccount(accountId)} awaiting in-flight refresh`);
            return existing;
        }

        // Store promise BEFORE awaiting so concurrent callers share it.
        const refreshPromise = this.doRefresh(accountId, row.provider as TokenProvider, row)
            .finally(() => {
                this.inFlight.delete(accountId);
            });
        this.inFlight.set(accountId, refreshPromise);

        return refreshPromise;
    }

    async invalidateToken(accountId: string): Promise<void> {
        // Clear in-flight slot so a subsequent call can start a new refresh.
        this.inFlight.delete(accountId);

        // Reset expires_at = 0 so the JIT check fails on the very next call.
        // Best-effort (D5.6): the credential row may not exist if the account
        // was deleted concurrently. The UPDATE is a no-op and we must not throw.
        try {
            const db = this.requireDb();
            updateAccessToken(db, accountId, {
                accessTokenEncrypted: encryptToken(''),
                expiresAt: 0,
            });
            logDebug(`[OAUTH] token invalidated for account ${redactAccount(accountId)}`);
        } catch (err) {
            // Silenced: best-effort per D5.6. Log for diagnostics only.
            logDebug(
                `[OAUTH] invalidateToken no-op for ${redactAccount(accountId)}: ${String(err).slice(0, 120)}`,
            );
        }
    }

    persistInitialTokens(
        accountId: string,
        provider: TokenProvider,
        tokens: PersistInitialTokensParams,
    ): void {
        const db = this.requireDb();
        // insertOAuthCredential uses ON CONFLICT DO UPDATE so this is safe
        // for both initial sign-in and in-place re-auth (D5.11, D8.2).
        insertOAuthCredential(db, {
            accountId,
            provider,
            accessTokenEncrypted: encryptToken(tokens.accessToken),
            refreshTokenEncrypted: encryptToken(tokens.refreshToken),
            expiresAt: tokens.expiresAt,
            scope: tokens.scope,
            tokenType: tokens.tokenType,
        });
        // Also clear any prior reauth_required state since a fresh token was
        // just written. The caller may have already set auth_state='ok' but
        // being explicit keeps the re-auth flow self-contained.
        setAuthState(db, accountId, 'ok');
        logDebug(
            `[OAUTH] initial tokens persisted for account ${redactAccount(accountId)} ` +
            `provider=${provider} access=${redactToken(tokens.accessToken)}`,
        );
    }

    async getDecryptedRefreshToken(accountId: string): Promise<string> {
        const db = this.requireDb();
        const row = getOAuthCredential(db, accountId);
        if (!row) {
            throw new Error(
                `AuthTokenManager.getDecryptedRefreshToken: no OAuth credential row for account ${accountId}`,
            );
        }
        return decryptToken(row.refreshTokenEncrypted);
    }

    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------

    private async doRefresh(
        accountId: string,
        provider: TokenProvider,
        row: { refreshTokenEncrypted: string },
    ): Promise<TokenResult> {
        const db = this.requireDb();
        const refreshToken = decryptToken(row.refreshTokenEncrypted);

        let result: { accessToken: string; refreshToken?: string; expiresAt: number } | undefined;

        try {
            if (provider === 'google') {
                const cfg = getGoogleOAuthConfig();
                result = await googleRefresh(refreshToken, cfg);
            } else if (provider === 'microsoft_personal' || provider === 'microsoft_business') {
                const cfg = getMicrosoftOAuthConfig();
                result = await microsoftRefresh(refreshToken, cfg);
            } else {
                throw new Error(
                    `AuthTokenManager: unknown provider '${String(provider)}' for account ${accountId}`,
                );
            }
        } catch (err) {
            if (isPermanentOAuthError(err)) {
                // Persist reauth state BEFORE re-throwing so AccountSyncController
                // and any consumer that inspects the DB sees the updated state.
                setAuthState(db, accountId, 'reauth_required');

                const code = extractErrorCode(err) as
                    | 'invalid_grant'
                    | 'unauthorized_client'
                    | 'invalid_client';
                logDebug(
                    `[OAUTH] permanent error for account ${redactAccount(accountId)} ` +
                    `provider=${provider} code=${code}`,
                );

                throw new PermanentAuthError(
                    `OAuth permanent error for account ${accountId}: ${code}`,
                    code,
                    accountId,
                );
            }

            // Transient error — wrap and re-throw. The in-flight map entry is
            // cleared by .finally() on the outer promise so the next caller
            // can attempt a fresh refresh.
            logDebug(
                `[OAUTH] transient error for account ${redactAccount(accountId)} ` +
                `provider=${provider}: ${String(err).slice(0, 200)}`,
            );

            throw new TransientAuthError(
                `OAuth transient error for account ${accountId}`,
                err,
                accountId,
            );
        }

        // Persist atomically (D5.5).
        // D5.4: only overwrite the refresh token if the provider returned one.
        if (result.refreshToken !== undefined) {
            updateAccessAndRefreshToken(db, accountId, {
                accessTokenEncrypted: encryptToken(result.accessToken),
                refreshTokenEncrypted: encryptToken(result.refreshToken),
                expiresAt: result.expiresAt,
            });
        } else {
            updateAccessToken(db, accountId, {
                accessTokenEncrypted: encryptToken(result.accessToken),
                expiresAt: result.expiresAt,
            });
        }

        logDebug(
            `[OAUTH] token refreshed for account ${redactAccount(accountId)} ` +
            `provider=${provider} expiresAt=${result.expiresAt} access=${redactToken(result.accessToken)}`,
        );

        return {
            accessToken: result.accessToken,
            expiresAt: result.expiresAt,
            provider,
        };
    }

    private requireDb(): Database {
        if (!this.db) {
            throw new Error('AuthTokenManager.init(db) must be called before any token operations');
        }
        return this.db;
    }
}

// ---------------------------------------------------------------------------
// Singleton factory (D5.2)
// ---------------------------------------------------------------------------

let _instance: AuthTokenManagerImpl | null = null;

export function getAuthTokenManager(): AuthTokenManagerInterface {
    if (!_instance) {
        _instance = new AuthTokenManagerImpl();
    }
    return _instance;
}

// Convenience delegate export for callers that prefer a module-level symbol:
//   import { authTokenManager } from './auth/tokenManager.js';
//   authTokenManager.getValidAccessToken(accountId);
export const authTokenManager: AuthTokenManagerInterface = {
    init: (db) => getAuthTokenManager().init(db),
    getValidAccessToken: (id) => getAuthTokenManager().getValidAccessToken(id),
    invalidateToken: (id) => getAuthTokenManager().invalidateToken(id),
    persistInitialTokens: (accountId, provider, tokens) =>
        getAuthTokenManager().persistInitialTokens(accountId, provider, tokens),
    getDecryptedRefreshToken: (id) => getAuthTokenManager().getDecryptedRefreshToken(id),
    shutdown: () => getAuthTokenManager().shutdown(),
};
