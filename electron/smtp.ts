import nodemailer from 'nodemailer';
import { getDatabase } from './db.js';
import { decryptData } from './crypto.js';
import { getAuthTokenManager } from './auth/tokenManager.js';
import { logDebug } from './logger.js';

export interface SendAttachment {
    filename: string;
    content: string;       // base64-encoded
    contentType: string;
}

/** Auth discriminator for the optional 8th argument of SmtpEngine.sendEmail. */
export type SmtpAuth =
    | { type: 'password'; user: string; pass: string }
    | { type: 'xoauth2'; user: string; accessToken: string };

export class SmtpEngine {
    /**
     * Send an email via SMTP.
     *
     * The optional `auth` parameter (8th argument) selects the SMTP auth strategy:
     *
     * - Omitted / undefined — reads password_encrypted from DB and uses { user, pass }.
     *   This is the legacy path used by password-mode accounts (Gmail app-password,
     *   Yahoo, iCloud, custom). Existing callers are unaffected.
     *
     * - `{ type: 'xoauth2', user, accessToken }` — builds a Nodemailer
     *   `{ type: 'OAuth2', user, accessToken }` config. Nodemailer handles XOAUTH2
     *   SASL framing internally per D5.8 — the application never constructs the raw
     *   `user=...^Aauth=Bearer ...^A^A` blob. The password_encrypted column is NOT
     *   read or decrypted in this path.
     */
    async sendEmail(
        accountId: string,
        to: string | string[],
        subject: string,
        html: string,
        cc?: string | string[],
        bcc?: string | string[],
        attachments?: SendAttachment[],
        auth?: SmtpAuth,
    ): Promise<{ success: boolean; messageId?: string }> {
        const db = getDatabase();
        const account = db.prepare(
            'SELECT id, email, password_encrypted, provider, display_name, smtp_host, smtp_port FROM accounts WHERE id = ?'
        ).get(accountId) as Record<string, unknown>;

        if (!account) throw new Error('Account not found');

        const host = (account.smtp_host as string) ||
            (account.provider === 'gmail' ? 'smtp.gmail.com' : 'smtp.example.com');
        const port = (account.smtp_port as number) || 465;

        // Build Nodemailer auth config based on the auth argument.
        let transporterAuth: Record<string, unknown>;
        if (auth?.type === 'xoauth2') {
            // OAuth2 path: Nodemailer takes { type, user, accessToken }.
            // Per D5.8: never construct the XOAUTH2 blob manually.
            transporterAuth = {
                type: 'OAuth2',
                user: auth.user,
                accessToken: auth.accessToken,
            };
        } else {
            // Password path: decrypt and use { user, pass }.
            if (!account.password_encrypted) throw new Error('No password stored for account');
            const password = decryptData(Buffer.from(account.password_encrypted as string, 'base64'));
            transporterAuth = {
                user: account.email as string,
                pass: password,
            };
        }

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: transporterAuth,
        });

        try {
            const displayName = (account.display_name as string) || (account.email as string);
            const info = await transporter.sendMail({
                from: {
                    name: displayName,
                    address: account.email as string,
                },
                to: Array.isArray(to) ? to.join(', ') : to,
                cc: cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : undefined,
                bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
                subject,
                html,
                attachments: attachments?.map(att => ({
                    filename: att.filename,
                    content: Buffer.from(att.content, 'base64'),
                    contentType: att.contentType,
                })),
            });

            return { success: true, messageId: info.messageId };
        } catch (error) {
            logDebug(`Error sending email: ${error instanceof Error ? error.message : String(error)}`);
            return { success: false };
        }
    }
}

export const smtpEngine = new SmtpEngine();

// ---------------------------------------------------------------------------
// sendEmailWithOAuthRetry — on-401 retry wrapper for OAuth2 SMTP send paths.
//
// Used by the sendMail dispatcher when an OAuth2 account sends via SMTP
// (Google + microsoft_business). On an auth failure (EAUTH / 535) the wrapper
// invalidates the cached token via AuthTokenManager, fetches a fresh one, and
// retries exactly once. A second failure gives up and returns { success: false }
// — it does NOT throw, because the IPC handler wraps responses as a simple
// success/error object rather than propagating exceptions.
//
// Non-auth errors are already swallowed by the base SmtpEngine.sendEmail (it
// returns { success: false } and logs the cause). The wrapper does not retry
// on those, because the failure is not auth-related and a token refresh would
// not help.
// ---------------------------------------------------------------------------

export interface OAuthRetryParams {
    accountId: string;
    to: string | string[];
    subject: string;
    html: string;
    cc?: string | string[];
    bcc?: string | string[];
    attachments?: SendAttachment[];
}

/**
 * Send via SMTP XOAUTH2 with automatic on-401 token refresh (D5.1 / §7.3).
 *
 * Fetches a valid access token from AuthTokenManager, attempts the send via
 * SmtpEngine.sendEmail with an xoauth2 auth object. If nodemailer throws an
 * EAUTH / 535 response (which the base method catches and returns as
 * { success: false }), this wrapper detects the failure, invalidates the
 * token, re-fetches, and retries once. A second failure returns
 * { success: false } — the IPC handler surfaces this as a toast.
 *
 * Because the base SmtpEngine.sendEmail swallows the underlying error (via
 * its own try/catch) and only surfaces a boolean, this wrapper cannot
 * distinguish auth errors from network errors after the fact. To handle this,
 * we bypass the base method's error swallowing by catching the nodemailer
 * error at this layer. We do this by calling a private helper that wraps
 * the transporter.sendMail call directly.
 */
export async function sendEmailWithOAuthRetry(
    params: OAuthRetryParams,
): Promise<{ success: boolean; messageId?: string }> {
    const tokenManager = getAuthTokenManager();
    const db = getDatabase();
    const account = db
        .prepare('SELECT email FROM accounts WHERE id = ?')
        .get(params.accountId) as { email: string } | undefined;

    if (!account) {
        logDebug(`[smtp-oauth-retry] account not found: ${params.accountId}`);
        return { success: false };
    }

    // First attempt.
    let firstToken: string;
    try {
        const tokenResult = await tokenManager.getValidAccessToken(params.accountId);
        firstToken = tokenResult.accessToken;
    } catch (err) {
        // PermanentAuthError or TransientAuthError from the token manager.
        // We do not retry — no amount of retries will fix a revoked refresh
        // token or a network outage here.
        logDebug(
            `[smtp-oauth-retry] token fetch failed on first attempt: ${err instanceof Error ? err.message : String(err)}`,
        );
        return { success: false };
    }

    const firstResult = await attemptXoauth2Send(params, account.email, firstToken);
    if (firstResult.success) return firstResult;

    if (!firstResult.authError) {
        // Non-auth failure — do not retry.
        logDebug('[smtp-oauth-retry] non-auth failure on first attempt; not retrying');
        return { success: false };
    }

    // Auth error on first attempt — invalidate + retry once.
    logDebug('[smtp-oauth-retry] EAUTH on first attempt; invalidating token and retrying');
    try {
        await tokenManager.invalidateToken(params.accountId);
    } catch (err) {
        logDebug(
            `[smtp-oauth-retry] invalidateToken failed (continuing anyway): ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Second attempt (exactly one retry per D5.1).
    let secondToken: string;
    try {
        const tokenResult = await tokenManager.getValidAccessToken(params.accountId);
        secondToken = tokenResult.accessToken;
    } catch (err) {
        logDebug(
            `[smtp-oauth-retry] token fetch failed on second attempt: ${err instanceof Error ? err.message : String(err)}`,
        );
        return { success: false };
    }

    const secondResult = await attemptXoauth2Send(params, account.email, secondToken);
    if (!secondResult.success) {
        logDebug('[smtp-oauth-retry] second attempt also failed; giving up');
    }
    return { success: secondResult.success, messageId: secondResult.messageId };
}

/**
 * Internal helper: attempt one XOAUTH2 send and classify the error.
 *
 * Unlike SmtpEngine.sendEmail (which swallows all errors as { success: false }),
 * this helper distinguishes auth errors from other failures so the retry wrapper
 * can decide whether to refresh and retry.
 */
interface AttemptResult {
    success: boolean;
    messageId?: string;
    authError?: boolean;
}

async function attemptXoauth2Send(
    params: OAuthRetryParams,
    user: string,
    accessToken: string,
): Promise<AttemptResult> {
    const db = getDatabase();
    const account = db
        .prepare(
            'SELECT id, email, password_encrypted, provider, display_name, smtp_host, smtp_port FROM accounts WHERE id = ?',
        )
        .get(params.accountId) as Record<string, unknown> | undefined;

    if (!account) return { success: false };

    const host = (account.smtp_host as string) ||
        (account.provider === 'gmail' ? 'smtp.gmail.com' : 'smtp.example.com');
    const port = (account.smtp_port as number) || 465;

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
            type: 'OAuth2',
            user,
            accessToken,
        },
    });

    try {
        const displayName = (account.display_name as string) || (account.email as string);
        const info = await transporter.sendMail({
            from: {
                name: displayName,
                address: account.email as string,
            },
            to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
            cc: params.cc ? (Array.isArray(params.cc) ? params.cc.join(', ') : params.cc) : undefined,
            bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc.join(', ') : params.bcc) : undefined,
            subject: params.subject,
            html: params.html,
            attachments: params.attachments?.map(att => ({
                filename: att.filename,
                content: Buffer.from(att.content, 'base64'),
                contentType: att.contentType,
            })),
        });
        return { success: true, messageId: info.messageId };
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const msg = err instanceof Error ? err.message : String(err);
        const isAuth =
            code === 'EAUTH' ||
            /\b535\b/.test(msg) ||
            /\bauthentication\b/i.test(msg);
        logDebug(`[smtp-oauth-retry] send error: ${msg} (authClassified=${isAuth})`);
        return { success: false, authError: isAuth };
    }
}
