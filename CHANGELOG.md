# Changelog

All notable changes to ExpressDelivery are documented in this file.

ExpressDelivery is an AI-powered desktop email client with MCP (Model Context
Protocol) integration, built with Electron, React 19, TypeScript, and SQLite.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.16.1] - 2026-04-13

### Added
- `role="status"` and `aria-live="polite"` on the OAuth2-gated Outlook disabled state in both `OnboardingScreen` and `SettingsModal` so assistive tech announces the disabled state when it appears
- `providerHelp.common.panelAriaLabel` i18n key in all 4 locales (en/fr/es/de) — the `ProviderHelpPanel` aria-label now routes through `t()` with `{{provider}}` interpolation instead of a hardcoded English template literal
- 5 new tests: explicit `aria-expanded` assertions on the `ProviderHelpPanel` disclosure button, pivot-to-server test locking in the `selectProvider + setStep('server')` batching when "Use Custom Instead" is clicked, aria-label i18n routing test, CR/LF/NUL stripping test, and length-cap test on the new `sanitizeForLog` helper

### Fixed
- Log injection defense in `electron/shellOpen.ts`: new `sanitizeForLog()` helper strips CR/LF/NUL and caps length before interpolating untrusted values into `logDebug` output, matching the existing `log:error` IPC pattern (CWE-117)
- `SettingsModal.selectCustomFallback` defensive `if (custom)` guard now documented as unreachable per the silent-failure rule
- Three remaining ASCII `'ExpressDelivery'` quotes in Spanish locale replaced with typographic `«ExpressDelivery»` for consistency with Spanish conventions

### Security
- Dependency audit: all 13 transitive vulnerabilities (6 high, 5 moderate, 2 low) resolved to 0 via `npm audit fix` (no `--force`). Every vulnerable package had a patched release within existing semver ranges; only `package-lock.json` changed. Notable upgrades:
  - `electron` 41.0.3 → 41.2.0 — use-after-free in offscreen shared texture, `clipboard.readImage()` crash on malformed data, named `window.open` scope bypass. NODE_MODULE_VERSION 145 preserved so `better-sqlite3` did not require an ABI rebuild
  - `nodemailer` 8.0.1 → 8.0.5 — SMTP command injection via `envelope.size` and CRLF in EHLO/HELO transport name (the existing `stripCRLF` in `electron/utils.ts` was already defense-in-depth)
  - `vite` 7.3.1 → 7.3.2 — path traversal in optimized deps `.map` handling, `server.fs.deny` bypass via queries, arbitrary file read via dev-server WebSocket (dev-server only, not bundled in production)
  - `hono` 4.12.8 → 4.12.12 and `@hono/node-server` 1.19.11 → 1.19.14 — `serveStatic` middleware bypass via repeated slashes (MCP server does not serve static files)
  - `@xmldom/xmldom` 0.8.11 → 0.8.12 — XML injection via unsafe CDATA serialization
  - `path-to-regexp` 8.3.0 → 8.4.2 — ReDoS via sequential optional groups and multiple wildcards
  - `picomatch` 4.0.3 → 4.0.4 — method injection in POSIX character classes, ReDoS via extglob quantifiers
  - `imapflow` 1.2.10 → 1.3.1 and `mailparser` 3.9.3 → 3.9.8 (via nodemailer)
  - `lodash`, `flatted`, `brace-expansion` patched for prototype pollution and DoS

---

## [1.16.0] - 2026-04-12

Phase 1 — Provider auth guidance overhaul. Replaces the outdated password-only account setup with provider-specific guidance for the reality of April 2026, anticipating Microsoft's removal of Basic Auth SMTP on personal Outlook.com accounts by April 30, 2026.

### Added
- New reusable `ProviderHelpPanel` component rendered in both `OnboardingScreen` and `SettingsModal` (add + edit flows), displaying a short note describing the auth model, a collapsible ordered list of step-by-step instructions, and an "Open official page" button that links to the provider's own documentation
- `shell:open-external` IPC handler in `electron/shellOpen.ts` backed by an exact-URL allowlist (5 entries) so the "Open official page" button can only open pre-approved provider help pages — not arbitrary URLs
- `ProviderPreset` interface extended with new fields: `authModel` (`password-supported` | `oauth2-required` | `password` | `legacy`), `shortNoteKey`, `stepsKey`, `helpUrl`, `warningKey`, `comingSoonMessageKey`
- `getPresetForAccount()` resolver that maps stored `provider` column values (including legacy `'outlook'`) to the correct preset at read time, enabling the split without a database migration
- Gmail, Yahoo, and iCloud each ship with 4-5 numbered app-password setup steps in all 4 locales (en/fr/es/de)
- New `providerHelp.*` i18n namespace with ~19 leaf keys in each of the 4 locales (+54 lines per locale)
- Complete test coverage for the new surface: `providerPresets.test.ts` (13 tests), `shellOpen.test.ts` (6 tests), `ProviderHelpPanel.test.tsx` (9 tests), plus integration tests added to `OnboardingScreen.test.tsx` (+3) and `SettingsModal.test.tsx` (+4). Baseline grew from 779 tests across 32 files to 814 tests across 35 files

### Changed
- The old single `outlook` preset split into `outlook-personal` (`smtp-mail.outlook.com:587`) and `outlook-business` (`smtp.office365.com:587`), both rendering a disabled "coming soon" state on add flows with a "Use Other / Custom instead" escape hatch because OAuth2 sign-in is not yet implemented
- `SettingsModal` edit flow introduces `editingOriginalProvider` state so that editing an account with stored `provider='outlook'` preserves the original column value through save, preventing unnecessary database churn and keeping the account recognizable by future provider-aware code paths
- `providerIcons.tsx` extended with icon map entries for `outlook-personal`, `outlook-business`, and `outlook-legacy` so all three preset IDs render the Outlook brand logo in the UI
- Legacy accounts with stored `provider='outlook'` now map to an invisible `OUTLOOK_LEGACY_PRESET` that renders an amber warning banner ("may stop working on or after April 30, 2026") in `SettingsModal`, while remaining fully editable

### Security
- `shell:open-external` IPC channel uses an exact-match allowlist (`ALLOWED_HELP_URLS: ReadonlySet<string>`) keyed by the 5 provider help URLs declared in `providerPresets.ts`. Any URL not matching exactly — including URLs with trailing whitespace, different schemes, or path variations — is rejected before reaching `shell.openExternal`

### Notes
- No database migration was required — all preset changes are resolver-based (`getPresetForAccount`)
- No OAuth2 implementation — Phase 2 (future release) will add OAuth2 for Gmail and Microsoft while keeping app-password flows for Yahoo and iCloud
- Quality pipeline green: ESLint `--max-warnings 0`, `tsc --noEmit` clean, 814 tests across 35 files, Semgrep SAST zero findings on Phase 1 files, Windows build produced `release/1.16.0/win-unpacked/ExpressDelivery.exe`

---

## [1.15.9] - 2026-04-05

### Fixed
- Web update checker reported older GitHub releases as "available" — `update:check` IPC now uses `compareVersions` to verify the remote version is actually newer than the installed version

### Changed
- Icon buttons (ReadingPane, SettingsModal) now show a subtle resting background tint for better button affordance
- Stronger dual-layer hover shadow on icon buttons for more pronounced elevation effect

---

## [1.15.8] - 2026-04-05

### Changed
- Increased hover background opacity from 6% to 9% across all 4 themes for more visible button feedback
- Added `--active-bg` CSS variable (15% opacity) for pressed/active button states
- Icon buttons (ReadingPane, SettingsModal) gain subtle box-shadow on hover for elevation feel
- Added `:active` pressed states to icon buttons, sidebar nav items, compose button, collapse button, bulk action buttons, and title bar window controls
- Global `button:active` applies `scale(0.96)` micro-interaction for click feedback
- Close button in title bar uses darker red (`#c50f1f`) on press

---

## [1.15.4] - 2026-03-22

### Changed
- Silent auto-update: `quitAndInstall(isSilent=true, forceRunAfter=true)` — app restarts automatically after update without showing a visible prompt
- NSIS installer verified kill loop: polls until process exits before beginning installation, preventing file-lock failures
- NSIS uses `nsProcess::KillProcess` with a 5-second wait for a clean app shutdown before overwriting binaries

---

## [1.15.3] - 2026-03-22

### Added
- Per-account `AccountSyncController` replaces the global poll loop — each account has an isolated sync lifecycle with `forceDisconnect` and independent reconnect state
- `withImapTimeout` wrapper applied to all IMAP operations; configurable per-operation timeout prevents indefinite hangs
- NOOP heartbeat every 2 minutes detects half-open TCP connections before they stall the sync cycle
- Settings > Email > Sync sub-tab with 3 configurable intervals: sync frequency, NOOP heartbeat interval, and operation timeout
- Staleness-aware sync status indicator in Sidebar: green (fresh, synced within 5min), amber (stale, >5min since last sync), red (error or disconnected)
- `imapSync.test.ts`: 56 new tests covering `AccountSyncController` lifecycle, `forceDisconnect`, reconnect, heartbeat, `withImapTimeout`, and parallel account isolation

### Changed
- Reconnect strategy changed from "max 5 retries" to infinite reconnect with exponential backoff + jitter — accounts always recover from transient network failures
- Test suite expanded to 779 tests across 32 files

---

## [1.10.0] - 2026-03-16

### Added
- Agentic channel architecture: unified ChannelConnector interface for multi-channel communication
- Telegram Bot API connector via grammy (long polling, chat ID allowlist, default-deny security)
- LinkedIn API v2 connector (OAuth 2.0, UGC posts, 100/day rate limit)
- Twitter/X API v2 connector (OAuth 2.0 PKCE, 50 tweets/day rate limit)
- Email channel adapter wrapping existing IMAP/SMTP engines for unified interface
- Channel registry singleton (Map-based, lazy init, parallel disconnect)
- Semantic intent parser with LLM-powered NLP (natural language to structured actions)
- Intent executor dispatching parsed actions to appropriate channel connectors
- LLM router with auto/local/cloud preference (Ollama for local Gemma 2, OpenRouter for cloud)
- Ollama local LLM provider with loopback-only SSRF protection
- OpenRouter cloud LLM provider adapter
- 3 new MCP tools: list_channels, send_channel, parse_intent (11 total)
- DB migration 14: channel_accounts, channel_messages, intent_log tables with indexes
- 10 new IPC channels for channel management, intent parsing, and LLM configuration
- Playwright E2E test harness with Electron fixtures and SQLite seeding
- Smoke test for app launch verification
- Performance instrumentation: 6 timing points (DB init, window, IMAP connect/sync, FTS5 search, email read)
- CHANGELOG.md (retrospective v0.1.0 through v1.9.0)
- docs/SECURITY.md: 14-section standalone security document with threat model and audit history
- docs/ARCHITECTURE.md: system architecture, data flows, 11-challenge anti-loop reference
- tests/E2E_TEST_PLAN.md: 60 test scenarios across 10 feature areas
- tests/PERFORMANCE_TARGETS.md: memory budgets, latency targets, profiling guide

### Changed
- Folder reordering via sort_order column with up/down context menu actions
- Folder nesting with path-depth indentation in Sidebar
- Per-folder IMAP sync (folders:sync IPC handler, on-demand sync)
- Per-mailbox UID tracking prevents cross-folder UID collisions
- SMTP sendEmail now returns { success, messageId } instead of boolean
- Sent folder IMAP APPEND after SMTP send
- All-folder startup sync (not just INBOX)
- Background folder sync on ThreadList navigation
- docs/PACKAGES.md updated with new dependencies and version changes

### Fixed
- 7 silent catch blocks in main.ts now log via logDebug (P3 audit)
- FTS5 search error path now logs failure reason

### Security
- SSRF protection: Ollama host restricted to loopback-only (localhost, 127.0.0.1, ::1)
- CRLF injection prevention on all LLM-extracted send parameters via sanitize()
- Body size caps on send_channel (4000 chars) and parse_intent (2000 chars) MCP tools
- Telegram bot default-deny: empty allowlist rejects all messages
- Prompt injection defense: sanitizeForPrompt() applied to intent parser input
- Silent failure prevention rules added to CLAUDE.md
- Release pipeline: code signing documentation and signature verification step

---

## [1.9.0] - 2026-03-01

### Added
- Typed toast notification system with distinct variants (info, success, warning, error)
- Recursive folder delete support for nested mailbox hierarchies

### Changed
- Startup optimized to reduce time-to-first-render

---

## [1.8.1] - 2026-02-28

### Changed
- Toolbar state now syncs correctly with reading pane actions
- DevTools available in production builds for diagnostics

### Fixed
- Performance regressions introduced in v1.8.0

---

## [1.8.0] - 2026-02-28

### Added
- Custom application menu bar with File, Edit, View, Message, Window, and Help menus (`electron/menu.ts`)
- `menu:action` IPC channel for renderer-side dispatch of menu commands
- Dismiss button on scheduled-send countdown overlay
- AI and Agentic integration section in README

### Fixed
- Send countdown timer now uses a single interval (eliminated duplicate-fire bug)

### Changed
- DevTools enabled in production builds

---

## [1.7.0] - 2026-02-28

### Added
- ConfirmDialog component (Radix Dialog) replacing all `window.confirm` and `window.prompt` calls
- Contact profile fields: company, phone, title, and notes
- SettingsModal render-gate system (`visitedTabs`) to skip mounting unvisited tabs

### Changed
- 45+ UI strings migrated to i18n keys across all four locales
- AI Reply errors now surface as toast notifications instead of inline error text
- SettingsModal IPC calls batched to reduce startup round-trips

### Fixed
- SQLite test flake resolved by assigning unique temp directories per test worker
- 11 unused CSS utility classes removed
- 6 inline styles extracted to CSS Modules

---

## [1.6.0] - 2026-02-28

### Added
- Thread conversation view with collapse/expand (older messages collapsed, latest expanded, avatar and snippet headers)
- AI compose assistant powered by OpenRouter LLM with five writing tones and a Sparkles button in the compose toolbar
- Optimal send-time hint derived from `analytics:busiest-hours` IPC data
- Agentic/MCP Settings tab for managing the MCP server, token, and port

### Changed
- Unified inbox deduplicates threads via SQL and shows provider badge per message
- Reply account selection fixed: `sendingAccount` resolved via `useMemo` from `initialAccountId` instead of `accounts[0]`

### Security
- Prompt injection sanitization applied to all AI input paths

---

## [1.5.0] - 2026-02-27

### Added
- User-defined tags: CRUD, color picker, sidebar section, ReadingPane chips, and Settings Tags tab
- Saved searches stored as virtual `__search_` folders with FTS5 query execution
- Loading skeletons with shimmer animation wired to folder load operations
- Density modes: compact, comfortable, and relaxed CSS variables selectable in Settings
- Zoom control (80-150%) in ReadingPane
- Folder color picker with 8 presets in folder context menu
- Sound alerts for new-mail notifications (toggle in Settings)
- Drag-and-drop emails to folders via HTML5 drag API, including multi-email drag
- Message source viewer (raw RFC822 via IMAP, Radix Dialog, copy button)
- Mailing list unsubscribe banner parsed from `List-Unsubscribe` header
- Email export to EML (single message) and MBOX (full folder)
- Email import from EML and MBOX files (1000 message cap)
- Contact import/export via vCard 3.0 and CSV
- Bayesian spam filter with tokenizer, training API, and Laplace smoothing
- Phishing URL detection with 7 heuristic rules including brand spoofing and suspicious TLD checks

### Changed
- Test suite expanded to 522 tests across 25 files

---

## [1.4.0] - 2026-02-27

### Added
- Multi-select emails with checkbox UI and `selectedEmailIds` Set in emailStore
- Bulk actions: mark read/unread, star, move to folder, delete
- Right-click context menu on email rows (reply, forward, star, toggle-read, move-to, delete)
- Folder context menu: mark all read, rename, create subfolder, delete folder
- Empty Trash action with confirmation prompt
- Folder-specific empty states (Inbox, Sent, Drafts, Trash, etc.)
- Print email and save as PDF via Electron `webContents.print`
- Undo send delay configuration in Settings
- Confirmation toasts with undo action for destructive operations
- Keyboard shortcut help overlay triggered by `?`
- Notification click navigates directly to the relevant email
- `emails:mark-read` lightweight IPC handler for single-message read state
- `extractUid` helper in `electron/db.ts` for reliable UID parsing
- Cross-account folder ownership checks on all folder mutation IPC handlers

### Changed
- Folder renames are transactional (insert-new, migrate-emails, delete-old) to preserve FK integrity
- Test suite expanded to 488 tests across 23 files

### Security
- Cross-account guards added to all folder-level IPC handlers

---

## [1.3.1] - 2026-02-27

### Fixed
- mailparser dependency resolved to correct version
- Polling sync now reliably detects new messages between IDLE sessions
- Live unread badge counts update without requiring a folder refresh
- Various UI polish items from v1.3.0

---

## [1.3.0] - 2026-02-26

### Added
- Charset decoding for legacy encoded email headers and bodies
- On-demand body fetch deferred until a message is opened (reduces startup bandwidth)

### Changed
- Startup performance improved by deferring IMAP body sync to background

---

## [1.2.1] - 2026-02-25

### Fixed
- Email click in thread list now reliably opens the correct message
- Trash folder hover icon corrected
- Sync progress indicator no longer flickers on reconnect
- IDLE connection crash on server-side timeout resolved

---

## [1.2.0] - 2026-02-25

### Fixed
- HTML email rendering regression affecting messages with complex MIME structure
- Mark-as-read now updates both local SQLite state and IMAP server flags
- Delete now moves messages to Trash instead of permanently expunging
- Remote image blocking bypass via CSS background-image patched

---

## [1.1.0] - 2026-02-25

### Added
- Performance improvements across IMAP sync and rendering pipeline
- UX refinements and new features

---

## [1.0.0] - 2026-02-24

### Added
- GitHub Actions CI pipeline (`ci.yml`): lint, test, and type-check on push and pull request
- GitHub Actions release pipeline (`release.yml`): build and publish on `v*` tags with SHA-pinned actions
- CSS Modules migration across 10 components with co-located `.module.css` files
- `React.memo` and `useMemo` applied to high-frequency render paths

### Changed
- Upgraded to Electron 40, React 19, Vite 7, and TypeScript 5.9
- ESLint migrated to v10 flat config (`eslint.config.js`)
- Test suite reaching ~68% coverage (337 tests across 21 files)

---

## [0.4.0] - 2026-02-24

### Added
- Snooze emails: snooze until a time, wake via 30-second polling scheduler, snoozed virtual folder in Sidebar
- Schedule send (send later): DateTimePicker with quick-select presets (1h, 3h, tomorrow, next week), scheduled virtual folder
- Follow-up reminders per email with OS notification delivery via scheduler
- Mail rules engine: conditions on from/subject/body/has_attachment, actions mark-read/star/move/delete/label, account-scoped and priority-ordered
- i18n framework using react-i18next with four locales: en, fr, es, de
- OS notifications for new mail via Electron Notification API triggered by scheduler
- Auto-update banner powered by electron-updater (GitHub Releases, autoDownload: false, progress and install states)
- Code signing configuration in `electron-builder.json5` for Windows and macOS
- Linux distribution targets: deb, rpm, and AppImage in electron-builder config
- SQLCipher at-rest encryption migration stub (`electron/dbEncryption.ts`) with documented implementation path

---

## [0.3.0] - 2026-02-24

### Added
- MCP (Model Context Protocol) server with multi-client SSE transport on port 3000
- Eight MCP tools: `search_emails`, `read_thread`, `send_email`, `create_draft`, `get_smart_summary`, `categorize_email`, `get_email_analytics`, `suggest_reply`
- AI metadata written to email rows: category, priority (1-4), and labels
- Priority badges and category pills displayed in ThreadList and ReadingPane
- MCP connection status indicator (green dot + agent count) in Sidebar
- OpenRouter API key management: encrypted storage via `electron.safeStorage`, Settings "AI / API Keys" tab
- `buildToolRegistry()` Map factory for clean MCP tool dispatch (`electron/mcpTools.ts`)
- Lazy MCP server initialization via `getMcpServer()` factory

### Security
- Bearer token authentication on MCP server with timing-safe comparison
- CORS origin set to `false` on MCP Express server; bound to 127.0.0.1
- Account ownership enforced on all MCP tool handlers (cross-account read/write blocked)

---

## [0.2.0] - 2026-02-24

### Added
- Keyboard shortcuts: mod+N compose, R reply, F forward, E archive, J/K navigate, Delete, Escape
- Contact autocomplete in To/CC/BCC with ARIA combobox, 200ms debounce, and email validation
- Contact auto-harvest: sender addresses saved to contacts table on every send
- Draft auto-save with 2-second debounce; CC/BCC preserved, draft deleted on send, resume via draftId
- File attachments: send via file picker (25MB per file, max 10), receive via IMAP on-demand download with SQLite BLOB cache
- Per-account email signatures (HTML, 10KB cap, DOMPurify-sanitized, preview in ComposeModal)
- Rich text compose with TipTap: bold, italic, underline, lists, and links
- Inline CID image display: Content-ID extraction, IMAP on-demand download, MIME allowlist, data: URL rendering
- Remote image blocking: blocked by default, privacy banner, "Load images" button, CSP defense-in-depth
- Archive and move-to-folder actions wired in ReadingPane and context menus

---

## [0.1.0] - 2026-02-24

### Added
- IMAP client: connect, IDLE, envelope and body fetch, folder sync, and reconnect with exponential backoff
- SMTP sender via Nodemailer with TLS/STARTTLS, CC/BCC, and attachment support
- HTML email rendering in sandboxed iframe with CSP meta tag and DOMPurify sanitization
- Reply, Forward, Delete, and Star/Flag actions
- CC/BCC fields in ComposeModal
- Multi-account sidebar with provider brand icons and per-folder unread badges
- Account management: add, remove, edit, and connection testing with 10-second timeout
- Five provider presets: Gmail, Outlook, Yahoo, iCloud, and Custom
- SQLite database with WAL mode, foreign keys, FTS5 full-text search, and initial schema migrations
- OS keychain encryption for stored passwords via `electron.safeStorage`
- Premium onboarding wizard: 4-step flow, 9 CSS keyframe animations, glassmorphism, WCAG 2.1 reduced-motion support
- Four themes: Light (indigo accent), Cream (solarized gold), Midnight (dark navy/purple), Forest (dark green/emerald)
- Two layout modes: vertical 3-pane and horizontal split, persisted via Zustand
- System tray with icon and minimize-to-tray behavior
- Clean build script (`scripts/clean-build.mjs`) handling native dep rebuild, ABI management, and artifact verification
