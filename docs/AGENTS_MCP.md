# ExpressDelivery — AI Agents and MCP Integration

This document is the definitive reference for how AI agents interact with ExpressDelivery via the Model Context Protocol (MCP). It covers the server architecture, authentication model, all 8 MCP tools, the OpenRouter AI compose pipeline, security guarantees, Settings UI management, and a step-by-step integration guide.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Authentication](#3-authentication)
4. [MCP Tools Reference](#4-mcp-tools-reference)
5. [AI Compose Pipeline (OpenRouter)](#5-ai-compose-pipeline-openrouter)
6. [Security Model](#6-security-model)
7. [Settings Management](#7-settings-management)
8. [Integration Flow](#8-integration-flow)
9. [Development Guide](#9-development-guide)
10. [Agent Validation Process](#10-agent-validation-process)

---

## 1. Overview

ExpressDelivery embeds a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server directly in its Electron main process. This server lets any MCP-compatible AI client — Claude Desktop, a custom agent, a CI script — connect to your live mailbox and operate on it programmatically.

The integration has two distinct AI surfaces:

| Surface | Entry point | Transport | Purpose |
|---|---|---|---|
| MCP server | `http://127.0.0.1:3000/sse` | SSE + HTTP POST | External AI agents (full tool access) |
| AI Compose | `ai:suggest-reply` IPC | Electron IPC + OpenRouter API | In-app reply drafting via Sparkles button |

Both surfaces share the same SQLite database and SMTP engine used by the human-facing UI, so an agent that calls `send_email` sends a real email through the configured SMTP account.
---

## 2. Architecture

### 2.1 Server Stack

The MCP server is built on **Express 5** and the **`@modelcontextprotocol/sdk`** Node.js package. It uses the SSE (Server-Sent Events) transport pattern: the AI client opens a persistent `GET /sse` connection to receive server-to-client events, and sends tool call requests via `POST /message`.

```
Electron main process
├── electron/mcpServer.ts   McpServerManager class + getMcpServer() factory
├── electron/mcpTools.ts    buildToolRegistry() — Map<string, ToolDefinition>
└── electron/db.ts          SQLite (shared with UI, WAL mode)
```

### 2.2 Multi-Client SSE Transport

Each connecting agent gets its own isolated `Server` + `SSEServerTransport` pair, stored in a `Map<string, ClientSession>` keyed by session ID. When an agent connects to `GET /sse`, a new server instance is created and configured with the shared tool registry. When the SSE connection closes, the session is removed and the UI connection badge updates.

Tool calls arrive as `POST /message?sessionId=<uuid>`. The server looks up the session by ID and routes the request to the correct transport. Multiple agents can be connected simultaneously without their requests interfering.

### 2.3 Lazy Initialization

The MCP server is **not** created at module load time. It uses a `getMcpServer()` factory pattern:

```typescript
// electron/mcpServer.ts
let _mcpServer: McpServerManager | null = null;

export function getMcpServer(options?: McpServerOptions): McpServerManager {
    if (!_mcpServer) {
        _mcpServer = new McpServerManager(options);
        if (_connectionCallback) {
            _mcpServer.setConnectionCallback(_connectionCallback);
        }
    }
    return _mcpServer;
}
```

The first call creates the instance. Subsequent calls return the cached instance. This avoids startup cost when MCP is disabled and allows the Settings UI to restart the server with new options without requiring an app restart.

### 2.4 Connection Count Notification

When the number of connected agents changes, the server fires a callback. In `electron/main.ts`, this callback pushes a `mcp:status` IPC event to the renderer, which the `Sidebar` component uses to display a live green dot with the agent count.

### 2.5 Lifecycle

| Event | Action |
|---|---|
| App startup | Token loaded/generated, `getMcpServer()` called, `mcp.start()` if enabled |
| Settings change | `restartMcpServer(options)` — stops old instance, creates new one |
| MCP toggle off | `mcp.stop()` — closes all open sessions, closes HTTP listener |
| App quit | `getMcpServer().stop()` called in `before-quit` handler |
---

## 3. Authentication

### 3.1 Bearer Token

Every HTTP request to the MCP server — both `GET /sse` and `POST /message` — must include:

```
Authorization: Bearer <token>
```

The auth middleware runs before all routes and uses `crypto.timingSafeEqual` to prevent timing-based token oracle attacks. Both the length and content of the Authorization header are checked. Requests that fail either check receive a 401 immediately.

### 3.2 Token Generation and Storage

On first startup, a 32-byte random token is generated and persisted encrypted using Electron's `safeStorage` API (DPAPI on Windows, Keychain on macOS, libsecret on Linux). The plaintext token is never written to disk. If decryption fails on a subsequent startup, a new token is generated automatically.

### 3.3 Token Retrieval

The current token is retrieved via the `mcp:get-token` IPC channel. The Settings > Agentic tab displays it in a masked field with a copy-to-clipboard button.

### 3.4 Token Regeneration

The Regenerate Token button generates a new 32-byte random token, encrypts and persists it, and restarts the MCP server via `restartMcpServer()`. All existing agent connections are immediately invalidated.

### 3.5 CORS Policy

The Express app uses `cors({ origin: false })`, emitting no `Access-Control-Allow-Origin` header. Combined with binding only to `127.0.0.1`, browser-originated cross-origin requests are blocked at both the network and CORS layers.
---

## 4. MCP Tools Reference

All 8 tools are registered in `electron/mcpTools.ts` via `buildToolRegistry()`, which returns a `Map<string, ToolDefinition>`. Each definition has a `description` (shown to the AI client), an `inputSchema` (JSON Schema), and a `handler` function.

---

### Tool: search_emails

**Purpose:** Full-text search across all indexed emails using SQLite FTS5.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search term; FTS5 query syntax is supported |

**Returns:** JSON array of up to 20 matching emails with fields: `id`, `account_id`, `folder_id`, `thread_id`, `subject`, `from_name`, `from_email`, `to_email`, `date`, `snippet`, `is_read`, `is_flagged`, `has_attachments`, `ai_category`, `ai_priority`, `ai_labels`.

**Security note:** The query passes through `sanitizeFts5Query()` before execution to prevent FTS5 operator injection. Invalid queries return an empty array rather than an error.

**Example call:**

```json
{
  "name": "search_emails",
  "arguments": {
    "query": "invoice Q4 2024"
  }
}
```

---

### Tool: read_thread

**Purpose:** Fetch the complete email thread by thread ID, ordered chronologically.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `thread_id` | string | yes | The thread ID to fetch |

**Returns:** JSON array of all emails in the thread including the full `body_text` column.

**Note:** This tool returns body text untruncated. Use `suggest_reply` when context window management matters, as it enforces a 2 KB cap per message.

**Example call:**

```json
{
  "name": "read_thread",
  "arguments": {
    "thread_id": "abc123@mail.example.com"
  }
}
```

---

### Tool: send_email

**Purpose:** Send an email immediately via the account's configured SMTP connection.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | string | yes | The account UUID to send from |
| `to` | string[] | yes | Recipient email addresses |
| `subject` | string | yes | Email subject line |
| `html` | string | yes | Email body as HTML (capped at 500 KB) |
| `attachments` | object[] | no | Up to 10 file attachments |

**Attachment object fields:**

| Field | Type | Description |
|---|---|---|
| `filename` | string | File name (path separators replaced with `_`, CRLF stripped, max 255 chars) |
| `content` | string | Base64-encoded file content (min 1 byte, max 25 MB per file) |
| `contentType` | string | MIME type, e.g. `application/pdf` |

**Security constraints applied before SMTP delivery:**
- All recipient addresses and the subject are CRLF-stripped to prevent header injection
- HTML body is hard-capped at 500,000 characters
- Each attachment is size-validated after base64 decode; empty files and files exceeding 25 MB are rejected
- Maximum 10 attachments per call is enforced

**Example call:**

```json
{
  "name": "send_email",
  "arguments": {
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "to": ["alice@example.com"],
    "subject": "Q4 Report",
    "html": "<p>Please find the report attached.</p>",
    "attachments": [{ "filename": "report.pdf", "content": "JVBERi0...", "contentType": "application/pdf" }]
  }
}
```
---

### Tool: create_draft

**Purpose:** Save a draft to the database for the user to review and optionally edit in the UI before sending. This is the preferred pattern for AI-generated emails — use `create_draft` rather than `send_email` whenever human review before delivery is appropriate.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | string | yes | The account UUID the draft belongs to |
| `to` | string[] | yes | Recipient email addresses |
| `subject` | string | yes | Email subject line |
| `html` | string | yes | Draft body as HTML |

**Security constraints:** `account_id` is validated against the `accounts` table. Unknown account IDs are rejected with an `InvalidParams` MCP error.

**Returns:** Confirmation text including the generated draft UUID.

**Example call:**

```json
{
  "name": "create_draft",
  "arguments": {
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "to": ["bob@example.com"],
    "subject": "Re: Meeting tomorrow",
    "html": "<p>Sounds good. I will be there at 10am.</p>"
  }
}
```

---

### Tool: get_smart_summary

**Purpose:** Return a comprehensive mailbox overview: recent emails, unread and flagged counts, high-priority items, folder distribution, and pending drafts. Useful as an agent's first call to orient itself within a mailbox before taking actions.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | string | yes | Account UUID to summarize |

**Returns JSON object:**

| Field | Description |
|---|---|
| `account_email` | The account's email address |
| `unread_count` | Total unread emails (all time) |
| `recent_emails` | Last 20 emails — envelope fields only, no body text |
| `flagged_emails` | Up to 10 flagged emails |
| `high_priority_emails` | Up to 10 emails with `ai_priority >= 3` |
| `folder_distribution` | Per-folder email count and unread count |
| `pending_drafts` | Up to 5 most-recent drafts |

**Example call:**

```json
{
  "name": "get_smart_summary",
  "arguments": {
    "account_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

---

### Tool: categorize_email

**Purpose:** Write AI-generated metadata to an email record — a category string, a priority level (1–4), and/or a labels array. The data is stored in `ai_category`, `ai_priority`, and `ai_labels` columns and surfaced in the UI: priority badges in ThreadList, metadata row in ReadingPane.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | string | yes | Account that owns the email (cross-account ownership enforced) |
| `email_id` | string | yes | Email UUID to categorize |
| `category` | string | no | Category label, e.g. "work", "newsletter", "finance" (max 50 chars) |
| `priority` | number | no | 1=low, 2=normal, 3=high, 4=urgent |
| `labels` | string[] | no | Tags array, e.g. ["actionable", "deadline"] (max 20 items) |

At least one of `category`, `priority`, or `labels` must be present.

**Security constraints:**
- The email's stored `account_id` must match the provided `account_id`; mismatches throw `InvalidParams`
- `priority` validated as integer in range [1, 4]
- `category` capped at 50 characters
- `labels` array capped at 20 items; non-string items are silently dropped

**Example call:**

```json
{
  "name": "categorize_email",
  "arguments": {
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "email_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "category": "finance",
    "priority": 3,
    "labels": ["invoice", "actionable"]
  }
}
```
---

### Tool: get_email_analytics

**Purpose:** Return structured mailbox analytics for a configurable time window. Gives an agent quantitative insight into email volume, sender patterns, and workload distribution without scanning individual messages.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | string | yes | Account UUID to analyze |
| `days` | number | no | Look-back window in days (default: 30, min: 1, max: 90) |

**Returns JSON object:**

| Field | Description |
|---|---|
| `period_days` | Actual window used after clamping |
| `total_received` | Total emails in the period |
| `unread_count` | Current total unread (all time, not windowed) |
| `flagged_count` | Current total flagged (all time, not windowed) |
| `per_folder` | Per-folder breakdown: name, type, count |
| `top_senders` | Top 10 senders: from_email, from_name, count |
| `emails_per_day` | Daily volume: day (ISO date), count |
| `busiest_hours` | Top 5 hours by volume: hour (0–23 UTC), count |
| `category_distribution` | Per-category counts for emails with `ai_category` set |
| `priority_distribution` | Per-priority counts for emails with `ai_priority` set |

**Example call:**

```json
{
  "name": "get_email_analytics",
  "arguments": {
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "days": 14
  }
}
```

---

### Tool: suggest_reply

**Purpose:** Assemble structured context that an AI client can use to draft a reply. This tool does **not** generate the reply itself — it packages the target email, thread history, sender history, and account identity into one JSON payload. A `hint` field reminds the agent to use `create_draft` for saving the result.

This design keeps the LLM invocation in the AI client, preserving flexibility over model choice, temperature, and system prompt design.

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | string | yes | Account that owns the email |
| `email_id` | string | yes | Email to reply to |
| `tone` | string | no | "professional" (default), "casual", "friendly", "formal", "concise" |
| `instructions` | string | no | Free-text guidance, e.g. "decline politely" (max 500 chars) |

**Returns JSON object:**

| Field | Description |
|---|---|
| `email` | The target email with `body_text` capped at 2 KB |
| `thread_context` | All thread messages ordered by date; each `body_text` capped at 2 KB |
| `sender_history` | Last 10 emails from the same sender (envelope only, no body) |
| `account` | `{ email, display_name }` for constructing the reply From line |
| `requested_tone` | The validated tone value for use in the LLM's system prompt |
| `instructions` | Passed-through free-text instructions |
| `hint` | Reminder to use `create_draft` to save the generated reply for user review |

**Security constraints:**
- Cross-account ownership enforced: the email's stored `account_id` must match the provided `account_id`
- `body_text` truncated to 2,048 characters for all messages
- `instructions` capped at 500 characters

**Recommended agent pattern:**

```
1. suggest_reply  ->  returns context JSON
2. [LLM generates HTML reply using the context]
3. create_draft   ->  saves reply for user review before sending
```

**Example call:**

```json
{
  "name": "suggest_reply",
  "arguments": {
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "email_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "tone": "concise",
    "instructions": "Confirm the meeting and ask for a dial-in number"
  }
}
```
---

## 5. AI Compose Pipeline (OpenRouter)

The in-app Sparkles button in the compose window uses a different AI path from the external MCP tools. The `ai:suggest-reply` IPC handler calls OpenRouter directly from the Electron main process.

### 5.1 End-to-End Flow

```
Renderer (ComposeModal)
  -> ipcInvoke('ai:suggest-reply', { emailId, accountId, tone })
      -> electron/main.ts  ai:suggest-reply handler
          1. Validate emailId, accountId, and tone against allowlist
          2. Cross-account ownership check on the email record
          3. Decrypt the OpenRouter API key from safeStorage
          4. Fetch thread context (last 3 messages, 500 chars each)
          5. Fetch sender history (last 3 emails, envelope only)
          6. Fetch account display_name and email address
          7. Call generateReply() in electron/openRouterClient.ts
          8. Return { html } on success or { error } on failure
      <- { html: "<p>...</p>" }
  -> DOMPurify.sanitize(html) in ComposeModal
  -> TipTap editor.commands.setContent(sanitizedHtml)
```

### 5.2 OpenRouter Client Configuration

File: `electron/openRouterClient.ts`

| Setting | Value |
|---|---|
| Model | `openai/gpt-4o-mini` |
| Max tokens | 500 |
| Timeout | 15 seconds (AbortController) |
| Max response length | 10,000 characters |
| API endpoint | `https://openrouter.ai/api/v1/chat/completions` |

**System prompt:** Instructs the model to act as an email assistant composing a reply on behalf of the account holder, using the specified tone, returning only the HTML body (no wrappers or signature).

**User message:** Includes the original email (body capped at 2,000 chars), thread context (last 3 messages at 500 chars each), and recent sender history (last 3 subjects/snippets). All user-controlled text is passed through `sanitizeForPrompt()` before inclusion.

### 5.3 Prompt Injection Sanitization

Before any user-controlled text is embedded in the prompt, it passes through:

```typescript
function sanitizeForPrompt(text: string): string {
    return text.replace(/---+/g, '—').replace(/```/g, "'''");
}
```

This prevents email content from using `---` to inject fake prompt delimiter sections or triple backticks to break out of formatted blocks.

### 5.4 HTML Safety on Return

The HTML returned by the LLM goes through two sanitization steps:

1. **Plain text detection:** If the response contains no HTML block elements, each double-newline-separated paragraph is wrapped in `<p>` tags automatically.
2. **DOMPurify sanitization:** In the renderer (ComposeModal), the HTML is sanitized with DOMPurify before being inserted into TipTap. This removes injected `<script>` tags, event handlers, and `javascript:` URLs.

### 5.5 API Key Storage

The OpenRouter API key is stored encrypted via `safeStorage` in the `settings` table under key `openrouter_api_key`. Users configure it in Settings > AI / API Keys. The plaintext key exists in memory only for the duration of the API call.

### 5.6 Tone Allowlist Validation

The `tone` parameter is validated against a fixed set: professional, casual, friendly, formal, concise. An unrecognized value defaults to `professional` rather than propagating user-controlled text into the LLM system prompt.
---

## 6. Security Model

### 6.1 Network Isolation

The MCP server binds exclusively to `127.0.0.1` and is not reachable from other machines on the network or from the internet. Only local processes on the same machine can connect.

### 6.2 Cross-Account Ownership Enforcement

The `categorize_email` and `suggest_reply` tools both check that the requested `email_id` belongs to the provided `account_id` before any operation:

```typescript
const email = db.prepare('SELECT id, account_id FROM emails WHERE id = ?').get(args.email_id);
if (!email) throw new McpError(ErrorCode.InvalidParams, 'Email not found');
if (email.account_id !== args.account_id) {
    throw new McpError(ErrorCode.InvalidParams, 'Email does not belong to the specified account');
}
```

This prevents an agent that knows one account ID from reading or modifying emails belonging to a different account. The same pattern is applied in the `ai:suggest-reply` IPC handler.

### 6.3 CRLF Injection Prevention

All SMTP fields that accept agent-provided input are stripped of carriage returns, line feeds, and null bytes before passing to Nodemailer. Without these strips, a malicious agent could inject extra SMTP headers by embedding CRLF sequences in a recipient address or subject line.

```typescript
const stripCRLF = (s: string) => s.replace(/[
 ]/g, '');
// Applied to: recipient addresses, subject line, attachment filenames
```

### 6.4 HTML and Body Content Caps

| Context | Cap |
|---|---|
| MCP `send_email` HTML body | 500,000 characters |
| MCP `suggest_reply` per-message body_text | 2,048 characters |
| `ai:suggest-reply` IPC primary email body | 2,000 characters |
| `ai:suggest-reply` IPC per thread message body | 500 characters |
| OpenRouter API response | 10,000 characters |

### 6.5 Parameterized SQL Queries

Every tool handler validates parameter types at runtime before touching the database. All database queries use parameterized prepared statements. There is no string interpolation of agent-provided data into SQL text.

### 6.6 Renderer Sandbox and Preload Allowlist

The Electron renderer runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. The preload script exposes only an explicit allowlist of IPC channels. MCP tool calls execute entirely in the main process and never reach the renderer directly.

### 6.7 FTS5 Query Sanitization

The `search_emails` tool passes the query through `sanitizeFts5Query()` (in `electron/utils.ts`) before hitting the FTS5 index, escaping or removing operator characters that could cause parse errors or unexpected boolean behavior.

### 6.8 Email HTML Rendering Safety

Email HTML displayed in the reading pane is rendered inside a `<iframe sandbox="allow-scripts">` (without `allow-same-origin`) backed by an iframe-internal CSP and DOMPurify pre-sanitization. Even if an agent sends malicious HTML via `send_email`, that HTML cannot execute scripts or access the parent frame when the user views it.
---

## 7. Settings Management

### 7.1 Agentic Settings Tab

Users configure the MCP server via Settings > Agentic. The tab provides:

- **Enable/disable toggle** — starts or stops the HTTP server; persists the `mcp_enabled` setting to SQLite
- **Port field** — editable integer in [1024, 65535]; applies via `restartMcpServer()` on save
- **Auth token display** — masked field with copy-to-clipboard button
- **Regenerate Token button** — creates a new 32-byte random token, restarts the server, immediately invalidates existing agent connections
- **Connected agents count** — live count, updated from `mcp:status` IPC push events
- **Tools list** — all registered tool names and descriptions, fetched via `mcp:get-tools`

### 7.2 IPC Channels for MCP Management

| Channel | Direction | Purpose |
|---|---|---|
| `mcp:get-status` | invoke | Returns `{ running, port, connectedCount }` |
| `mcp:get-token` | invoke | Returns `{ token }` (plaintext for display) |
| `mcp:regenerate-token` | invoke | Generates new token, restarts server, returns `{ token }` |
| `mcp:set-port` | invoke | Validates port, persists, restarts server |
| `mcp:toggle` | invoke | Enables or disables the server; persists `mcp_enabled` |
| `mcp:get-tools` | invoke | Returns `{ tools: [{ name, description }] }` |
| `mcp:connected-count` | invoke | Returns `{ count }` (current connected agent count) |
| `mcp:status` | on (push) | Pushed to renderer when agent count changes: `{ connectedAgents }` |

### 7.3 Persisted Settings Keys

| Key | Value type | Default | Description |
|---|---|---|---|
| `mcp_enabled` | "true" or "false" | "true" | Whether the server starts on app launch |
| `mcp_port` | Integer as string | "3000" | Listening port |
| `mcp_auth_token` | Base64-encoded (safeStorage-encrypted) | Auto-generated | The bearer token |
| `openrouter_api_key` | Base64-encoded (safeStorage-encrypted) | null | OpenRouter API key for AI compose |
---

## 8. Integration Flow

This section walks through the complete lifecycle of an external AI agent connecting to and using ExpressDelivery.

### Step 1 — Retrieve the Auth Token

Open Settings > Agentic in ExpressDelivery. Copy the auth token shown in the masked field. The token is a 64-character hex string (32 bytes of entropy). Treat it like a password: do not commit it to source control or include it in logs.

### Step 2 — Configure Your MCP Client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "expressdelivery": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-sse"],
      "env": {
        "MCP_SERVER_URL": "http://127.0.0.1:3000/sse",
        "MCP_AUTH_TOKEN": "<your-token-here>"
      }
    }
  }
}
```

**Custom Node.js agent** using the MCP SDK:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const TOKEN = process.env.MCP_AUTH_TOKEN ?? '';

const transport = new SSEClientTransport(
    new URL('http://127.0.0.1:3000/sse'),
    {
        requestInit: { headers: { Authorization: 'Bearer ' + TOKEN } },
        eventSourceInit: {
            fetch: (url, init) => fetch(url, {
                ...init,
                headers: { ...(init?.headers), Authorization: 'Bearer ' + TOKEN }
            })
        }
    }
);

const client = new Client({ name: 'my-agent', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
```

### Step 3 — Discover Tools

```typescript
const { tools } = await client.listTools();
// tools: Array<{ name: string; description: string; inputSchema: object }>
```

### Step 4 — Orient with a Mailbox Survey

Call `get_smart_summary` first to understand the state of the mailbox before taking any actions:

```typescript
const result = await client.callTool({ name: 'get_smart_summary', arguments: { account_id: '<uuid>' } });
const summary = JSON.parse(result.content[0].text);
console.log(`Unread: ${summary.unread_count}`);
console.log(`High priority: ${summary.high_priority_emails.length}`);
```

### Step 5 — Search and Read

```typescript
const searchResult = await client.callTool({ name: 'search_emails', arguments: { query: 'project proposal deadline' } });
const emails = JSON.parse(searchResult.content[0].text);
const threadResult = await client.callTool({ name: 'read_thread', arguments: { thread_id: emails[0].thread_id } });
const thread = JSON.parse(threadResult.content[0].text);
```

### Step 6 — Categorize Emails

```typescript
await client.callTool({
    name: 'categorize_email',
    arguments: { account_id: '<uuid>', email_id: emails[0].id, category: 'work', priority: 3, labels: ['actionable', 'deadline'] }
});
```

### Step 7 — Draft a Reply

The recommended pattern is `suggest_reply` → LLM → `create_draft`:

```typescript
// 1. Get structured reply context
const ctxResult = await client.callTool({
    name: 'suggest_reply',
    arguments: { account_id: '<uuid>', email_id: emails[0].id, tone: 'professional',
                instructions: 'Accept the meeting invitation and propose 10am' }
});
const context = JSON.parse(ctxResult.content[0].text);

// 2. Your LLM generates an HTML reply using context.email,
//    context.thread_context, context.account, and context.requested_tone
const replyHtml = '<p>Thank you for the invitation. 10am works well for me.</p>';

// 3. Save as draft for the user to review before sending
await client.callTool({
    name: 'create_draft',
    arguments: { account_id: context.email.account_id, to: [context.email.from_email],
                subject: 'Re: ' + context.email.subject, html: replyHtml }
});
```

### Step 8 — Disconnect

Close the SSE connection when the agent is done. The server detects the HTTP stream closure and removes the session from the map, decrementing the connected agent count shown in the Sidebar.
---

## 9. Development Guide

### 9.1 Adding a New MCP Tool

**Step 1 — Write the handler** in `electron/mcpTools.ts`:

```typescript
async function handleMyNewTool(
    args: Record<string, unknown>,
    db: BetterSqlite3.Database
): Promise<ToolResult> {
    if (typeof args.account_id !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'account_id must be a string');
    }
    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(args.account_id);
    if (!account) throw new McpError(ErrorCode.InvalidParams, 'Account not found');
    const rows = db.prepare('SELECT id, subject FROM emails WHERE account_id = ? LIMIT 10').all(args.account_id);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
}
```

**Step 2 — Register the tool** in `buildToolRegistry()`:

```typescript
tools.set('my_new_tool', {
    description: 'One sentence describing what this tool does.',
    inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
    handler: handleMyNewTool,
});
```

The tool is immediately available to connected agents on the next server start or `restartMcpServer()` call. Document it in this file with a parameter table and example JSON call.

### 9.2 Writing Unit Tests

Test files live at `electron/__tests__/mcpTools.test.ts`. Create an in-memory SQLite database with minimal fixtures and call the handler directly — no HTTP transport required.

```typescript
import { buildToolRegistry } from '../mcpTools.js';
import Database from 'better-sqlite3';

describe('my_new_tool', () => {
    let db: Database.Database;
    beforeEach(() => {
        db = new Database(':memory:');
        db.exec('CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT)');
        db.exec("INSERT INTO accounts VALUES ('acc1', 'test@example.com')");
    });
    afterEach(() => db.close());

    it('returns data for a valid account', async () => {
        const tool = buildToolRegistry().get('my_new_tool')!;
        const result = await tool.handler({ account_id: 'acc1' }, db);
        expect(result.isError).toBeFalsy();
    });

    it('rejects non-string account_id', async () => {
        const tool = buildToolRegistry().get('my_new_tool')!;
        await expect(tool.handler({ account_id: 42 }, db)).rejects.toThrow('account_id must be a string');
    });
});
```

### 9.3 Testing the Live MCP Endpoint

With the app running in dev mode, retrieve the token from Settings > Agentic and test with curl:

```bash
TOKEN="your-64-char-hex-token"
# The SSE endpoint sends an event:endpoint event containing the sessionId
curl -sN -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/sse
# Then POST tool calls to /message?sessionId=<UUID>
```

### 9.4 Restarting During Development

Use Settings > Agentic to change the port or toggle the server. This invokes `restartMcpServer()` without requiring an Electron restart. All currently connected agents will be disconnected.

### 9.5 Key Constraints for Tool Handlers

- Handlers must not throw for expected client-side errors. Use `McpError(ErrorCode.InvalidParams)` instead.
- Handlers must not import Electron modules. They receive only a `db` reference.
- All per-account data access must enforce cross-account ownership explicitly.
- Every `inputSchema` must list all required fields in the `required` array.
- Large text fields must be capped before returning to agents.
---

## 10. Agent Validation Process

ExpressDelivery uses a **tech-lead orchestrator** pattern for quality assurance during development. This pattern is especially relevant for AI-related code changes where correctness and security guarantees must be independently verified.

### 10.1 Subagent Roles

When a change needs independent review, the orchestrator dispatches specialized subagent roles in parallel rather than relying on any single analysis:

| Subagent | Responsibility |
|---|---|
| `code-archaeologist` | Traces data flow, finds caller/callee chains, maps module dependencies |
| `cyber-sentinel` | OWASP Top 10, injection analysis, authentication and authorization review |
| `code-reviewer` | Architecture patterns, type safety, naming consistency, error handling |
| `code-simplifier` | Dead code detection, refactoring opportunities, complexity reduction |
| `qa-engineer` | Test coverage gaps, edge case identification, regression risk assessment |
| `documentation-specialist` | Docs completeness, accuracy of inline comments, README and AGENTS_MCP.md freshness |

### 10.2 Mandatory 8-Step Quality Pipeline

All changes to ExpressDelivery follow this sequence before merging:

1. **Implementation** — write the feature or fix
2. **ESLint auto-fix** — `npm run lint -- --fix` on all modified files
3. **Parallel analysis** — `code-simplifier`, `cyber-sentinel`, and `code-reviewer` run simultaneously in a single message
4. **Remediation** — all findings from step 3 are addressed before proceeding
5. **Pre-existing scan** — boy scout rule: fix any pre-existing issues in all touched files
6. **Test validation** — `qa-engineer` validates coverage and identifies uncovered edge cases
7. **Build verification** — `npm run build:win` to catch TypeScript errors and native module issues
8. **Documentation update** — `documentation-specialist` updates CLAUDE.md, README.md, and this file

### 10.3 MCP-Specific Validation Checklist

When adding or modifying an MCP tool, verify each item before merging:

- [ ] Cross-account ownership enforced for all per-account data access
- [ ] All parameters type-checked at runtime (TypeScript types alone are insufficient at runtime)
- [ ] User-controlled strings passed to SQL use parameterized statements, never string interpolation
- [ ] Free-text fields have explicit length caps appropriate to the field
- [ ] The tool is registered in `buildToolRegistry()` with an accurate `description` and complete `inputSchema`
- [ ] A test covers the unauthorized-account (cross-account) scenario
- [ ] A test covers missing or invalid required parameters
- [ ] A test covers the happy path with a real in-memory SQLite database fixture
- [ ] The tool is documented in this file with a parameter table and a JSON call example

### 10.4 Security Audit History

Ten rounds of security and code review were completed between 2026-02-22 and 2026-02-27. Current security posture: **A-** (0 Critical, 1 High).

The single remaining High finding is an inherent limitation of the JavaScript runtime: decrypted passwords and API keys exist in the V8 heap for the duration of their use and cannot be explicitly zeroed in JavaScript. This is mitigated by keeping decryption calls within the narrowest possible lexical scope and never caching plaintext credentials in module-level variables or long-lived objects.

Full audit reports are available in `.claude/`:

- `security-audit-report.md` — OWASP-aligned findings and remediations
- `code-review-report.md` — architecture and pattern review history
- `qa-report.md` — test coverage analysis and gap findings
- `cleanup-report.md` — dead code and style remediation history