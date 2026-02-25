# ExpressDelivery Feature Roadmap

Feature comparison against Mailspring (reference email client) and implementation status.

Last updated: 2026-02-24

---

## Feature Matrix: ExpressDelivery vs Mailspring

### Legend

| Symbol | Meaning |
|--------|---------|
| Done | Fully implemented and working |
| Partial | Started but incomplete |
| Stub | UI exists but not wired |
| Planned | Not started, on roadmap |
| Deferred | Not planned for v1.0 |

---

### Core Email Operations

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Multiple account support | Yes | Yes | **Done** | Add/remove/edit accounts, provider presets (Gmail, Outlook, Yahoo, iCloud, Custom), brand icons |
| Multi-account sidebar | Yes | Yes | **Done** | Account switcher dropdown, provider icons, all accounts visible |
| Unified inbox | Yes | No | **Planned** | Store supports multi-account; no unified view across accounts |
| IMAP connect + IDLE | Yes (C++ sync engine) | Yes | **Done** | Connects, syncs headers + body, folder sync, IDLE for new mail |
| IMAP full message fetch | Yes | Yes | **Done** | Fetches first MIME part (body text), stored in body_text column |
| IMAP folder sync | Yes | Yes | **Done** | `listAndSyncFolders()` syncs all mailboxes with RFC 6154 classification |
| IMAP reconnect/retry | Yes | Yes | **Done** | Exponential backoff (1-30s), max 5 retries, auto-reconnect on close |
| Connection testing | Yes | Yes | **Done** | Standalone "Test Connection" button + test-before-save, `accounts:test` IPC, 10s timeout, status indicator (pass/fail/testing) |
| SMTP send | Yes | Yes | **Done** | Nodemailer, TLS/STARTTLS auto-detect, injection-safe, CC/BCC |
| Email search (full-text) | Yes (Gmail-style) | Yes | **Done** | SQLite FTS5, sanitized input, 300ms debounce |
| Email threading | Yes | Partial | **Partial** | thread_id column exists, MCP read_thread works; UI doesn't group threads |
| Mark as read | Yes | Yes | **Done** | Clicking email in ThreadList calls emails:read IPC |
| Star/flag messages | Yes | Yes | **Done** | Toggle in ThreadList + ReadingPane, `emails:toggle-flag` IPC |
| Archive messages | Yes | Yes | **Done** | Archive button in ReadingPane, `emails:archive` IPC, IMAP MOVE |
| Delete messages | Yes | Yes | **Done** | Delete button in ReadingPane wired to `emails:delete` IPC |
| Move messages between folders | Yes | Yes | **Done** | Radix DropdownMenu in ReadingPane, `emails:move` IPC, cross-account guard |
| Undo send | Yes | No | **Planned** | No delayed send queue |
| Drafts (save/edit/resume) | Yes | Yes | **Done** | Draft auto-save (2s debounce), CC/BCC preserved, delete on send, draft resume via draftId prop |

### Compose & Writing

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Plain text compose | Yes | Yes | **Done** | ComposeModal with To, CC, BCC, Subject, Body fields |
| Rich text / HTML compose | Yes | Yes | **Done** | TipTap editor: bold/italic/underline/lists/links, `editor.getHTML()` |
| Reply to email | Yes | Yes | **Done** | Pre-fills To, Subject ("Re:"), quoted body |
| Forward email | Yes | Yes | **Done** | Pre-fills Subject ("Fwd:"), forwarded message body |
| CC / BCC fields | Yes | Yes | **Done** | Collapsible CC/BCC toggle in ComposeModal |
| File attachments | Yes | Yes | **Done** | Send + receive attachments, IMAP on-demand download, SQLite BLOB cache, file picker, attachment chips in compose + reading pane + thread list, 25MB/file limit, max 10 per email |
| Inline images | Yes | Yes | **Done** | CID resolution via `attachments:by-cid` IPC, MIME allowlist, data: URL rendering |
| Signature editor | Yes | Yes | **Done** | Per-account signatures (HTML, 10KB cap, DOMPurify-sanitized, preview in compose) |
| Quick reply templates | Yes | No | **Planned** | |
| Spell check | Yes | Partial | **Partial** | TipTap contenteditable has native browser spellcheck; global webPreferences spellcheck deferred (security: sends typed input to OS spellchecker) |
| Draft auto-save | Yes | Yes | **Done** | 2s debounce, CC/BCC, delete on send, resume via draftId |

### Contact Management

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Contact storage | Yes | Yes | **Done** | contacts table with auto-harvest on send, search, upsert IPC |
| Contact autocomplete (To field) | Yes | Yes | **Done** | ARIA combobox, 200ms debounced search, keyboard nav, multi-recipient |
| Contact profiles | Yes (Pro: enriched bios, social) | No | **Planned** | |
| Company information | Yes (Pro) | No | **Deferred** | Not in scope for v1.0 |

### UI & Theming

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Multiple themes | Yes | Yes | **Done** | 4 themes: Light, Cream, Midnight, Forest |
| Dark mode | Yes | Yes | **Done** | Midnight and Forest themes |
| Multiple layouts | Yes | Yes | **Done** | Vertical 3-pane, Horizontal split; persisted |
| Custom font | Yes | Yes | **Done** | Self-hosted Outfit TTF, 5 weights |
| Glassmorphism effects | No | Yes | **Done** | Sidebar, cards, modals |
| Animations | Basic | Yes | **Done** | 9 keyframe animations, fade-in transitions |
| Onboarding wizard | No | Yes | **Done** | 4-step flow with provider presets, brand colors, 9 CSS animations |
| System tray | Yes | Yes | **Done** | Show/hide toggle, context menu, custom icon |
| Unread badge count | Yes | Yes | **Done** | `folders:unread-counts` IPC, badges in Sidebar, refresh on `email:new` |
| Touch/gesture support | Yes | No | **Deferred** | Desktop-focused |
| Localization (i18n) | Yes (9+ languages) | Yes | **Done** | react-i18next + 4 locales (en/fr/es/de); all components wired to t() calls |
| RTL layout support | Yes | No | **Deferred** | |
| Keyboard shortcuts | Yes (advanced) | Yes | **Done** | mod+N compose, R reply, F forward, E archive, J/K navigate, Delete, Escape |
| Notification badges (OS) | Yes | Yes | **Done** | Electron Notification API, fires on new email/reminder/scheduled failure, settings toggle |

### HTML Email Rendering

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| HTML email display | Yes | Yes | **Done** | ReadingPane renders body_html with DOMPurify sanitization, falls back to body_text |
| Safe HTML rendering | Yes | Yes | **Done** | DOMPurify.sanitize() strips scripts, iframes, event handlers |
| Inline image display | Yes | Yes | **Done** | CID resolution via `attachments:by-cid` IPC, MIME allowlist, data: URL rendering |
| Remote image blocking | Yes | Yes | **Done** | Blocked by default, privacy banner, "Load images" button, CSP defense-in-depth |

### Productivity Features

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Snooze messages | Yes (Pro) | Yes | **Done** | Scheduler restores at snooze_until, ReadingPane Clock popover, Sidebar virtual folder |
| Schedule send / send later | Yes (Pro) | Yes | **Done** | Split Send button with DateTimePicker, scheduler sends via SMTP (3 retries) |
| Follow-up reminders | Yes (Pro) | Yes | **Done** | Bell popover in ReadingPane, scheduler triggers toast + OS notification |
| Read receipts | Yes (Pro) | No | **Deferred** | Tracking pixel approach; privacy concerns |
| Link tracking | Yes (Pro) | No | **Deferred** | Requires redirect proxy; privacy concerns |
| Mail rules / filters | Yes | Yes | **Done** | Rule engine: from/subject/body/has_attachment x contains/equals/starts_with/ends_with, 6 actions, SettingsModal Rules tab |
| Calendar integration (RSVP) | Yes | No | **Deferred** | |

### AI / MCP Integration (ExpressDelivery Differentiator)

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| MCP server (SSE transport) | No | Yes | **Done** | Express 5, bearer token auth, bound to 127.0.0.1:3000 |
| AI email search | No | Yes | **Done** | search_emails MCP tool, FTS5 backend |
| AI read thread | No | Yes | **Done** | read_thread MCP tool |
| AI send email | No | Yes | **Done** | send_email MCP tool, wired to SMTP |
| AI create draft | No | Yes | **Done** | create_draft MCP tool, inserts to drafts table |
| AI smart summary | No | Yes | **Done** | get_smart_summary MCP tool (rich: recent 20 emails, unread/flagged counts, high-priority, folder dist., drafts) |
| AI email categorization | No | Yes | **Done** | categorize_email MCP tool (category, priority 1-4, labels; account ownership enforced) |
| AI email analytics | No | Yes | **Done** | get_email_analytics MCP tool (volume, top senders, folder dist., busiest hours, category/priority breakdown) |
| AI suggest reply | No | Yes | **Done** | suggest_reply MCP tool (email + thread + sender history + account context, body truncated to 2KB) |
| AI compose assistant | No | No | **Planned** | LLM-powered reply generation using suggest_reply context |
| Multi-client MCP transport | No | Yes | **Done** | Map<sessionId, ClientSession> with per-connection Server instances |
| AI metadata in UI | No | Yes | **Done** | Priority badges (ThreadList + ReadingPane), category pills, label badges, AI status indicator in Sidebar |
| MCP connection status | No | Yes | **Done** | Real-time AI agent count in Sidebar (green dot + label, push via mcp:status event) |

### Security & Privacy

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| OS keychain encryption | Yes | Yes | **Done** | electron.safeStorage for password storage |
| CSP policy | Unknown | Yes | **Done** | Meta tag in index.html |
| Sandboxed renderer | Unknown | Yes | **Done** | contextIsolation + sandbox: true + CJS preload |
| Scoped IPC API | Unknown | Yes | **Done** | Channel allowlist in preload |
| MCP authentication | N/A | Yes | **Done** | Bearer token, CORS disabled, loopback only |
| SMTP injection protection | Unknown | Yes | **Done** | CRLF stripping, object-form `from` |
| At-rest DB encryption | Unknown | No | **Planned** | Evaluate SQLCipher |
| PGP/S-MIME | No | No | **Deferred** | |

### Analytics & Insights

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Mailbox insights | Yes (Pro) | Yes | **Done** | get_email_analytics MCP tool (volume, senders, folders, hours, categories) |
| Optimal send time | Yes (Pro) | No | **Planned** | busiest_hours data available via analytics tool |
| Email activity breakdown | Yes (Pro) | Yes | **Done** | get_email_analytics returns per-day, per-folder, per-sender, per-hour breakdown |

### Build & Distribution

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Windows installer (NSIS) | Yes | Yes | **Done** | electron-builder, x64 |
| macOS DMG | Yes | Yes | **Done** | Configured but untested (no macOS build env) |
| Linux AppImage | Yes | Yes | **Partial** | Builds fail on Windows (symlink privilege); --dir works |
| Linux deb/rpm/snap | Yes | Yes | **Done** | deb + rpm targets in electron-builder.json5 (snap deferred) |
| Auto-update | Yes | Yes | **Done** | electron-updater + UpdateBanner UI + GitHub Actions release.yml (tag-triggered, Windows + Linux builds, GitHub Releases publish) |
| Code signing | Yes | Partial | **Partial** | electron-builder.json5 configured; needs CSC_LINK + CSC_KEY_PASSWORD env vars |

### Testing

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Unit tests | Yes | Yes | **Done** | 21 files, 337 tests, ~68% coverage |
| Integration tests | Yes | No | **Planned** | IMAP client not tested (SMTP unit-tested) |
| E2E tests | Yes | No | **Planned** | No Playwright/Spectron |
| Coverage thresholds | Unknown | Yes | **Done** | @vitest/coverage-v8, 70% line threshold, `npm run test:coverage` |

---

## Priority Roadmap

### Phase 1: Core Email Client (v0.1.0) -- COMPLETE
Make the app usable for daily email reading and sending.

- [x] IMAP full message body fetch (body_text + body_html)
- [x] IMAP folder sync (all mailboxes, not just INBOX)
- [x] HTML email rendering with DOMPurify sanitization
- [x] Reply and Forward wired to ComposeModal (pre-fill fields + quote original)
- [x] Delete email action (local DB deletion via IPC)
- [x] CC/BCC fields in ComposeModal (collapsible toggle)
- [x] Unread count badges in Sidebar (refresh on email:new event)
- [x] `email:new` IPC event emitted from main process after IMAP sync
- [x] IMAP reconnect/retry on disconnect (exponential backoff, max 5 retries)
- [x] Star/flag toggle in ThreadList + ReadingPane
- [x] Multi-account selection in Sidebar (provider icons, account switcher dropdown)
- [x] Connection testing before account save (10s timeout)
- [x] Account editing in Settings modal
- [x] Provider brand icons (Gmail, Outlook, Yahoo, iCloud, Custom)
- [x] Post-add IMAP sync (connect + folder sync + INBOX sync)
- [x] Standalone "Test Connection" button with status indicator (pass/fail/spin)
- [x] Post-add account selection + folder load + inbox auto-select
- [x] Clean build hydration script (`scripts/clean-build.mjs`)

### Phase 2: Productivity (v0.2.0)
Make the app pleasant and efficient for power users.

- [x] Keyboard shortcuts (mod+N compose, R reply, F forward, E archive, J/K navigate, Delete, Escape)
- [x] Contact autocomplete in To/CC/BCC fields (ARIA combobox, 200ms debounced IPC, keyboard nav)
- [x] Draft auto-save + draft resume (2s debounce, CC/BCC, delete on send, draftId prop)
- [x] File attachment support (send + receive, IMAP on-demand download, SQLite BLOB cache, 25MB/file, max 10)
- [x] Email signature editor + per-account signatures (HTML, 10KB cap, DOMPurify-sanitized preview, appended at send)
- [x] Rich text compose (TipTap: bold/italic/underline/lists/links toolbar, `editor.getHTML()`)
- [x] Inline image display in reading pane (CID extraction, IMAP on-demand download, SAFE_IMAGE_MIMES allowlist)
- [x] Remote image blocking with click-to-load (blocked by default, ShieldAlert banner, CSP `img-src https:` fallback)
- [x] Archive action (IMAP MOVE + DB update, cross-account guard)
- [x] Move messages between folders (Radix DropdownMenu, IMAP MOVE, cross-account guard)
- [x] ComposeModal floating card redesign (solid bg, matches SettingsModal)

### Phase 3: AI-Powered Features (v0.3.0) -- COMPLETE
Leverage MCP integration as the key differentiator vs Mailspring.

- [x] MCP infrastructure refactor: tool handlers extracted to `mcpTools.ts`, Map-based dispatch, multi-client SSE
- [x] Database migration 6: ai_category, ai_priority, ai_labels columns on emails table
- [x] `categorize_email` MCP tool: AI agents write category/priority/labels back to DB (account ownership enforced)
- [x] `get_email_analytics` MCP tool: mailbox analytics (volume, top senders, folders, busiest hours, category/priority breakdown)
- [x] `suggest_reply` MCP tool: structured context for reply generation (email + thread + sender history + account, body truncated 2KB)
- [x] Enhanced `get_smart_summary`: rich data (recent 20 emails, unread/flagged, high-priority, folder distribution, pending drafts)
- [x] Enhanced `search_emails`: JOIN to emails table, returns AI metadata, limit 20
- [x] UI: priority badges in ThreadList (! / !!), category pills, AI metadata row in ReadingPane (priority label, category, labels)
- [x] UI: MCP connection status indicator in Sidebar (green dot + agent count, push event)
- [x] Security: timing-safe bearer token comparison, account ownership checks, body_text truncation, attachment filename sanitization, HTML body 500KB cap
- [x] 39 new tests in mcpTools.test.ts, 7 in mcpServer.test.ts

### Phase 4: Polish & Distribution (v0.4.0) -- COMPLETE
Production-ready release.

- [x] Snooze messages (scheduler + ReadingPane popover + Sidebar virtual folder)
- [x] Schedule send / send later (split Send button + DateTimePicker + scheduler with 3 retries)
- [x] Follow-up reminders (Bell popover + scheduler + toast + OS notification)
- [x] Mail rules and filters (ruleEngine.ts: 4 fields x 4 operators, 6 actions, SettingsModal Rules tab)
- [x] Localization (i18n) framework (react-i18next, 4 locales: en/fr/es/de, language selector in Settings)
- [x] OS notifications (Electron Notification API, new email + reminder + scheduled failure, settings toggle)
- [x] Auto-update UI (electron-updater + UpdateBanner component; needs GitHub Releases publish config)
- [x] Code signing config (electron-builder.json5; needs CSC env vars for actual signing)
- [x] Linux deb/rpm packages (electron-builder.json5 targets)
- [x] At-rest DB encryption stub (dbEncryption.ts documents SQLCipher migration path)

### Phase 5: Quality & Scale (v1.0.0) -- COMPLETE
Ship-ready with full test coverage, i18n, CSS modules, CI/CD, and performance.

- [x] Test coverage to ~68% (337 tests across 21 files: scheduler, ruleEngine, DateTimePicker, UpdateBanner, App, ThemeContext)
- [ ] E2E tests with Playwright (deferred to post-v1.0)
- [x] Migrate inline styles to CSS modules (10 components migrated to `.module.css` files)
- [x] Performance optimization (React.memo on ThreadItem, useMemo/useCallback audit)
- [x] i18n: wire t() calls into all component render output (all 12 components)
- [x] Auto-update: GitHub Actions release.yml (tag-triggered, Windows + Linux builds, GitHub Releases publish)
- [x] CI pipeline: GitHub Actions ci.yml (lint + test + tsc on push/PR, SHA-pinned actions, npm audit)
- [ ] Code signing: provision CSC certificates (Windows + macOS) — requires purchase
- [ ] SQLCipher at-rest DB encryption (@journeyapps/sqlcipher) — deferred unless compliance requires it
- [x] Upgrade Electron to 40+ (upgraded from 30 to 40)
- [x] Upgrade ESLint to flat config v10 (migrated from .eslintrc.cjs to eslint.config.js)
- [x] Upgrade React to 19 (from 18)
- [x] Upgrade Vite to 7 (from 5)
- [x] Upgrade TypeScript to 5.9 (from 5.2)

---

## What ExpressDelivery Has That Mailspring Doesn't

1. **MCP/AI Integration** -- 8 AI-accessible tools via Model Context Protocol (search, read, send, draft, summary, categorize, analytics, suggest reply). Multi-client SSE with real-time connection status. No other desktop email client offers this.
2. **Modern React + Zustand** -- Mailspring uses older React class components + Flux stores. ExpressDelivery uses hooks, Zustand, and Radix UI primitives.
3. **Glassmorphism Design** -- Premium visual design with backdrop blur, floating organic shapes, gradient animations.
4. **Premium Onboarding** -- 4-step animated wizard with provider presets, brand colors, 9 CSS animations, WCAG 2.1 accessibility.
5. **SQLite FTS5** -- Full-text search built into the local database (Mailspring relies on its C++ sync engine for search).
6. **Simpler Architecture** -- Single TypeScript codebase (no separate C++ sync engine to maintain).

## What Mailspring Has That We Need

1. ~~**Full IMAP sync**~~ -- Done: body fetch, all folders, reconnect, connection testing
2. ~~**HTML email rendering**~~ -- Done: DOMPurify sanitization
3. ~~**Reply/Forward/Delete**~~ -- Done: wired to ComposeModal + IPC
4. ~~**Rich text compose**~~ -- Done: TipTap editor with formatting toolbar
5. ~~**Attachments**~~ -- Done: send + receive, IMAP on-demand, BLOB cache, file picker, attachment chips
6. ~~**Keyboard shortcuts**~~ -- Done: mod+N, R, F, E, J/K, Delete, Escape
7. ~~**Contact autocomplete**~~ -- Done: ARIA combobox, debounced search, auto-harvest
8. ~~**Snooze/Send Later/Reminders**~~ -- Done: scheduler engine, DateTimePicker, snooze/send-later/reminder flows
9. ~~**Localization**~~ -- Done: i18n framework (4 locales), all components wired to t() calls
10. ~~**Auto-update + Code signing**~~ -- Done: electron-updater + UpdateBanner + GitHub Actions release.yml; code signing certs pending
