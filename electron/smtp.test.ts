import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// vi.mock factories are hoisted to the top of the file, so shared mock fns
// must be declared with `var` (hoisted) or via vi.hoisted().
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockSendMail: any;
mockSendMail = vi.fn();

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockCreateTransport: any;
mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }));

vi.mock('nodemailer', () => ({
    default: {
        createTransport: (...args: unknown[]) => mockCreateTransport(...args),
    },
}));

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockDecryptData: any;
mockDecryptData = vi.fn((buf: Buffer) => buf.toString('utf-8'));

vi.mock('./crypto.js', () => ({
    decryptData: (...args: unknown[]) => mockDecryptData(...args),
}));

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockDbGet: any;
mockDbGet = vi.fn();

vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => ({ get: mockDbGet })),
    })),
}));

vi.mock('./logger.js', () => ({
    logDebug: vi.fn(),
}));

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockGetValidAccessToken: any;
mockGetValidAccessToken = vi.fn();

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockInvalidateToken: any;
mockInvalidateToken = vi.fn();

vi.mock('./auth/tokenManager.js', () => ({
    getAuthTokenManager: () => ({
        getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
        invalidateToken: (...args: unknown[]) => mockInvalidateToken(...args),
    }),
}));

// Import after mocks are registered
import { SmtpEngine, sendEmailWithOAuthRetry } from './smtp';

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

const BASE_ACCOUNT = {
    id: 'acc-1',
    email: 'sender@example.com',
    password_encrypted: Buffer.from('test-password', 'utf-8').toString('base64'),
    provider: 'gmail',
    display_name: 'Test Sender',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
};

describe('SmtpEngine.sendEmail', () => {
    let engine: SmtpEngine;

    beforeEach(() => {
        vi.clearAllMocks();
        engine = new SmtpEngine();
        // Restore defaults after clearAllMocks wipes them
        mockDbGet.mockReturnValue(BASE_ACCOUNT);
        mockSendMail.mockResolvedValue({ messageId: '<abc@smtp>' });
        mockDecryptData.mockImplementation((buf: Buffer) => buf.toString('utf-8'));
        mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }));
    });

    // -------------------------------------------------------------------------
    // Guard: account resolution errors
    // -------------------------------------------------------------------------

    it('throws when account is not found in the database', async () => {
        mockDbGet.mockReturnValue(undefined);
        await expect(engine.sendEmail('missing', 'to@test.com', 'Sub', '<p>body</p>'))
            .rejects.toThrow('Account not found');
    });

    it('throws when account has no stored password', async () => {
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, password_encrypted: null });
        await expect(engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>body</p>'))
            .rejects.toThrow('No password stored for account');
    });

    // -------------------------------------------------------------------------
    // Transporter creation
    // -------------------------------------------------------------------------

    it('creates transporter with secure:true for port 465', async () => {
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, smtp_port: 465 });
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
        }));
    });

    it('creates transporter with secure:false for port 587 (STARTTLS)', async () => {
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, smtp_port: 587, smtp_host: 'smtp.gmail.com' });
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
            port: 587,
            secure: false,
        }));
    });

    it('falls back to port 465 when smtp_port is null', async () => {
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, smtp_port: null });
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465 }));
    });

    it('falls back to smtp.gmail.com for gmail when smtp_host is null', async () => {
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, smtp_host: null, provider: 'gmail' });
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
            host: 'smtp.gmail.com',
        }));
    });

    it('falls back to smtp.example.com for non-gmail when smtp_host is null', async () => {
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, smtp_host: null, provider: 'outlook' });
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
            host: 'smtp.example.com',
        }));
    });

    it('passes decrypted password to transporter auth', async () => {
        const base64Password = Buffer.from('my-secret-pass', 'utf-8').toString('base64');
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, password_encrypted: base64Password });
        mockDecryptData.mockReturnValue('my-secret-pass');
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
            auth: expect.objectContaining({ pass: 'my-secret-pass' }),
        }));
    });

    // -------------------------------------------------------------------------
    // sendMail payload: recipients
    // -------------------------------------------------------------------------

    it('returns success:true on successful send with a string recipient', async () => {
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Hello', '<p>hi</p>');
        expect(result).toEqual({ success: true, messageId: '<abc@smtp>' });
        expect(mockSendMail).toHaveBeenCalledOnce();
    });

    it('joins array recipients into a comma-separated string for To', async () => {
        await engine.sendEmail('acc-1', ['a@test.com', 'b@test.com'], 'Sub', '<p>hi</p>');
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'a@test.com, b@test.com',
        }));
    });

    it('passes a single string recipient directly', async () => {
        await engine.sendEmail('acc-1', 'only@test.com', 'Sub', '<p>hi</p>');
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'only@test.com',
        }));
    });

    it('includes CC when provided as string', async () => {
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>', 'cc@test.com');
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            cc: 'cc@test.com',
        }));
    });

    it('joins CC array into comma-separated string', async () => {
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>', ['cc1@test.com', 'cc2@test.com']);
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            cc: 'cc1@test.com, cc2@test.com',
        }));
    });

    it('sets CC to undefined when not provided', async () => {
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            cc: undefined,
        }));
    });

    it('includes BCC when provided as array', async () => {
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>', undefined, ['bcc@test.com']);
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            bcc: 'bcc@test.com',
        }));
    });

    it('sets BCC to undefined when not provided', async () => {
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            bcc: undefined,
        }));
    });

    // -------------------------------------------------------------------------
    // sendMail payload: from address
    // -------------------------------------------------------------------------

    it('uses display_name + email as from object', async () => {
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            from: { name: 'Test Sender', address: 'sender@example.com' },
        }));
    });

    it('falls back to email address when display_name is null', async () => {
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, display_name: null });
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            from: { name: 'sender@example.com', address: 'sender@example.com' },
        }));
    });

    // -------------------------------------------------------------------------
    // sendMail payload: attachments
    // -------------------------------------------------------------------------

    it('converts base64 attachment content to a Buffer for Nodemailer', async () => {
        const attachments = [
            { filename: 'doc.pdf', content: Buffer.from('PDF content').toString('base64'), contentType: 'application/pdf' },
        ];
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>', undefined, undefined, attachments);
        const call = mockSendMail.mock.calls[0][0];
        expect(call.attachments).toHaveLength(1);
        expect(call.attachments[0].filename).toBe('doc.pdf');
        expect(call.attachments[0].content).toBeInstanceOf(Buffer);
        expect(call.attachments[0].content.toString()).toBe('PDF content');
        expect(call.attachments[0].contentType).toBe('application/pdf');
    });

    it('sends multiple attachments correctly', async () => {
        const attachments = [
            { filename: 'a.txt', content: Buffer.from('AAA').toString('base64'), contentType: 'text/plain' },
            { filename: 'b.txt', content: Buffer.from('BBB').toString('base64'), contentType: 'text/plain' },
        ];
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>', undefined, undefined, attachments);
        const call = mockSendMail.mock.calls[0][0];
        expect(call.attachments).toHaveLength(2);
        expect(call.attachments[1].filename).toBe('b.txt');
    });

    it('passes undefined attachments to sendMail when none provided', async () => {
        await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        const call = mockSendMail.mock.calls[0][0];
        expect(call.attachments).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // Error handling: sendMail rejection returns false, never rethrows
    // -------------------------------------------------------------------------

    it('returns success:false when nodemailer sendMail throws', async () => {
        mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(result).toEqual({ success: false });
    });

    it('returns success:false for auth failure without rethrowing', async () => {
        mockSendMail.mockRejectedValue(new Error('Invalid login: 535 Authentication failed'));
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(result).toEqual({ success: false });
    });

    it('returns success:false for network timeout without rethrowing', async () => {
        mockSendMail.mockRejectedValue(new Error('Connection timeout'));
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(result).toEqual({ success: false });
    });
});

// ---------------------------------------------------------------------------
// Task 12: XOAUTH2 branch
// ---------------------------------------------------------------------------

describe('SmtpEngine.sendEmail — XOAUTH2 branch', () => {
    let engine: SmtpEngine;

    beforeEach(() => {
        vi.clearAllMocks();
        engine = new SmtpEngine();
        mockDbGet.mockReturnValue(BASE_ACCOUNT);
        mockSendMail.mockResolvedValue({ messageId: '<oauth-id>' });
        mockDecryptData.mockImplementation((buf: Buffer) => buf.toString('utf-8'));
        mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }));
    });

    it('builds { type: "OAuth2", user, accessToken } when xoauth2 auth is supplied', async () => {
        await engine.sendEmail(
            'acc-1', ['to@x.com'], 'Subject', '<p>hi</p>',
            undefined, undefined, undefined,
            { type: 'xoauth2', user: 'user@gmail.com', accessToken: 'at-token' },
        );

        const transportConfig = mockCreateTransport.mock.calls[0][0];
        expect(transportConfig.auth.type).toBe('OAuth2');
        expect(transportConfig.auth.user).toBe('user@gmail.com');
        expect(transportConfig.auth.accessToken).toBe('at-token');
    });

    it('does NOT include a "pass" field in the XOAUTH2 auth config', async () => {
        await engine.sendEmail(
            'acc-1', ['to@x.com'], 'Subject', '<p>hi</p>',
            undefined, undefined, undefined,
            { type: 'xoauth2', user: 'user@gmail.com', accessToken: 'at-token' },
        );

        const transportConfig = mockCreateTransport.mock.calls[0][0];
        expect('pass' in transportConfig.auth).toBe(false);
    });

    it('does NOT decrypt password_encrypted in the XOAUTH2 path', async () => {
        await engine.sendEmail(
            'acc-1', ['to@x.com'], 'Subject', '<p>hi</p>',
            undefined, undefined, undefined,
            { type: 'xoauth2', user: 'user@gmail.com', accessToken: 'at-token' },
        );

        expect(mockDecryptData).not.toHaveBeenCalled();
    });

    it('still requires the account row but does NOT require password_encrypted', async () => {
        // OAuth2 accounts have password_encrypted = null
        mockDbGet.mockReturnValue({ ...BASE_ACCOUNT, password_encrypted: null });
        const result = await engine.sendEmail(
            'acc-1', ['to@x.com'], 'Subject', '<p>hi</p>',
            undefined, undefined, undefined,
            { type: 'xoauth2', user: 'user@gmail.com', accessToken: 'at-token' },
        );
        expect(result.success).toBe(true);
    });

    it('returns { success: true, messageId } when XOAUTH2 send succeeds', async () => {
        const result = await engine.sendEmail(
            'acc-1', ['to@x.com'], 'Subject', '<p>hi</p>',
            undefined, undefined, undefined,
            { type: 'xoauth2', user: 'user@gmail.com', accessToken: 'at-token' },
        );
        expect(result).toEqual({ success: true, messageId: '<oauth-id>' });
    });
});

// ---------------------------------------------------------------------------
// Task 12: sendEmailWithOAuthRetry — on-401 retry wrapper
// ---------------------------------------------------------------------------

describe('sendEmailWithOAuthRetry — on-401 retry wrapper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbGet.mockReturnValue(BASE_ACCOUNT);
        mockDecryptData.mockImplementation((buf: Buffer) => buf.toString('utf-8'));
        mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }));
    });

    it('succeeds on first attempt without invalidating the token', async () => {
        mockSendMail.mockResolvedValueOnce({ messageId: '<ok>' });
        mockGetValidAccessToken.mockResolvedValue({
            accessToken: 'at-1',
            expiresAt: Date.now() + 3600_000,
            provider: 'google',
        });

        const result = await sendEmailWithOAuthRetry({
            accountId: 'acc-1',
            to: ['to@x.com'],
            subject: 'Hello',
            html: '<p>hi</p>',
        });

        expect(result.success).toBe(true);
        expect(mockInvalidateToken).not.toHaveBeenCalled();
        expect(mockSendMail).toHaveBeenCalledTimes(1);
        expect(mockGetValidAccessToken).toHaveBeenCalledTimes(1);
    });

    it('invalidates token and retries once when the first send throws EAUTH', async () => {
        // First sendMail call throws EAUTH; second resolves.
        // We use mockImplementationOnce to chain responses to mocksendmail itself
        // because the SmtpEngine catches and swallows inside try/catch.
        // sendEmailWithOAuthRetry needs to know about the failure. So the wrapper
        // must detect auth errors by re-throwing them from the base. The current
        // base swallows errors and returns { success: false } — so the wrapper
        // detects failure via that and must look at some other signal.
        //
        // Design: the wrapper uses getAuthTokenManager + invokes SmtpEngine.sendEmail
        // directly. On { success: false } from the base, the wrapper invalidates
        // the token, fetches a fresh one, and retries once. If the second attempt
        // also returns { success: false }, it gives up.
        mockSendMail
            .mockResolvedValueOnce(undefined)  // first send: returns undefined → base catches as failure? No.
            .mockResolvedValueOnce({ messageId: '<retry-ok>' });

        // Instead: first call rejects internally (SmtpEngine catches → { success: false }),
        // second call succeeds.
        mockSendMail.mockReset();
        const authError = Object.assign(new Error('535 Authentication failed'), { code: 'EAUTH' });
        mockSendMail
            .mockRejectedValueOnce(authError)
            .mockResolvedValueOnce({ messageId: '<retry-ok>' });

        mockGetValidAccessToken
            .mockResolvedValueOnce({ accessToken: 'at-stale', expiresAt: Date.now() + 3600_000, provider: 'google' })
            .mockResolvedValueOnce({ accessToken: 'at-fresh', expiresAt: Date.now() + 3600_000, provider: 'google' });

        const result = await sendEmailWithOAuthRetry({
            accountId: 'acc-1',
            to: ['to@x.com'],
            subject: 'Hello',
            html: '<p>hi</p>',
        });

        expect(mockInvalidateToken).toHaveBeenCalledOnce();
        expect(mockInvalidateToken).toHaveBeenCalledWith('acc-1');
        expect(mockGetValidAccessToken).toHaveBeenCalledTimes(2);
        expect(mockSendMail).toHaveBeenCalledTimes(2);
        expect(result.success).toBe(true);
        expect(result.messageId).toBe('<retry-ok>');
    });

    it('gives up after second failure and returns { success: false }', async () => {
        const authError = Object.assign(new Error('535 Authentication failed'), { code: 'EAUTH' });
        mockSendMail.mockRejectedValue(authError);
        mockGetValidAccessToken.mockResolvedValue({
            accessToken: 'at-bad',
            expiresAt: Date.now() + 3600_000,
            provider: 'google',
        });

        const result = await sendEmailWithOAuthRetry({
            accountId: 'acc-1',
            to: ['to@x.com'],
            subject: 'Hello',
            html: '<p>hi</p>',
        });

        expect(result.success).toBe(false);
        expect(mockSendMail).toHaveBeenCalledTimes(2);
        expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
    });

    it('returns { success: false } when account row is missing', async () => {
        mockDbGet.mockReturnValue(undefined);

        const result = await sendEmailWithOAuthRetry({
            accountId: 'missing',
            to: ['to@x.com'],
            subject: 'Hello',
            html: '<p>hi</p>',
        });

        expect(result.success).toBe(false);
        expect(mockGetValidAccessToken).not.toHaveBeenCalled();
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('propagates PermanentAuthError from getValidAccessToken without retrying', async () => {
        const permErr = Object.assign(new Error('invalid_grant'), {
            name: 'PermanentAuthError',
            code: 'invalid_grant',
            accountId: 'acc-1',
        });
        mockGetValidAccessToken.mockRejectedValue(permErr);

        const result = await sendEmailWithOAuthRetry({
            accountId: 'acc-1',
            to: ['to@x.com'],
            subject: 'Hello',
            html: '<p>hi</p>',
        });

        // Permanent auth errors surface as { success: false } — the
        // surrounding IPC handler maps the error name to a toast.
        expect(result.success).toBe(false);
        expect(mockSendMail).not.toHaveBeenCalled();
    });
});
