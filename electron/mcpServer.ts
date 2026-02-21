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

export class McpServerManager {
    private server: Server;
    private app: express.Express;
    private port: number = 3000;
    private transport: SSEServerTransport | null = null;

    constructor() {
        this.app = express();
        this.app.use(cors());
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

        this.setupRoutes();
        this.setupTools();
    }

    private setupRoutes() {
        // SSE endpoint for AI Agent connection
        this.app.get('/sse', async (_req, res) => {
            console.log('New MCP connection request');
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

                    // SQLite FTS5 query
                    const results = db.prepare(`
            SELECT rowid, subject, from_name, from_email, snippet 
            FROM emails_fts 
            WHERE emails_fts MATCH ? 
            ORDER BY rank 
            LIMIT 10
          `).all(query);

                    return {
                        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                    };
                }

                if (request.params.name === 'read_thread') {
                    const thread_id = request.params.arguments?.thread_id;
                    if (typeof thread_id !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'thread_id must be a string');
                    }

                    const results = db.prepare(`
            SELECT * FROM emails WHERE thread_id = ? ORDER BY date ASC
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
                    // In a real app, this would call smtpEngine.sendEmail
                    // For now, we simulate success
                    return {
                        content: [{ type: 'text', text: `Successfully simulated sending email to ${args.to.join(', ')}` }]
                    };
                }

                if (request.params.name === 'create_draft') {
                    const args = request.params.arguments;
                    if (!args || typeof args.account_id !== 'string' || !Array.isArray(args.to) || typeof args.subject !== 'string' || typeof args.html !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_draft');
                    }

                    // Simulation of preparing a draft struct in DB or App State
                    return {
                        content: [{ type: 'text', text: `Draft created successfully with subject: "${args.subject}"` }]
                    };
                }

                if (request.params.name === 'get_smart_summary') {
                    const args = request.params.arguments;
                    if (!args || typeof args.account_id !== 'string') {
                        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_smart_summary');
                    }

                    // Simulation of AI summarization local index chunk
                    const recentEmails = db.prepare(`SELECT subject, snippet FROM emails WHERE account_id = ? ORDER BY date DESC LIMIT 5`).all(args.account_id);

                    return {
                        content: [{ type: 'text', text: JSON.stringify({ summary: "Here are the recent active threads.", data: recentEmails }, null, 2) }]
                    };
                }

                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: `Error executing tool: ${errorMessage}` }],
                    isError: true,
                };
            }
        });

        this.server.onerror = (error) => console.error('[MCP Error]', error);
    }

    public start() {
        this.app.listen(this.port, () => {
            console.log(`[MCP Server] Listening on http://localhost:${this.port}/sse`);
        });
    }
}

export const mcpServer = new McpServerManager();
