# ExpressDelivery - AI-Powered Email Client

Electron desktop email client with MCP (Model Context Protocol) integration for AI-assisted operations. **Status:** v1.18.9 (schema v17, 21 React components, 2 Zustand stores, ~120 IPC handlers, 8 MCP tools, 54 test files / 1167 tests). Full IMAP/SMTP with OAuth2 sign-in for Gmail (RFC 8252 loopback + PKCE S256) and Microsoft personal/business (`@azure/msal-node`), plus a Microsoft Graph send path for personal Outlook.com (Basic Auth SMTP kill April 2026). Per-account `AccountSyncController` with NOOP heartbeat + infinite exponential-backoff reconnect, `AuthTokenManager` singleton with JIT pre-flight refresh + per-account dedup mutex, in-place legacy outlook re-auth, sidebar reauth badges. Frameless window with custom TitleBar, 4 themes, 2 layouts. Rich text compose (TipTap), sandboxed-iframe HTML rendering + DOMPurify, CID inline images, remote image blocking. Multi-client MCP SSE server on port 3000. Playwright E2E Console Health suite (8 enabled).

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

## Test Coverage

~80% across **54 files / 1167 tests** (Vitest 4 + jsdom) plus **8 Playwright E2E Console Health** tests. Coverage spans crypto, db, mcpServer/mcpTools, imapSync (`AccountSyncController` lifecycle, `withImapTimeout`, heartbeat, reconnect), smtp, scheduler, ruleEngine, spamFilter, phishingDetector, openRouterClient, updater (CWE-22/CWE-78), emailImport, authResults, rateLimiter, all Zustand stores, and all major React components (SettingsModal, ComposeModal, ReadingPane, ThreadList, Sidebar, OnboardingScreen, ConfirmDialog, ProviderHelpPanel, OAuthSignInButton).

**Untested critical paths:** IMAP protocol integration (IMAPFlow client calls — deferred to E2E).

## Feature Status

Full feature matrix and phased roadmap in `docs/ROADMAP.md` — it is authoritative for phase-by-phase history. Git log is authoritative for change details. Reference client: [Mailspring](https://github.com/Foundry376/Mailspring).

### Shipped capabilities (v1.17.x)

- **Accounts:** add/edit/remove/test, 5 provider presets + Custom, brand icons, OAuth2 sign-in for Gmail + Microsoft personal/business, password fallback for Yahoo/iCloud, in-place legacy outlook re-auth, sidebar reauth badges (red/amber), per-account `auth_state` (`ok` / `recommended_reauth` / `reauth_required`)
- **IMAP/SMTP:** per-account `AccountSyncController` with isolated lifecycle + `forceDisconnect` + parallel sync, IDLE + body/folder fetch, NOOP heartbeat every 2 min, infinite exponential backoff + jitter, `withImapTimeout` wrapper, on-401 OAuth retry, configurable intervals (Settings > Email > Sync), staleness-aware sync indicator
- **Send dispatcher:** SMTP-with-XOAUTH2 (Gmail, Outlook password fallback, M365 business) vs Microsoft Graph `POST /me/sendMail` (personal Outlook.com, Basic Auth SMTP kill April 2026), `sendEmailWithOAuthRetry` on-`EAUTH` invalidate+retry
- **Compose:** TipTap rich text, To/CC/BCC, contact autocomplete + auto-harvest, reply/forward prefill (correct account via `sendingAccount` useMemo), per-account signatures (DOMPurify sanitized), draft auto-save (2s debounce), attachments (25MB/file, max 10), scheduled send with `DateTimePicker`, AI reply (OpenRouter, 5 tones, Sparkles button, prompt-injection sanitized)
- **Reading:** sandboxed-iframe HTML (CSP + DOMPurify), CID inline images (IMAP on-demand + BLOB cache), remote image blocking + privacy banner, thread collapse/expand, reply/forward/delete/star/archive/move/print/save-as-PDF, raw RFC822 source viewer, phishing URL warning, mailing list unsubscribe banner, reminders
- **List:** FTS5 predictive search (as-you-type, 200ms debounce), multi-select + bulk actions, drag-and-drop to folders, right-click context menu, priority/AI badges, unified All Accounts mode with include/exclude filter, loading skeletons
- **Sidebar:** multi-account switcher with unread + sync staleness + MCP status + reauth badges, folder context menu (rename/create subfolder/delete/color/mark all read), tags section, saved searches, virtual folders (`__all_inbox`, `__snoozed`, `__scheduled`, `__search_*`)
- **Productivity:** snooze (scheduler), reminders, mail rules engine (from/subject/body/has_attachment × contains/equals/starts_with/ends_with → mark/star/move/delete/label), tags (CRUD + color), saved searches, keyboard shortcuts (mod+N/R/F/E/J/K/Delete/?), global search overlay (Ctrl+Shift+F, cross-account FTS5)
- **Data portability:** EML single + MBOX folder export/import, vCard 3.0 + CSV contacts, Bayesian spam filter (train/classify + Laplace smoothing)
- **UI:** frameless window with custom `TitleBar`, 4 themes (Light/Cream/Midnight/Forest), 2 layouts (vertical/horizontal), density modes (compact/comfortable/relaxed), zoom 80-150%, 4 locales (en/fr/es/de), sound alerts, WCAG 2.1 reduced-motion
- **MCP:** multi-client SSE on port 3000, bearer token auth, 8 tools (search_emails, read_thread, send_email, create_draft, get_smart_summary, categorize_email, get_email_analytics, suggest_reply), account ownership enforced, encrypted OpenRouter API key
- **Updates:** dual system — electron-updater (GitHub Releases, silent install via `quitAndInstall(isSilent=true)`, NSIS verified kill loop) + file-based `.expressdelivery` packages (ZIP + manifest, SHA-256, Authenticode, path-traversal/command-injection hardened), post-update splash
- **Build/CI:** GitHub Actions `ci.yml` + `release.yml` (SHA-pinned), targets NSIS/AppImage/deb/rpm/DMG, `VITE_OAUTH_*` secret injection + pre-package verification gate

### Planned (Phase 18)

- Code signing (SignPath.io OSS), broader integration tests, macOS CI build job, Windows/Linux ARM64 coverage

## Known Issues and Technical Debt

All critical/high/medium issues from the 2026-02-22 → 2026-02-27 audit remediation are resolved. Full history in `.claude/` audit reports (security, code-review, qa, cleanup).

**Open items:**
- Virtual folders `__snoozed`/`__scheduled`: basic query support only; advanced filtering pending
- IMAP protocol integration untested (IMAPFlow client calls — deferred to E2E)
- Decrypted passwords in V8 heap (inherent JS limitation; mitigated with short-lived scope)
