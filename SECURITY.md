# Security

ExpressDelivery takes security seriously. This document outlines the security mechanisms built into the application.

## Security Grade: A-

10 rounds of security and code review remediation completed. All critical and high issues resolved except one inherent JavaScript limitation (decrypted passwords in V8 heap, mitigated with short-lived scope).

---

## Anti-Spam

| Mechanism | Description |
|-----------|-------------|
| **Bayesian Classifier** | Per-account Naive Bayes with Laplace smoothing, trained via user feedback |
| **Auto-Classification** | New emails scored during IMAP sync; spam_score stored in DB |
| **Sender Whitelist/Blacklist** | Per-account sender patterns (email or domain), checked during classification |
| **Token Analysis** | Email tokenization with 3-50 char filtering, log-space math to prevent underflow |

Spam training requires 10+ examples before predictions activate. The classifier runs on every new email during IMAP sync.

## Anti-Scam & Phishing

| Mechanism | Description |
|-----------|-------------|
| **Phishing URL Detection** | 7-rule heuristic engine: IP addresses, suspicious TLDs, excessive subdomains, brand spoofing, HTTP on sensitive paths, long URLs, @ sign obfuscation |
| **Display Name Spoofing** | Detects brand names in display name with mismatched email domain, embedded email addresses differing from actual sender, domain-mimicking display names |
| **Invoice Fraud Detection** | Pattern matching for urgency language (7 patterns) and payment requests (6 patterns) |
| **Remote Image Blocking** | Images blocked by default; privacy banner with explicit "Load images" consent |
| **HTML Sandboxing** | Emails rendered in sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) |
| **DOMPurify Sanitization** | All email HTML sanitized before rendering; `<link>` tags, `onerror`/`onload` attributes forbidden |
| **Phishing Warning Banner** | Visual alert in ReadingPane when phishing URLs detected |

## Email Authentication (SPF/DKIM/DMARC)

| Mechanism | Description |
|-----------|-------------|
| **Authentication-Results Parsing** | Extracts SPF, DKIM, DMARC results from email headers during IMAP sync |
| **Sender Verification Badge** | Green shield for verified (all pass), red shield for unverified (failures) |
| **Per-Email Storage** | `auth_spf`, `auth_dkim`, `auth_dmarc`, `sender_verified` columns in emails table |
| **Verification Levels** | Verified (all pass), Partial (some pass), Unverified (all fail), Unknown (no headers) |

## Anti-Hack

### Application Sandbox
- **Electron Context Isolation** — strict context boundary between main and renderer
- **Node Integration Disabled** — no Node.js APIs in renderer process
- **OS-Level Sandbox** — `sandbox: true` on BrowserWindow
- **IPC Channel Allowlist** — 160+ hardcoded channels in preload; unknown channels rejected at runtime

### Content Security Policy
- `default-src 'self'` — only self-hosted resources
- `script-src 'self'` — no inline scripts in main app
- `connect-src 'self'` — XHR/fetch restricted to self
- Email iframe has its own stricter CSP: `default-src 'none'; img-src data:`

### Input Validation
- **CRLF Injection Prevention** — `stripCRLF()` on all SMTP recipients/subjects
- **FTS5 Query Sanitization** — strips special operators, AND/OR/NOT keywords, max 200 chars
- **SQL Injection Prevention** — all queries use parameterized statements (`?` placeholders)
- **Attachment Filename Sanitization** — strips CRLF, null bytes, bidirectional Unicode overrides, path separators
- **Rule Engine Guards** — VALID_FIELDS, VALID_OPERATORS, VALID_ACTIONS whitelists
- **Settings Key Allowlist** — only 18 predefined keys accepted

### Rate Limiting
- **IPC Rate Limiter** — token bucket algorithm on sensitive handlers (`email:send`, `spam:train`, `sender-list:add`)
- **Automatic Bucket Cleanup** — stale buckets purged every 5 minutes

### Cross-Account Access Control
- Email, folder, draft, scheduled send, reminder, and rule operations enforce `account_id` ownership
- MCP tool handlers verify account ownership before data access

### Navigation Defense
- `will-navigate` handler blocks unexpected navigation from email content
- `setWindowOpenHandler` blocks all `window.open()` calls

### Crash Resilience
- Only exits on fatal errors (MODULE_NOT_FOUND, OOM)
- All other exceptions logged but don't crash the app

## Credential Security

| Mechanism | Description |
|-----------|-------------|
| **OS Keychain Encryption** | Passwords encrypted via `electron.safeStorage` (Windows DPAPI, macOS Keychain, Linux libsecret) |
| **Short-Lived Decryption** | Passwords decrypted only for IMAP/SMTP connections, not stored in memory |
| **Encrypted API Keys** | OpenRouter API key encrypted via safeStorage, managed in Settings UI |
| **MCP Bearer Token** | 32-byte random hex token, timing-safe comparison (`crypto.timingSafeEqual`) |

## Update Security

| Mechanism | Description |
|-----------|-------------|
| **SHA-256 Integrity** | `.expressdelivery` update packages verified against manifest SHA-256 hash |
| **Authenticode Verification** | Windows installer signatures checked via PowerShell `Get-AuthenticodeSignature` |
| **Path Traversal Prevention** | CWE-22 — input paths validated, payload filenames sanitized |
| **Command Injection Prevention** | CWE-78 — `execFileSync` with args array, no shell interpolation |
| **Auto-Update via GitHub Releases** | electron-updater with SHA-512 verification of downloaded installers |

## Network Security

- **IMAP/SMTP TLS** — `secure: true` for port 993, STARTTLS for port 587
- **MCP Server** — bound to `127.0.0.1`, CORS `origin: false`, bearer token required
- **CSP Frame Ancestors** — `'none'` prevents clickjacking of email iframe

## Log Security

- **Renderer Log Sanitization** — `log:error` IPC strips CR/LF/NUL, prepends `[RENDERER]`, caps at 4000 chars
- **IMAP Error Sanitization** — strips HTML entities and control chars from server error messages

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please email **yassine@boumiza.com** with details. We aim to respond within 48 hours.
