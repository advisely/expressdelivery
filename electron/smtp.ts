import nodemailer from 'nodemailer';
import { getDatabase } from './db.js';
import { decryptData } from './crypto.js';
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
