import nodemailer from 'nodemailer';
import { getDatabase } from './db.js';
import { decryptData } from './crypto.js';

export class SmtpEngine {
    /**
     * Send an email using an account's configured SMTP details.
     */
    async sendEmail(accountId: string, to: string | string[], subject: string, html: string): Promise<boolean> {
        const db = getDatabase();
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Record<string, unknown>;

        if (!account) throw new Error('Account not found');

        const password = decryptData(Buffer.from(account.password_encrypted as string, 'base64'));

        const transporter = nodemailer.createTransport({
            host: account.provider === 'gmail' ? 'smtp.gmail.com' : 'smtp.example.com',
            port: 465,
            secure: true,
            auth: {
                user: account.email as string,
                pass: password,
            },
        });

        try {
            const info = await transporter.sendMail({
                from: `"${(account.name as string) || (account.email as string)}" <${account.email as string}>`,
                to: Array.isArray(to) ? to.join(', ') : to,
                subject,
                html,
            });

            console.log('Message sent: %s', info.messageId);
            return true;
        } catch (error) {
            console.error('Error sending email:', error);
            return false;
        }
    }
}

export const smtpEngine = new SmtpEngine();
