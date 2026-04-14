import { describe, it, expect, afterEach, vi } from 'vitest';
import nock from 'nock';
import { sendViaGraph } from './graphSend.js';
import type { SendMailParams } from './sendMail.js';

vi.mock('./logger.js', () => ({
    logDebug: vi.fn(),
}));

const GRAPH_HOST = 'https://graph.microsoft.com';
const SEND_PATH = '/v1.0/me/sendMail';

const baseParams: SendMailParams = {
    accountId: 'acc-ms-1',
    to: ['recipient@example.com'],
    subject: 'Test subject',
    html: '<p>Hello</p>',
};

afterEach(() => {
    nock.cleanAll();
});

describe('sendViaGraph — happy path', () => {
    it('POSTs to the correct Graph endpoint with Bearer token and returns a synthesized messageId', async () => {
        const scope = nock(GRAPH_HOST)
            .post(SEND_PATH)
            .reply(202);

        const result = await sendViaGraph(baseParams, 'test-access-token');

        expect(scope.isDone()).toBe(true);
        expect(result.messageId).toMatch(/^graph-/);
        expect(result.accepted).toContain('recipient@example.com');
        expect(result.rejected).toHaveLength(0);
    });

    it('sets the Authorization header to "Bearer <accessToken>"', async () => {
        let capturedAuth: string | undefined;
        nock(GRAPH_HOST)
            .post(SEND_PATH)
            .reply(function () {
                const hdr = this.req.headers['authorization'];
                capturedAuth = Array.isArray(hdr) ? hdr[0] : hdr;
                return [202];
            });

        await sendViaGraph(baseParams, 'my-access-token');

        expect(capturedAuth).toBe('Bearer my-access-token');
    });

    it('sets Content-Type to application/json', async () => {
        let capturedContentType: string | undefined;
        nock(GRAPH_HOST)
            .post(SEND_PATH)
            .reply(function () {
                const hdr = this.req.headers['content-type'];
                capturedContentType = Array.isArray(hdr) ? hdr[0] : hdr;
                return [202];
            });

        await sendViaGraph(baseParams, 'at');

        expect(capturedContentType ?? '').toContain('application/json');
    });

    it('builds toRecipients array in correct Graph schema', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph({ ...baseParams, to: ['a@x.com', 'b@y.com'] }, 'at');

        const msg = (body.message as Record<string, unknown>);
        const toRecipients = msg.toRecipients as Array<{ emailAddress: { address: string } }>;
        expect(toRecipients).toHaveLength(2);
        expect(toRecipients[0].emailAddress.address).toBe('a@x.com');
        expect(toRecipients[1].emailAddress.address).toBe('b@y.com');
    });

    it('builds ccRecipients and bccRecipients correctly', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph({
            ...baseParams,
            cc: ['cc@x.com'],
            bcc: ['bcc@y.com'],
        }, 'at');

        const msg = (body.message as Record<string, unknown>);
        expect((msg.ccRecipients as Array<unknown>)[0]).toMatchObject(
            { emailAddress: { address: 'cc@x.com' } }
        );
        expect((msg.bccRecipients as Array<unknown>)[0]).toMatchObject(
            { emailAddress: { address: 'bcc@y.com' } }
        );
    });

    it('sets saveToSentItems to true in the request body', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph(baseParams, 'at');

        expect(body.saveToSentItems).toBe(true);
    });

    it('sets body.contentType to HTML', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph(baseParams, 'at');

        const emailBody = (body.message as Record<string, unknown>).body as Record<string, unknown>;
        expect(emailBody.contentType).toBe('HTML');
        expect(emailBody.content).toBe('<p>Hello</p>');
    });

    it('returned accepted array includes cc and bcc recipients', async () => {
        nock(GRAPH_HOST).post(SEND_PATH).reply(202);

        const result = await sendViaGraph({
            ...baseParams,
            cc: ['cc@x.com'],
            bcc: ['bcc@y.com'],
        }, 'at');

        expect(result.accepted).toEqual(expect.arrayContaining([
            'recipient@example.com',
            'cc@x.com',
            'bcc@y.com',
        ]));
    });
});

describe('sendViaGraph — attachment encoding', () => {
    it('base64-encodes Buffer attachments and sets @odata.type', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        const buf = Buffer.from('PDF content here');
        await sendViaGraph({
            ...baseParams,
            attachments: [{ filename: 'doc.pdf', content: buf, contentType: 'application/pdf' }],
        }, 'at');

        const msg = body.message as Record<string, unknown>;
        const atts = msg.attachments as Array<Record<string, unknown>>;
        expect(atts).toHaveLength(1);
        expect(atts[0]['@odata.type']).toBe('#microsoft.graph.fileAttachment');
        expect(atts[0].name).toBe('doc.pdf');
        expect(atts[0].contentType).toBe('application/pdf');
        expect(atts[0].contentBytes).toBe(buf.toString('base64'));
    });

    it('sends an empty attachments array when no attachments provided', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph(baseParams, 'at');

        const msg = body.message as Record<string, unknown>;
        expect(msg.attachments).toEqual([]);
    });

    it('defaults contentType to application/octet-stream when not provided', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph({
            ...baseParams,
            attachments: [{ filename: 'unknown.bin', content: Buffer.from('x') }],
        }, 'at');

        const atts = (body.message as Record<string, unknown>).attachments as Array<Record<string, unknown>>;
        expect(atts[0].contentType).toBe('application/octet-stream');
    });
});

describe('sendViaGraph — error handling', () => {
    it('throws on 401 so the dispatcher can invalidate + retry', async () => {
        nock(GRAPH_HOST).post(SEND_PATH).reply(401, {
            error: { code: 'InvalidAuthenticationToken', message: 'Access token expired.' },
        });

        await expect(sendViaGraph(baseParams, 'stale-token')).rejects.toThrow(/401/);
    });

    it('throws on 400 with the Graph error code in the message', async () => {
        nock(GRAPH_HOST).post(SEND_PATH).reply(400, {
            error: { code: 'RequestBodyRead', message: 'Invalid body' },
        });

        await expect(sendViaGraph(baseParams, 'at')).rejects.toThrow(/RequestBodyRead/);
    });

    it('throws a transient error on 500', async () => {
        nock(GRAPH_HOST).post(SEND_PATH).reply(500, {
            error: { code: 'ServiceNotAvailable', message: 'Server busy' },
        });

        await expect(sendViaGraph(baseParams, 'at')).rejects.toThrow(/500/);
    });

    it('throws on network failure (nock disables the request)', async () => {
        nock(GRAPH_HOST).post(SEND_PATH).replyWithError('ECONNREFUSED');

        await expect(sendViaGraph(baseParams, 'at')).rejects.toThrow();
    });
});

describe('sendViaGraph — CRLF sanitization (defense-in-depth)', () => {
    it('strips CRLF from subject before sending', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph({ ...baseParams, subject: 'Injected\r\nX-Header: evil' }, 'at');

        const msg = body.message as Record<string, unknown>;
        expect(msg.subject as string).toBe('InjectedX-Header: evil');
    });

    it('strips CRLF from recipient addresses', async () => {
        let body: Record<string, unknown> = {};
        nock(GRAPH_HOST)
            .post(SEND_PATH, (b: Record<string, unknown>) => { body = b; return true; })
            .reply(202);

        await sendViaGraph({ ...baseParams, to: ['evil\r\nrecip@x.com'] }, 'at');

        const msg = body.message as Record<string, unknown>;
        const toRecipients = msg.toRecipients as Array<{ emailAddress: { address: string } }>;
        expect(toRecipients[0].emailAddress.address).toBe('evilrecip@x.com');
    });
});
