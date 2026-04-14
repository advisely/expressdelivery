# ExpressDelivery - AI-Powered Email Client

Electron desktop email client evolving into an agentic multi-channel communication platform. MCP (Model Context Protocol) integration for AI-assisted operations across email, Telegram, LinkedIn, and Twitter. **Status:** Phase 17.1 (v1.17.1). 21 components (added OAuthSignInButton), 2 Zustand stores, 11 MCP tools, SQLite persistence (17 migrations — schema v17 adds `oauth_credentials` table + `accounts.auth_type` + `accounts.auth_state`), 4 themes, 45 test files (1002 tests), ~116 IPC handlers (added 5 `auth:*` channels), frameless window with custom TitleBar. Agentic channel layer (6 connectors), semantic intent parser (Ollama/OpenRouter LLM router), Playwright E2E harness (8 enabled Console Health tests including reauth badge via `EXPRESSDELIVERY_TEST_SEED_REAUTH` env-var seed hook). Full IMAP sync (body + folders + reconnect, OAuth2 XOAUTH2 with on-401 retry), HTML email rendering (DOMPurify), reply/forward/delete/star/archive/move, CC/BCC compose with contact autocomplete, contact auto-harvest, draft auto-save/resume, file attachments (send + receive, IMAP on-demand download, SQLite BLOB cache), keyboard shortcuts (mod+N/R/F/E/J/K/Delete/Escape), multi-account sidebar with unread badges + AI status indicator + OAuth reauth badges, connection testing, account editing, provider brand icons. Rich text compose (TipTap), per-account email signatures, inline CID image display, remote image blocking with privacy banner. AI-powered features: email categorization/priority/labels via MCP, mailbox analytics, suggest reply context, multi-client SSE transport, OpenRouter API key management (encrypted via safeStorage, Settings UI). **OAuth2 sign-in for Gmail (RFC 8252 loopback + PKCE S256), Outlook.com Personal (MSAL), and Microsoft 365 Work/School (MSAL)**, with Microsoft Graph send path for personal Outlook.com accounts (Basic Auth SMTP kill April 2026), `AuthTokenManager` singleton with JIT pre-flight refresh + per-account dedup mutex, in-place legacy outlook re-auth, sidebar reauth badges, and CI secret injection + pre-package verification. App icon implemented (SVG source in `build/`, PNG/ICO generated via `npm run generate:icons`). Premium onboarding flow with 9 CSS animations, glassmorphism, and WCAG 2.1 reduced-motion support.

## Tech Stack

| Layer     | Technology                                                                                   |
| --------- | -------------------------------------------------------------------------------------------- |
| Frontend  | React 19, TypeScript 5.9 strict, Zustand (theme + email stores), Radix UI (Dialog, Tabs, Popover), TipTap (rich text), Lucide icons, Tailwind CSS v4, DOMPurify, react-i18next, CSS custom properties |
| Backend   | Electron 41, better-sqlite3 (WAL + FTS5), IMAPFlow (XOAUTH2), Nodemailer (XOAUTH2), Express 5, electron-updater    |
| OAuth2    | RFC 8252 loopback flow with PKCE S256 (Gmail), `@azure/msal-node` `PublicClientApplication` (Microsoft personal + business), Microsoft Graph `POST /me/sendMail` for personal Outlook.com — all tokens AES-encrypted at rest via `electron.safeStorage` |
| AI/MCP    | @modelcontextprotocol/sdk (multi-client SSE transport on port 3000), 8 tools (search, read, send, draft, summary, categorize, analytics, suggest_reply) |
| Build     | Vite 7 + vite-plugin-electron, electron-builder (Windows NSIS, Linux AppImage/deb/rpm, macOS DMG, GitHub Releases publish), `VITE_OAUTH_*` build-time env injection from CI secrets |
| Testing   | Vitest 4 + jsdom, @testing-library/react, @vitest/coverage-v8, `nock` (HTTP mocks for OAuth adapter tests)                               |

## Structure

```
electron/          # Main process (db, imap, smtp, crypto, mcp server, utils)
src/               # Renderer process (React SPA)
  components/      # UI components (14 files + 12 co-located .module.css files)
  stores/          # Zustand stores (themeStore, emailStore)
  lib/             # Shared utilities (ipc wrapper, providerPresets, providerIcons, useKeyboardShortcuts, i18n)
  assets/          # Static assets
  locales/         # i18n translation files (en, fr, es, de)
public/            # Runtime assets (self-hosted fonts, icon.png)
build/             # electron-builder assets (icon.svg, icon.png, icon.ico, icon@2x.png)
scripts/           # Dev tooling (generate-icons.mjs, clean-build.mjs)
.github/workflows/ # CI/CD pipelines (ci.yml, release.yml)
release/           # Built app artifacts
```

## Key Files

| File                        | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `electron/main.ts`         | Electron entry, window + tray + menu + ~77 IPC handlers (snooze, scheduled sends, reminders, rules, update, notifications, print, bulk actions, tags, exports, imports, spam, source, ai:suggest-reply, analytics:busiest-hours) |
| `src/components/TitleBar.tsx` | Custom frameless window title bar (minimize/maximize/close, drag region, theme-aware) |
| `electron/db.ts`           | SQLite init, schema, 12 migrations (accounts, folders, emails, drafts, contacts, attachments, settings, snoozed_emails, scheduled_sends, reminders, mail_rules, FTS5) |
| `electron/mcpServer.ts`    | MCP multi-client SSE server (Map-based dispatch, connection callback, timing-safe auth, lazy init via getMcpServer()) |
| `electron/mcpTools.ts`     | 8 MCP tool handlers + buildToolRegistry() Map factory |
| `electron/imap.ts`         | IMAP engine with per-account `AccountSyncController` (connect, heartbeat NOOP, timeout-protected sync, infinite reconnect with backoff, `withImapTimeout` wrapper, on-demand body fetch, folders, attachments, Content-ID, applyRulesToEmail) |
| `electron/smtp.ts`         | SMTP sender via Nodemailer (host/port from DB, CC/BCC, attachments, CRLF-safe) |
| `electron/crypto.ts`       | OS keychain encryption (safeStorage)            |
| `electron/logger.ts`       | Shared debug logger (writes to `app.getPath('logs')`) |
| `electron/preload.ts`      | IPC bridge -- scoped typed API with channel allowlist (builds as CJS .cjs) |
| `electron/utils.ts`        | Shared utilities (FTS5 query sanitizer, stripCRLF, escapeAttr)         |
| `electron/scheduler.ts`    | 30s polling scheduler for snooze wake, scheduled sends, and reminder notifications |
| `electron/ruleEngine.ts`   | Mail rule matching + actions (from/subject/body/has_attachment x contains/equals/starts_with/ends_with) |
| `electron/updater.ts`      | Dual update system: electron-updater (GitHub Releases, silent install mode via quitAndInstall isSilent=true) + file-based .expressdelivery packages (ZIP+manifest, SHA-256 integrity, Authenticode signature, NSIS verified kill loop) |
| `electron/spamFilter.ts`   | Bayesian spam classifier (tokenize, train, classify with Laplace smoothing) |
| `electron/openRouterClient.ts` | OpenRouter API client for AI reply generation (15s timeout, prompt sanitization) |
| `electron/emailExport.ts`  | EML single + MBOX folder export with RFC 2822 formatting |
| `electron/emailImport.ts`  | EML/MBOX file import with header parsing, 1000 msg cap |
| `electron/contactPortability.ts` | vCard 3.0 + CSV contact import/export |
| `electron/dbEncryption.ts` | SQLCipher migration stub (Phase 5 at-rest encryption documentation) |
| `electron/oauth/clientConfig.ts` | Reads `VITE_OAUTH_*` env vars at build time; throws friendly errors when missing |
| `electron/oauth/google.ts` | Google RFC 8252 loopback flow: PKCE S256, 32-byte hex CSRF state, 127.0.0.1 explicit bind, AbortSignal, refresh + revoke endpoints |
| `electron/oauth/microsoft.ts` | `@azure/msal-node` `PublicClientApplication`: `acquireTokenInteractive` opens system browser, `tid` claim → personal/business classification, `acquireTokenByRefreshToken` for silent refresh |
| `electron/auth/tokenManager.ts` | `AuthTokenManager` singleton — `getValidAccessToken` (JIT pre-flight refresh), per-account dedup mutex, error classification, `invalidateToken` for on-401 retry, `persistInitialTokens` for first-token writes, redacted log lines |
| `electron/auth/ipcHandlers.ts` | 5 `auth:*` IPC channels (start-oauth-flow, start-reauth-flow, cancel-flow, flow-status, get-state); D11.5b transactional account+token writes; `safeErrorMessage` strips control chars |
| `electron/auth/accountRevoke.ts` | `maybeRevokeOAuthCredentials` helper called by `accounts:remove` BEFORE row delete (Google: real revoke; Microsoft: no-op per D11.1) |
| `electron/send/sendMail.ts` | Provider-aware send dispatcher: SMTP-with-XOAUTH2 vs Microsoft Graph |
| `electron/send/graphSend.ts` | Microsoft Graph `POST /me/sendMail` send adapter for personal Outlook.com |
| `src/App.tsx`              | Root component, error boundary, data loading, reply/forward plumbing, toast system |
| `src/components/OAuthSignInButton.tsx` | Reusable Sign in with Google/Microsoft button — in-flight spinner, double-click guard, `aria-busy`, `data-provider` |
| `src/components/Sidebar.tsx`     | Multi-account switcher, folders with unread badges, folder context menu, virtual folders, staleness-aware sync indicator (green/amber/red) |
| `src/components/ThreadList.tsx`  | Email list with search, multi-select, bulk actions, right-click context menu      |
| `src/components/ReadingPane.tsx` | HTML email viewer (SandboxedEmailBody), reply/forward/delete/star/print actions, CID inline images, remote image blocking |
| `src/components/ComposeModal.tsx`| Rich text compose (TipTap) with To/CC/BCC, reply/forward prefill, signature preview, scheduled send |
| `src/components/SettingsModal.tsx`| Two-level settings: horizontal categories (General/Email/AI/Data/System) + vertical sub-tabs, lazy Radix Tabs, Import/Export + About tabs, Sync sub-tab (3 configurable intervals) |
| `src/components/ThemeContext.tsx` | Layout context + theme class application   |
| `src/components/OnboardingScreen.tsx` | First-run account setup (4-step wizard, 9 CSS animations) |
| `src/components/DateTimePicker.tsx`   | Native datetime input with quick-select presets (1h, 3h, tomorrow, next week) |
| `src/components/UpdateBanner.tsx`     | In-app update available/download progress/install banner (online updates) |
| `src/components/UpdatePanel.tsx`     | Settings tab: file-based update UI (.expressdelivery packages, validation, multi-step progress, install mode detection) |
| `src/components/UpdateSplash.tsx`    | Post-update splash screen (animated version badge, changelog, 3-phase animation, click-to-skip) |
| `src/components/GlobalSearch.tsx`    | Spotlight-style global search overlay (Ctrl+Shift+F, cross-account/folder FTS5, keyboard nav) |
| `src/components/ConfirmDialog.tsx` | Reusable Radix Dialog for confirm + prompt modes (replaces window.confirm/prompt) |
| `src/components/MessageSourceDialog.tsx` | Raw RFC822 email source viewer (Radix Dialog, monospace pre, copy) |
| `src/lib/providerPresets.ts`   | Email provider IMAP/SMTP presets (Gmail, Outlook Personal, Outlook Business, Yahoo, iCloud, Custom) + invisible legacy outlook resolver; `AuthModel` enum: `password-supported` / `oauth2-supported` / `password` / `legacy` |
| `src/lib/providerIcons.tsx`    | Provider brand SVG icons (Gmail, Outlook, Yahoo, iCloud, Custom) |
| `src/stores/themeStore.ts` | Zustand persisted theme + layout state          |
| `src/stores/emailStore.ts` | Zustand email/folder/account state + selectedEmailIds Set for multi-select             |
| `src/components/ContactAutocomplete.tsx` | ARIA combobox contact search (To/CC/BCC) |
| `src/lib/useKeyboardShortcuts.ts` | Global keyboard shortcut hook (mod/shift/alt combos) |
| `src/lib/formatFileSize.ts` | Human-readable file size formatter |
| `src/lib/phishingDetector.ts` | Phishing URL detection (7 heuristic rules, brand spoofing, suspicious TLDs) |
| `src/lib/ipc.ts`          | Typed IPC wrapper for renderer process          |
| `src/lib/i18n.ts`         | react-i18next init with 4 locales (en, fr, es, de) |
| `scripts/clean-build.mjs`  | Hydration + clean packaging (purge, rebuild native deps, package, verify) |
| `scripts/build-expressdelivery.ps1` | Packages NSIS installer into .expressdelivery update file (ZIP + manifest.json with SHA-256 + optional Authenticode) |
| `src/index.css`            | Global styles, 4 themes, self-hosted Outfit font, CSS variables, layout modes |

## Data Models

**SQLite Tables (schema_version=17):** `accounts` (email, provider, encrypted password, IMAP/SMTP host/port, display_name, signature_html, **auth_type** `'password'`/`'oauth2'`, **auth_state** `'ok'`/`'recommended_reauth'`/`'reauth_required'`), `oauth_credentials` (account_id, provider `'google'`/`'microsoft_personal'`/`'microsoft_business'`, access_token_encrypted, refresh_token_encrypted, expires_at, scope, token_type, last_refreshed_at, last_error_code, FK cascade to accounts), `folders` (mailbox hierarchy + color), `emails` (messages + FTS5 index + has_attachments + ai_category + ai_priority + ai_labels + is_snoozed + list_unsubscribe + spam_score), `attachments` (metadata + BLOB cache + content_id, FK cascade to emails), `drafts` (pending emails with cc/bcc), `contacts` (auto-harvested from sent mail), `settings` (key-value), `snoozed_emails` (email_id, snooze_until, created_at), `scheduled_sends` (draft_id, send_at, status), `reminders` (email_id, remind_at, note, status), `mail_rules` (account_id, conditions JSON, actions JSON, order, enabled), `tags` (account_id, name, color), `email_tags` (email_id, tag_id junction), `saved_searches` (account_id, name, query, icon), `spam_tokens` (token, account_id, spam_count, ham_count), `spam_stats` (account_id, total_spam, total_ham)

**Zustand Stores:**
- `themeStore` -- `themeName`, `layout`, `densityMode`, `readingPaneZoom`, persisted to localStorage
- `emailStore` -- `accounts` (each row carries `auth_type` + `auth_state` for Phase 2 OAuth UI), `folders`, `emails`, `selectedEmail`, `selectedEmailIds` (Set for multi-select), `tags`, `savedSearches`, `draggedEmailIds`, search state

**Layout:** `'vertical' | 'horizontal'` persisted via Zustand (themeStore), applied via ThemeContext

## MCP Tools

All handlers in `electron/mcpTools.ts`, dispatched via Map in `electron/mcpServer.ts`. Server lazy-initialized via `getMcpServer()` factory.

| Tool              | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `search_emails`   | FTS5 full-text search with AI metadata (JOIN to emails table, limit 20) |
| `read_thread`     | Fetch email thread by thread_id            |
| `send_email`      | Send via SMTP (attachments, filename sanitized, 500KB HTML cap, CRLF-safe) |
| `create_draft`    | Insert draft to DB for UI review (account validated) |
| `get_smart_summary` | Rich mailbox summary: recent 20 emails, unread/flagged, high-priority, folders, drafts |
| `categorize_email` | AI writes category/priority(1-4)/labels to DB (account ownership enforced) |
| `get_email_analytics` | Mailbox stats: volume, top senders, folders, busiest hours, category/priority dist. (1-90 days) |
| `suggest_reply`   | Structured reply context: email + thread + sender history + account (body 2KB cap, account ownership) |

## Design System

**Outfit font** (self-hosted TTF), CSS custom properties with RGB values. 4 themes: Light (default, indigo accent), Cream (solarized, gold accent), Midnight (dark navy, purple accent), Forest (dark green, emerald accent). Glassmorphism with backdrop blur. 2 layouts: Vertical 3-pane, Horizontal split (persisted). 0.3s fade-in animations. Full design system documented in `docs/UI.md`.

**Onboarding animations** (9 keyframes, `ob-` prefix): floating background blobs, gradient text, pulsing mail icon with glow aura, shimmer button sweep, staggered card entrance, provider card hover elevation, error shake, step progress dots. Provider cards use brand accent colors (Gmail red, Outlook blue, Yahoo purple, iCloud blue). `@media (prefers-reduced-motion: reduce)` disables all continuous animations (WCAG 2.1 SC 2.3.3).

## Commands

```bash
npm run dev              # Vite dev server + Electron
npm run generate:icons   # Render build/icon.svg -> PNG + ICO (requires sharp, png-to-ico)
npm run build            # tsc + vite build + electron-builder (Win + Mac)
npm run build:win        # Clean build for Windows (purge + rebuild native deps + package)
npm run build:win:nsis   # Clean build for Windows + NSIS installer
npm run build:linux      # Clean build for Linux
npm run build:all        # Clean build for Linux + Windows (correct order)
npm run test             # vitest run
npm run test:coverage    # vitest with @vitest/coverage-v8
npm run test:e2e         # Playwright E2E (rebuilds better-sqlite3 for Electron ABI, restores after)
npm run lint             # eslint (strict, 0 warnings)
npm run make:update-package  # Package NSIS installer into .expressdelivery update file
```

### Build Notes (IMPORTANT)

**Use `scripts/clean-build.mjs`:** All `build:*` scripts use the clean build script which handles the full hydration sequence automatically: kill app, purge stale artifacts, delete old `better-sqlite3` build, rebuild native deps for Electron ABI, compile, package, verify binary, restore host binary for vitest.

**Why this matters:** `better-sqlite3` is a NAN-based native module (ABI-specific, not NAPI). Node.js v24 uses ABI 137 but Electron 41 uses ABI 145. If the wrong ABI binary is packaged, the app crashes with `NODE_MODULE_VERSION` mismatch. The clean build script purges the old binary and `.forge-meta` before every rebuild to prevent stale cache issues.

**Cross-platform build order:** Building Linux overwrites `better_sqlite3.node` with a Linux ELF binary. The clean build script handles this automatically -- when `--linux --win` are both specified, it rebuilds native deps between platforms.

**Close the app before rebuilding:** electron-builder cannot overwrite `win-unpacked/` if the app is running (file locks). Check the system tray -- the app may be minimized there. The clean build script attempts `taskkill` automatically.

**Manual rebuild (if needed):** `npx @electron/rebuild -v 41.0.3 -m . --only better-sqlite3 --force` then `npx electron-builder --win --dir`. Always delete `node_modules/better-sqlite3/build/` first to avoid stale `.forge-meta`.

**Restore host binary after manual builds:** `npm rebuild better-sqlite3` (restores ABI 137 for vitest). The clean build script does this automatically unless `--no-restore` is passed.

## Silent Failure Prevention

- Every `catch` block must either: (a) log via `logDebug()`, or (b) have a comment explaining why silence is intentional
- IPC handlers that perform mutations must return `{ success: boolean; error?: string }`
- Empty `catch {}` is only acceptable for: fire-and-forget cleanup (app quit, logout, file close), clipboard operations, and test teardown
- Scheduler failures must fire callbacks that surface to the user (toast or OS notification)
- Search handlers must distinguish "no results" from "query failed" -- return `{ results: [], error? }` not bare `[]`
- IMAP reconnect failures must be logged with the specific error, not just `return false`
- All `[PERF]` prefixed log entries go to `logDebug()` for startup, search, email read, and IMAP sync timing

## Development Guidelines

- TypeScript strict mode, `noUnusedLocals`, `noUnusedParameters`
- Components use CSS Modules (co-located `.module.css` files), bracket notation `styles[class-name]`
- Radix portals (Dialog/DropdownMenu/Popover) render outside component tree -- their classes MUST use `:global(.className)` in `.module.css` and remain plain strings in JSX
- CSS module class names are hashed at build time; tests must use `getByText`, `getByRole`, `data-*` attributes (not `toHaveClass` or `querySelector`)
- Electron main process uses `.js` extension in imports (ESM)
- Preload script MUST build as CJS `.cjs` -- Electron requires `require()` for preload in sandboxed mode (configured in `vite.config.ts`, referenced as `preload.cjs` in `main.ts`)
- Database uses WAL mode + foreign keys + FTS5 triggers (12 migrations); migration runner short-circuits at `CURRENT_SCHEMA_VERSION` when DB is up-to-date
- Passwords encrypted via `electron.safeStorage` (OS keychain); decrypted values are short-lived
- MCP server: configurable port (default 3000), multi-client SSE + POST transport, timing-safe auth, account ownership enforcement, lazy-initialized via `getMcpServer()` factory, persisted token/port/enabled in settings DB, Settings UI for management
- React 19 useRef: `useRef<T>(undefined)` instead of `useRef<T>()`
- Vitest 4: Use `vi.hoisted()` for mock variables referenced inside `vi.mock()` factory functions
- TipTap + i18next packages require `--legacy-peer-deps` (eslint-plugin-react-hooks peer dep conflict)
- SettingsModal test mocks on mount: 3 calls -- apikeys:get-openrouter, settings:get(notifications_enabled), settings:get(undo_send_delay)
- Radix Tabs controlled mode: use `userEvent.click()` for tab switching in jsdom tests
- IMAP secure flag: always `secure: port === 993` (STARTTLS on 587, TLS on 993)

### Quality Pipeline (MANDATORY)

**9-step process:**

1. **Development** -- Implement the feature/fix
2. **ESLint Auto-Fix** -- Run `npm run lint -- --fix` to auto-fix lint issues in modified files
3. **Parallel Analysis (single message):**
   - `code-simplifier` -- Refactor for clarity, remove dead code
   - `cyber-sentinel` -- Security vulnerability scan (OWASP Top 10, injection, XSS)
   - `code-reviewer` -- Architecture, patterns, type safety audit
4. **Remediation** -- Fix all issues found in step 3
5. **Pre-existing Scan** -- Fix pre-existing issues in touched files (boy scout rule)
6. **`qa-engineer`** -- Test coverage validation, edge case identification
7. **Build Verification** -- Run `npm run build:win` to catch TypeScript errors
8. **E2E Console Health** -- Run `npm run test:e2e -- --grep "Console Health"` to catch runtime errors, deprecation warnings, and console errors across all app sections (requires build from step 7; requires C++ build tools locally — Visual Studio Build Tools on Windows, build-essential on Linux; always enforced in CI)
9. **`documentation-specialist`** -- Update CLAUDE.md, README, inline comments

**Key rules:** Fix all issues before proceeding. Never skip steps. ESLint must pass with zero warnings. E2E console health is mandatory in CI; locally it may be skipped if C++ build tools are unavailable (warned at step 8).

## Security Posture: A- (0 Critical, 1 High)

10 rounds of security and code review remediation completed 2026-02-22 through 2026-02-27 -- all critical and high issues resolved except one inherent JS limitation. Full audit reports in .claude/: security-audit-report.md, code-review-report.md, qa-report.md, cleanup-report.md.

**Active security properties:**
- MCP server: bearer token auth, cors({ origin: false }), bound to 127.0.0.1
- Preload: scoped typed API with channel allowlist, sandbox: true, contextIsolation: true, nodeIntegration: false
- CRLF injection: stripCRLF on all SMTP recipients/subjects (both IPC and MCP paths)
- Settings: ALLOWED_SETTINGS_KEYS allowlist; rule engine: VALID_FIELDS/VALID_OPERATORS/VALID_ACTIONS guard sets
- Cross-account ownership enforced on all email/folder/scheduled/reminder/rule IPC handlers
- CSP meta tag in index.html; will-navigate + setWindowOpenHandler defense-in-depth in main.ts
- Email HTML: sandboxed iframe (no allow-same-origin), iframe-internal CSP, DOMPurify on all HTML before iframe
- Crash handling: uncaughtException only exits for fatal errors (MODULE_NOT_FOUND, NODE_MODULE_VERSION, OOM)
- Log injection: log:error IPC strips CR/LF/NUL, prepends [RENDERER], caps at 4000 chars
- Update packages: .expressdelivery format with SHA-256 payload integrity, Authenticode signature verification, path traversal prevention (CWE-22), command injection prevention (CWE-78 — execFileSync with args array, no shell interpolation), payload filename sanitization

**Remaining limitation:**
- Decrypted passwords in V8 heap (inherent to JS; mitigated with short-lived scope)

## Test Coverage: ~80% (35 files, 819 tests)

**Tested:** crypto, db, db.phase6 (folder CRUD, mark-read/unread, mark-all-read, extractUid), mcpServer, mcpTools (all 8 handlers), imapSanitize, themeStore, emailStore, SettingsModal, ComposeModal (TipTap + signatures + account selection), ReadingPane (CID + remote image blocking + thread collapse/expand + AI reply), ThreadList (88 tests: rendering, multi-select, bulk actions, context menu, search, empty states, unified inbox badge), useKeyboardShortcuts, formatFileSize, smtp, ContactAutocomplete, scheduler, ruleEngine, App, ThemeContext, DateTimePicker, UpdateBanner, OnboardingScreen, spamFilter (18 tests: tokenize, train, classify), phishingDetector (16 tests: URL analysis, brand spoofing, suspicious TLDs), openRouterClient (37 tests: API calls, validation, prompt injection, error handling), ConfirmDialog (29 tests: confirm + prompt modes, validation, danger variant, keyboard, i18n), updater (25 tests: CWE-22 path traversal, CWE-78 injection, version comparison, thumbprint normalization), emailImport (21 tests: XSS sanitization, RFC 2822 parsing, MIME multipart), authResults (17 tests: SPF/DKIM/DMARC parsing, sender verification), rateLimiter (12 tests: token bucket exhaustion, refill, isolation)
**Tested:** imapSync (56 tests: withImapTimeout, AccountSyncController lifecycle/forceDisconnect/reconnect/heartbeat/sync-cycle/updateIntervals, parallel isolation, edge cases)
**Untested critical paths:** IMAP protocol integration (IMAPFlow client calls — deferred to E2E)

## Feature Status Summary

Full feature matrix and phased roadmap in `docs/ROADMAP.md`. Reference client: [Mailspring](https://github.com/Foundry376/Mailspring).

### What's Done (Phase 1-7 complete -- v1.5.0)
- Account management (add/remove/edit/test, 5 provider presets, brand icons)
- IMAP connect + IDLE + body fetch + folder sync + reconnect with exponential backoff
- Connection testing (10s timeout) -- standalone Test Connection button + test-before-save, visual status (pass/fail/spinner)
- SMTP send with CC/BCC (TLS/STARTTLS, injection-safe)
- Full-text search (FTS5, debounced)
- Rich text email compose (TipTap: bold/italic/underline/lists/links) with To/CC/BCC + contact autocomplete (ARIA combobox), reply/forward prefill
- Per-account email signatures (HTML, 10KB cap, DOMPurify-sanitized, preview in compose)
- HTML email rendering (sandboxed iframe with CSP + DOMPurify sanitization, postMessage auto-resize)
- Inline CID image display (Content-ID extraction, IMAP on-demand download, MIME allowlist, data: URL rendering)
- Remote image blocking (blocked by default, privacy banner, "Load images" button, CSP defense-in-depth)
- Reply, Forward, Delete, Star/Flag, Archive, Move-to-folder actions wired
- Keyboard shortcuts: mod+N compose, R reply, F forward, E archive, J/K navigate, Delete, Escape
- Contact autocomplete in To/CC/BCC (200ms debounce, auto-harvest on send, email validation)
- Draft auto-save (2s debounce, CC/BCC preserved, delete on send, resume via draftId)
- Multi-account sidebar with provider icons and unread badges
- `email:new` IPC event emitted from main process
- 4 themes + 2 layouts (persisted)
- Premium onboarding wizard (4-step, 9 animations, WCAG 2.1, connection testing)
- MCP server with 8 AI tools (search, read, send, draft, summary, categorize, analytics, suggest_reply)
- Multi-client MCP SSE transport (Map<sessionId, ClientSession>), connection status push, timing-safe auth
- AI metadata: email categorization (category/priority/labels), priority badges in ThreadList, AI metadata row in ReadingPane
- MCP connection status indicator in Sidebar (green dot + agent count)
- OpenRouter API key management (encrypted via safeStorage, Settings "AI / API Keys" tab, eye toggle, save/clear, auto-clear feedback)
- Security hardened (auth, sandbox, CSP, scoped IPC, encrypted passwords, cross-account guards, account ownership on MCP tools, encrypted API key storage)
- System tray with icon
- File attachments: send (file picker, 25MB/file, max 10) + receive (IMAP on-demand download, SQLite BLOB cache), attachment chips in compose/reading pane/thread list, MCP send_email with attachments
- Snooze emails (30s polling scheduler, wake/unsnooze, snoozed virtual folder in Sidebar)
- Send later (scheduled sends with DateTimePicker, quick-select presets, scheduled virtual folder)
- Reminders (per-email, scheduled notifications, reminder management in ReadingPane)
- Mail rules engine (from/subject/body/has_attachment conditions, mark-read/star/move/delete/label actions, account-scoped, priority-ordered)
- i18n framework (react-i18next, 4 locales: en/fr/es/de, translation files in src/locales/)
- OS notifications (system tray notifications via Electron Notification API, triggered by scheduler)
- Auto-update banner (electron-updater, GitHub Releases, autoDownload: false, progress/install)
- Code signing config in electron-builder.json5 (Windows + macOS signing fields)
- Linux deb/rpm targets added to electron-builder.json5
- SQLCipher migration stub (electron/dbEncryption.ts, Phase 5 implementation ready)
- GitHub Actions: ci.yml (lint+test+tsc on push/PR), release.yml (build+publish on v* tag, SHA-pinned)
- **Phase 6 (v1.4.0):** Multi-select emails with bulk actions (mark read/unread, star, move, delete), right-click context menu (reply, forward, star, toggle-read, move-to, delete), folder context menu (mark all read, rename, create subfolder, delete), empty trash with confirmation, folder-specific empty states, print email / save as PDF, undo send delay configuration UI, confirmation toasts with undo, keyboard shortcut help overlay (?), notification click navigation, `emails:mark-read` lightweight IPC, `extractUid` helper, cross-account folder ownership checks, transactional folder renames (FK-safe insert→migrate→delete), 488 tests across 23 files
- **Phase 7 (v1.5.0):** User-defined tags (CRUD + assign/remove, color picker, sidebar section, ReadingPane tag chips, Settings Tags tab), saved searches (virtual `__search_` folders, FTS5 execution), loading skeletons (shimmer animation, wired isLoading), density modes (compact/comfortable/relaxed CSS variables), zoom control (80-150% in ReadingPane), folder colors (8 presets, context menu picker), sound alerts (notification.wav, toggle in Settings), drag-and-drop emails to folders (HTML5 drag API, multi-email drag), message source viewer (raw RFC822 via IMAP, Radix Dialog, copy button), mailing list unsubscribe (List-Unsubscribe header parsing, unsubscribe banner), email export/import (EML single + MBOX folder), contact import/export (vCard 3.0 + CSV), Bayesian spam filter (train/classify, Laplace smoothing), phishing URL detection (7 heuristic rules, warning banner), 522 tests across 25 files
- **Phase 8 (v1.6.0):** Thread conversation collapse/expand (older collapsed, latest expanded, avatar+snippet headers), unified inbox polish (thread-dedup SQL, provider badge, correct reply account via sendingAccount useMemo), AI compose assistant (OpenRouter LLM, 5 tones, Sparkles button, DOMPurify sanitization), optimal send time hint (analytics:busiest-hours IPC), quick reply templates marked Done, prompt injection sanitization, 568 tests across 26 files
- **Phase 9 (v1.7.0):** Bugs & polish — ConfirmDialog component (replaces window.confirm/prompt), 45+ i18n strings fixed, CSS cleanup (11 unused utilities removed, 6 inline styles extracted), contact profiles (company/phone/title/notes), SettingsModal performance (visitedTabs render gates, batched IPC, scoped Zustand), AI Reply error UX (toast instead of inline), SQLite test flake fixed (unique temp dirs), DB migration 12, 617+ tests across 27 files
- **Phase 10 (v1.8.0):** Custom application menu bar (replaced by frameless TitleBar in v1.12.5), send countdown fix (single-interval, dismiss button), DevTools enabled in production, AI & Agentic README section, 646 tests across 27 files
- **Phase 11 (v1.11.0–v1.11.4):** All Accounts view (unified virtual folders `__all_inbox` etc.), secure file-based updater (.expressdelivery ZIP+manifest, SHA-256, Authenticode, NSIS silent install), spam actions, NSIS auto-kill. v1.11.1: aggregated sync indicator for All Accounts mode (green/purple/red), account folders with labeled separators, solid context menu background, Linux ARM64 deb target, hono CVE fix. v1.11.2: live web updater in Settings (electron-updater → GitHub Releases check/download/install flow), removed Help menu "Check for Updates", 4h periodic re-check. v1.11.3: All Accounts filter (include/exclude accounts via checkbox picker, excluded accounts filtered at SQL level, asterisk + accent indicator for partial selection, persisted to localStorage). v1.11.4: update notification moved from floating banner to sidebar footer (compact accent bar with download/restart/dismiss, pulsing dot in collapsed mode), release workflow uses `--publish always` for auto-update `latest.yml`, professional README rewrite, 648 tests across 27 files

- **Phase 12.5 (v1.12.5):** Frameless window redesign — removed native Windows title bar (`frame: false`), custom `TitleBar` component (minimize/maximize/close, drag region, theme-aware), deleted `electron/menu.ts`, all menu actions reassigned to keyboard shortcuts (Ctrl+P print, Ctrl+F search, Ctrl+0 reset zoom, Ctrl+\ sidebar, Ctrl+/ shortcuts, F11 fullscreen, Ctrl+Shift+I devtools) or Settings UI. SettingsModal redesigned with two-level navigation: horizontal category tabs (General/Email/AI & Agents/Data/System) + vertical sub-tabs per category. New Import/Export sub-tab (absorbs File menu actions) and About sub-tab (version info). Reset Zoom button in ReadingPane (RotateCcw, visible when zoom != 100%). Roadmap consolidated: merged deferred features report, 11 features marked Skipped, added Phase 13 (code signing + tests) and Phase 14 (Calendar RSVP). 8 new IPC handlers (window controls + app info), 648 tests across 27 files

- **Phase 14 (v1.14.0):** Quality & reliability hardening — 18 silent failure fixes (4 HIGH: print:email Promise wrap, emails:search structured return, mcp:toggle try/catch, contacts:update explicit returns; 8 MEDIUM: accounts:set-excluded, emails:toggle-flag, searches:run, update:install, window controls, spam:train, reminders:cancel, IMAP startup did-finish-load; 6 LOW: queryDate rename, templates:delete/tags:remove verification, imap:status try/catch, moveMessage logging). Dead code cleanup: removed 10 dead preload IPC channels (channels/intent/llm), vestigial menu:action listener, 3x duplicated stripCRLF → single import from utils.ts, dead MAIN_DIST export, PURIFY_CONFIG_THREAD alias. 4 new test files: updater.test.ts (25 tests: CWE-22 path traversal, CWE-78 injection, version comparison, thumbprint normalization), emailImport.test.ts (21 tests: XSS sanitization, RFC 2822 parsing, MIME multipart), authResults.test.ts (17 tests: SPF/DKIM/DMARC parsing, sender verification), rateLimiter.test.ts (12 tests: token bucket exhaustion, refill, isolation). 723 tests across 31 files

- **Phase 15 (v1.15.0):** Global Search, predictive search, contextual folder switching, post-update splash — Global Search overlay (Ctrl+Shift+F) searches across all accounts/folders with 100-result limit, grouped by account, keyboard navigation (↑↓/Enter), glassmorphism overlay. Predictive search: FTS5 prefix wildcards for as-you-type, 200ms debounce, 1-char minimum, account filtering, 50-result limit, spinning search icon + clear button. Contextual folder switching restored: clicking email in All Accounts mode auto-expands and scrolls to that account's folder group with accent highlight. Post-update splash screen: animated "Updated to vX.X.X" screen on relaunch after file-based update (3-phase animation, version badge, changelog, click-to-skip, WCAG reduced-motion). New IPC handlers: emails:search-global, update:postUpdateInfo, update:clearPostUpdate. 2 new components (GlobalSearch, UpdateSplash), 723 tests across 31 files

- **v1.15.3:** IMAP reliability overhaul — per-account `AccountSyncController` replaces global poll loop (isolated lifecycle per account, forceDisconnect, parallel sync). `withImapTimeout` wrapper protects all IMAP operations with configurable per-operation timeouts. NOOP heartbeat every 2 minutes detects half-open TCP connections before they stall sync. Infinite reconnect with exponential backoff + jitter (no retry cap). Staleness-aware sync status indicator in Sidebar (green=fresh <5min, amber=stale >5min, red=error/disconnected). Settings > Email > Sync sub-tab with 3 configurable intervals (sync frequency, heartbeat, timeout). 1 new test file: imapSync.test.ts (56 tests covering AccountSyncController lifecycle, withImapTimeout, reconnect, heartbeat, parallel isolation). 779 tests across 32 files

- **v1.15.4:** Update reliability — silent auto-update via `quitAndInstall(isSilent=true, forceRunAfter=true)` (no visible prompt on restart). NSIS verified kill loop (polls until process exits before install, prevents file-lock failures). NSIS installer uses `nsProcess::KillProcess` + 5s wait for clean app shutdown before overwrite.

- **v1.15.8:** Button hover/active feedback — increased `--hover-bg` from 6% to 9% opacity, added `--active-bg` (15%) CSS variable, icon buttons gain subtle box-shadow on hover + pressed state, global `button:active` scale(0.96) micro-interaction, `:active` states on sidebar nav, compose, collapse, bulk actions, and title bar controls. 779 tests across 32 files

- **v1.15.9:** Fix web update checker falsely reporting older releases as available — `update:check` IPC now compares remote version against installed version. Icon buttons gain resting background tint and stronger hover shadow. 779 tests across 32 files

- **Phase 16 (v1.16.0):** Provider auth guidance overhaul — replaces outdated password-only account setup with provider-specific guidance for the reality of April 2026. New reusable `ProviderHelpPanel` component rendered in both OnboardingScreen and SettingsModal (add + edit flows), carrying a short note, collapsible step-by-step instructions, and an "Open official page" button backed by a new `shell:open-external` IPC handler with exact-URL allowlist. `ProviderPreset` interface extended with `authModel` (`password-supported` | `oauth2-required` | `password` | `legacy`), `shortNoteKey`, `stepsKey`, `helpUrl`, `warningKey`, `comingSoonMessageKey`. The old single `outlook` preset split into `outlook-personal` (`smtp-mail.outlook.com:587`) and `outlook-business` (`smtp.office365.com:587`), both rendering a disabled state on add flows with a "Use Other / Custom instead" escape hatch because Microsoft is removing Basic Auth SMTP on personal Outlook.com by April 30, 2026 and OAuth2 is not yet implemented. Legacy accounts with stored `provider='outlook'` map to an invisible `OUTLOOK_LEGACY_PRESET` via new `getPresetForAccount()` resolver — fully editable in SettingsModal with a warning banner, preserved through save via new `editingOriginalProvider` state so the stored column is never rewritten. Gmail/Yahoo/iCloud each ship with 4-5 numbered app-password setup steps in all 4 locales (en/fr/es/de). `providerIcons.tsx` extended with entries for the split Outlook IDs. No DB migration, no OAuth2 implementation — Phase 17 (or later) will add OAuth2 for Gmail and Microsoft while keeping app-password flows for Yahoo and iCloud. 4 new files: `electron/shellOpen.ts`, `src/components/ProviderHelpPanel.tsx`, test files for both, `src/lib/providerPresets.test.ts`. Full pipeline green: ESLint `--max-warnings 0`, `tsc --noEmit` clean, 814 tests across 35 files, Semgrep SAST zero findings on Phase 1 files, `npm run build:win` producing `release/1.16.0/win-unpacked/ExpressDelivery.exe`.

- **v1.16.1:** Post-Phase-1 polish + dependency audit cleanup. Polish pass landed 7 of the 9 review nits staged during Phase 1: CR/LF/NUL sanitization on the rejected-URL log path in `electron/shellOpen.ts` (`sanitizeForLog()` helper, CWE-117 defense matching the existing `log:error` IPC pattern); `role="status"` + `aria-live="polite"` on the OAuth2-gated Outlook disabled state in both `OnboardingScreen` and `SettingsModal` (assistive tech now announces the disabled state); `ProviderHelpPanel` aria-label routed through new i18n key `providerHelp.common.panelAriaLabel` with `{{provider}}` interpolation in all 4 locales instead of a hardcoded English template literal; `SettingsModal.selectCustomFallback` defensive `if (custom)` guard documented as unreachable per the silent-failure rule; three remaining ASCII `'ExpressDelivery'` quotes in `es.json` replaced with Spanish typographic `«ExpressDelivery»`. Tests strengthened with +5 net: explicit `aria-expanded` assertions on the `ProviderHelpPanel` disclosure button (was verifying list presence but not the attribute), new "pivot-to-server" test locking in the `selectProvider + setStep('server')` batching when "Use Custom Instead" is clicked (verified catches regression by temporarily commenting out `setStep`), new `aria-label through i18n` test (verified catches regression by temporarily reverting to the hardcoded template literal), new CR/LF/NUL stripping and length-cap tests on `sanitizeForLog`, new `role="status"` assertions on both `OnboardingScreen` and `SettingsModal` outlook-personal tests. Narrow `vi.mock('react-i18next')` override in `ProviderHelpPanel.test.tsx` gained minimal `{{var}}` interpolation support. Two staged items intentionally deferred: `providerIcons.tsx` source-of-truth consolidation and `SettingsModal` sub-component extraction — both are larger refactors, not polish. Dependency audit cleanup then ran `npm audit fix` (no `--force`) and resolved **all 13 transitive vulnerabilities to 0** with only `package-lock.json` changes — every vulnerable package had a patched release within existing semver ranges. Notable bumps: `electron 41.0.3 → 41.2.0` (moderate: UAF in offscreen shared texture, clipboard crash, named window.open scope — NODE_MODULE_VERSION 145 preserved so `better-sqlite3` does not require ABI rebuild, verified via `node-abi` lookup), `nodemailer 8.0.1 → 8.0.5` (moderate: SMTP command injection via `envelope.size` + CRLF in EHLO/HELO — the existing `stripCRLF` in `electron/utils.ts` was already defense-in-depth), `imapflow 1.2.10 → 1.3.1` and `mailparser 3.9.3 → 3.9.8` (low, via nodemailer), `vite 7.3.1 → 7.3.2` (high: path traversal in optimized deps `.map`, `server.fs.deny` bypass, dev-server WebSocket arbitrary file read — dev-only, not bundled), `hono 4.12.8 → 4.12.12` + `@hono/node-server 1.19.11 → 1.19.14` (moderate: `serveStatic` middleware bypass — MCP server does not serve static files), `@xmldom/xmldom 0.8.11 → 0.8.12` (high: XML injection via unsafe CDATA), `path-to-regexp 8.3.0 → 8.4.2` (high: ReDoS via optional groups and wildcards), `picomatch 4.0.3 → 4.0.4` (high: method injection in POSIX classes, ReDoS in extglob quantifiers). Full pipeline green on the bumped lock file: ESLint `--max-warnings 0`, `tsc --noEmit` clean, 819 tests across 35 files (up from 814 baseline), `npm audit` reports `found 0 vulnerabilities` (was 2 low / 5 moderate / 6 high / 13 total), `npm run build:win` packaged `release/1.16.0/win-unpacked/ExpressDelivery.exe` with Electron 41.2.0 and `better-sqlite3` rebuilt for Electron ABI 145 then restored to host ABI 137 for Vitest. Semgrep SAST on the 5 polish files: zero findings.

- **Phase 17 (v1.17.0):** OAuth2 sign-in for Gmail and Microsoft. Replaces the Phase 1 "coming soon" gate on Outlook presets with a live, working OAuth flow built on RFC 8252 loopback (Google) and `@azure/msal-node` `PublicClientApplication` (Microsoft personal + business), and adds a Microsoft Graph `POST /me/sendMail` send path for personal Outlook.com accounts so they keep working after Microsoft removes Basic Auth SMTP on April 30, 2026. Schema v17 introduces a new `oauth_credentials` table (one row per `(account_id, provider)` storing AES-encrypted access + refresh tokens via `electron.safeStorage`, expiry epoch, scope, token type, last-refreshed timestamp, last-error code, FK cascade to accounts) plus two new accounts columns: `auth_type` (`'password'` | `'oauth2'`, default `'password'`) and `auth_state` (`'ok'` | `'recommended_reauth'` | `'reauth_required'`, default `'ok'`), with backfill for existing rows. New singleton `AuthTokenManager` (`electron/auth/tokenManager.ts`) provides `getValidAccessToken()` with JIT pre-flight refresh (refreshes when within 60s of expiry), per-account dedup mutex (in-flight Map<accountId, Promise>) so concurrent IMAP/SMTP/Graph callers share one refresh round-trip, error classification (`isPermanentOAuthError` for `invalid_grant` / `consent_required` flips `auth_state` to `reauth_required`; transient errors retry without state change), `invalidateToken()` for on-401 retry callers, `persistInitialTokens()` for first-token writes, redacted log lines (8-char token preview, 2+2-char account preview). New send dispatcher `electron/send/sendMail.ts` chooses between SMTP-with-XOAUTH2 (Gmail, Outlook.com password fallback, Microsoft 365 business) and Microsoft Graph (`electron/send/graphSend.ts`, personal Outlook.com); `electron/smtp.ts` extended to accept an `auth: { type: 'oauth2', user, accessToken }` parameter and pass `XOAUTH2` SASL credentials to `nodemailer`, with `sendEmailWithOAuthRetry()` wrapping send paths in on-`EAUTH` invalidate-and-retry. `electron/imap.ts` `AccountSyncController` extended with OAuth2 wiring: at connect time it calls `tokenManager.getValidAccessToken()` and passes `{ user, accessToken }` to `IMAPFlow`; on `EAUTHENTICATIONFAILED` it calls `invalidateToken()`, retries once, and on second failure flips `auth_state` and emits a needs-reauth IPC event. Five new IPC channels in `electron/auth/ipcHandlers.ts`: `auth:start-oauth-flow` (creates account row + persists tokens in single transaction per D11.5b), `auth:start-reauth-flow` (in-place legacy outlook migration, D8.2 transaction order ensures persist-before-clear so a failed reauth leaves the account retryable), `auth:cancel-flow`, `auth:flow-status`, `auth:get-state`. New reusable `OAuthSignInButton` component (`src/components/OAuthSignInButton.tsx`) with in-flight spinner + `aria-busy` + double-click guard. `OnboardingScreen` Gmail card now shows the Google sign-in button above the email/password form separated by an "or use an app password" divider (Gmail keeps the dual path); Outlook Personal and Microsoft 365 cards show the Microsoft sign-in button inside the same `role="status"` region as Phase 1, with the "Use Other / Custom instead" escape hatch still present. `SettingsModal` Account Add tab uses the same pattern; Account Edit tab adds a reauth banner (amber for `recommended_reauth`, red for `reauth_required`) with a "Sign in again" CTA plus a separate migration banner for legacy `provider='outlook'` + `auth_type='password'` accounts. `Sidebar` renders red/amber reauth badges next to account rows in the corresponding states, listens for `auth:needs-reauth` events to refresh state, and exposes an inline "Sign in again" button. `outlook-personal` and `outlook-business` presets flipped from `'oauth2-required'` (Phase 1 disabled state) to `'oauth2-supported'`, their `warningKey` cleared and replaced by a new accent banner in `ProviderHelpPanel` titled "Faster sign-in available" rendered for any provider in the OAuth allowlist (`gmail`, `outlook-personal`, `outlook-business`); legacy outlook warning text updated to actionable migration copy. New top-level `oauth` namespace in all 4 locales (en/fr/es/de) with 21 leaf keys + `providerPresets.outlook*.oauthSteps` 5-step arrays with real professional translations. New `tests/fixtures/oauth/` with 5 scrubbed token-endpoint fixtures and a README documenting scrubbing rules. `release.yml` gains a "Verify OAuth secrets" pre-flight step that fails the workflow loudly if any of `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, or `OAUTH_MICROSOFT_CLIENT_ID` is missing, plus `VITE_OAUTH_*` env injection on the build step (both Windows and Linux jobs). Console Health E2E adapted (Outlook tests now assert the new accent banner instead of the Phase 1 amber warning) and extended with 2 new tests (Gmail Google sign-in button, Outlook OAuth button enablement); 1 sidebar reauth badge test marked `.skip` with a TODO referencing missing seed-hook infra. Security: PKCE S256 with `crypto.randomBytes(32)`, 32-byte hex CSRF state token, loopback bind explicitly to `127.0.0.1`, `safeErrorMessage()` strips CR/LF/NUL and caps stack traces on every renderer error, account-id redaction symmetric across `tokenManager.ts`, `ipcHandlers.ts`, and `accountRevoke.ts`, D11.3 singleton `activeOAuthFlow` blocks concurrent OAuth flows. Test count: **1002 tests across 45 files** (up from 819 across 35 in v1.16.1), 7 enabled Console Health E2E tests + 1 skipped (was 5). Full pipeline green: ESLint `--max-warnings 0`, `tsc --noEmit` clean, `npm audit` 0 vulnerabilities (preserved from v1.16.1), `npm run build:win` packaged `release/1.17.0/win-unpacked/ExpressDelivery.exe`. Schema version 15 → 17. New external dependency: `@azure/msal-node` for Microsoft OAuth, `nock` for HTTP mocks in adapter tests.

- **Phase 17.1 (v1.17.1):** Polish follow-up to v1.17.0. Three items deferred during Phase 2 execution landed in one patch release: (1) Playwright **seed hook** wiring — `ELECTRON_USER_DATA_DIR` env var now actually overrides the Electron userData path (was declared in the fixture but never consumed), and a new `EXPRESSDELIVERY_TEST_SEED_REAUTH` env var gated on `NODE_ENV=test` inserts a synthetic Gmail OAuth account with a caller-supplied `auth_state` after `initDatabase()`. The previously-skipped Console Health test "sidebar: reauth badge renders for an account in reauth_required state" is now enabled and asserts the red badge is visible via `page.getByLabel(/sign.?in.?(needed|required|again)/i)`. (2) SettingsModal **`deepLink` prop** — new `{ accountId?: string }` prop that, when supplied on mount, navigates the modal to Email → Accounts and calls `enterEditMode(account)` for the target account. Wired from `App.tsx` via a new `settingsDeepLink` state fed by a new `onSettings(opts?: { accountId?: string })` Sidebar prop signature. The Sidebar "Sign in again" CTA now deep-links to the account's edit form instead of opening the last-visited tab. (3) **Dead i18n key cleanup** — removed `oauth.mismatch.cancel` and `oauth.mismatch.proceedAnyway` from all 4 locales (they were populated in v1.17.0 based on a pre-implementation assumption about the mismatch UX that did not materialize — the warning is a status banner, not a dialog with buttons). Simplified warning copy to "the account was added — remove and re-add if you want the other preset". Also fixed one pre-existing Windows CI flake in `electron/rateLimiter.test.ts` (from v1.14.0, unrelated to Phase 2 but blocking merges) by widening the refill sleep from 20ms to 60ms to accommodate Windows' ~15ms timer granularity. Dead `tests/e2e/fixtures/seed-database.ts` removed (never imported). Schema-drift-proof seed approach: the env-var hook runs AFTER `initDatabase()` so the real production schema is in place when rows are inserted. No schema changes, no new dependencies, no breaking API changes — safe patch release. Full pipeline green: ESLint `--max-warnings 0`, `tsc --noEmit` clean, 1002 tests across 45 files (+1 net SettingsModal `deepLink` test), `npm run build:win` packages `release/1.17.1/win-unpacked/ExpressDelivery.exe`.

### What's Not Done Yet (by phase)
- **Phase 18 (planned):** Code signing (SignPath.io free for OSS), broader integration tests, macOS CI build job, Windows/Linux ARM64 coverage

## Known Issues and Technical Debt

All critical, high, and medium issues from the 2026-02-22 initial audit through the 2026-02-27 Phase 6 remediation are resolved. Full history in .claude/ audit reports.

**Open items:**
- [x] ~~Remove unused CSS utility classes~~ -- removed in Phase 9
- [x] ~~isLoading/setLoading wired to folder load operations in Phase 7 (loading skeletons)~~
- [ ] Virtual folders __snoozed/__scheduled: basic query support only; advanced filtering pending
- [x] ~~IMAP sync reliability~~ — per-account controllers with timeout protection, NOOP heartbeat, infinite reconnect (v1.15.3)
- [ ] IMAP protocol integration untested (IMAPFlow client calls — deferred to E2E)
- [x] ~~window.prompt for Insert Link~~ -- replaced with ConfirmDialog (Radix Dialog) in Phase 9
- [x] ~~accounts[0] used for compose signature~~ -- fixed in Phase 8: sendingAccount useMemo with initialAccountId
- [x] ~~SettingsModal strings hardcoded~~ -- all i18n-ified in Phase 9 (~50 new keys)
- [x] ~~SQLCipher~~ — Skipped: OS-level FDE sufficient for most users
