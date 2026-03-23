# ExpressDelivery — System Architecture

Anti-loop reference and architecture guide for contributors and AI agents.
Last updated: 2026-03-22 (v1.15.4).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Process Architecture](#2-process-architecture)
3. [Data Flow Patterns](#3-data-flow-patterns)
4. [SQLite Architecture](#4-sqlite-architecture)
5. [MCP Server Architecture](#5-mcp-server-architecture)
6. [Preload and Sandbox Architecture](#6-preload-and-sandbox-architecture)
7. [CSS and Theming Architecture](#7-css-and-theming-architecture)
8. [Build System](#8-build-system)
9. [Challenge Log](#9-challenge-log)
10. [Quick Reference — If You Are Stuck](#10-quick-reference--if-you-are-stuck)

---

## 1. System Overview

ExpressDelivery is an Electron 41 desktop email client built with React 19 and TypeScript 5.9 in strict mode. It speaks IMAP (via IMAPFlow) and SMTP (via Nodemailer), stores all state in a local SQLite database (better-sqlite3, WAL mode, FTS5 full-text search), and exposes an MCP (Model Context Protocol) server over SSE so that external AI agents can read, search, send, and categorize email. The UI is a three-pane React SPA rendered in the Chromium process; the main process (Node.js) owns all I/O and exposes approximately 107 typed IPC handlers through a sandboxed preload bridge. Security properties include bearer-token MCP auth, sandboxed iframes for HTML email, DOMPurify sanitization, safeStorage encryption for credentials, CRLF injection prevention, and a channel allowlist on the preload bridge.

---

## 2. Process Architecture

```
Electron Main Process (Node.js / ABI 145)
|
+-- electron/main.ts         ~107 IPC handlers, window, tray, crash handler (frameless, no menu)
+-- electron/db.ts           SQLite via better-sqlite3 (WAL, foreign keys, FTS5, 12 migrations)
+-- electron/imap.ts         Per-account AccountSyncController (connect, IDLE, sync, withImapTimeout, NOOP heartbeat, infinite reconnect with backoff+jitter, on-demand body)
+-- electron/smtp.ts         Nodemailer (TLS/STARTTLS, CC/BCC, attachments, CRLF-safe)
+-- electron/mcpServer.ts    Express 5 SSE server (multi-client Map, bearer auth, lazy init)
+-- electron/mcpTools.ts     8 MCP tool handlers — buildToolRegistry() returns Map<string, ToolDef>
+-- electron/scheduler.ts    30s polling (snooze wake, scheduled sends, reminder notifications)
+-- electron/crypto.ts       safeStorage encryption/decryption wrapper
+-- electron/menu.ts         Application menu bar builder (File/Edit/View/Message/Window/Help)
+-- electron/ruleEngine.ts   Mail rule matching and actions
+-- electron/spamFilter.ts   Bayesian spam classifier (tokenize, train, classify)
+-- electron/openRouterClient.ts  OpenRouter LLM API client (15s timeout, prompt sanitization)
+-- electron/updater.ts      electron-updater wrapper (autoDownload: false)
+-- electron/emailExport.ts  EML single + MBOX folder export
+-- electron/emailImport.ts  EML/MBOX import (1000 msg cap)
+-- electron/contactPortability.ts  vCard 3.0 + CSV import/export
+-- electron/logger.ts       File logger (writes to app.getPath('logs'))
+-- electron/utils.ts        FTS5 query sanitizer, stripCRLF, escapeAttr
|
+-- electron/preload.ts  -->  contextBridge (channel allowlist, CJS output)
                              |
                              | IPC: invoke + on (allowlisted channels only)
                              |
Electron Renderer Process (Chromium)
|
+-- src/App.tsx              Root component, error boundary, toast system, reply/forward plumbing
+-- src/components/          14 UI components + 12 co-located CSS Module files
|     Sidebar.tsx            Multi-account switcher, folder list, unread badges, MCP indicator
|     ThreadList.tsx         Email list, search, multi-select, bulk actions, context menu
|     ReadingPane.tsx        HTML viewer (sandboxed iframe), reply/forward/delete/star, CID images
|     ComposeModal.tsx       TipTap rich text, To/CC/BCC, signatures, scheduled send
|     SettingsModal.tsx      Account management, themes, MCP/AI settings (9 Radix Tabs)
|     OnboardingScreen.tsx   First-run wizard (4 steps, 9 animations, WCAG 2.1)
|     ConfirmDialog.tsx      Radix Dialog replacing window.confirm/prompt
|     ContactAutocomplete.tsx  ARIA combobox for To/CC/BCC fields
|     DateTimePicker.tsx     Native datetime input with quick-select presets
|     UpdateBanner.tsx       electron-updater progress and install banner
|     MessageSourceDialog.tsx  Raw RFC822 source viewer
|     ThemeContext.tsx       Layout context and theme class application
+-- src/stores/
|     emailStore.ts          Zustand: accounts, folders, emails, tags, savedSearches, multi-select
|     themeStore.ts          Zustand persisted: theme, layout, density, zoom
+-- src/lib/
|     ipc.ts                 Typed ipcInvoke / ipcOn wrappers
|     i18n.ts                react-i18next init (en/fr/es/de)
|     useKeyboardShortcuts.ts  Global shortcut hook (mod+N/R/F/E/J/K/Delete/Escape)
|     providerPresets.ts     IMAP/SMTP defaults for Gmail, Outlook, Yahoo, iCloud, Custom
|     providerIcons.tsx      Brand SVG icons
|     phishingDetector.ts    7-rule URL heuristic checker
|     formatFileSize.ts      Human-readable file size formatter
+-- src/locales/             en.json, fr.json, es.json, de.json

External AI Agent --> HTTP SSE on port 3000 (Bearer token)
                  --> McpServerManager (Express 5, 127.0.0.1 only)
                      --> buildToolRegistry() Map
                          --> SQLite getDatabase() / smtpEngine
```

### Key Singletons (Main Process)

| Module | Export | Notes |
|---|---|---|
| `electron/db.ts` | `db` (module-level `let`) | Initialized once via `initDatabase()` |
| `electron/imap.ts` | `imapEngine` | `ImapEngine` class instance |
| `electron/smtp.ts` | `smtpEngine` | `SmtpEngine` class instance |
| `electron/scheduler.ts` | `schedulerEngine` | `SchedulerEngine` class instance |
| `electron/mcpServer.ts` | `getMcpServer()` | Lazy factory; same instance after first call |

---

## 3. Data Flow Patterns

### 3.1 IMAP to Renderer (Email Sync)

```
IMAPFlow (remote IMAP server)
  |  persistent connection per account, IDLE for push notifications
  v
ImapEngine.syncFolders()
  |  listAndSyncFolders() writes to SQLite `folders` table
  v
ImapEngine.syncEmails()
  |  fetches envelopes + bodyStructure (no body content yet)
  |  stores rows in SQLite `emails` table
  |  FTS5 triggers update emails_fts automatically on INSERT
  |  applyRulesToEmail() called per new message
  v
main.ts IPC handler `startup:load`
  |  queries SQLite for accounts, folders, emails
  v
Renderer emailStore (Zustand)
  |  setAccounts(), setFolders(), setEmails()
  v
React components re-render (Sidebar, ThreadList)
```

Body is fetched on demand when the user clicks an email:

```
User clicks email in ThreadList
  v
ReadingPane --> ipc.invoke('emails:read', { id })
  v
main.ts handler --> ImapEngine.fetchBody(id)
  |  downloads MIME part from IMAP server
  |  stores body_text + body_html in SQLite
  v
Returns body to renderer; ReadingPane renders sandboxed iframe
```

### 3.2 Renderer to SMTP (Sending)

```
ComposeModal (TipTap editor)
  |  collects To/CC/BCC, subject, body HTML, attachments
  v
ipc.invoke('email:send', payload)
  v
main.ts handler
  |  stripCRLF on all recipient fields and subject (CRLF injection prevention)
  v
smtpEngine.sendEmail(accountId, to, subject, html, cc, bcc, attachments)
  |  decrypts password via safeStorage (short-lived scope)
  |  TLS on port 465, STARTTLS on port 587
  v
Nodemailer transporter delivers to SMTP server
```

### 3.3 MCP Agent to Email (AI Tool Call)

```
External AI agent (e.g. Claude Desktop)
  |  HTTP POST /messages?sessionId=X with Bearer token header
  v
McpServerManager (Express 5, bound to 127.0.0.1:3000)
  |  timing-safe Bearer token check via crypto.timingSafeEqual
  |  routes to per-session Server instance via Map<sessionId, ClientSession>
  v
CallToolRequestSchema handler
  |  looks up tool in buildToolRegistry() Map by name
  |  calls tool.handler(args, db)
  v
Tool handler (e.g. handleSendEmail)
  |  reads/writes SQLite via getDatabase()
  |  or calls smtpEngine for sending
  |  enforces account ownership on all email/folder operations
  v
Returns MCP ToolResult to agent via SSE transport
```

### 3.4 Scheduler to OS Notifications

```
SchedulerEngine (setInterval, 30000ms)
  |  first tick fires after 2s startup delay (non-blocking)
  v
  +-- Query snoozed_emails WHERE snooze_until <= now
  |     --> restore email to original_folder_id in SQLite
  |     --> onSnoozeRestore callback
  |     --> main.ts emits 'email:new' IPC event to renderer
  |
  +-- Query scheduled_sends WHERE send_at <= now AND status = 'pending'
  |     --> smtpEngine.sendEmail() (up to MAX_RETRIES = 3)
  |     --> UPDATE status to 'sent' or 'failed'
  |
  +-- Query reminders WHERE remind_at <= now AND status = 'pending'
        --> new Notification(...) via Electron Notification API
        --> UPDATE status to 'notified'
```

---

## 4. SQLite Architecture

**Database file:** `{app.getPath('userData')}/expressdelivery.sqlite`

**PRAGMAs set at init:**

```sql
PRAGMA journal_mode = WAL;   -- concurrent reads during IMAP sync writes
PRAGMA foreign_keys = ON;    -- cascade deletes enforced at DB level
```

### 4.1 Schema Tables

| Table | Purpose | Notable columns |
|---|---|---|
| `accounts` | Email accounts | `id`, `email`, `provider`, `password_encrypted`, `imap_host`, `imap_port`, `smtp_host`, `smtp_port`, `display_name`, `signature_html` |
| `folders` | Mailbox hierarchy | `id`, `account_id`, `name`, `path`, `type`, `color` |
| `emails` | Messages | `id`, `account_id`, `folder_id`, `thread_id`, `subject`, `from_name`, `from_email`, `to_email`, `date`, `snippet`, `body_text`, `body_html`, `is_read`, `is_flagged`, `has_attachments`, `ai_category`, `ai_priority`, `ai_labels`, `is_snoozed`, `list_unsubscribe`, `spam_score`, `schema_version` |
| `emails_fts` | FTS5 virtual table | indexes `subject`, `from_name`, `from_email`, `snippet`, `body_text` from `emails` |
| `attachments` | File metadata + BLOB cache | `id`, `email_id`, `filename`, `mime_type`, `size`, `data` (BLOB), `content_id` |
| `drafts` | Pending emails | `id`, `account_id`, `to_email`, `cc`, `bcc`, `subject`, `body_html`, `attachments_json` |
| `contacts` | Auto-harvested senders/recipients | `id`, `email`, `name`, `company`, `phone`, `title`, `notes` |
| `settings` | Key-value app configuration | `key`, `value` |
| `snoozed_emails` | Snooze queue | `id`, `email_id`, `account_id`, `original_folder_id`, `snooze_until` |
| `scheduled_sends` | Send-later queue | `id`, `account_id`, `draft_id`, `to_email`, `cc`, `bcc`, `subject`, `body_html`, `attachments_json`, `send_at`, `status`, `retry_count` |
| `reminders` | Email reminders | `id`, `email_id`, `account_id`, `remind_at`, `note`, `status` |
| `mail_rules` | Auto-processing rules | `id`, `account_id`, `conditions` (JSON), `actions` (JSON), `priority`, `enabled` |
| `tags` | User-defined labels | `id`, `account_id`, `name`, `color` |
| `email_tags` | Tag-to-email junction | `email_id`, `tag_id` |
| `saved_searches` | Persisted FTS queries | `id`, `account_id`, `name`, `query`, `icon` |
| `spam_tokens` | Bayesian classifier token counts | `token`, `account_id`, `spam_count`, `ham_count` |
| `spam_stats` | Classifier totals per account | `account_id`, `total_spam`, `total_ham` |

### 4.2 FTS5 Configuration

`emails_fts` is a content-table FTS5 index backed by the `emails` table. Three triggers maintain it automatically:

- `emails_ai` (AFTER INSERT) -- adds new row to the FTS index
- `emails_ad` (AFTER DELETE) -- removes row from the FTS index
- `emails_au` (AFTER UPDATE) -- deletes then re-inserts in the FTS index

All FTS5 queries pass through `sanitizeFts5Query()` in `electron/utils.ts` before execution. This function strips characters that would break FTS5 query syntax and returns `null` for empty queries, which callers treat as a no-op.

### 4.3 Migration System

`setupSchema()` in `electron/db.ts` applies up to 12 schema migrations (as of v1.10.0). The migration runner checks the current `schema_version` in the `settings` table and short-circuits at `CURRENT_SCHEMA_VERSION` so already-migrated databases skip all processing. Each migration uses `IF NOT EXISTS` guards or column presence checks to be idempotent.

---

## 5. MCP Server Architecture

### 5.1 Lazy Initialization

The MCP server does not start at app launch. `getMcpServer()` in `electron/mcpServer.ts` is a factory function: on first call it creates and starts a `McpServerManager` instance, then caches and returns it on every subsequent call. If the user never enables MCP in Settings, no Express server is ever started.

```
getMcpServer() first call
  --> new McpServerManager(options)
      --> express() + cors({ origin: false }) + express.json()
      --> setupAuth() -- Bearer token middleware (timing-safe comparison)
      --> setupRoutes() -- GET /sse, POST /messages
      --> server.listen(port, '127.0.0.1')
  --> cache instance

getMcpServer() subsequent calls
  --> return cached instance
```

### 5.2 Multi-Client Session Model

Each SSE connection from an external agent creates an isolated `ClientSession` with its own `Server` (MCP SDK) and `SSEServerTransport` instance. Sessions are stored in a `Map<sessionId, ClientSession>`. On disconnect, the session is removed and the live connection count is pushed to the renderer via the `mcp:status` IPC event, which drives the connection badge in the Sidebar.

```typescript
interface ClientSession {
    server: Server;                  // @modelcontextprotocol/sdk Server instance
    transport: SSEServerTransport;   // per-connection transport
}

private transports: Map<string, ClientSession> = new Map();
```

### 5.3 Tool Registry

`buildToolRegistry()` in `electron/mcpTools.ts` returns a `Map<string, ToolDefinition>`. Each entry contains a description, a JSON Schema `inputSchema`, and an async `handler(args, db)` function.

| Tool | Description |
|---|---|
| `search_emails` | FTS5 full-text search, returns up to 20 results with AI metadata |
| `read_thread` | Fetch all emails in a thread by `thread_id` |
| `send_email` | Send via SMTP (CRLF-safe, 500KB HTML cap, filename sanitized) |
| `create_draft` | Insert a draft into SQLite for user review in the UI |
| `get_smart_summary` | Recent 20 emails, unread/flagged counts, folder list, drafts |
| `categorize_email` | Write `ai_category`, `ai_priority`, `ai_labels` to the email row |
| `get_email_analytics` | Volume, top senders, busiest hours, category/priority distribution (1-90 days) |
| `suggest_reply` | Reply context: email body + thread history + sender history + account info |

### 5.4 Security Properties

- Bearer token stored encrypted in the `settings` table; decrypted at server init.
- Token comparison uses `crypto.timingSafeEqual` to prevent timing-based token extraction.
- Express server binds exclusively to `127.0.0.1` -- not reachable from LAN.
- `cors({ origin: false })` rejects all cross-origin requests.
- All tool handlers enforce cross-account ownership.

---

## 6. Preload and Sandbox Architecture

### 6.1 Why the Preload Must Be CJS

Electron requires CommonJS (`require()`) for preload scripts when `sandbox: true` is active. ESM module preloads are not supported in sandboxed mode. The build configuration in `vite.config.ts` outputs the preload entry as CJS with a `.cjs` extension. `electron/main.ts` references it as `preload.cjs`.

**Never change the preload output format to ESM or rename it to `.js`.**

### 6.2 Channel Allowlist

`electron/preload.ts` defines two constant arrays:

- `ALLOWED_INVOKE_CHANNELS` -- channels callable via `ipcRenderer.invoke()`
- `ALLOWED_ON_CHANNELS` -- channels listenable via `ipcRenderer.on()`

The `contextBridge.exposeInMainWorld` call wraps these arrays so any call with an unlisted channel is silently rejected. As of v1.12.5 there are approximately 168 invoke channels and 12 on-channels.

### 6.3 BrowserWindow Security Configuration

```typescript
new BrowserWindow({
    webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
    }
})
```

All three flags must remain set.

### 6.4 Typed IPC Wrapper

`src/lib/ipc.ts` exports `ipcInvoke<T>(channel, args)` and `ipcOn(channel, handler)`. All renderer IPC calls go through this wrapper for TypeScript type safety.

---

## 7. CSS and Theming Architecture

### 7.1 CSS Modules

All component styles use co-located CSS Module files (e.g. `Sidebar.module.css` alongside `Sidebar.tsx`). Class names accessed via bracket notation: `styles['class-name']`. Vite hashes class names at build time.

**Critical constraint for Radix portals:** Radix UI Dialog, DropdownMenu, and Popover render their DOM nodes under `document.body` via React portals. Any style targeting portal content must use `:global(.className)` in the module file and a plain string as the `className` prop in JSX.

```css
/* CorrectDialog.module.css */
:global(.correctDialogOverlay) {
    background: rgba(0, 0, 0, 0.5);
    position: fixed;
    inset: 0;
}
```

```tsx
/* CorrectDialog.tsx */
<Dialog.Overlay className="correctDialogOverlay" />
```

### 7.2 Theme System

Four themes defined in `src/index.css` as CSS custom properties using RGB component values.

| Theme | Class | Accent color |
|---|---|---|
| Light | `theme-light` | Indigo |
| Cream | `theme-cream` | Gold (solarized palette) |
| Midnight | `theme-midnight` | Purple |
| Forest | `theme-forest` | Emerald |

### 7.3 Persisted UI State

`themeStore` (Zustand with `persist` middleware) saves to `localStorage`:

| Key | Type | Values |
|---|---|---|
| `themeName` | string | `'light'`, `'cream'`, `'midnight'`, `'forest'` |
| `layout` | string | `'vertical'`, `'horizontal'` |
| `densityMode` | string | `'compact'`, `'comfortable'`, `'relaxed'` |
| `readingPaneZoom` | number | 80-150 (percent) |

### 7.4 Tailwind CSS v4

Tailwind v4 provides utility classes. CSS custom properties serve as the token source. Component-specific layout uses CSS Modules; Tailwind utilities for one-off styles.

---

## 8. Build System

### 8.1 Vite and vite-plugin-electron

Vite 7 with `vite-plugin-electron` handles three entry points:

| Entry | Output | Format |
|---|---|---|
| `src/main.tsx` | `dist/` | ESM (renderer SPA) |
| `electron/main.ts` | `dist-electron/main.js` | ESM |
| `electron/preload.ts` | `dist-electron/preload.cjs` | CJS (required by Electron) |

### 8.2 electron-builder Targets

| Platform | Output formats |
|---|---|
| Windows | NSIS installer, unpacked directory (`win-unpacked/`) |
| macOS | DMG |
| Linux | AppImage, `.deb`, `.rpm` |

### 8.3 Clean Build Script (`scripts/clean-build.mjs`)

All `build:*` npm scripts delegate to this script:

1. Kill the running app process on Windows (`taskkill`) to release file locks.
2. Purge stale build artifacts (`dist/`, `dist-electron/`, `release/`).
3. Delete `node_modules/better-sqlite3/build/` to force a clean native rebuild.
4. Delete `.forge-meta` cache files.
5. Run `@electron/rebuild -v 41.0.3 --only better-sqlite3 --force` for Electron ABI 145.
6. Run TypeScript compilation, Vite build, and electron-builder packaging.
7. Verify the packaged binary exists.
8. Run `npm rebuild better-sqlite3` to restore host ABI 137 for Vitest. (Skippable with `--no-restore`.)

When `--linux` and `--win` are both passed, it rebuilds native deps between platforms.

### 8.4 ABI Reference

| Runtime | ABI version |
|---|---|
| Node.js v24 | 137 |
| Electron 41 | 145 |

`better-sqlite3` is NAN-based (not NAPI), so it must be compiled for the specific ABI. For manual rebuilds:

```bash
rm -rf node_modules/better-sqlite3/build/
npx @electron/rebuild -v 41.0.3 -m . --only better-sqlite3 --force
npx electron-builder --win --dir
npm rebuild better-sqlite3   # restore for Vitest
```

### 8.5 CI/CD Workflows

| Workflow file | Trigger | Steps |
|---|---|---|
| `.github/workflows/ci.yml` | push, pull_request | eslint, vitest, tsc |
| `.github/workflows/release.yml` | `v*` tag push | build all platforms + publish to GitHub Releases |

---

## 9. Challenge Log

This section documents recurring pitfalls. Read this before re-investigating any of these issues.

---

### Challenge 1: better-sqlite3 ABI Mismatch

**Symptom:** App crashes with `NODE_MODULE_VERSION mismatch`.

**Root Cause:** `better-sqlite3` is NAN-based. Node.js v24 uses ABI 137; Electron 41 uses ABI 145. Wrong binary = crash.

**Solution:** Use `scripts/clean-build.mjs` which purges the old binary, rebuilds for Electron ABI, packages, then restores host ABI for Vitest.

**Prevention:** Never manually copy `better_sqlite3.node`. Never skip the clean build script.

---

### Challenge 2: Preload Must Be CJS

**Symptom:** `window.electronAPI is undefined` in renderer.

**Root Cause:** Electron requires `require()` for sandboxed preload. ESM doesn't work.

**Solution:** `vite.config.ts` outputs preload as `.cjs`. Referenced as `preload.cjs` in `main.ts`.

**Prevention:** Never change preload output format.

---

### Challenge 3: Radix Portal CSS in CSS Modules

**Symptom:** Radix Dialog/DropdownMenu/Popover has no styles.

**Root Cause:** Portals render under `document.body`, outside CSS Module scope.

**Solution:** Use `:global(.className)` in `.module.css` for portal-targeted styles.

**Prevention:** Check if Radix element uses portal before styling.

---

### Challenge 4: React 19 useRef Typing

**Symptom:** TypeScript error `Expected 1 arguments, but got 0` on `useRef<T>()`.

**Root Cause:** React 19 removed zero-argument overload.

**Solution:** Use `useRef<T>(undefined)`.

---

### Challenge 5: Vitest vi.mock() Hoisting

**Symptom:** Mock variable `undefined` inside `vi.mock()` factory.

**Root Cause:** `vi.mock()` hoisted before variable declarations.

**Solution:** Use `vi.hoisted()`:

```typescript
const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('../../lib/ipc', () => ({ ipcInvoke: mockInvoke }));
```

---

### Challenge 6: CSS Module Classes in Tests

**Symptom:** `toHaveClass` or `querySelector` fails in tests.

**Root Cause:** Class names hashed at build time; jsdom doesn't have same hashes.

**Solution:** Use `getByRole`, `getByText`, `data-testid` selectors.

---

### Challenge 7: Cross-Platform Build Order

**Symptom:** Windows build crashes with `invalid ELF header` after Linux build.

**Root Cause:** Linux build overwrites `better_sqlite3.node` with ELF binary.

**Solution:** `scripts/clean-build.mjs` rebuilds between platforms when both flags passed.

**Prevention:** Use `npm run build:all`.

---

### Challenge 8: IMAP Secure Flag

**Symptom:** IMAP TLS handshake failure.

**Root Cause:** Port 993 = implicit TLS (`secure: true`). Port 587 = STARTTLS (`secure: false`).

**Solution:** `secure: port === 993`.

**Prevention:** Never hardcode the secure flag.

---

### Challenge 9: SettingsModal Mount IPC Calls

**Symptom:** SettingsModal tests fail with unmocked IPC calls on mount.

**Root Cause:** Three IPC calls fire on mount: `apikeys:get-openrouter`, `settings:get(notifications_enabled)`, `settings:get(undo_send_delay)`.

**Solution:** Mock all three in `beforeEach`:

```typescript
mockInvoke.mockImplementation((channel: string, args?: unknown) => {
    if (channel === 'apikeys:get-openrouter') return Promise.resolve(null);
    if (channel === 'settings:get') {
        const key = (args as { key: string })?.key;
        if (key === 'notifications_enabled') return Promise.resolve('true');
        if (key === 'undo_send_delay') return Promise.resolve('5');
    }
    return Promise.resolve(null);
});
```

---

### Challenge 10: Radix Tabs in jsdom Tests

**Symptom:** Clicking Radix Tab trigger doesn't switch tab.

**Root Cause:** jsdom's `fireEvent.click()` is insufficient for Radix's pointer event sequence.

**Solution:** Use `userEvent.click()`:

```typescript
const user = userEvent.setup();
await user.click(screen.getByRole('tab', { name: 'AI Settings' }));
```

---

### Challenge 11: TipTap and i18next Peer Dependency Conflict

**Symptom:** `npm install` fails with `ERESOLVE` peer dep conflict.

**Root Cause:** `eslint-plugin-react-hooks` peer dep conflict with TipTap/i18next.

**Solution:** `npm install --legacy-peer-deps`.

---

## 10. Quick Reference -- If You Are Stuck

| Symptom | Most Likely Cause | See |
|---|---|---|
| App crashes: `NODE_MODULE_VERSION mismatch` | Wrong ABI binary packaged | Challenge 1 |
| `window.electronAPI is undefined` | Preload not CJS | Challenge 2 |
| Radix Dialog/Popover has no styles | Portal outside CSS Module scope | Challenge 3 |
| TypeScript: `Expected 1 arguments` on useRef | React 19 signature change | Challenge 4 |
| Mock `undefined` inside `vi.mock()` | Hoisting before declarations | Challenge 5 |
| `toHaveClass` fails in tests | CSS Module hashed names | Challenge 6 |
| Windows build has Linux ELF binary | Cross-platform build order | Challenge 7 |
| IMAP TLS handshake failure | Wrong `secure` flag for port | Challenge 8 |
| SettingsModal test errors on mount | Three IPC calls not mocked | Challenge 9 |
| Radix Tabs click doesn't switch | jsdom needs `userEvent.click()` | Challenge 10 |
| `npm install` peer dep conflict | TipTap/i18next peer deps | Challenge 11 |
| Email body empty after sync | Body fetched on demand, not at startup | Section 3.1 |
| MCP server not starting | Lazy init: `getMcpServer()` not called | Section 5.1 |
| FTS5 search returns 0 results | Query not sanitized or has FTS syntax | Section 4.2 |
| Scheduled email not sent | Scheduler polls every 30s; check status | Section 3.4 |
| Attachment gone after email delete | FK cascade by design | Section 4.1 |
| electron-builder file lock on Windows | App running (check system tray) | Section 8.3 |

---

*For feature roadmap, see `docs/ROADMAP.md`. For design system, see `docs/UI.md`. For MCP integration, see `docs/AGENTS_MCP.md`. For security details, see `docs/SECURITY.md`.*
