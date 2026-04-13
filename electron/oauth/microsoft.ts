// Microsoft OAuth provider adapter (Phase 2).
//
// Spec D3.3, D5.7, D5.9, D11.1, §6.2
//
// Thin wrapper around @azure/msal-node's PublicClientApplication.
// Per D5.9 the wrapper must NOT introduce a second durable cache —
// each refresh creates a fresh PublicClientApplication instance with
// no persistent cache plugin, so the only token state lives in our
// own oauth_credentials SQLite table.
//
// Per D11.1, Microsoft does not provide a clean per-token revoke
// endpoint. The closest API (POST /me/revokeSignInSessions) is
// nuclear (revokes ALL refresh tokens for the user, across every app)
// and we deliberately do NOT call it. The revoke function is a no-op
// that just logs for diagnostics.

import { PublicClientApplication } from '@azure/msal-node';
import { logDebug } from '../logger.js';

export interface MicrosoftOAuthClientConfig {
    clientId: string;
    tenantId: 'common';
    authority: 'https://login.microsoftonline.com/common';
}

export interface MicrosoftRefreshResult {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    scope?: string;
    tokenType?: string;
}

interface MsalErrorShape {
    errorCode?: string;
    errorMessage?: string;
}

const MICROSOFT_SCOPES = [
    'https://outlook.office.com/IMAP.AccessAsUser.All',
    'https://outlook.office.com/SMTP.Send',
    'https://graph.microsoft.com/Mail.Send',
    'offline_access',
    'openid',
    'profile',
    'email',
];

function makeClient(config: MicrosoftOAuthClientConfig): PublicClientApplication {
    return new PublicClientApplication({
        auth: {
            clientId: config.clientId,
            authority: config.authority,
        },
        // No cache plugin — D5.9 requires SQLite to be the single source
        // of truth for token persistence.
    });
}

export async function refreshAccessToken(
    refreshToken: string,
    config: MicrosoftOAuthClientConfig
): Promise<MicrosoftRefreshResult> {
    const client = makeClient(config);
    // The `as unknown as ...` cast is intentional per D5.9: MSAL marks
    // acquireTokenByRefreshToken as internal in some versions, but the
    // architectural constraint ("no second durable cache") means we MUST
    // pass the refresh token ourselves rather than letting MSAL manage
    // its own cache. If a future MSAL version removes this API, the
    // implementer adjusts the wrapper without changing the constraint.
    try {
        const result = await (
            client as unknown as {
                acquireTokenByRefreshToken: (req: {
                    refreshToken: string;
                    scopes: string[];
                }) => Promise<{
                    accessToken: string;
                    refreshToken?: string;
                    expiresOn: Date | null;
                    scopes: string[];
                    tokenType?: string;
                }>;
            }
        ).acquireTokenByRefreshToken({
            refreshToken,
            scopes: MICROSOFT_SCOPES,
        });

        const expiresAt = result.expiresOn
            ? result.expiresOn.getTime()
            : Date.now() + 3600 * 1000;
        return {
            accessToken: result.accessToken,
            refreshToken: result.refreshToken, // undefined unless MSAL rotated
            expiresAt,
            scope: result.scopes.join(' '),
            tokenType: result.tokenType,
        };
    } catch (err) {
        const msalErr = err as MsalErrorShape;
        const wrapped: Error & { error?: string; status?: number } = new Error(
            `Microsoft token refresh failed: ${msalErr.errorMessage || String(err)}`
        );
        wrapped.error = msalErr.errorCode || 'unknown';
        throw wrapped;
    }
}

// -----------------------------------------------------------------------------
// Tenant classification (D6.7, D6.8)
// -----------------------------------------------------------------------------
//
// Per D6.7 the authoritative classification for a Microsoft account comes
// from the id_token's `tid` (tenant id) claim — NOT from domain sniffing
// (hotmail.com / outlook.com / live.com). Domain sniffing is brittle
// because:
//   - Personal accounts CAN use custom domains (e.g. alias@me.com bound
//     to a Microsoft personal account).
//   - Business accounts CAN use consumer-looking domains when tenants
//     migrate from M365 Home to M365 Business.
// The personal-tenant magic GUID below is stable and documented in the
// Microsoft identity platform reference.

const MICROSOFT_PERSONAL_TID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MicrosoftClassification = 'microsoft_personal' | 'microsoft_business';

export function classifyMicrosoftAccount(tid: string): MicrosoftClassification {
    if (!tid || !GUID_RE.test(tid)) {
        throw new Error(`Invalid or missing id_token.tid claim: ${tid || '(empty)'}`);
    }
    return tid.toLowerCase() === MICROSOFT_PERSONAL_TID
        ? 'microsoft_personal'
        : 'microsoft_business';
}

// -----------------------------------------------------------------------------
// Interactive flow (D3.1, D3.3, §6.2)
// -----------------------------------------------------------------------------

export interface MicrosoftIdTokenClaims {
    tid: string;
    email?: string;
    preferred_username?: string;
    sub?: string;
}

export interface MicrosoftInteractiveResult {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    idToken: string;
    idTokenClaims: MicrosoftIdTokenClaims;
    classifiedProvider: MicrosoftClassification;
    scope: string;
    tokenType: string;
}

export interface MicrosoftInteractiveFlowParams {
    clientConfig: MicrosoftOAuthClientConfig;
    onAuthUrl: (url: string) => Promise<void>;
    abortSignal: AbortSignal;
}

export async function startInteractiveFlow(
    params: MicrosoftInteractiveFlowParams
): Promise<MicrosoftInteractiveResult> {
    const client = makeClient(params.clientConfig);

    // MSAL handles the loopback server, PKCE, code exchange, and id_token
    // parsing internally. We pass the openBrowser callback to wire system
    // browser launch via shell.openExternal at the call site.
    //
    // The `as unknown as ...` cast is intentional per D5.9 (same rationale
    // as refreshAccessToken above).
    const result = await (
        client as unknown as {
            acquireTokenInteractive: (req: {
                scopes: string[];
                openBrowser: (url: string) => Promise<void>;
                successTemplate?: string;
                errorTemplate?: string;
            }) => Promise<{
                accessToken: string;
                refreshToken?: string;
                expiresOn: Date | null;
                scopes: string[];
                tokenType?: string;
                idToken: string;
                idTokenClaims: MicrosoftIdTokenClaims;
            }>;
        }
    ).acquireTokenInteractive({
        scopes: MICROSOFT_SCOPES,
        openBrowser: params.onAuthUrl,
        successTemplate:
            '<h1>Sign in complete</h1><p>You can close this tab and return to ExpressDelivery.</p>',
        errorTemplate:
            '<h1>Sign in error</h1><p>Please return to ExpressDelivery and try again.</p>',
    });

    if (!result.refreshToken) {
        // Microsoft only issues refresh tokens when offline_access was
        // granted. If we don't have one, the account is unusable for
        // long-lived background sync — fail hard rather than persisting a
        // credential row that will go sour on the next refresh attempt.
        throw new Error(
            'Microsoft did not return a refresh token. Ensure offline_access scope is requested.'
        );
    }

    const classifiedProvider = classifyMicrosoftAccount(result.idTokenClaims.tid);
    const expiresAt = result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3600 * 1000;

    return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt,
        idToken: result.idToken,
        idTokenClaims: result.idTokenClaims,
        classifiedProvider,
        scope: result.scopes.join(' '),
        tokenType: result.tokenType || 'Bearer',
    };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
    // No-op per D11.1. Microsoft does not provide a clean per-token revoke
    // endpoint. The closest is POST /me/revokeSignInSessions which is
    // nuclear (revokes ALL refresh tokens for the user, across every app).
    // We deliberately do NOT call it. The local oauth_credentials row will
    // be deleted by the caller; the refresh token will age out on
    // Microsoft's side after ~90 days of inactivity. The refreshToken
    // argument is intentionally accepted (symmetry with the Google adapter)
    // but only the first 8 chars are logged for correlation diagnostics.
    const preview = refreshToken ? `${refreshToken.slice(0, 8)}…` : '(empty)';
    logDebug(
        `[OAUTH] [MICROSOFT] revoke skipped for token ${preview} ` +
            '(no per-token endpoint per D11.1)'
    );
}
