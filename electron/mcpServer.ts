import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { getDatabase } from './db.js';
import { smtpEngine } from './smtp.js';
import { sanitizeFts5Query } from './utils.js';

export class McpServerManager {
    private server: Server;
    private app: express.Express;
    private port: number = 3000;
    private transport: SSEServerTransport | null = null;
    private authToken: string;

    constructor() {
        this.authToken = crypto.randomBytes(32).toString('hex');
        this.app = express();
        this.app.use(cors({ origin: false }));
        this.app.use(express.json());

        this.server = new Server(
            {
                name: 'express-delivery',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupAuth();
        this.setupRoutes();
        this.setupTools();
    }

    /** Bearer token authentication middleware */
    private setupAuth() {
        this.app.use((req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== `Bearer ${this.authToken}`) {
                res.status(401).json({ error: 'Unauthorized: valid Bearer token required' });
                return;
            }
            next();
        });
    }

    private setupRoutes() {
        // SSE endpoint for AI Agent connection
        this.app.get('/sse', async (_req, res) => {
            console.log('New MCP connection request (authenticated)');
            this.transport = new SSEServerTransport('/message', res);
            await this.server.connect(this.transport);
        });

        // Message endpoint to receive client tools/requests
        this.app.post('/message', async (req, res) => {
            if (!this.transport) {
                res.status(400).send('SSE connection not established');
                return;
            }
            await this.transport.handlePostMessage(req, res);
        });
    }

    private setupTools() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'search_emails',
                    description: 'Search for emails using a full-text query',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Search term',
                            },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'read_thread',
                    description: 'Read the full thread of emails using thread_id',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            thread_id: {
                                type: 'string',
                                description: 'The thread ID to fetch',
                            },
                        },
                        required: ['thread_id'],
                    },
                },
                {
                    name: 'send_email',
                    description: 'Send a new email using the configured SMTP connection',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            account_id: { type: 'string' },
                            to: {
                                type: 'array',
                                items: { type: 'string' }
                            },
                            subject: { type: 'string' },
                            html: { type: 'string' },
                        },
                        required: ['account_id', 'to', 'subject', 'html'],
                    },
                },
                {
                    name: 'create_draft',
                    description: 'Prepare a draft for the user to review in the UI before sending',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            account_id: { type: 'string' },
                            to: {
                                type: 'array',
                                items: { type: 'string' }
                            },
                            subject: { type: 'string' },
                            html: { type: 'string' },
                        },
                        required: ['account_id', 'to', 'subject', 'html'],
                    },
                },
                {
                    name: 'get_smart_summary',
                    description: 'Leverage local index to summarize recent emails',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            account_id: { type: 'string' }
                        },
                        required: ['account_id']
                    }
                }
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                const db = getDatabase();
                if (request.params.name === 'search_emails') {
                    const query = request.params.arguments?.query;
                    if (typeof query !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'query must be a string');
                    }

                    const sanitized = sanitizeFts5Query(query);
                    if (!sanitized) {
                        return {
                            content: [{ type: 'text', text: JSON.stringify([], null, 2) }],
                        };
                    }

                    try {
                        const results = db.prepare(`
                            SELECT rowid, subject, from_name, from_email, snippet
                            FROM emails_fts
                            WHERE emails_fts MATCH ?
                            ORDER BY rank
                            LIMIT 10
                        `).all(sanitized);

                        return {
                            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                        };
                    } catch {
                        return {
                            content: [{ type: 'text', text: 'Search failed: invalid query syntax' }],
                            isError: true,
                        };
                    }
                }

                if (request.params.name === 'read_thread') {
                    const thread_id = request.params.arguments?.thread_id;
                    if (typeof thread_id !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'thread_id must be a string');
                    }

                    const results = db.prepare(`
                        SELECT id, account_id, folder_id, thread_id, subject,
                               from_name, from_email, to_email, date, snippet, body_text,
                               is_read, is_flagged
                        FROM emails WHERE thread_id = ? ORDER BY date ASC
                    `).all(thread_id);

                    return {
                        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                    };
                }

                if (request.params.name === 'send_email') {
                    const args = request.params.arguments;
                    if (!args || typeof args.account_id !== 'string' || !Array.isArray(args.to) || typeof args.subject !== 'string' || typeof args.html !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for send_email');
                    }
                    const success = await smtpEngine.sendEmail(
                        args.account_id, args.to, args.subject, args.html
                    );
                    return {
                        content: [{ type: 'text', text: success
                            ? `Email sent to ${args.to.join(', ')}`
                            : 'Failed to send email' }],
                        isError: !success,
                    };
                }

                if (request.params.name === 'create_draft') {
                    const args = request.params.arguments;
                    if (!args || typeof args.account_id !== 'string' || !Array.isArray(args.to) || typeof args.subject !== 'string' || typeof args.html !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_draft');
                    }

                    const id = crypto.randomUUID();
                    db.prepare(
                        'INSERT INTO drafts (id, account_id, to_email, subject, body_html) VALUES (?, ?, ?, ?, ?)'
                    ).run(id, args.account_id, args.to.join(', '), args.subject, args.html);

                    return {
                        content: [{ type: 'text', text: `Draft created (id: ${id}) with subject: "${args.subject}"` }]
                    };
                }

                if (request.params.name === 'get_smart_summary') {
                    const args = request.params.arguments;
                    if (!args || typeof args.account_id !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_smart_summary');
                    }

                    const recentEmails = db.prepare(
                        `SELECT subject, snippet FROM emails WHERE account_id = ? ORDER BY date DESC LIMIT 5`
                    ).all(args.account_id);

                    return {
                        content: [{ type: 'text', text: JSON.stringify({ summary: "Here are the recent active threads.", data: recentEmails }, null, 2) }]
                    };
                }

                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            } catch (error: unknown) {
                if (error instanceof McpError) throw error;
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: `Error executing tool: ${errorMessage}` }],
                    isError: true,
                };
            }
        });

        this.server.onerror = (error) => console.error('[MCP Error]', error);
    }

    /** Get the auth token for MCP client configuration */
    public getAuthToken(): string {
        return this.authToken;
    }

    private httpServer: ReturnType<typeof this.app.listen> | null = null;

    public start() {
        this.httpServer = this.app.listen(this.port, '127.0.0.1', () => {
            console.log(`[MCP Server] Listening on http://127.0.0.1:${this.port}/sse`);
        });
    }

    public stop() {
        this.httpServer?.close();
        this.httpServer = null;
    }
}

export const mcpServer = new McpServerManager();
