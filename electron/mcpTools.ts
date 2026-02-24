import crypto from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { smtpEngine } from './smtp.js';
import { sanitizeFts5Query } from './utils.js';

/** Shape returned by every tool handler (index signature satisfies MCP SDK's ServerResult) */
export interface ToolResult {
    [key: string]: unknown;
    content: { type: string; text: string }[];
    isError?: boolean;
}

/** Registration entry for the tool registry Map */
export interface ToolDefinition {
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>, db: BetterSqlite3.Database) => Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const stripCRLF = (s: string) => s.replace(/[\r\n\0]/g, '');

// ---------------------------------------------------------------------------
// Existing tools (extracted from mcpServer.ts)
// ---------------------------------------------------------------------------

async function handleSearchEmails(args: Record<string, unknown>, db: BetterSqlite3.Database): Promise<ToolResult> {
    const query = args.query;
    if (typeof query !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'query must be a string');
    }

    const sanitized = sanitizeFts5Query(query);
    if (!sanitized) {
        return { content: [{ type: 'text', text: JSON.stringify([], null, 2) }] };
    }

    try {
        const results = db.prepare(`
            SELECT e.id, e.account_id, e.folder_id, e.thread_id, e.subject,
                   e.from_name, e.from_email, e.to_email, e.date, e.snippet,
                   e.is_read, e.is_flagged, e.has_attachments,
                   e.ai_category, e.ai_priority, e.ai_labels
            FROM emails_fts f
            JOIN emails e ON f.rowid = e.rowid
            WHERE emails_fts MATCH ?
            ORDER BY rank LIMIT 20
        `).all(sanitized);

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    } catch {
        return { content: [{ type: 'text', text: 'Search failed: invalid query syntax' }], isError: true };
    }
}

async function handleReadThread(args: Record<string, unknown>, db: BetterSqlite3.Database): Promise<ToolResult> {
    const thread_id = args.thread_id;
    if (typeof thread_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'thread_id must be a string');
    }

    const results = db.prepare(`
        SELECT id, account_id, folder_id, thread_id, subject,
               from_name, from_email, to_email, date, snippet, body_text,
               is_read, is_flagged
        FROM emails WHERE thread_id = ? ORDER BY date ASC
    `).all(thread_id);

    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleSendEmail(args: Record<string, unknown>, _db: BetterSqlite3.Database): Promise<ToolResult> {
    if (typeof args.account_id !== 'string' || !Array.isArray(args.to) || typeof args.subject !== 'string' || typeof args.html !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for send_email');
    }

    // Validate attachments
    const rawAtts = Array.isArray(args.attachments) ? args.attachments : undefined;
    if (rawAtts && rawAtts.length > 10) {
        throw new McpError(ErrorCode.InvalidParams, 'Maximum 10 attachments allowed');
    }
    const attachments = rawAtts?.map((att: Record<string, unknown>) => {
        if (typeof att.filename !== 'string' || typeof att.content !== 'string' || typeof att.contentType !== 'string') {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid attachment: must have filename, content (base64), contentType');
        }
        const buf = Buffer.from(att.content, 'base64');
        if (buf.length === 0 || buf.length > 25 * 1024 * 1024) {
            throw new McpError(ErrorCode.InvalidParams, `Attachment ${att.filename} exceeds 25MB or is empty`);
        }
        const safeName = stripCRLF(String(att.filename).replace(/[\\/]/g, '_')).slice(0, 255);
        return { filename: safeName, content: att.content, contentType: att.contentType };
    });

    // Sanitize recipients and subject
    const sanitizedTo = (args.to as string[]).map((r: string) => stripCRLF(r.trim())).filter((r: string) => r.length > 0);
    if (sanitizedTo.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, 'No valid recipients');
    }

    const html = (args.html as string).slice(0, 500_000);
    const success = await smtpEngine.sendEmail(
        args.account_id as string, sanitizedTo, stripCRLF(args.subject as string), html,
        undefined, undefined,
        attachments
    );
    return {
        content: [{
            type: 'text',
            text: success
                ? `Email sent to ${(args.to as string[]).join(', ')}${attachments ? ` with ${attachments.length} attachment(s)` : ''}`
                : 'Failed to send email'
        }],
        isError: !success,
    };
}

async function handleCreateDraft(args: Record<string, unknown>, db: BetterSqlite3.Database): Promise<ToolResult> {
    if (typeof args.account_id !== 'string' || !Array.isArray(args.to) || typeof args.subject !== 'string' || typeof args.html !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for create_draft');
    }

    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(args.account_id);
    if (!account) {
        throw new McpError(ErrorCode.InvalidParams, 'Account not found');
    }

    const id = crypto.randomUUID();
    db.prepare(
        'INSERT INTO drafts (id, account_id, to_email, subject, body_html) VALUES (?, ?, ?, ?, ?)'
    ).run(id, args.account_id, (args.to as string[]).join(', '), args.subject, args.html);

    return { content: [{ type: 'text', text: `Draft created (id: ${id}) with subject: "${args.subject}"` }] };
}

async function handleGetSmartSummary(args: Record<string, unknown>, db: BetterSqlite3.Database): Promise<ToolResult> {
    if (typeof args.account_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_smart_summary');
    }

    const account = db.prepare('SELECT id, email FROM accounts WHERE id = ?').get(args.account_id) as { id: string; email: string } | undefined;
    if (!account) {
        throw new McpError(ErrorCode.InvalidParams, 'Account not found');
    }

    const recentEmails = db.prepare(`
        SELECT id, subject, from_name, from_email, to_email, date, snippet,
               is_read, is_flagged, ai_category, ai_priority
        FROM emails WHERE account_id = ? ORDER BY date DESC LIMIT 20
    `).all(args.account_id);

    const unreadCount = db.prepare(
        'SELECT COUNT(*) as count FROM emails WHERE account_id = ? AND is_read = 0'
    ).get(args.account_id) as { count: number };

    const flaggedEmails = db.prepare(`
        SELECT id, subject, from_name, from_email, date, snippet
        FROM emails WHERE account_id = ? AND is_flagged = 1
        ORDER BY date DESC LIMIT 10
    `).all(args.account_id);

    const highPriority = db.prepare(`
        SELECT id, subject, from_name, from_email, date, snippet, ai_category
        FROM emails WHERE account_id = ? AND ai_priority >= 3
        ORDER BY date DESC LIMIT 10
    `).all(args.account_id);

    const folderCounts = db.prepare(`
        SELECT f.name, f.type, COUNT(e.id) as count,
               SUM(CASE WHEN e.is_read = 0 THEN 1 ELSE 0 END) as unread
        FROM emails e JOIN folders f ON e.folder_id = f.id
        WHERE e.account_id = ?
        GROUP BY f.id ORDER BY count DESC
    `).all(args.account_id);

    const pendingDrafts = db.prepare(`
        SELECT id, to_email, subject, updated_at
        FROM drafts WHERE account_id = ?
        ORDER BY updated_at DESC LIMIT 5
    `).all(args.account_id);

    const summary = {
        account_email: account.email,
        unread_count: unreadCount.count,
        recent_emails: recentEmails,
        flagged_emails: flaggedEmails,
        high_priority_emails: highPriority,
        folder_distribution: folderCounts,
        pending_drafts: pendingDrafts,
    };

    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
}

// ---------------------------------------------------------------------------
// New Phase 3 tools
// ---------------------------------------------------------------------------

async function handleCategorizeEmail(args: Record<string, unknown>, db: BetterSqlite3.Database): Promise<ToolResult> {
    if (typeof args.email_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'email_id must be a string');
    }
    if (typeof args.account_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'account_id must be a string');
    }

    const email = db.prepare('SELECT id, account_id FROM emails WHERE id = ?').get(args.email_id) as { id: string; account_id: string } | undefined;
    if (!email) {
        throw new McpError(ErrorCode.InvalidParams, 'Email not found');
    }
    if (email.account_id !== args.account_id) {
        throw new McpError(ErrorCode.InvalidParams, 'Email does not belong to the specified account');
    }

    if (args.priority !== undefined) {
        if (typeof args.priority !== 'number' || args.priority < 1 || args.priority > 4) {
            throw new McpError(ErrorCode.InvalidParams, 'Priority must be a number between 1 and 4');
        }
    }

    const labels = Array.isArray(args.labels)
        ? (args.labels as unknown[]).filter((l): l is string => typeof l === 'string').slice(0, 20)
        : undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (typeof args.category === 'string') {
        fields.push('ai_category = ?');
        values.push(args.category.slice(0, 50));
    }
    if (typeof args.priority === 'number') {
        fields.push('ai_priority = ?');
        values.push(Math.floor(args.priority));
    }
    if (labels) {
        fields.push('ai_labels = ?');
        values.push(JSON.stringify(labels));
    }

    if (fields.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, 'At least one of category, priority, or labels must be provided');
    }

    values.push(args.email_id);
    db.prepare(`UPDATE emails SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return {
        content: [{
            type: 'text',
            text: `Email ${args.email_id} categorized: category=${typeof args.category === 'string' ? args.category : 'unchanged'}, priority=${typeof args.priority === 'number' ? args.priority : 'unchanged'}, labels=${labels ? JSON.stringify(labels) : 'unchanged'}`
        }],
    };
}

async function handleGetEmailAnalytics(args: Record<string, unknown>, db: BetterSqlite3.Database): Promise<ToolResult> {
    if (typeof args.account_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'account_id must be a string');
    }

    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(args.account_id);
    if (!account) {
        throw new McpError(ErrorCode.InvalidParams, 'Account not found');
    }

    const days = typeof args.days === 'number' ? Math.min(Math.max(Math.floor(args.days), 1), 90) : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString();

    const totalReceived = db.prepare(
        'SELECT COUNT(*) as count FROM emails WHERE account_id = ? AND date >= ?'
    ).get(args.account_id, sinceStr) as { count: number };

    const perFolder = db.prepare(`
        SELECT f.name, f.type, COUNT(e.id) as count
        FROM emails e JOIN folders f ON e.folder_id = f.id
        WHERE e.account_id = ? AND e.date >= ?
        GROUP BY f.id ORDER BY count DESC
    `).all(args.account_id, sinceStr);

    const topSenders = db.prepare(`
        SELECT from_email, from_name, COUNT(*) as count
        FROM emails WHERE account_id = ? AND date >= ?
        GROUP BY from_email ORDER BY count DESC LIMIT 10
    `).all(args.account_id, sinceStr);

    const unreadCount = db.prepare(
        'SELECT COUNT(*) as count FROM emails WHERE account_id = ? AND is_read = 0'
    ).get(args.account_id) as { count: number };

    const flaggedCount = db.prepare(
        'SELECT COUNT(*) as count FROM emails WHERE account_id = ? AND is_flagged = 1'
    ).get(args.account_id) as { count: number };

    const perDay = db.prepare(`
        SELECT DATE(date) as day, COUNT(*) as count
        FROM emails WHERE account_id = ? AND date >= ?
        GROUP BY DATE(date) ORDER BY day DESC
    `).all(args.account_id, sinceStr);

    const perHour = db.prepare(`
        SELECT CAST(strftime('%H', date) AS INTEGER) as hour, COUNT(*) as count
        FROM emails WHERE account_id = ? AND date >= ?
        GROUP BY hour ORDER BY count DESC LIMIT 5
    `).all(args.account_id, sinceStr);

    const categoryDist = db.prepare(`
        SELECT ai_category, COUNT(*) as count
        FROM emails WHERE account_id = ? AND ai_category IS NOT NULL AND date >= ?
        GROUP BY ai_category ORDER BY count DESC
    `).all(args.account_id, sinceStr);

    const priorityDist = db.prepare(`
        SELECT ai_priority, COUNT(*) as count
        FROM emails WHERE account_id = ? AND ai_priority IS NOT NULL AND date >= ?
        GROUP BY ai_priority ORDER BY ai_priority DESC
    `).all(args.account_id, sinceStr);

    const analytics = {
        period_days: days,
        total_received: totalReceived.count,
        unread_count: unreadCount.count,
        flagged_count: flaggedCount.count,
        per_folder: perFolder,
        top_senders: topSenders,
        emails_per_day: perDay,
        busiest_hours: perHour,
        category_distribution: categoryDist,
        priority_distribution: priorityDist,
    };

    return { content: [{ type: 'text', text: JSON.stringify(analytics, null, 2) }] };
}

async function handleSuggestReply(args: Record<string, unknown>, db: BetterSqlite3.Database): Promise<ToolResult> {
    if (typeof args.email_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'email_id must be a string');
    }
    if (typeof args.account_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'account_id must be a string');
    }

    const email = db.prepare(`
        SELECT id, account_id, thread_id, subject, from_name, from_email,
               to_email, date, body_text, ai_category, ai_priority
        FROM emails WHERE id = ?
    `).get(args.email_id) as Record<string, unknown> | undefined;
    if (!email) {
        throw new McpError(ErrorCode.InvalidParams, 'Email not found');
    }
    if (email.account_id !== args.account_id) {
        throw new McpError(ErrorCode.InvalidParams, 'Email does not belong to the specified account');
    }

    // Truncate body_text to prevent leaking raw MIME data
    if (typeof email.body_text === 'string') {
        email.body_text = email.body_text.slice(0, 2000);
    }

    let threadContext: unknown[] = [];
    if (email.thread_id) {
        threadContext = (db.prepare(`
            SELECT id, subject, from_name, from_email, to_email, date, snippet, body_text
            FROM emails WHERE thread_id = ? AND account_id = ? ORDER BY date ASC
        `).all(email.thread_id as string, args.account_id) as Record<string, unknown>[]).map(e => {
            if (typeof e.body_text === 'string') e.body_text = e.body_text.slice(0, 2000);
            return e;
        });
    }

    const senderHistory = db.prepare(`
        SELECT id, subject, from_email, to_email, date, snippet
        FROM emails
        WHERE account_id = ? AND from_email = ?
        ORDER BY date DESC LIMIT 10
    `).all(args.account_id, email.from_email);

    const account = db.prepare(
        'SELECT email, display_name FROM accounts WHERE id = ?'
    ).get(email.account_id as string) as { email: string; display_name: string } | undefined;

    const context = {
        email,
        thread_context: threadContext,
        sender_history: senderHistory,
        account: account ? { email: account.email, display_name: account.display_name } : null,
        requested_tone: typeof args.tone === 'string' ? args.tone : 'professional',
        instructions: typeof args.instructions === 'string' ? args.instructions.slice(0, 500) : null,
        hint: 'Use the create_draft tool with account_id, to, subject, and html to save the suggested reply as a draft for user review.',
    };

    return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Tool registry builder
// ---------------------------------------------------------------------------

export function buildToolRegistry(): Map<string, ToolDefinition> {
    const tools = new Map<string, ToolDefinition>();

    tools.set('search_emails', {
        description: 'Search for emails using a full-text query. Returns matching emails with AI metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term' },
            },
            required: ['query'],
        },
        handler: handleSearchEmails,
    });

    tools.set('read_thread', {
        description: 'Read the full thread of emails using thread_id',
        inputSchema: {
            type: 'object',
            properties: {
                thread_id: { type: 'string', description: 'The thread ID to fetch' },
            },
            required: ['thread_id'],
        },
        handler: handleReadThread,
    });

    tools.set('send_email', {
        description: 'Send a new email using the configured SMTP connection',
        inputSchema: {
            type: 'object',
            properties: {
                account_id: { type: 'string' },
                to: { type: 'array', items: { type: 'string' } },
                subject: { type: 'string' },
                html: { type: 'string' },
                attachments: {
                    type: 'array',
                    description: 'Optional file attachments (max 10, each max 25MB base64-encoded)',
                    items: {
                        type: 'object',
                        properties: {
                            filename: { type: 'string' },
                            content: { type: 'string', description: 'Base64-encoded file content' },
                            contentType: { type: 'string' },
                        },
                        required: ['filename', 'content', 'contentType'],
                    },
                },
            },
            required: ['account_id', 'to', 'subject', 'html'],
        },
        handler: handleSendEmail,
    });

    tools.set('create_draft', {
        description: 'Prepare a draft for the user to review in the UI before sending',
        inputSchema: {
            type: 'object',
            properties: {
                account_id: { type: 'string' },
                to: { type: 'array', items: { type: 'string' } },
                subject: { type: 'string' },
                html: { type: 'string' },
            },
            required: ['account_id', 'to', 'subject', 'html'],
        },
        handler: handleCreateDraft,
    });

    tools.set('get_smart_summary', {
        description: 'Get a comprehensive mailbox summary: recent emails, unread/flagged counts, high-priority items, folder distribution, and pending drafts',
        inputSchema: {
            type: 'object',
            properties: {
                account_id: { type: 'string', description: 'Account ID to summarize' },
            },
            required: ['account_id'],
        },
        handler: handleGetSmartSummary,
    });

    tools.set('categorize_email', {
        description: 'Set AI-generated category, priority, and/or labels on an email. Priority: 1=low, 2=normal, 3=high, 4=urgent.',
        inputSchema: {
            type: 'object',
            properties: {
                account_id: { type: 'string', description: 'Account ID that owns the email' },
                email_id: { type: 'string', description: 'The email ID to categorize' },
                category: { type: 'string', description: 'Category label (e.g., "work", "personal", "newsletter", "finance")' },
                priority: { type: 'number', description: 'Priority level: 1=low, 2=normal, 3=high, 4=urgent' },
                labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags/labels (e.g., ["actionable", "from-boss", "deadline"])',
                },
            },
            required: ['account_id', 'email_id'],
        },
        handler: handleCategorizeEmail,
    });

    tools.set('get_email_analytics', {
        description: 'Get mailbox analytics: email volume, top senders, folder distribution, busiest hours, category/priority breakdown. Returns structured data for AI analysis.',
        inputSchema: {
            type: 'object',
            properties: {
                account_id: { type: 'string', description: 'Account ID to analyze' },
                days: { type: 'number', description: 'Number of days to look back (default: 30, max: 90)' },
            },
            required: ['account_id'],
        },
        handler: handleGetEmailAnalytics,
    });

    tools.set('suggest_reply', {
        description: 'Get structured context for generating a reply to an email: the email, thread history, sender history, and account info. Use create_draft to save the generated reply.',
        inputSchema: {
            type: 'object',
            properties: {
                account_id: { type: 'string', description: 'Account ID that owns the email' },
                email_id: { type: 'string', description: 'The email ID to reply to' },
                tone: {
                    type: 'string',
                    enum: ['professional', 'casual', 'friendly', 'formal', 'concise'],
                    description: 'Desired tone for the reply (default: professional)',
                },
                instructions: {
                    type: 'string',
                    description: 'Additional instructions (e.g., "decline politely", "ask for more details")',
                },
            },
            required: ['account_id', 'email_id'],
        },
        handler: handleSuggestReply,
    });

    return tools;
}
