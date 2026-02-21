import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
var mockRequestHandler: (req: any) => Promise<{ content: { text: string }[], isError?: boolean }>;

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
vi.mock('cors', () => ({ default: vi.fn() }));

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
vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => ({
            all: mockDbAll
        }))
    }))
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
        const response = await mockRequestHandler({
            params: {
                name: 'search_emails',
                arguments: {}
            }
        });
        expect(response.isError).toBe(true);
        expect(response.content[0].text).toContain('query must be a string');
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

    it('should simulate sending an email via send_email', async () => {
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

        expect(response.isError).toBeUndefined();
        expect(response.content[0].text).toContain('Successfully simulated sending email to test@example.com');
    });

    it('should reject unknown tool names', async () => {
        const response = await mockRequestHandler({
            params: {
                name: 'unknown_fake_tool'
            }
        });

        expect(response.isError).toBe(true);
        expect(response.content[0].text).toContain('Unknown tool: unknown_fake_tool');
    });
});
