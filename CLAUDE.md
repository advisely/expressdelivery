# ExpressDelivery - AI-Powered Email Client

Electron desktop email client with MCP (Model Context Protocol) integration for AI-assisted email operations. **Status:** Phase 8 complete (v1.6.0). 14 components, 2 Zustand stores, 8 MCP tools, SQLite persistence (11 migrations), 4 themes, 26 test files (617+ tests), ~83 IPC handlers. Full IMAP sync (body + folders + reconnect), HTML email rendering (DOMPurify), reply/forward/delete/star/archive/move, CC/BCC compose with contact autocomplete, contact auto-harvest, draft auto-save/resume, file attachments (send + receive, IMAP on-demand download, SQLite BLOB cache), keyboard shortcuts (mod+N/R/F/E/J/K/Delete/Escape), multi-account sidebar with unread badges + AI status indicator, connection testing, account editing, provider brand icons. Rich text compose (TipTap), per-account email signatures, inline CID image display, remote image blocking with privacy banner. AI-powered features: email categorization/priority/labels via MCP, mailbox analytics, suggest reply context, multi-client SSE transport, OpenRouter API key management (encrypted via safeStorage, Settings UI). App icon implemented (SVG source in `build/`, PNG/ICO generated via `npm run generate:icons`). Premium onboarding flow with 9 CSS animations, glassmorphism, and WCAG 2.1 reduced-motion support.

## Tech Stack

| Layer     | Technology                                                                                   |
| --------- | -------------------------------------------------------------------------------------------- |
| Frontend  | React 19, TypeScript 5.9 strict, Zustand (theme + email stores), Radix UI (Dialog, Tabs, Popover), TipTap (rich text), Lucide icons, Tailwind CSS v4, DOMPurify, react-i18next, CSS custom properties |
| Backend   | Electron 40, better-sqlite3 (WAL + FTS5), IMAPFlow, Nodemailer, Express 5, electron-updater    |
| AI/MCP    | @modelcontextprotocol/sdk (multi-client SSE transport on port 3000), 8 tools (search, read, send, draft, summary, categorize, analytics, suggest_reply) |
| Build     | Vite 7 + vite-plugin-electron, electron-builder (Windows NSIS, Linux AppImage/deb/rpm, macOS DMG, GitHub Releases publish) |
| Testing   | Vitest 4 + jsdom, @testing-library/react, @vitest/coverage-v8                               |

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
| `electron/main.ts`         | Electron entry, window + tray + ~77 IPC handlers (snooze, scheduled sends, reminders, rules, update, notifications, print, bulk actions, tags, exports, imports, spam, source, ai:suggest-reply, analytics:busiest-hours) |
| `electron/db.ts`           | SQLite init, schema, 11 migrations (accounts, folders, emails, drafts, contacts, attachments, settings, snoozed_emails, scheduled_sends, reminders, mail_rules, FTS5) |
| `electron/mcpServer.ts`    | MCP multi-client SSE server (Map-based dispatch, connection callback, timing-safe auth, lazy init via getMcpServer()) |
| `electron/mcpTools.ts`     | 8 MCP tool handlers + buildToolRegistry() Map factory |
| `electron/imap.ts`         | IMAP client (connect, IDLE, sync envelope+bodyStructure at startup, on-demand body fetch, folders, attachments, Content-ID, reconnect, applyRulesToEmail) |
| `electron/smtp.ts`         | SMTP sender via Nodemailer (host/port from DB, CC/BCC, attachments, CRLF-safe) |
| `electron/crypto.ts`       | OS keychain encryption (safeStorage)            |
| `electron/logger.ts`       | Shared debug logger (writes to `app.getPath('logs')`) |
| `electron/preload.ts`      | IPC bridge -- scoped typed API with channel allowlist (builds as CJS .cjs) |
| `electron/utils.ts`        | Shared utilities (FTS5 query sanitizer, stripCRLF, escapeAttr)         |
| `electron/scheduler.ts`    | 30s polling scheduler for snooze wake, scheduled sends, and reminder notifications |
| `electron/ruleEngine.ts`   | Mail rule matching + actions (from/subject/body/has_attachment x contains/equals/starts_with/ends_with) |
| `electron/updater.ts`      | electron-updater wrapper (autoDownload: false, GitHub Releases) |
| `electron/spamFilter.ts`   | Bayesian spam classifier (tokenize, train, classify with Laplace smoothing) |
| `electron/openRouterClient.ts` | OpenRouter API client for AI reply generation (15s timeout, prompt sanitization) |
| `electron/emailExport.ts`  | EML single + MBOX folder export with RFC 2822 formatting |
| `electron/emailImport.ts`  | EML/MBOX file import with header parsing, 1000 msg cap |
| `electron/contactPortability.ts` | vCard 3.0 + CSV contact import/export |
| `electron/dbEncryption.ts` | SQLCipher migration stub (Phase 5 at-rest encryption documentation) |
| `src/App.tsx`              | Root component, error boundary, data loading, reply/forward plumbing, toast system |
| `src/components/Sidebar.tsx`     | Multi-account switcher, folders with unread badges, folder context menu, virtual folders |
| `src/components/ThreadList.tsx`  | Email list with search, multi-select, bulk actions, right-click context menu      |
| `src/components/ReadingPane.tsx` | HTML email viewer (SandboxedEmailBody), reply/forward/delete/star/print actions, CID inline images, remote image blocking |
| `src/components/ComposeModal.tsx`| Rich text compose (TipTap) with To/CC/BCC, reply/forward prefill, signature preview, scheduled send |
| `src/components/SettingsModal.tsx`| Account management (add/edit/test/delete) + theme/appearance + Agentic/MCP settings, lazy Radix Tabs (9 tabs) |
| `src/components/ThemeContext.tsx` | Layout context + theme class application   |
| `src/components/OnboardingScreen.tsx` | First-run account setup (4-step wizard, 9 CSS animations) |
| `src/components/DateTimePicker.tsx`   | Native datetime input with quick-select presets (1h, 3h, tomorrow, next week) |
| `src/components/UpdateBanner.tsx`     | In-app update available/download progress/install banner |
| `src/components/MessageSourceDialog.tsx` | Raw RFC822 email source viewer (Radix Dialog, monospace pre, copy) |
| `src/lib/providerPresets.ts`   | Email provider IMAP/SMTP presets (Gmail, Outlook, Yahoo, iCloud, Custom) |
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
| `src/index.css`            | Global styles, 4 themes, self-hosted Outfit font, CSS variables, layout modes |

## Data Models

**SQLite Tables:** `accounts` (email, provider, encrypted password, IMAP/SMTP host/port, display_name, signature_html), `folders` (mailbox hierarchy + color), `emails` (messages + FTS5 index + has_attachments + ai_category + ai_priority + ai_labels + is_snoozed + list_unsubscribe + spam_score, schema_version=11), `attachments` (metadata + BLOB cache + content_id, FK cascade to emails), `drafts` (pending emails with cc/bcc), `contacts` (auto-harvested from sent mail), `settings` (key-value), `snoozed_emails` (email_id, snooze_until, created_at), `scheduled_sends` (draft_id, send_at, status), `reminders` (email_id, remind_at, note, status), `mail_rules` (account_id, conditions JSON, actions JSON, order, enabled), `tags` (account_id, name, color), `email_tags` (email_id, tag_id junction), `saved_searches` (account_id, name, query, icon), `spam_tokens` (token, account_id, spam_count, ham_count), `spam_stats` (account_id, total_spam, total_ham)

**Zustand Stores:**
- `themeStore` -- `themeName`, `layout`, `densityMode`, `readingPaneZoom`, persisted to localStorage
- `emailStore` -- `accounts`, `folders`, `emails`, `selectedEmail`, `selectedEmailIds` (Set for multi-select), `tags`, `savedSearches`, `draggedEmailIds`, search state

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
npm run lint             # eslint (strict, 0 warnings)
```

### Build Notes (IMPORTANT)

**Use `scripts/clean-build.mjs`:** All `build:*` scripts use the clean build script which handles the full hydration sequence automatically: kill app, purge stale artifacts, delete old `better-sqlite3` build, rebuild native deps for Electron ABI, compile, package, verify binary, restore host binary for vitest.

**Why this matters:** `better-sqlite3` is a NAN-based native module (ABI-specific, not NAPI). Node.js v24 uses ABI 137 but Electron 40 uses ABI 143. If the wrong ABI binary is packaged, the app crashes with `NODE_MODULE_VERSION` mismatch. The clean build script purges the old binary and `.forge-meta` before every rebuild to prevent stale cache issues.

**Cross-platform build order:** Building Linux overwrites `better_sqlite3.node` with a Linux ELF binary. The clean build script handles this automatically -- when `--linux --win` are both specified, it rebuilds native deps between platforms.

**Close the app before rebuilding:** electron-builder cannot overwrite `win-unpacked/` if the app is running (file locks). Check the system tray -- the app may be minimized there. The clean build script attempts `taskkill` automatically.

**Manual rebuild (if needed):** `npx @electron/rebuild -v 40.6.0 -m . --only better-sqlite3 --force` then `npx electron-builder --win --dir`. Always delete `node_modules/better-sqlite3/build/` first to avoid stale `.forge-meta`.

**Restore host binary after manual builds:** `npm rebuild better-sqlite3` (restores ABI 137 for vitest). The clean build script does this automatically unless `--no-restore` is passed.

## Development Guidelines

- TypeScript strict mode, `noUnusedLocals`, `noUnusedParameters`
- Components use CSS Modules (co-located `.module.css` files), bracket notation `styles[class-name]`
- Radix portals (Dialog/DropdownMenu/Popover) render outside component tree -- their classes MUST use `:global(.className)` in `.module.css` and remain plain strings in JSX
- CSS module class names are hashed at build time; tests must use `getByText`, `getByRole`, `data-*` attributes (not `toHaveClass` or `querySelector`)
- Electron main process uses `.js` extension in imports (ESM)
- Preload script MUST build as CJS `.cjs` -- Electron requires `require()` for preload in sandboxed mode (configured in `vite.config.ts`, referenced as `preload.cjs` in `main.ts`)
- Database uses WAL mode + foreign keys + FTS5 triggers (11 migrations); migration runner short-circuits at `CURRENT_SCHEMA_VERSION` when DB is up-to-date
- Passwords encrypted via `electron.safeStorage` (OS keychain); decrypted values are short-lived
- MCP server: configurable port (default 3000), multi-client SSE + POST transport, timing-safe auth, account ownership enforcement, lazy-initialized via `getMcpServer()` factory, persisted token/port/enabled in settings DB, Settings UI for management
- React 19 useRef: `useRef<T>(undefined)` instead of `useRef<T>()`
- Vitest 4: Use `vi.hoisted()` for mock variables referenced inside `vi.mock()` factory functions
- TipTap + i18next packages require `--legacy-peer-deps` (eslint-plugin-react-hooks peer dep conflict)
- SettingsModal test mocks on mount: 3 calls -- apikeys:get-openrouter, settings:get(notifications_enabled), settings:get(undo_send_delay)
- Radix Tabs controlled mode: use `userEvent.click()` for tab switching in jsdom tests
- IMAP secure flag: always `secure: port === 993` (STARTTLS on 587, TLS on 993)

### Quality Pipeline (MANDATORY)

**8-step process:**

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
8. **`documentation-specialist`** -- Update CLAUDE.md, README, inline comments

**Key rules:** Fix all issues before proceeding. Never skip steps. ESLint must pass with zero warnings.

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

**Remaining limitation:**
- Decrypted passwords in V8 heap (inherent to JS; mitigated with short-lived scope)

## Test Coverage: ~76% (26 files, 568 tests)

**Tested:** crypto, db, db.phase6 (folder CRUD, mark-read/unread, mark-all-read, extractUid), mcpServer, mcpTools (all 8 handlers), imapSanitize, themeStore, emailStore, SettingsModal, ComposeModal (TipTap + signatures + account selection), ReadingPane (CID + remote image blocking + thread collapse/expand + AI reply), ThreadList (88 tests: rendering, multi-select, bulk actions, context menu, search, empty states, unified inbox badge), useKeyboardShortcuts, formatFileSize, smtp, ContactAutocomplete, scheduler, ruleEngine, App, ThemeContext, DateTimePicker, UpdateBanner, OnboardingScreen, spamFilter (18 tests: tokenize, train, classify), phishingDetector (16 tests: URL analysis, brand spoofing, suspicious TLDs), openRouterClient (37 tests: API calls, validation, prompt injection, error handling)
**Untested critical paths:** IMAP client (P1 -- integration complexity, deferred to E2E)

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

### What's Not Done Yet (by phase)
- **Phase 5 (remaining):** E2E tests, SQLCipher at-rest encryption

## Known Issues and Technical Debt

All critical, high, and medium issues from the 2026-02-22 initial audit through the 2026-02-27 Phase 6 remediation are resolved. Full history in .claude/ audit reports.

**Open items:**
- [ ] Remove unused CSS utility classes or adopt them
- [x] ~~isLoading/setLoading wired to folder load operations in Phase 7 (loading skeletons)~~
- [ ] Virtual folders __snoozed/__scheduled: basic query support only; advanced filtering pending
- [ ] IMAP client untested (P1 -- integration complexity, deferred to E2E)
- [ ] window.prompt for Insert Link should be replaced with Radix Dialog
- [x] ~~accounts[0] used for compose signature~~ -- fixed in Phase 8: sendingAccount useMemo with initialAccountId
- [ ] Some SettingsModal strings still hardcoded (need matching locale keys added)
- [ ] SQLCipher not yet integrated (documented migration path in electron/dbEncryption.ts)
