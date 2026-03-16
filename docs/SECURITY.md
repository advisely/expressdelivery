# ExpressDelivery Security Document

**Last updated:** 2026-03-16
**Current posture:** A- (0 Critical, 0 High, 1 inherent limitation)
**Version:** v1.9.0

---


## Table of Contents

1. [Overview and Security Posture](#1-overview-and-security-posture)
2. [Threat Model](#2-threat-model)
3. [Electron Hardening](#3-electron-hardening)
4. [Email HTML Rendering Safety](#4-email-html-rendering-safety)
5. [MCP Server Security](#5-mcp-server-security)
6. [IMAP and SMTP Injection Prevention](#6-imap-and-smtp-injection-prevention)
7. [Credential Management](#7-credential-management)
8. [Input Validation and Sanitization](#8-input-validation-and-sanitization)
9. [Cross-Account Ownership Enforcement](#9-cross-account-ownership-enforcement)
10. [Logging and Error Handling Safety](#10-logging-and-error-handling-safety)
11. [Build and Distribution Security](#11-build-and-distribution-security)
12. [Audit History](#12-audit-history)
13. [Remaining Limitations and Mitigations](#13-remaining-limitations-and-mitigations)
14. [Reporting Vulnerabilities](#14-reporting-vulnerabilities)

---


## 1. Overview and Security Posture

ExpressDelivery is an Electron 40 desktop email client with an embedded MCP server for AI-assisted email operations.

Ten rounds of security and code review remediation were completed between 2026-02-22 and 2026-02-27. All critical and high-severity findings have been resolved. One limitation -- decrypted credentials in V8 heap memory -- is inherent to JavaScript.

**Summary ratings after each round:**

| Date       | Rating | Scope                                |
|------------|--------|--------------------------------------|
| 2026-02-22 | D      | Initial audit (Phase 1)              |
| 2026-02-23 | B-     | Post-remediation (Phase 2)           |
| 2026-02-25 | B+     | v1.2.2-v1.2.3 hardening              |
| 2026-02-27 | A-     | Phase 6-7 audit and remediation      |

**Current issue counts:** 0 Critical, 0 High, 1 inherent limitation.

---

## 2. Threat Model

### Assets

| Asset                       | Sensitivity | Storage Location                           |
|-----------------------------|-------------|--------------------------------------------|
| Email account passwords     | Critical    | SQLite BLOB, encrypted via OS keychain     |
| OpenRouter API key          | High        | SQLite, encrypted via OS keychain          |
| MCP bearer token            | High        | SQLite settings, used only in memory       |
| Email content (body HTML)   | Medium      | SQLite, displayed in sandboxed iframe      |
| Contact data                | Medium      | SQLite                                     |
| Email metadata              | Low-Medium  | SQLite                                     |

### Primary Threat Vectors

**1. Malicious email HTML**

An attacker sends a crafted HTML email containing script payloads, tracking pixels, or phishing links. The renderer must sanitize and isolate this content before display.

Mitigations: DOMPurify sanitization, sandboxed iframe without `allow-same-origin`, iframe-internal CSP, remote image blocking by default, phishing URL detection.

**2. Prompt injection via email content**

Email content forwarded to an LLM may contain attacker-controlled text designed to override system prompt instructions.

Mitigation: `sanitizeForPrompt()` replaces triple-dash delimiter sequences with an em-dash and triple-backtick code fence sequences with single quotes before LLM submission. Body content is capped at 2,000 characters.

**3. Unauthenticated MCP server access**

The MCP server exposes an HTTP/SSE endpoint. Without authentication, any local process could invoke MCP tools including `send_email`.

Mitigations: Bearer token authentication with timing-safe comparison, server bound to `127.0.0.1` only, CORS disabled.

**4. IPC channel abuse from renderer**

A compromised renderer could call arbitrary IPC channels to access the filesystem or database.

Mitigations: Preload exposes a scoped allowlist API only; `sandbox: true` and `contextIsolation: true` prevent direct Node.js access; nodeIntegration is false.

**5. SQL injection via user-supplied input**

User-controlled strings (search queries, folder names, email IDs) could be concatenated into SQL statements.

Mitigation: All SQL uses parameterized queries via `better-sqlite3` prepared statements. FTS5 queries receive additional sanitization through `sanitizeFts5Query()` before being passed as parameters.

**6. Header injection via SMTP**

Newline characters injected into To, CC, BCC, or Subject fields could add arbitrary headers to outbound email.

Mitigation: `stripCRLF()` is applied to all recipient addresses and subject fields before they reach Nodemailer, on both the IPC path and the MCP `send_email` path.

**7. Cross-account data access**

A renderer bug or logic error could allow one account data to be accessed or modified using another account IDs.

Mitigation: Every IPC handler that touches account-scoped data validates `account_id` ownership against the database before proceeding.

---

## 3. Electron Hardening

### BrowserWindow Configuration

The main window is created with the following security-relevant options in `electron/main.ts`:

```typescript
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: `false`,
    sandbox: true,
    backgroundThrottling: `false`,
    devTools: true,
  },
})
```

`sandbox: true` restricts the renderer to a Chromium sandbox process without filesystem or OS access. `contextIsolation: true` ensures the preload script exported API lives in an isolated context, preventing renderer JavaScript from prototype-polluting or monkey-patching it. `nodeIntegration: false` means `require()` is unavailable in the renderer.

### Navigation and Window Open Defenses

All navigation events are intercepted. Only the Vite dev server URL (in development) or `file://` (in production) are permitted:

```typescript
win.webContents.on('will-navigate', (event, url) => {
  const allowed = VITE_DEV_SERVER_URL
    ? url.startsWith(VITE_DEV_SERVER_URL)
    : url.startsWith('file://');
  if (!allowed) {
    logDebug('[BLOCKED NAVIGATION] ' + url);
    event.preventDefault();
  }
})

win.webContents.setWindowOpenHandler(({ url }) => {
  logDebug('[BLOCKED WINDOW OPEN] ' + url);
  return { action: 'deny' };
})
```

This prevents email content or any renderer-triggered navigation from opening external URLs in the Electron window.

### Preload Channel Allowlist

The preload script (`electron/preload.ts`) exposes a single `window.electronAPI` object via `contextBridge`. Every channel the renderer can invoke is explicitly listed in `ALLOWED_INVOKE_CHANNELS` (approximately 80 channels) and a corresponding on-channels array (10 event channels). A channel not in the allowlist throws immediately in the renderer before any IPC message is sent:

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel: InvokeChannel, ...args: unknown[]) {
    if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      throw new Error('IPC channel not allowed: ' + channel)
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  // ...
})
```

The preload is compiled as a CommonJS '+bk+'.cjs'+bk+' file, as required by Electron sandboxed preload mode.

### Content Security Policy

A CSP meta tag in `src/index.html` restricts script and resource loading for the renderer application chrome. This provides defense-in-depth alongside the Electron sandbox, limiting the impact of any hypothetical XSS in the React application.

---

## 4. Email HTML Rendering Safety

### Rendering Pipeline

All HTML email rendering follows this pipeline before any content is displayed:

**Step 1: DOMPurify sanitization**

Applied in the renderer via the `dompurify` package. Configuration forbids `<link>` tags and `onerror`/`onload` attributes:

```typescript
const PURIFY_CONFIG = {
  FORBID_TAGS: ['link'],
  FORBID_ATTR: ['onerror', 'onload'],
  ADD_URI_SAFE_ATTR: ['src'],
};
```

`<style>` tags are permitted because the content renders inside an isolated iframe that cannot bleed styles into the application chrome.

**Step 2: Sandboxed iframe rendering**

The sanitized HTML is placed into an iframe via `srcdoc`. The sandbox attribute is `sandbox=allow-scripts` -- deliberately omitting `allow-same-origin`, which means the iframe content cannot access the parent DOM, cookies, localStorage, or any browser storage. The only injected script is a ResizeObserver that posts body height to the parent via `postMessage`.

**Step 3: Iframe-internal CSP**

The srcdoc document includes its own Content Security Policy meta tag:

```
default-src 'none';
style-src 'unsafe-inline';
script-src 'unsafe-inline';
img-src data:;
frame-ancestors 'none';
```

When the user explicitly consents to load remote images for a specific email, `img-src` becomes `data: https:`. The `frame-ancestors 'none'` directive prevents the iframe from being embedded by other content.

### Remote Image Blocking

By default, `img-src` in the iframe CSP is `data:` only. Remote image URLs are replaced with a 1x1 transparent SVG placeholder before the HTML is written to srcdoc:

```typescript
processed = html.replace(
  // regex: img tags with http/https src, quoted with single or double quotes
  (_full, before, url, after) => {
    return img_tag_with_blocked_src_and_original_url_in_data_attr;
);
```

A privacy banner is displayed when blocked images are detected. The user can click Load images to consent for that specific email, which re-renders with `img-src data: https:` and the original URLs restored.

### Imported Email HTML

Email HTML imported from EML and MBOX files goes through a Node-side pre-sanitization step in `electron/emailImport.ts` before database storage (DOMPurify requires a DOM and is unavailable in Node.js):

```typescript
function stripDangerousHtml(html: string): string {
  return html
    .replace(script-tag-regex, '')
    .replace(on-attr-with-quoted-value-regex, '')
    .replace(on-attr-unquoted-regex, '');
}
```

When the imported HTML is later displayed in the renderer, the full DOMPurify and sandboxed iframe pipeline applies as normal.

### Phishing Detection

Before rendering, email HTML is analyzed by `src/lib/phishingDetector.ts` using seven heuristics scored on a 0-100 scale. A score of 40 or above triggers a warning banner visible to the user.

| Rule | Score Added | Condition |
|------|-------------|----------|
| IP address as hostname | +30 | IPv4 address pattern used instead of domain |
| Suspicious TLD | +15 | .tk, .ml, .ga, .cf, .gq, .xyz, and others |
| Excessive subdomains | +20 | More than 3 dots in hostname |
| Brand spoofing | +35 | Brand name in hostname but not the official domain |
| HTTP on sensitive path | +25 | http: scheme with /login, /signin, /verify, etc. |
| Unusually long URL | +10 | URL length exceeds 200 characters |
| URL obfuscation via @ | +40 | @ sign before first path separator |

Brand spoofing checks 13 known brands (PayPal, Apple, Microsoft, Google, Amazon, Netflix, Facebook, Instagram, LinkedIn, Twitter, Chase, Wells Fargo, Bank of America) against their official domains.

---

## 5. MCP Server Security

The MCP server is an Express 5 HTTP server that exposes an SSE endpoint for AI agent connections. It runs only when enabled by the user and is lazy-initialized on first access via the `getMcpServer()` factory function.

### Network Isolation

The server binds exclusively to the loopback interface:

```typescript
this.httpServer = this.app.listen(this.port, '127.0.0.1', () => {
  logDebug('[MCP Server] Listening on http://127.0.0.1:' + this.port + '/sse');
})
```

Remote hosts cannot reach the server regardless of firewall configuration. CORS is completely disabled:

```typescript
this.app.use(cors({ origin: `false` }));
```

### Bearer Token Authentication

Every request must supply a bearer token. The token is a 32-byte cryptographically random hex string generated at server instantiation:

```typescript
this.authToken = options?.authToken ?? crypto.randomBytes(32).toString('hex');
```

The authentication middleware uses a constant-time comparison to prevent timing-based token oracle attacks:

```typescript
private setupAuth() {
  const expectedHeader = 'Bearer ' + this.authToken;
  this.app.use((req, res, next) => {
    const authHeader = req.headers.authorization ?? '';
    if (
      authHeader.length !== expectedHeader.length ||
      !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedHeader))
    ) {
      res.status(401).json({ error: 'Unauthorized: valid Bearer token required' });
      return;
    }
    next();
  });
}
```

The explicit length check before `timingSafeEqual` prevents a RangeError from mismatched buffer lengths while maintaining constant-time behavior for equal-length inputs.

### Account Ownership Enforcement on MCP Tools

MCP tools that read or modify email data verify that the requested resource belongs to the target account before proceeding. The `categorize_email` and `suggest_reply` tools validate that `email.account_id` matches the supplied `account_id` argument. This prevents an MCP client with a valid token from accessing emails belonging to other accounts managed in the same app instance.

### Token and Port Persistence

The active token and port are persisted to the SQLite settings table. The settings:get IPC handler blocks direct renderer reads of sensitive keys:

```typescript
const BLOCKED_SETTINGS_GET_KEYS = new Set(['openrouter_api_key', 'mcp_auth_token']);
ipcMain.handle('settings:get', (_event, key: string) => {
  if (BLOCKED_SETTINGS_GET_KEYS.has(key)) return null;
  // ...
})
```

The token is only surfaced via the dedicated `mcp:get-token` IPC handler.

---

## 6. IMAP and SMTP Injection Prevention

### CRLF Injection

SMTP header injection attacks insert CR and LF characters into recipient addresses or subject lines to append arbitrary headers. The `stripCRLF()` utility in `electron/utils.ts` removes all carriage returns, newlines, and null bytes:

```typescript
export function stripCRLF(s: string): string {
  return s.replace(cr-lf-nul-regex, '');
}
```

This function is applied to every recipient field and subject before the data reaches Nodemailer:

- **IPC path (`email:send`)** -- Applied in the main process IPC handler before constructing the Nodemailer message object.
- **MCP path (`send_email` tool)** -- Applied in `electron/mcpTools.ts` to all recipients and subject.
- **EML export** -- `stripCRLF()` is applied to all header values written to exported EML and MBOX files.

### Object-Form from Address

Nodemailer from field is supplied as an object with separate name and address properties rather than a formatted string, preventing display-name injection:

```typescript
from: {
  name: displayName,
  address: account.email as string,
},
```

### Parameterized SQL

All database queries use better-sqlite3 prepared statement API. No user-controlled string is ever concatenated into a SQL string. The FTS5 MATCH query receives additional sanitization before being passed as a prepared statement parameter:

```typescript
export function sanitizeFts5Query(raw: string): string {
  const cleaned = raw
    .replace(special-chars-regex, '')
    .replace(boolean-operators-regex, '')
    .trim();
  return cleaned.slice(0, 200);
}
```

The function strips FTS5 operator syntax, special chars, and enforces a 200-character maximum length.

---

## 7. Credential Management

### Email Account Passwords

Passwords are encrypted immediately on receipt using `electron.safeStorage`, which delegates to the OS keychain (DPAPI on Windows, Keychain on macOS, libsecret on Linux):

```typescript
// electron/crypto.ts
export function encryptData(text: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is not available');
  }
  return safeStorage.encryptString(text);
}
```

The encrypted bytes are stored as base64 in the SQLite `accounts.password_encrypted` column. Decryption occurs only at the moment of use (IMAP connect, SMTP send, connection test), in a short-lived local variable that is not assigned to any persistent data structure, not logged, and not returned to the renderer.

The `accounts:list` and `startup:load` IPC handlers explicitly select only non-sensitive columns. The password_encrypted column is never included in any renderer response.

### OpenRouter API Key

The OpenRouter API key follows the same encryption path. It is stored encrypted in the settings table under the key `openrouter_api_key`. It is decrypted only inside the `ai:suggest-reply` IPC handler immediately before the HTTP call to OpenRouter, and the plaintext does not persist beyond that call scope.

The renderer cannot read the raw key via `settings:get` (blocked by the BLOCKED_SETTINGS_GET_KEYS set) and cannot receive it via any other channel. The Settings UI uses a masked input field and only sends a new value to the main process for re-encryption.

---

## 8. Input Validation and Sanitization

### FTS5 Query Sanitization

Covered in Section 6. Applied on both the IPC `emails:search` path and the MCP `search_emails` tool path before the sanitized string is passed to a prepared statement parameter.

### Settings Key Allowlist

The `settings:set` IPC handler only accepts a predefined set of keys:

```typescript
const ALLOWED_SETTINGS_KEYS = new Set([
  'theme', 'layout', 'sidebar_width', 'notifications', 'notifications_enabled',
  'notifications_sound', 'locale', 'undo_send_delay', 'density_mode',
  'reading_pane_zoom', 'sound_enabled', 'sound_custom_path', 'ai_compose_tone',
  'mcp_enabled', 'mcp_port', 'mcp_auth_token',
]);

ipcMain.handle('settings:set', (_event, key: string, value: string) => {
  if (!ALLOWED_SETTINGS_KEYS.has(key)) {
    throw new Error('Setting key not allowed: ' + key);
  }
  // ...
})
```

This prevents arbitrary key-value writes to the settings table from the renderer.

### Mail Rule Engine Guards

When creating or updating mail rules, guard sets reject any value outside the known vocabulary:

```typescript
const VALID_FIELDS    = new Set(['from', 'subject', 'body', 'has_attachment']);
const VALID_OPERATORS = new Set(['contains', 'equals', 'starts_with', 'ends_with']);
const VALID_ACTIONS   = new Set(['move', 'mark_read', 'flag', 'delete', 'label', 'categorize']);

if (!VALID_FIELDS.has(params.matchField))       throw new Error('Invalid match field');
if (!VALID_OPERATORS.has(params.matchOperator)) throw new Error('Invalid match operator');
if (!VALID_ACTIONS.has(params.actionType))      throw new Error('Invalid action type');
```

The rule engine in `electron/ruleEngine.ts` also uses default: return false branches in both switch statements, so an unexpected field or operator stored by an older schema version silently matches nothing rather than throwing.

### Import File-Size Guards

File import operations enforce maximum sizes before reading file content into memory:

| Import type   | Maximum file size | Additional cap              |
|---------------|-------------------|--------------------------|
| Single EML    | 50 MB per file    | 100 files per import batch |
| MBOX          | 200 MB            | 1,000 messages per file    |
| vCard / CSV   | 10 MB             | -                          |

### Attachment Filename Sanitization

Attachment filenames received via IMAP or submitted via MCP are sanitized before storage or use:

```typescript
const safeName = stripCRLF(String(att.filename).replace(/[/]/g, '_')).slice(0, 255);
```

Path separator characters (/ and ) are replaced with underscores to prevent path traversal. CRLF sequences are removed. The result is capped at 255 characters.

### HTML Body Cap on MCP send_email

The MCP send_email tool enforces a 500 KB cap on the HTML body to prevent memory exhaustion through oversized payloads:

```typescript
if (html.length > 500_000) {
  throw new McpError(ErrorCode.InvalidParams, 'HTML body exceeds 500KB limit');
}
```

### Prompt Injection Sanitization

Before user-controlled email content is included in LLM prompts, `sanitizeForPrompt()` in `electron/openRouterClient.ts` replaces common prompt delimiter sequences: triple-dash with em-dash, triple-backtick with single quotes. All user-supplied content (subject, body, sender name, thread context, sender history) passes through this function. Body content is capped at 2,000 characters, thread context per-message at 500 characters, and sender history items at 100 characters each.

### Tag Color Validation

When creating or updating a tag, the color value is validated against a hex color regex before storage:

```typescript
if (params.color && !/^#[0-9a-fA-F]{6}$/.test(params.color)) {
  throw new Error('Invalid color format');
}
```

### Drag-and-Drop Email ID Validation

When emails are dropped onto a folder, each ID in the drag payload is validated before use:

```typescript
const EMAIL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ids = rawIds.slice(0, 500).filter(id => EMAIL_ID_PATTERN.test(id));
```

IDs that do not match the pattern are silently discarded. The array is capped at 500 items.

### Spam Filter Token Cap

The Bayesian spam filter caps the number of tokens passed to SQLite IN (...) clauses at 999, matching SQLite maximum host parameter limit, preventing a runtime error from processing large email bodies.

---

## 9. Cross-Account Ownership Enforcement

All IPC handlers that read, modify, or delete account-scoped resources validate ownership before executing. This prevents any renderer-side logic error from accessing one account data using another account resource IDs.

The pattern used consistently across handlers queries the resource `account_id` from the database and compares it against the caller-supplied accountId before proceeding. For example, the reminders:create handler:

```typescript
const email = db.prepare(
  'SELECT id, account_id FROM emails WHERE id = ?'
).get(params.emailId);
if (!email || email.account_id !== params.accountId) {
  throw new Error('Email not found or access denied');
}
```

Handlers covered by cross-account enforcement:

- **Emails:** emails:delete, emails:toggle-flag, emails:archive, emails:move, emails:snooze, emails:unsnooze, emails:mark-read, emails:mark-all-read, bulk operations
- **Folders:** folders:create, folders:rename, folders:delete, folders:set-color, folders:reorder
- **Scheduled sends:** scheduled:create, scheduled:cancel, scheduled:update
- **Reminders:** reminders:create, reminders:cancel
- **Mail rules:** rules:create, rules:update, rules:delete, rules:reorder
- **Tags:** tags:assign, tags:remove, tags:update, tags:delete
- **Exports:** export:eml, export:mbox -- folder ownership verified against the requesting account before export
- **Saved searches:** searches:create, searches:delete

The same check applies in MCP tools. The categorize_email tool verifies `email.account_id` matches the account_id argument before writing AI metadata to the database.

---

## 10. Logging and Error Handling Safety

### Log Destination

All debug logging is written to app.getPath('logs'), the OS-managed application log directory. On Windows this resolves to %APPDATA%ExpressDeliverylogs. Log files are not transmitted to any remote service.

### Renderer Error Log Sanitization

The renderer sends error messages to the main process via the `log:error` IPC channel. The main process handler strips CR, LF, and NUL bytes to prevent log injection, prepends [RENDERER] to distinguish renderer logs from main process logs, and caps the message at 4,000 characters:

```typescript
ipcMain.handle('log:error', (_event, message: string) => {
  const safe = typeof message === 'string'
    ? '[RENDERER] ' + message.replace(cr-lf-nul-regex, ' ').slice(0, 4000)
    : '[RENDERER] [invalid log message]';
  logDebug(safe);
  return { success: true };
})
```

### Crash Handling

The uncaughtException handler only calls `process.exit(1)` for errors that indicate an unrecoverable process state:

```typescript
const fatal = errWithCode.code === 'MODULE_NOT_FOUND'
  || err.message?.includes('NODE_MODULE_VERSION')
  || /out of memory|heap exhausted/i.test(err.message ?? '');
if (fatal) process.exit(1);
```

All other uncaught JavaScript errors are logged and execution continues, preventing IMAP reconnection failures or transient network errors from terminating the application. Unhandled promise rejections are logged only and never cause a process exit.

### Error Information Exposure

Error responses returned to the renderer via IPC contain only generic messages. Internal database state, file paths, and SQL query text are not included. OpenRouter API error body details are logged at debug level with CRLF stripped, but only a generic HTTP status code is propagated to the renderer.

---

## 11. Build and Distribution Security

### ASAR Packaging

The application is packaged with asar: true in electron-builder.json5. Application source is bundled into an ASAR archive, preventing trivial inspection or modification of the shipped JavaScript. Native modules (better-sqlite3) are unpacked to app.asar.unpacked/ as required for native binary loading. The relevant electron-builder.json5 configuration:

```
{
  asar: true,
  asarUnpack: [
    'node_modules/better-sqlite3/**/*'
  ]
}
```

### Code Signing Configuration

electron-builder.json5 includes code signing configuration for all platforms:

- **Windows:** signAndEditExecutable: true. Set CSC_LINK (path to .pfx certificate) and CSC_KEY_PASSWORD environment variables at build time to enable Authenticode signing.
- **macOS:** hardenedRuntime: true, gatekeeperAssess: false. Set CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, and APPLE_APP_SPECIFIC_PASSWORD for Developer ID signing and Gatekeeper notarization.
- **Linux:** AppImage, .deb, and .rpm targets. The .deb package declares libsecret-1-0 as a runtime dependency, required for electron.safeStorage OS keychain access.

### Native Module ABI Integrity

better-sqlite3 is a NAN-based native module. Node.js v24 uses ABI 137; Electron 40 uses ABI 143. The clean build script (scripts/clean-build.mjs) always rebuilds the native module for the correct Electron ABI before packaging and restores the host ABI binary afterward. Packaging with the wrong ABI causes an immediate NODE_MODULE_VERSION crash on startup, which is caught by the uncaughtException handler and triggers process.exit(1).

### GitHub Actions CI/CD

- ci.yml: Runs npm run lint (ESLint strict, zero warnings), npm run test (Vitest), and tsc --noEmit on every push and pull request. Action versions are SHA-pinned to prevent supply-chain substitution attacks.
- release.yml: Builds and publishes to GitHub Releases on v* version tags. The ci.yml workflow uses --publish never in the electron-builder invocation to prevent accidental artifact publishing from CI runs.

---

## 12. Audit History

### Resolved Critical Issues

| ID     | Finding                                      | Resolution                                                               |
|--------|----------------------------------------------|--------------------------------------------------------------------------|
| CRIT-1 | Unauthenticated MCP server                   | Bearer token auth + cors({ origin: false }) + bind to 127.0.0.1         |
| CRIT-2 | Raw IPC bridge -- full ipcRenderer exposure  | Scoped typed API with channel allowlist; sandbox: true                   |
| CRIT-3 | Source code exposed (asar: false)            | asar: true; native .node files unpacked via asarUnpack                   |

### Resolved High Issues

| ID      | Finding                                          | Resolution                                                                  |
|---------|--------------------------------------------------|-----------------------------------------------------------------------------|
| HIGH-1  | FTS5 MATCH received raw user input               | sanitizeFts5Query() strips operators and special chars; 200-char cap        |
| HIGH-2  | SELECT * returning body_html in list queries     | Explicit column lists in all list and summary queries                       |
| HIGH-3  | Debug logs captured PII                          | Logs written to app.getPath(logs) only; PII sanitization in log handler    |
| HIGH-4  | No IPC channel allowlist                         | ALLOWED_INVOKE_CHANNELS and ALLOWED_ON_CHANNELS arrays in preload           |
| HIGH-5  | MCP server bound to all interfaces               | app.listen(port, 127.0.0.1, ...)                                            |
| H-P6-1  | Cross-account folder access                      | account_id ownership validation on all folder IPC handlers                 |
| H-P7-1  | window.open on attacker-controlled URLs          | Removed; replaced with clipboard copy and https: scheme validation         |
| H-P7-2  | Missing cross-account checks on tags:assign      | account_id validated before tag assignment                                 |
| H-P7-3  | Missing cross-account checks on exports          | account_id passed to and validated inside export functions                 |
| H-P7-4  | No file-size caps on import                      | EML 50 MB, MBOX 200 MB, vCard/CSV 10 MB hard limits before file read      |
| H-P7-5  | No color validation on tags:update               | Hex regex enforced before storage                                          |
| M-P7-7  | Imported HTML stored unsanitized                 | stripDangerousHtml() applied before DB insert in emailImport.ts            |

---

## 13. Remaining Limitations and Mitigations

### Decrypted Credentials in V8 Heap

**Severity:** Low (inherent to JavaScript)

When a password or API key is decrypted for use (IMAP connect, SMTP send, AI reply generation), the plaintext string exists in the V8 heap for the duration of its enclosing scope. JavaScript does not provide mechanisms to zero memory on deallocation or to pin sensitive strings to non-swappable memory regions. This is a known limitation of all JavaScript runtimes.

Mitigations in place:

- Decryption occurs in the narrowest possible scope (inside the IPC handler function call), not at module load time or in persistent module state.
- The decrypted value is never assigned to a module-level variable, never returned to the renderer, and never written to any log.
- The V8 heap of the main process is not accessible from the renderer process due to contextIsolation: true and sandbox: true.
- An attacker with OS-level process memory access could read the value only within the brief window of active use.

### SQLite Database Not Encrypted at Rest

The SQLite database (expressdelivery.sqlite in app.getPath(userData)) is not encrypted at rest in the current release. An attacker with filesystem access to the user data directory can read email content and metadata directly from the database file.

A migration path to SQLCipher is documented in electron/dbEncryption.ts and is planned for a future phase. Current mitigations: account passwords and the OpenRouter API key are encrypted via the OS keychain and cannot be extracted by reading the database file alone.

---

## 14. Reporting Vulnerabilities

To report a security vulnerability in ExpressDelivery, contact the project maintainers privately before public disclosure to allow time for a fix to be prepared.

**Preferred contact:** Open a GitHub Security Advisory at https://github.com/advisely/expressdelivery/security/advisories/new

**Scope:** Issues in the Electron main process, renderer, MCP server, IPC bridge, SMTP/IMAP handling, credential encryption, or the import/export pipeline. Third-party package vulnerabilities should be reported to the respective upstream maintainers and tracked via npm audit.

**Response commitment:** We aim to acknowledge reports within 3 business days and provide an initial assessment within 7 business days.

**Out of scope:** Issues requiring physical access to the host machine, OS-level privilege escalation outside Electron process model, or vulnerabilities in upstream dependencies that are already publicly disclosed and for which no upstream fix is available.