// Phase 2 D11.1 — best-effort OAuth refresh token revocation helper.
//
// Extracted from the inline accounts:remove IPC handler so the revocation
// behavior is unit-testable in isolation. The handler calls this BEFORE
// deleting the accounts row; any failure is logged and swallowed so the
// delete always proceeds.
//
// Provider policy per D11.1:
//   google                → POST to Google revoke endpoint (real revocation)
//   microsoft_personal    → no-op (revokeSignInSessions is nuclear; intentional)
//   microsoft_business    → no-op (same reason)

import type { Database } from 'better-sqlite3';
import { getOAuthCredential } from '../db.js';
import { getAuthTokenManager } from './tokenManager.js';
import { revokeRefreshToken as googleRevokeRefreshToken } from '../oauth/google.js';
import { revokeRefreshToken as microsoftRevokeRefreshToken } from '../oauth/microsoft.js';
import { logDebug } from '../logger.js';

/**
 * Revoke the OAuth refresh token for `accountId` if one exists. Best-effort:
 * never throws. Returns `{ attempted, revoked }` so callers can log outcomes
 * but MUST NOT branch on the result — the caller (accounts:remove) always
 * proceeds with the delete regardless.
 */
export async function maybeRevokeOAuthCredentials(
    db: Database,
    accountId: string,
): Promise<{ attempted: boolean; revoked: boolean; provider?: string }> {
    let cred: ReturnType<typeof getOAuthCredential>;
    try {
        cred = getOAuthCredential(db, accountId);
    } catch (err) {
        logDebug(`[OAUTH] revoke lookup failed for ${accountId}: ${err instanceof Error ? err.message : String(err)}`);
        return { attempted: false, revoked: false };
    }
    if (cred === null) {
        return { attempted: false, revoked: false };
    }

    try {
        const refreshToken = await getAuthTokenManager().getDecryptedRefreshToken(accountId);
        if (cred.provider === 'google') {
            await googleRevokeRefreshToken(refreshToken);
            logDebug(`[OAUTH] google refresh token revoked for account ${accountId}`);
            return { attempted: true, revoked: true, provider: cred.provider };
        }
        // microsoft_personal / microsoft_business: adapter is a no-op per D11.1.
        await microsoftRevokeRefreshToken(refreshToken);
        logDebug(`[OAUTH] microsoft refresh token revoke (no-op) for account ${accountId}`);
        return { attempted: true, revoked: true, provider: cred.provider };
    } catch (err) {
        // Revocation failure is non-fatal. The local credential row will
        // be deleted anyway; the token will age out on the provider side.
        logDebug(`[OAUTH] revoke failed for ${accountId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        return { attempted: true, revoked: false, provider: cred.provider };
    }
}
