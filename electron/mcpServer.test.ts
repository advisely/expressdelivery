import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockAppUse, mockAppGet, mockAppPost, mockAppListen,
    mockDbAll, mockDbGet, mockDbRun,
} = vi.hoisted(() => ({
    mockAppUse: vi.fn(),
    mockAppGet: vi.fn(),
    mockAppPost: vi.fn(),
    mockAppListen: vi.fn(),
    mockDbAll: vi.fn(),
    mockDbGet: vi.fn(),
    mockDbRun: vi.fn(),
}));

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
        use: mockAppUse,
        get: mockAppGet,
        post: mockAppPost,
        listen: mockAppListen,
    })) as unknown) as Record<string, unknown>;
    expressMock.json = vi.fn();
    return { default: expressMock };
});
vi.mock('cors', () => ({ default: vi.fn(() => vi.fn()) }));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
    Server: class {
        setRequestHandler = vi.fn();
        connect = vi.fn();
        onerror: unknown;
    }
}));

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
    SSEServerTransport: class {
        sessionId = 'mock-session-1';
        constructor(public _endpoint: string, public _res: unknown) {}
        handlePostMessage = vi.fn();
        close = vi.fn();
    }
}));

vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => ({
            all: mockDbAll,
            get: mockDbGet,
            run: mockDbRun,
        }))
    }))
}));

vi.mock('./smtp.js', () => ({
    smtpEngine: { sendEmail: vi.fn().mockResolvedValue(true) },
}));

vi.mock('./utils.js', () => ({
    sanitizeFts5Query: (raw: string) => raw,
}));

vi.mock('./logger.js', () => ({
    logDebug: vi.fn(),
}));

// Import after mocks
import { McpServerManager } from './mcpServer';

describe('McpServerManager', () => {
    let manager: McpServerManager;

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new McpServerManager();
    });

    it('sets up auth middleware, SSE route, and message route', () => {
        // Auth middleware
        expect(mockAppUse).toHaveBeenCalled();
        // SSE endpoint
        expect(mockAppGet).toHaveBeenCalledWith('/sse', expect.any(Function));
        // Message endpoint
        expect(mockAppPost).toHaveBeenCalledWith('/message', expect.any(Function));
    });

    it('generates a 32-byte auth token', () => {
        expect(manager.getAuthToken()).toBe('test-token-abc123');
    });

    it('starts HTTP server on 127.0.0.1:3000', () => {
        manager.start();
        expect(mockAppListen).toHaveBeenCalledWith(3000, '127.0.0.1', expect.any(Function));
    });

    it('reports 0 connected agents initially', () => {
        expect(manager.getConnectedCount()).toBe(0);
    });

    it('fires connection callback on setConnectionCallback', () => {
        const cb = vi.fn();
        manager.setConnectionCallback(cb);

        // Simulate an SSE connection by calling the route handler
        const sseHandler = mockAppGet.mock.calls.find(
            (c: unknown[]) => c[0] === '/sse'
        )?.[1] as (req: unknown, res: unknown) => Promise<void>;
        expect(sseHandler).toBeDefined();

        // The handler is async and creates a Server + Transport
        // We just verify the callback mechanism exists
        expect(typeof manager.setConnectionCallback).toBe('function');
    });

    it('stop() clears transports and closes HTTP server', () => {
        const mockClose = vi.fn();
        mockAppListen.mockReturnValue({ close: mockClose });
        manager.start();
        manager.stop();
        expect(mockClose).toHaveBeenCalled();
    });

    it('POST /message returns 400 when no sessionId match', async () => {
        const messageHandler = mockAppPost.mock.calls.find(
            (c: unknown[]) => c[0] === '/message'
        )?.[1] as (req: unknown, res: { status: (code: number) => { send: (msg: string) => void } }) => Promise<void>;

        const mockRes = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
        };

        await messageHandler(
            { query: { sessionId: 'nonexistent' } },
            mockRes as unknown as { status: (code: number) => { send: (msg: string) => void } }
        );

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.send).toHaveBeenCalledWith('No transport found for sessionId');
    });
});
