import nodemailer from 'nodemailer';
import { getDatabase } from './db.js';
import { decryptData } from './crypto.js';
import { logDebug } from './logger.js';

export interface SendAttachment {
    filename: string;
    content: string;       // base64-encoded
    contentType: string;
}

export class SmtpEngine {
    async sendEmail(
        accountId: string,
        to: string | string[],
        subject: string,
        html: string,
        cc?: string | string[],
        bcc?: string | string[],
        attachments?: SendAttachment[]
    ): Promise<boolean> {
        const db = getDatabase();
        const account = db.prepare(
            'SELECT id, email, password_encrypted, provider, display_name, smtp_host, smtp_port FROM accounts WHERE id = ?'
        ).get(accountId) as Record<string, unknown>;

        if (!account) throw new Error('Account not found');

        if (!account.password_encrypted) throw new Error('No password stored for account');
        const password = decryptData(Buffer.from(account.password_encrypted as string, 'base64'));

        const host = (account.smtp_host as string) ||
            (account.provider === 'gmail' ? 'smtp.gmail.com' : 'smtp.example.com');
        const port = (account.smtp_port as number) || 465;

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: {
                user: account.email as string,
                pass: password,
            },
        });

        try {
            const displayName = (account.display_name as string) || (account.email as string);
            await transporter.sendMail({
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

            return true;
        } catch (error) {
            logDebug(`Error sending email: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
}

export const smtpEngine = new SmtpEngine();
