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

// Import after mocks are registered
import { SmtpEngine } from './smtp';

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

    it('returns true on successful send with a string recipient', async () => {
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Hello', '<p>hi</p>');
        expect(result).toBe(true);
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

    it('returns false when nodemailer sendMail throws', async () => {
        mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(result).toBe(false);
    });

    it('returns false for auth failure without rethrowing', async () => {
        mockSendMail.mockRejectedValue(new Error('Invalid login: 535 Authentication failed'));
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(result).toBe(false);
    });

    it('returns false for network timeout without rethrowing', async () => {
        mockSendMail.mockRejectedValue(new Error('Connection timeout'));
        const result = await engine.sendEmail('acc-1', 'to@test.com', 'Sub', '<p>hi</p>');
        expect(result).toBe(false);
    });
});
