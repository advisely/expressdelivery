// graphSend.ts — Microsoft Graph POST /me/sendMail implementation.
//
// Used exclusively for personal Outlook accounts (oauth_credentials.provider
// = 'microsoft_personal') per D1.3 and D6.4. Personal accounts have had SMTP
// Basic Auth removed (April 2026) and Microsoft is phasing out OAuth2 SMTP
// for personal accounts, so we use Microsoft Graph instead.
//
// Per D6.4: raw fetch() only — no @microsoft/microsoft-graph-client dependency.
// One endpoint, stable schema, zero extra bundle weight.
//
// The access token is received from the caller (sendMail.ts dispatcher) which
// fetched it via AuthTokenManager.getValidAccessToken. This module is stateless
// — it contains no token management logic.
//
// Per D9.6: wire-shape is fully tested via nock HTTP interception.

import { randomBytes } from 'crypto';
import { stripCRLF } from './utils.js';
import { logDebug } from './logger.js';
import type { SendMailParams, SendMailResult } from './sendMail.js';

const GRAPH_SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';

interface GraphRecipient {
    emailAddress: { address: string };
}

interface GraphAttachment {
    '@odata.type': '#microsoft.graph.fileAttachment';
    name: string;
    contentType: string;
    contentBytes: string;
}

interface GraphSendBody {
    message: {
        subject: string;
        body: { contentType: 'HTML'; content: string };
        toRecipients: GraphRecipient[];
        ccRecipients: GraphRecipient[];
        bccRecipients: GraphRecipient[];
        attachments: GraphAttachment[];
    };
    saveToSentItems: true;
}

/** Build a Graph recipient object, stripping CRLF from the address (CWE-93 defense-in-depth). */
function toRecipient(addr: string): GraphRecipient {
    return { emailAddress: { address: stripCRLF(addr.trim()) } };
}

/**
 * Send mail via Microsoft Graph POST /me/sendMail.
 *
 * @param params  Normalized send params from the sendMail dispatcher.
 * @param accessToken  Valid OAuth2 access token with Mail.Send scope.
 *
 * @throws on 401 (caller should invalidate + retry), 4xx (permanent error),
 *         5xx or network failure (transient error).
 */
export async function sendViaGraph(
    params: SendMailParams,
    accessToken: string,
): Promise<SendMailResult> {
    const sanitizedSubject = stripCRLF(params.subject);
    const toRecipients = (params.to ?? []).map(toRecipient);
    const ccRecipients = (params.cc ?? []).map(toRecipient);
    const bccRecipients = (params.bcc ?? []).map(toRecipient);

    const attachments: GraphAttachment[] = (params.attachments ?? []).map(att => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.filename,
        contentType: att.contentType ?? 'application/octet-stream',
        // Graph expects base64 string; content is already a Buffer from the dispatcher.
        contentBytes: att.content.toString('base64'),
    }));

    const requestBody: GraphSendBody = {
        message: {
            subject: sanitizedSubject,
            body: { contentType: 'HTML', content: params.html },
            toRecipients,
            ccRecipients,
            bccRecipients,
            attachments,
        },
        saveToSentItems: true,
    };

    let response: Response;
    try {
        response = await fetch(GRAPH_SEND_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });
    } catch (err) {
        // Network-level failure (DNS, connection refused, timeout).
        const msg = err instanceof Error ? err.message : String(err);
        logDebug(`[GRAPH-SEND] network error for account=${params.accountId}: ${msg}`);
        throw new Error(`Graph send network error: ${msg}`);
    }

    if (response.status === 202) {
        // Graph returns 202 Accepted with no body on success.
        const messageId = `graph-${Date.now()}-${randomBytes(4).toString('hex')}`;
        logDebug(`[GRAPH-SEND] success account=${params.accountId} messageId=${messageId}`);
        const accepted = [
            ...toRecipients.map(r => r.emailAddress.address),
            ...ccRecipients.map(r => r.emailAddress.address),
            ...bccRecipients.map(r => r.emailAddress.address),
        ];
        return {
            messageId,
            accepted,
            rejected: [],
        };
    }

    if (response.status === 401) {
        // 401 — the dispatcher will invalidate the token and retry once.
        logDebug(`[GRAPH-SEND] 401 for account=${params.accountId} — token invalidation needed`);
        throw new Error(`Graph send 401: access token rejected`);
    }

    // 4xx (permanent) or 5xx (transient) — parse error body if possible.
    let graphErrorCode = `HTTP ${response.status}`;
    try {
        const errorBody = await response.json() as {
            error?: { code?: string; message?: string };
        };
        if (errorBody.error?.code) {
            graphErrorCode = `${errorBody.error.code} (${response.status})`;
        }
        logDebug(`[GRAPH-SEND] error account=${params.accountId} status=${response.status} code=${errorBody.error?.code ?? 'unknown'}`);
    } catch {
        // Response body not JSON — use the status code alone.
        logDebug(`[GRAPH-SEND] error account=${params.accountId} status=${response.status} body-not-json`);
    }

    throw new Error(`Graph send failed: ${graphErrorCode}`);
}
