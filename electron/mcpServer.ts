import crypto from 'node:crypto';
import express from 'express';
import { logDebug } from './logger.js';
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
import { buildToolRegistry, type ToolDefinition } from './mcpTools.js';

interface ClientSession {
    server: Server;
    transport: SSEServerTransport;
}

export interface McpServerOptions {
    port?: number;
    authToken?: string;
}

export class McpServerManager {
    private app: express.Express;
    private port: number;
    private transports: Map<string, ClientSession> = new Map();
    private tools: Map<string, ToolDefinition>;
    private authToken: string;
    private connectionCallback: ((count: number) => void) | null = null;

    constructor(options?: McpServerOptions) {
        this.port = options?.port ?? 3000;
        this.authToken = options?.authToken ?? crypto.randomBytes(32).toString('hex');
        this.app = express();
        this.app.use(cors({ origin: false }));
        this.app.use(express.json());

        this.tools = buildToolRegistry();

        this.setupAuth();
        this.setupRoutes();
    }

    /** Bearer token authentication middleware (timing-safe comparison) */
    private setupAuth() {
        const expectedHeader = `Bearer ${this.authToken}`;
        this.app.use((req, res, next) => {
            const authHeader = req.headers.authorization ?? '';
            if (authHeader.length !== expectedHeader.length ||
                !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedHeader))) {
                res.status(401).json({ error: 'Unauthorized: valid Bearer token required' });
                return;
            }
            next();
        });
    }

    /** Configure a Server instance with tool handlers from the shared registry */
    private configureServer(server: Server) {
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: Array.from(this.tools.entries()).map(([name, def]) => ({
                name,
                description: def.description,
                inputSchema: def.inputSchema,
            })),
        }));

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const tool = this.tools.get(request.params.name);
            if (!tool) {
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
            try {
                const db = getDatabase();
                return await tool.handler(request.params.arguments ?? {}, db);
            } catch (error: unknown) {
                if (error instanceof McpError) throw error;
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: `Error executing tool: ${errorMessage}` }],
                    isError: true,
                };
            }
        });

        server.onerror = (error) => logDebug(`[MCP Error] ${error instanceof Error ? error.message : String(error)}`);
    }

    private setupRoutes() {
        // SSE endpoint — each connection gets its own Server + Transport pair
        this.app.get('/sse', async (_req, res) => {
            logDebug('New MCP connection request (authenticated)');

            const server = new Server(
                { name: 'express-delivery', version: '1.0.0' },
                { capabilities: { tools: {} } }
            );
            this.configureServer(server);

            const transport = new SSEServerTransport('/message', res);
            const sessionId = transport.sessionId;
            this.transports.set(sessionId, { server, transport });
            logDebug(`MCP client connected: ${sessionId} (total: ${this.transports.size})`);
            this.notifyConnectionChange();

            // Clean up on disconnect
            res.on('close', () => {
                this.transports.delete(sessionId);
                logDebug(`MCP client disconnected: ${sessionId} (total: ${this.transports.size})`);
                this.notifyConnectionChange();
            });

            try {
                await server.connect(transport);
            } catch (err) {
                this.transports.delete(sessionId);
                this.notifyConnectionChange();
                logDebug(`MCP connection failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
                if (!res.headersSent) res.end();
            }
        });

        // Message endpoint — route by sessionId query param
        this.app.post('/message', async (req, res) => {
            const sessionId = req.query.sessionId as string;
            const session = sessionId ? this.transports.get(sessionId) : undefined;
            if (!session) {
                res.status(400).send('No transport found for sessionId');
                return;
            }
            await session.transport.handlePostMessage(req, res);
        });
    }

    private notifyConnectionChange() {
        this.connectionCallback?.(this.transports.size);
    }

    /** Set callback for connection count changes (same pattern as IMAP's setNewEmailCallback) */
    public setConnectionCallback(cb: (count: number) => void) {
        this.connectionCallback = cb;
    }

    /** Get the number of currently connected AI agents */
    public getConnectedCount(): number {
        return this.transports.size;
    }

    /** Get the auth token for MCP client configuration */
    public getAuthToken(): string {
        return this.authToken;
    }

    /** Get the configured port */
    public getPort(): number {
        return this.port;
    }

    /** Whether the HTTP server is currently listening */
    public isRunning(): boolean {
        return this.httpServer !== null;
    }

    /** Return tool names + descriptions for UI display */
    public getToolList(): Array<{ name: string; description: string }> {
        return Array.from(this.tools.entries()).map(([name, def]) => ({
            name,
            description: def.description,
        }));
    }

    private httpServer: ReturnType<typeof this.app.listen> | null = null;

    public start() {
        if (this.httpServer) return;
        this.httpServer = this.app.listen(this.port, '127.0.0.1', () => {
            logDebug(`[MCP Server] Listening on http://127.0.0.1:${this.port}/sse`);
        });
    }

    public stop(): Promise<void> {
        for (const [sessionId, session] of this.transports) {
            try {
                session.transport.close();
            } catch {
                logDebug(`Error closing MCP transport ${sessionId}`);
            }
        }
        this.transports.clear();
        return new Promise((resolve) => {
            if (this.httpServer) {
                this.httpServer.close(() => resolve());
                this.httpServer = null;
            } else {
                resolve();
            }
        });
    }
}

let _mcpServer: McpServerManager | null = null;
let _connectionCallback: ((count: number) => void) | null = null;

/** Lazy factory — MCP server is created on first access (deferred from module load time) */
export function getMcpServer(options?: McpServerOptions): McpServerManager {
    if (!_mcpServer) {
        _mcpServer = new McpServerManager(options);
        if (_connectionCallback) {
            _mcpServer.setConnectionCallback(_connectionCallback);
        }
    }
    return _mcpServer;
}

/** Store the connection callback so it persists across restarts */
export function setMcpConnectionCallback(cb: (count: number) => void) {
    _connectionCallback = cb;
    if (_mcpServer) {
        _mcpServer.setConnectionCallback(cb);
    }
}

/** Restart the MCP server with new options (port/token change) */
export async function restartMcpServer(options: McpServerOptions): Promise<McpServerManager> {
    if (_mcpServer) {
        await _mcpServer.stop();
        _mcpServer = null;
    }
    const server = getMcpServer(options);
    try {
        server.start();
    } catch (err) {
        _mcpServer = null;
        throw err;
    }
    return server;
}
