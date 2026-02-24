import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbAll = vi.fn();
const mockDbGet = vi.fn();
const mockDbRun = vi.fn();

const mockDb = {
    prepare: vi.fn(() => ({
        all: mockDbAll,
        get: mockDbGet,
        run: mockDbRun,
    })),
};

vi.mock('./smtp.js', () => {
    const sendEmail = vi.fn().mockResolvedValue(true);
    return { smtpEngine: { sendEmail } };
});

vi.mock('./utils.js', () => ({
    sanitizeFts5Query: (raw: string) => raw.trim(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let smtpSendEmail: any;
beforeEach(async () => {
    vi.clearAllMocks();
    mockDbAll.mockReturnValue([]);
    mockDbGet.mockReturnValue(null);
    mockDbRun.mockReturnValue({ changes: 1 });
    const smtp = await import('./smtp.js');
    smtpSendEmail = smtp.smtpEngine.sendEmail;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = mockDb as any;

import { buildToolRegistry } from './mcpTools';

function getHandler(name: string) {
    const tools = buildToolRegistry();
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found in registry`);
    return tool.handler;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('buildToolRegistry', () => {
    it('returns a Map with 8 tools', () => {
        const tools = buildToolRegistry();
        expect(tools.size).toBe(8);
        expect([...tools.keys()]).toEqual(expect.arrayContaining([
            'search_emails', 'read_thread', 'send_email', 'create_draft',
            'get_smart_summary', 'categorize_email', 'get_email_analytics', 'suggest_reply',
        ]));
    });

    it('each tool has description, inputSchema, and handler', () => {
        const tools = buildToolRegistry();
        for (const [, def] of tools) {
            expect(def.description).toBeTruthy();
            expect(def.inputSchema).toBeTruthy();
            expect(typeof def.handler).toBe('function');
        }
    });
});

// ---------------------------------------------------------------------------
// search_emails
// ---------------------------------------------------------------------------

describe('search_emails handler', () => {
    it('returns results from FTS5 join', async () => {
        const handler = getHandler('search_emails');
        mockDbAll.mockReturnValue([{ id: 'e1', subject: 'Test' }]);

        const result = await handler({ query: 'test' }, db);
        expect(result.isError).toBeFalsy();
        expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'e1', subject: 'Test' }]);
    });

    it('returns empty array for empty sanitized query', async () => {
        const handler = getHandler('search_emails');
        const result = await handler({ query: '   ' }, db);
        expect(JSON.parse(result.content[0].text)).toEqual([]);
    });

    it('rejects non-string query', async () => {
        const handler = getHandler('search_emails');
        await expect(handler({ query: 123 }, db)).rejects.toThrow('query must be a string');
    });

    it('handles FTS5 query syntax error gracefully', async () => {
        const handler = getHandler('search_emails');
        mockDbAll.mockImplementation(() => { throw new Error('fts5: syntax error'); });
        const result = await handler({ query: 'bad query' }, db);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Search failed');
    });
});

// ---------------------------------------------------------------------------
// read_thread
// ---------------------------------------------------------------------------

describe('read_thread handler', () => {
    it('returns thread emails sorted by date', async () => {
        const handler = getHandler('read_thread');
        mockDbAll.mockReturnValue([{ id: 'e1', thread_id: 't1' }, { id: 'e2', thread_id: 't1' }]);

        const result = await handler({ thread_id: 't1' }, db);
        const data = JSON.parse(result.content[0].text);
        expect(data).toHaveLength(2);
    });

    it('rejects non-string thread_id', async () => {
        const handler = getHandler('read_thread');
        await expect(handler({ thread_id: 42 }, db)).rejects.toThrow('thread_id must be a string');
    });
});

// ---------------------------------------------------------------------------
// send_email
// ---------------------------------------------------------------------------

describe('send_email handler', () => {
    it('sends email via SMTP engine', async () => {
        const handler = getHandler('send_email');
        const result = await handler({
            account_id: 'acc1', to: ['user@example.com'], subject: 'Hi', html: '<p>Hello</p>'
        }, db);
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain('Email sent');
        expect(smtpSendEmail).toHaveBeenCalled();
    });

    it('rejects when recipients are empty after sanitization', async () => {
        const handler = getHandler('send_email');
        await expect(handler({
            account_id: 'acc1', to: ['', '  '], subject: 'Hi', html: '<p>Hello</p>'
        }, db)).rejects.toThrow('No valid recipients');
    });

    it('rejects more than 10 attachments', async () => {
        const handler = getHandler('send_email');
        const atts = Array.from({ length: 11 }, (_, i) => ({
            filename: `file${i}.txt`, content: 'YQ==', contentType: 'text/plain'
        }));
        await expect(handler({
            account_id: 'acc1', to: ['a@b.com'], subject: 'Hi', html: '<p>Hi</p>', attachments: atts
        }, db)).rejects.toThrow('Maximum 10 attachments');
    });

    it('rejects non-array to field', async () => {
        const handler = getHandler('send_email');
        await expect(handler({
            account_id: 'acc1', to: 'bad', subject: 'S', html: '<p>H</p>'
        }, db)).rejects.toThrow('Invalid arguments');
    });

    it('returns failure when SMTP returns false', async () => {
        const handler = getHandler('send_email');
        smtpSendEmail.mockResolvedValueOnce(false);
        const result = await handler({
            account_id: 'acc1', to: ['user@example.com'], subject: 'Hi', html: '<p>Hi</p>'
        }, db);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Failed to send');
    });
});

// ---------------------------------------------------------------------------
// create_draft
// ---------------------------------------------------------------------------

describe('create_draft handler', () => {
    it('creates a draft when account exists', async () => {
        const handler = getHandler('create_draft');
        mockDbGet.mockReturnValue({ id: 'acc1' });

        const result = await handler({
            account_id: 'acc1', to: ['user@example.com'], subject: 'Draft', html: '<p>Draft body</p>'
        }, db);

        expect(result.content[0].text).toContain('Draft created');
        expect(mockDbRun).toHaveBeenCalled();
    });

    it('rejects when account not found', async () => {
        const handler = getHandler('create_draft');
        mockDbGet.mockReturnValue(null);

        await expect(handler({
            account_id: 'nonexistent', to: ['a@b.com'], subject: 'S', html: '<p>B</p>'
        }, db)).rejects.toThrow('Account not found');
    });

    it('rejects invalid arguments', async () => {
        const handler = getHandler('create_draft');
        await expect(handler({ account_id: 'acc1' }, db)).rejects.toThrow('Invalid arguments');
    });
});

// ---------------------------------------------------------------------------
// get_smart_summary
// ---------------------------------------------------------------------------

describe('get_smart_summary handler', () => {
    it('returns rich summary data when account exists', async () => {
        const handler = getHandler('get_smart_summary');
        mockDbGet.mockReturnValue({ id: 'acc1', email: 'test@ex.com', count: 5 });
        mockDbAll.mockReturnValue([{ id: 'e1', subject: 'Hello' }]);

        const result = await handler({ account_id: 'acc1' }, db);
        const data = JSON.parse(result.content[0].text);

        expect(data.account_email).toBe('test@ex.com');
        expect(data.recent_emails).toBeDefined();
        expect(data.flagged_emails).toBeDefined();
        expect(data.high_priority_emails).toBeDefined();
        expect(data.folder_distribution).toBeDefined();
        expect(data.pending_drafts).toBeDefined();
    });

    it('rejects when account not found', async () => {
        const handler = getHandler('get_smart_summary');
        mockDbGet.mockReturnValue(null);
        await expect(handler({ account_id: 'nope' }, db)).rejects.toThrow('Account not found');
    });

    it('rejects non-string account_id', async () => {
        const handler = getHandler('get_smart_summary');
        await expect(handler({ account_id: 123 }, db)).rejects.toThrow();
    });
});

// ---------------------------------------------------------------------------
// categorize_email
// ---------------------------------------------------------------------------

describe('categorize_email handler', () => {
    it('updates email category and priority', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc1' });

        const result = await handler({
            account_id: 'acc1', email_id: 'e1', category: 'work', priority: 3
        }, db);

        expect(result.content[0].text).toContain('categorized');
        expect(result.content[0].text).toContain('work');
        expect(mockDbRun).toHaveBeenCalled();
    });

    it('updates labels only', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc1' });

        const result = await handler({
            account_id: 'acc1', email_id: 'e1', labels: ['urgent', 'from-boss']
        }, db);

        expect(result.content[0].text).toContain('categorized');
    });

    it('rejects when email not found', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue(null);
        await expect(handler({ account_id: 'acc1', email_id: 'nope', category: 'x' }, db)).rejects.toThrow('Email not found');
    });

    it('rejects when email belongs to different account', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc2' });
        await expect(handler({ account_id: 'acc1', email_id: 'e1', category: 'x' }, db)).rejects.toThrow('does not belong');
    });

    it('rejects out-of-range priority', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc1' });
        await expect(handler({ account_id: 'acc1', email_id: 'e1', priority: 5 }, db)).rejects.toThrow('Priority must be');
    });

    it('rejects priority of 0', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc1' });
        await expect(handler({ account_id: 'acc1', email_id: 'e1', priority: 0 }, db)).rejects.toThrow('Priority must be');
    });

    it('rejects when no categorization data provided', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc1' });
        await expect(handler({ account_id: 'acc1', email_id: 'e1' }, db)).rejects.toThrow('At least one of');
    });

    it('caps category to 50 chars', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc1' });
        const longCategory = 'a'.repeat(100);

        await handler({ account_id: 'acc1', email_id: 'e1', category: longCategory }, db);
        const runArgs = mockDbRun.mock.calls[0];
        expect((runArgs[0] as string).length).toBe(50);
    });

    it('caps labels to 20 items', async () => {
        const handler = getHandler('categorize_email');
        mockDbGet.mockReturnValue({ id: 'e1', account_id: 'acc1' });
        const manyLabels = Array.from({ length: 30 }, (_, i) => `label${i}`);

        await handler({ account_id: 'acc1', email_id: 'e1', labels: manyLabels }, db);
        const runArgs = mockDbRun.mock.calls[0];
        const stored = JSON.parse(runArgs[0] as string);
        expect(stored).toHaveLength(20);
    });

    it('rejects missing account_id', async () => {
        const handler = getHandler('categorize_email');
        await expect(handler({ email_id: 'e1', category: 'x' }, db)).rejects.toThrow('account_id must be a string');
    });
});

// ---------------------------------------------------------------------------
// get_email_analytics
// ---------------------------------------------------------------------------

describe('get_email_analytics handler', () => {
    it('returns analytics for valid account', async () => {
        const handler = getHandler('get_email_analytics');
        mockDbGet.mockReturnValue({ id: 'acc1', count: 42 });
        mockDbAll.mockReturnValue([]);

        const result = await handler({ account_id: 'acc1' }, db);
        const data = JSON.parse(result.content[0].text);

        expect(data.period_days).toBe(30);
        expect(data.per_folder).toBeDefined();
        expect(data.top_senders).toBeDefined();
        expect(data.busiest_hours).toBeDefined();
        expect(data.category_distribution).toBeDefined();
    });

    it('clamps days to 1-90 range', async () => {
        const handler = getHandler('get_email_analytics');
        mockDbGet.mockReturnValue({ id: 'acc1', count: 0 });
        mockDbAll.mockReturnValue([]);

        const result1 = await handler({ account_id: 'acc1', days: 0 }, db);
        expect(JSON.parse(result1.content[0].text).period_days).toBe(1);

        const result2 = await handler({ account_id: 'acc1', days: 200 }, db);
        expect(JSON.parse(result2.content[0].text).period_days).toBe(90);
    });

    it('rejects when account not found', async () => {
        const handler = getHandler('get_email_analytics');
        mockDbGet.mockReturnValue(null);
        await expect(handler({ account_id: 'nope' }, db)).rejects.toThrow('Account not found');
    });
});

// ---------------------------------------------------------------------------
// suggest_reply
// ---------------------------------------------------------------------------

describe('suggest_reply handler', () => {
    it('returns context for reply generation', async () => {
        const handler = getHandler('suggest_reply');
        mockDbGet.mockReturnValueOnce({
            id: 'e1', account_id: 'acc1', thread_id: 't1',
            subject: 'Hello', from_name: 'Alice', from_email: 'alice@ex.com',
            to_email: 'me@ex.com', date: '2026-01-01', body_text: 'Hi there',
            ai_category: null, ai_priority: null,
        }).mockReturnValueOnce({ email: 'me@ex.com', display_name: 'Me' });
        mockDbAll.mockReturnValue([]);

        const result = await handler({ account_id: 'acc1', email_id: 'e1', tone: 'casual' }, db);
        const data = JSON.parse(result.content[0].text);

        expect(data.email.from_email).toBe('alice@ex.com');
        expect(data.requested_tone).toBe('casual');
        expect(data.hint).toContain('create_draft');
        expect(data.account.email).toBe('me@ex.com');
    });

    it('rejects when email not found', async () => {
        const handler = getHandler('suggest_reply');
        mockDbGet.mockReturnValue(null);
        await expect(handler({ account_id: 'acc1', email_id: 'nope' }, db)).rejects.toThrow('Email not found');
    });

    it('rejects when email belongs to different account', async () => {
        const handler = getHandler('suggest_reply');
        mockDbGet.mockReturnValue({
            id: 'e1', account_id: 'acc2', thread_id: null,
            subject: 'Test', from_name: 'A', from_email: 'a@b.com',
            to_email: 'me@b.com', date: '2026-01-01', body_text: 'Hi',
            ai_category: null, ai_priority: null,
        });
        await expect(handler({ account_id: 'acc1', email_id: 'e1' }, db)).rejects.toThrow('does not belong');
    });

    it('rejects missing account_id', async () => {
        const handler = getHandler('suggest_reply');
        await expect(handler({ email_id: 'e1' }, db)).rejects.toThrow('account_id must be a string');
    });

    it('caps instructions to 500 chars', async () => {
        const handler = getHandler('suggest_reply');
        mockDbGet.mockReturnValueOnce({
            id: 'e1', account_id: 'acc1', thread_id: null,
            subject: 'Test', from_name: 'A', from_email: 'a@b.com',
            to_email: 'me@b.com', date: '2026-01-01', body_text: 'Hi',
            ai_category: null, ai_priority: null,
        }).mockReturnValueOnce({ email: 'me@b.com', display_name: 'Me' });
        mockDbAll.mockReturnValue([]);

        const longInstructions = 'x'.repeat(1000);
        const result = await handler({ account_id: 'acc1', email_id: 'e1', instructions: longInstructions }, db);
        const data = JSON.parse(result.content[0].text);
        expect(data.instructions.length).toBe(500);
    });

    it('defaults tone to professional when not specified', async () => {
        const handler = getHandler('suggest_reply');
        mockDbGet.mockReturnValueOnce({
            id: 'e1', account_id: 'acc1', thread_id: null,
            subject: 'Test', from_name: 'A', from_email: 'a@b.com',
            to_email: 'me@b.com', date: '2026-01-01', body_text: 'Hi',
            ai_category: null, ai_priority: null,
        }).mockReturnValueOnce({ email: 'me@b.com', display_name: 'Me' });
        mockDbAll.mockReturnValue([]);

        const result = await handler({ account_id: 'acc1', email_id: 'e1' }, db);
        const data = JSON.parse(result.content[0].text);
        expect(data.requested_tone).toBe('professional');
    });

    it('truncates body_text to 2000 chars', async () => {
        const handler = getHandler('suggest_reply');
        const longBody = 'x'.repeat(5000);
        mockDbGet.mockReturnValueOnce({
            id: 'e1', account_id: 'acc1', thread_id: null,
            subject: 'Test', from_name: 'A', from_email: 'a@b.com',
            to_email: 'me@b.com', date: '2026-01-01', body_text: longBody,
            ai_category: null, ai_priority: null,
        }).mockReturnValueOnce({ email: 'me@b.com', display_name: 'Me' });
        mockDbAll.mockReturnValue([]);

        const result = await handler({ account_id: 'acc1', email_id: 'e1' }, db);
        const data = JSON.parse(result.content[0].text);
        expect(data.email.body_text.length).toBe(2000);
    });
});
