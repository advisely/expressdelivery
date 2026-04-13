// AuthTokenManager — main-process singleton for OAuth token lifecycle.
//
// Spec §5, D5.1 (JIT pre-flight + on-401 reactive retry), D5.2 (singleton),
// D5.3 (per-account refresh dedup), D5.4 (refresh-token rotation), D5.5
// (atomic persistence), D5.6 (ownership boundaries).
//
// Encryption: all token values stored in SQLite as base64(encryptData(plain)).
// Callers receive plain-text access tokens; the encryption boundary lives
// entirely inside this module.
//
// Never import safeStorage directly — use the encryptData/decryptData helpers
// from electron/crypto.ts so tests can substitute the safeStorage stub from
// src/setupTests.ts without monkey-patching Electron internals.
//
// Task 9 scope: JIT pre-flight, per-account dedup mutex, Google + Microsoft
// refresh dispatch, atomic persistence with rotation (D5.4). Task 10 will
// add error classification, invalidateToken, and persistInitialTokens.

import { encryptData, decryptData } from '../crypto.js';
import {
    getOAuthCredential,
    updateAccessToken,
    updateAccessAndRefreshToken,
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

export interface AuthTokenManagerInterface {
    init(db: Database): void;
    getValidAccessToken(accountId: string): Promise<TokenResult>;
    shutdown(): void;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const SKEW_SECONDS = 60;

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

        let result: { accessToken: string; refreshToken?: string; expiresAt: number };

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
    shutdown: () => getAuthTokenManager().shutdown(),
};
