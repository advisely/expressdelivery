import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock handles before any module imports.
// ---------------------------------------------------------------------------
const {
    mockGetDatabase,
    mockGetOAuthCredential,
    mockGetValidAccessToken,
    mockSmtpSendEmail,
    mockGraphSendViaGraph,
} = vi.hoisted(() => ({
    mockGetDatabase: vi.fn(),
    mockGetOAuthCredential: vi.fn(),
    mockGetValidAccessToken: vi.fn(),
    mockSmtpSendEmail: vi.fn(),
    mockGraphSendViaGraph: vi.fn(),
}));

vi.mock('./db.js', () => ({
    getDatabase: mockGetDatabase,
    getOAuthCredential: mockGetOAuthCredential,
}));

vi.mock('./auth/tokenManager.js', async () => {
    const actual = await vi.importActual<typeof import('./auth/tokenManager.js')>('./auth/tokenManager.js');
    return {
        ...actual,
        getAuthTokenManager: () => ({
            getValidAccessToken: mockGetValidAccessToken,
            invalidateToken: vi.fn(),
        }),
    };
});

vi.mock('./smtp.js', () => ({
    smtpEngine: {
        sendEmail: mockSmtpSendEmail,
    },
}));

vi.mock('./graphSend.js', () => ({
    sendViaGraph: mockGraphSendViaGraph,
}));

vi.mock('./logger.js', () => ({
    logDebug: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test — AFTER vi.mock declarations.
// ---------------------------------------------------------------------------
import { sendMail } from './sendMail.js';
import type { SendMailParams } from './sendMail.js';
import { PermanentAuthError, TransientAuthError } from './auth/tokenManager.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'acc-1',
        email: 'user@gmail.com',
        display_name: 'Test User',
        smtp_host: 'smtp.gmail.com',
        smtp_port: 587,
        password_encrypted: 'enc-password',
        auth_type: 'password',
        provider: 'gmail',
        ...overrides,
    };
}

const baseParams: SendMailParams = {
    accountId: 'acc-1',
    to: ['recipient@example.com'],
    subject: 'Hello world',
    html: '<p>Body</p>',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendMail dispatcher — legacy password path', () => {
    beforeEach(() => {
        mockGetValidAccessToken.mockReset();
        mockSmtpSendEmail.mockReset();
        mockGraphSendViaGraph.mockReset();
        mockGetOAuthCredential.mockReturnValue(null);

        const fakeDb = {
            prepare: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue(makeAccount({ auth_type: 'password' })),
            }),
        };
        mockGetDatabase.mockReturnValue(fakeDb);
    });

    it('routes to smtp.sendEmail when getOAuthCredential returns null', async () => {
        mockSmtpSendEmail.mockResolvedValueOnce({ success: true, messageId: '<id@host>' });

        const result = await sendMail(baseParams);

        expect(mockSmtpSendEmail).toHaveBeenCalledOnce();
        expect(mockGraphSendViaGraph).not.toHaveBeenCalled();
        expect(mockGetValidAccessToken).not.toHaveBeenCalled();
        expect(result.messageId).toBe('<id@host>');
        expect(result.accepted).toContain('recipient@example.com');
    });

    it('strips CRLF from recipients and subject before passing to smtp', async () => {
        mockSmtpSendEmail.mockResolvedValueOnce({ success: true, messageId: '<x>' });

        await sendMail({
            accountId: 'acc-1',
            to: ['bad\rnewline@example.com'],
            cc: ['cc\nuser@example.com'],
            bcc: ['bcc\r\nuser@example.com'],
            subject: 'Injected\r\nHeader: evil',
            html: '<p>ok</p>',
        });

        const callArgs = mockSmtpSendEmail.mock.calls[0];
        // to array
        expect(callArgs[1]).toEqual(['badnewline@example.com']);
        // subject
        expect(callArgs[2]).toBe('InjectedHeader: evil');
        // cc
        expect(callArgs[4]).toEqual(['ccuser@example.com']);
        // bcc
        expect(callArgs[5]).toEqual(['bccuser@example.com']);
    });

    it('passes attachments through to smtp as base64-encoded SendAttachment objects', async () => {
        mockSmtpSendEmail.mockResolvedValueOnce({ success: true, messageId: '<y>' });

        const attachment = {
            filename: 'doc.pdf',
            content: Buffer.from('data'),
            contentType: 'application/pdf',
        };

        await sendMail({ ...baseParams, attachments: [attachment] });

        const callArgs = mockSmtpSendEmail.mock.calls[0];
        expect(callArgs[6]).toHaveLength(1);
        expect(callArgs[6][0].filename).toBe('doc.pdf');
        expect(callArgs[6][0].contentType).toBe('application/pdf');
        // content should be base64 of 'data'
        expect(callArgs[6][0].content).toBe(Buffer.from('data').toString('base64'));
    });

    it('returns empty result when account is not found in DB', async () => {
        const fakeDb = {
            prepare: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue(undefined),
            }),
        };
        mockGetDatabase.mockReturnValue(fakeDb);

        const result = await sendMail(baseParams);

        expect(result.accepted).toEqual([]);
        expect(result.rejected).toEqual([]);
        expect(result.messageId).toBeUndefined();
        expect(mockSmtpSendEmail).not.toHaveBeenCalled();
    });

    it('returns empty result on password send failure (success: false)', async () => {
        mockSmtpSendEmail.mockResolvedValueOnce({ success: false });

        const result = await sendMail(baseParams);

        expect(result.accepted).toEqual([]);
        expect(result.rejected).toEqual(['recipient@example.com']);
    });
});

describe('sendMail dispatcher — Google XOAUTH2 path', () => {
    beforeEach(() => {
        mockGetValidAccessToken.mockReset();
        mockSmtpSendEmail.mockReset();
        mockGraphSendViaGraph.mockReset();
        mockGetOAuthCredential.mockReturnValue({ provider: 'google' });

        const fakeDb = {
            prepare: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue(makeAccount({ auth_type: 'oauth2', provider: 'gmail' })),
            }),
        };
        mockGetDatabase.mockReturnValue(fakeDb);
        mockGetValidAccessToken.mockResolvedValue({
            accessToken: 'google-at',
            expiresAt: Date.now() + 3600_000,
            provider: 'google',
        });
    });

    it('fetches access token then routes to smtp.sendEmail with xoauth2 auth arg', async () => {
        mockSmtpSendEmail.mockResolvedValueOnce({ success: true, messageId: '<google-msg>' });

        const result = await sendMail(baseParams);

        expect(mockGetValidAccessToken).toHaveBeenCalledWith('acc-1');
        expect(mockSmtpSendEmail).toHaveBeenCalledOnce();
        const callArgs = mockSmtpSendEmail.mock.calls[0];
        const authArg = callArgs[callArgs.length - 1];
        expect(authArg).toMatchObject({
            type: 'xoauth2',
            user: 'user@gmail.com',
            accessToken: 'google-at',
        });
        expect(mockGraphSendViaGraph).not.toHaveBeenCalled();
        expect(result.messageId).toBe('<google-msg>');
    });

    it('strips CRLF on subject + recipients in XOAUTH2 path', async () => {
        mockSmtpSendEmail.mockResolvedValueOnce({ success: true, messageId: '<x>' });

        await sendMail({
            accountId: 'acc-1',
            to: ['evil\r\nrecip@x.com'],
            subject: 'inject\r\nX-Header: 1',
            html: '<p>hi</p>',
        });

        const callArgs = mockSmtpSendEmail.mock.calls[0];
        expect(callArgs[1]).toEqual(['evilrecip@x.com']);
        expect(callArgs[2]).toBe('injectX-Header: 1');
    });

    it('propagates PermanentAuthError from getValidAccessToken without calling smtp', async () => {
        const err = new PermanentAuthError('invalid_grant', 'invalid_grant', 'acc-1');
        mockGetValidAccessToken.mockRejectedValueOnce(err);

        await expect(sendMail(baseParams)).rejects.toThrow(PermanentAuthError);
        expect(mockSmtpSendEmail).not.toHaveBeenCalled();
    });

    it('propagates TransientAuthError from getValidAccessToken without calling smtp', async () => {
        const err = new TransientAuthError('transient', new Error('network'), 'acc-1');
        mockGetValidAccessToken.mockRejectedValueOnce(err);

        await expect(sendMail(baseParams)).rejects.toThrow(TransientAuthError);
        expect(mockSmtpSendEmail).not.toHaveBeenCalled();
    });
});

describe('sendMail dispatcher — microsoft_business XOAUTH2 path', () => {
    beforeEach(() => {
        mockGetValidAccessToken.mockReset();
        mockSmtpSendEmail.mockReset();
        mockGraphSendViaGraph.mockReset();
        mockGetOAuthCredential.mockReturnValue({ provider: 'microsoft_business' });

        const fakeDb = {
            prepare: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue(makeAccount({
                    auth_type: 'oauth2',
                    provider: 'outlook-business',
                    email: 'user@company.com',
                })),
            }),
        };
        mockGetDatabase.mockReturnValue(fakeDb);
        mockGetValidAccessToken.mockResolvedValue({
            accessToken: 'biz-at',
            expiresAt: Date.now() + 3600_000,
            provider: 'microsoft_business',
        });
    });

    it('routes microsoft_business to smtp.sendEmail (not Graph)', async () => {
        mockSmtpSendEmail.mockResolvedValueOnce({ success: true, messageId: '<biz-msg>' });

        const result = await sendMail({ ...baseParams, accountId: 'acc-1' });

        expect(mockSmtpSendEmail).toHaveBeenCalledOnce();
        expect(mockGraphSendViaGraph).not.toHaveBeenCalled();
        const callArgs = mockSmtpSendEmail.mock.calls[0];
        const authArg = callArgs[callArgs.length - 1];
        expect(authArg).toMatchObject({
            type: 'xoauth2',
            user: 'user@company.com',
            accessToken: 'biz-at',
        });
        expect(result.messageId).toBe('<biz-msg>');
    });
});

describe('sendMail dispatcher — microsoft_personal Graph path', () => {
    beforeEach(() => {
        mockGetValidAccessToken.mockReset();
        mockSmtpSendEmail.mockReset();
        mockGraphSendViaGraph.mockReset();
        mockGetOAuthCredential.mockReturnValue({ provider: 'microsoft_personal' });

        const fakeDb = {
            prepare: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue(makeAccount({
                    auth_type: 'oauth2',
                    provider: 'outlook-personal',
                    email: 'user@hotmail.com',
                })),
            }),
        };
        mockGetDatabase.mockReturnValue(fakeDb);
        mockGetValidAccessToken.mockResolvedValue({
            accessToken: 'ms-personal-at',
            expiresAt: Date.now() + 3600_000,
            provider: 'microsoft_personal',
        });
    });

    it('routes microsoft_personal to sendViaGraph (not smtp)', async () => {
        mockGraphSendViaGraph.mockResolvedValueOnce({
            messageId: 'graph-abc123',
            accepted: ['recipient@example.com'],
            rejected: [],
        });

        const result = await sendMail(baseParams);

        expect(mockGraphSendViaGraph).toHaveBeenCalledOnce();
        expect(mockSmtpSendEmail).not.toHaveBeenCalled();
        expect(result.messageId).toBe('graph-abc123');
        expect(result.accepted).toContain('recipient@example.com');
    });

    it('passes access token to sendViaGraph', async () => {
        mockGraphSendViaGraph.mockResolvedValueOnce({
            messageId: 'graph-xyz',
            accepted: ['recipient@example.com'],
            rejected: [],
        });

        await sendMail(baseParams);

        const callArgs = mockGraphSendViaGraph.mock.calls[0];
        expect(callArgs[0]).toMatchObject({ accountId: 'acc-1' });
        expect(callArgs[1]).toBe('ms-personal-at');
    });

    it('propagates PermanentAuthError from getValidAccessToken without calling Graph', async () => {
        const err = new PermanentAuthError('unauthorized_client', 'unauthorized_client', 'acc-1');
        mockGetValidAccessToken.mockRejectedValueOnce(err);

        await expect(sendMail(baseParams)).rejects.toThrow(PermanentAuthError);
        expect(mockGraphSendViaGraph).not.toHaveBeenCalled();
    });
});
