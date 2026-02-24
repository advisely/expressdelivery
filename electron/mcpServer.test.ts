import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockRequestHandler: (req: any) => Promise<{ content: { text: string }[], isError?: boolean }>;

vi.mock('node:crypto', () => ({
    default: {
        randomBytes: vi.fn(() => ({
            toString: vi.fn(() => 'test-token-abc123')
        })),
        randomUUID: vi.fn(() => 'test-draft-uuid'),
    }
}));

vi.mock('express', () => {
    const expressMock = (vi.fn(() => ({
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        listen: vi.fn(),
    })) as unknown) as Record<string, unknown>;
    expressMock.json = vi.fn();
    return { default: expressMock };
});
vi.mock('cors', () => ({ default: vi.fn(() => vi.fn()) }));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
    Server: class {
        setRequestHandler = vi.fn((schema, handler) => {
            if (schema === CallToolRequestSchema) {
                mockRequestHandler = handler;
            }
        });
        connect = vi.fn();
    }
}));

const mockDbAll = vi.fn();
const mockDbRun = vi.fn();
vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => ({
            all: mockDbAll,
            run: mockDbRun,
        }))
    }))
}));

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockSendEmail: any;
mockSendEmail = vi.fn().mockResolvedValue(true);
vi.mock('./smtp.js', () => ({
    smtpEngine: {
        sendEmail: (...args: unknown[]) => mockSendEmail(...args),
    },
}));

vi.mock('./utils.js', () => ({
    sanitizeFts5Query: (raw: string) => raw,
}));

// Import after mocks are initialized
import { McpServerManager } from './mcpServer';

describe('MCP Server Integration Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        new McpServerManager();
    });

    it('should handle search_emails correctly and hit the FTS engine', async () => {
        const fakeData = [{ rowid: 1, subject: 'Hello' }];
        mockDbAll.mockReturnValue(fakeData);

        const request = {
            params: {
                name: 'search_emails',
                arguments: { query: 'test' }
            }
        };

        const response = await mockRequestHandler(request);
        expect(response.content[0].text).toContain('Hello');
        expect(mockDbAll).toHaveBeenCalledWith('test');
    });

    it('should handle read_thread and query database', async () => {
        mockDbAll.mockReturnValue([{ id: 'email1', thread_id: 't1' }]);

        const request = {
            params: {
                name: 'read_thread',
                arguments: { thread_id: 't1' }
            }
        };

        const response = await mockRequestHandler(request);
        expect(response.content[0].text).toContain('email1');
        expect(mockDbAll).toHaveBeenCalledWith('t1');
    });

    it('should return error for invalid arguments', async () => {
        await expect(mockRequestHandler({
            params: {
                name: 'search_emails',
                arguments: {}
            }
        })).rejects.toThrow('query must be a string');
    });

    it('should handle get_smart_summary and fetch latest emails', async () => {
        mockDbAll.mockReturnValue([{ subject: 'Urgent' }]);

        const response = await mockRequestHandler({
            params: {
                name: 'get_smart_summary',
                arguments: { account_id: 'acc1' }
            }
        });

        expect(response.content[0].text).toContain('Here are the recent active threads');
        expect(response.content[0].text).toContain('Urgent');
    });

    it('should send an email via send_email using SMTP engine', async () => {
        mockSendEmail.mockResolvedValue(true);

        const response = await mockRequestHandler({
            params: {
                name: 'send_email',
                arguments: {
                    account_id: 'acc1',
                    to: ['test@example.com'],
                    subject: 'Hi',
                    html: '<p>Hi</p>'
                }
            }
        });

        expect(response.isError).toBeFalsy();
        expect(response.content[0].text).toContain('Email sent to test@example.com');
        expect(mockSendEmail).toHaveBeenCalledWith('acc1', ['test@example.com'], 'Hi', '<p>Hi</p>');
    });

    it('should reject unknown tool names', async () => {
        await expect(mockRequestHandler({
            params: {
                name: 'unknown_fake_tool'
            }
        })).rejects.toThrow('Unknown tool: unknown_fake_tool');
    });
});
