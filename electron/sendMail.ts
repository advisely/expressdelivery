// sendMail.ts — single outbound mail dispatcher (Phase 2 D6.1, D6.2, D6.6, §7.1).
//
// All call sites that previously imported smtpEngine.sendEmail directly now
// import sendMail from this module. The dispatcher performs one SQL lookup and
// routes to one of two transports:
//
//   1. smtp.ts (Nodemailer) — password accounts + Google XOAUTH2 + MS business XOAUTH2
//   2. graphSend.ts (fetch + Microsoft Graph) — personal Outlook (provider='microsoft_personal')
//
// Per D6.2, this file contains ONLY routing logic. Transport-specific request
// construction lives in smtp.ts and graphSend.ts respectively.
//
// Per D6.3 / D6.5, attachments carry { filename, content: Buffer, contentType }
// and are converted to the transport-specific shape inside the dispatcher.

import { getDatabase, getOAuthCredential } from './db.js';
import { getAuthTokenManager } from './auth/tokenManager.js';
import { smtpEngine } from './smtp.js';
import { sendViaGraph } from './graphSend.js';
import { stripCRLF } from './utils.js';
import { logDebug } from './logger.js';

export interface SendMailParams {
    accountId: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
    }>;
}

export interface SendMailResult {
    messageId?: string;
    accepted: string[];
    rejected: string[];
}

/** Strip CRLF from all addresses in an array. Filters out blanks. */
function sanitizeAddressList(list: string[] | undefined): string[] | undefined {
    if (!list || list.length === 0) return undefined;
    const sanitized = list.map(addr => stripCRLF(addr.trim())).filter(a => a.length > 0);
    return sanitized.length > 0 ? sanitized : undefined;
}

/**
 * Single entry point for all outbound mail.
 *
 * Routing decision (D6.6): based on persisted oauth_credentials.provider,
 * never on token claim inspection at send time.
 *
 *   null credential row             → legacy password path → smtp.ts
 *   provider = 'google'              → XOAUTH2               → smtp.ts
 *   provider = 'microsoft_business'  → XOAUTH2               → smtp.ts
 *   provider = 'microsoft_personal'  → Graph                 → graphSend.ts
 *
 * PermanentAuthError and TransientAuthError from getValidAccessToken propagate
 * to the caller (main.ts IPC handler, scheduler) which surfaces them to the
 * user via toast or retry counter.
 */
export async function sendMail(params: SendMailParams): Promise<SendMailResult> {
    const db = getDatabase();
    const account = db.prepare(
        'SELECT id, email, display_name, smtp_host, smtp_port, password_encrypted, auth_type, provider FROM accounts WHERE id = ?'
    ).get(params.accountId) as Record<string, unknown> | undefined;

    if (!account) {
        logDebug(`[sendMail] account not found: ${params.accountId}`);
        return { accepted: [], rejected: [] };
    }

    // Sanitize recipients and subject against CRLF injection (CWE-93).
    const sanitizedTo = sanitizeAddressList(params.to) ?? [];
    const sanitizedCc = sanitizeAddressList(params.cc);
    const sanitizedBcc = sanitizeAddressList(params.bcc);
    const sanitizedSubject = stripCRLF(params.subject);

    if (sanitizedTo.length === 0) {
        logDebug('[sendMail] no valid recipients after sanitization');
        return { accepted: [], rejected: [] };
    }

    const allAcceptedOnSuccess = [
        ...sanitizedTo,
        ...(sanitizedCc ?? []),
        ...(sanitizedBcc ?? []),
    ];

    // Convert Buffer attachments to the SendAttachment shape used by smtp.ts
    // (base64 string + contentType). graphSend.ts receives the original
    // Buffer-shaped attachments unchanged via the params object.
    const smtpAttachments = params.attachments?.map(att => ({
        filename: att.filename,
        content: att.content.toString('base64'),
        contentType: att.contentType ?? 'application/octet-stream',
    }));

    const cred = getOAuthCredential(db, params.accountId);

    if (cred !== null) {
        // OAuth2 account — fetch a valid access token then route by provider.
        // getValidAccessToken throws PermanentAuthError or TransientAuthError on
        // failure; callers are responsible for catching and surfacing these.
        const tokenManager = getAuthTokenManager();
        const tokenResult = await tokenManager.getValidAccessToken(params.accountId);

        if (cred.provider === 'microsoft_personal') {
            // Personal Outlook: SMTP Basic Auth removed April 2026; use Microsoft Graph.
            // Per D1.3 and D6.4. We pass the sanitized params + original Buffer
            // attachments (graphSend.ts does its own base64 encoding).
            const graphParams: SendMailParams = {
                ...params,
                to: sanitizedTo,
                cc: sanitizedCc,
                bcc: sanitizedBcc,
                subject: sanitizedSubject,
            };
            return sendViaGraph(graphParams, tokenResult.accessToken);
        }

        // Google or microsoft_business: Nodemailer XOAUTH2 path.
        // Per D5.8, the auth object is { type: 'xoauth2', user, accessToken } —
        // Nodemailer handles SASL framing; we never construct the raw XOAUTH2 blob.
        const xoauth2Auth = {
            type: 'xoauth2' as const,
            user: account.email as string,
            accessToken: tokenResult.accessToken,
        };
        const smtpResult = await smtpEngine.sendEmail(
            params.accountId,
            sanitizedTo,
            sanitizedSubject,
            params.html,
            sanitizedCc,
            sanitizedBcc,
            smtpAttachments,
            xoauth2Auth,
        );
        return {
            messageId: smtpResult.messageId,
            accepted: smtpResult.success ? allAcceptedOnSuccess : [],
            rejected: smtpResult.success ? [] : sanitizedTo,
        };
    }

    // Password-mode account (Gmail app-password, Yahoo, iCloud, custom).
    const smtpResult = await smtpEngine.sendEmail(
        params.accountId,
        sanitizedTo,
        sanitizedSubject,
        params.html,
        sanitizedCc,
        sanitizedBcc,
        smtpAttachments,
    );
    return {
        messageId: smtpResult.messageId,
        accepted: smtpResult.success ? allAcceptedOnSuccess : [],
        rejected: smtpResult.success ? [] : sanitizedTo,
    };
}
