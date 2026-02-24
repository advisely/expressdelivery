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
| Rich text / HTML compose | Yes | No | **Planned** | Body textarea labeled "rich-text-stub"; entity-escaped plain text sent as HTML |
| Reply to email | Yes | Yes | **Done** | Pre-fills To, Subject ("Re:"), quoted body |
| Forward email | Yes | Yes | **Done** | Pre-fills Subject ("Fwd:"), forwarded message body |
| CC / BCC fields | Yes | Yes | **Done** | Collapsible CC/BCC toggle in ComposeModal |
| File attachments | Yes | No | **Stub** | Paperclip button rendered in compose toolbar, not wired |
| Inline images | Yes | No | **Planned** | No image handling |
| Signature editor | Yes | No | **Planned** | No signature management |
| Quick reply templates | Yes | No | **Planned** | |
| Spell check | Yes | No | **Deferred** | Chromium has built-in spellcheck; needs enabling in Electron |
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
| Localization (i18n) | Yes (9+ languages) | No | **Planned** | All strings hardcoded in English |
| RTL layout support | Yes | No | **Deferred** | |
| Keyboard shortcuts | Yes (advanced) | Yes | **Done** | mod+N compose, R reply, F forward, E archive, J/K navigate, Delete, Escape |
| Notification badges (OS) | Yes | No | **Planned** | |

### HTML Email Rendering

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| HTML email display | Yes | Yes | **Done** | ReadingPane renders body_html with DOMPurify sanitization, falls back to body_text |
| Safe HTML rendering | Yes | Yes | **Done** | DOMPurify.sanitize() strips scripts, iframes, event handlers |
| Inline image display | Yes | No | **Planned** | |
| Remote image blocking | Yes | No | **Planned** | |

### Productivity Features

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Snooze messages | Yes (Pro) | No | **Planned** | |
| Schedule send / send later | Yes (Pro) | No | **Planned** | |
| Follow-up reminders | Yes (Pro) | No | **Planned** | |
| Read receipts | Yes (Pro) | No | **Deferred** | Tracking pixel approach; privacy concerns |
| Link tracking | Yes (Pro) | No | **Deferred** | Requires redirect proxy; privacy concerns |
| Mail rules / filters | Yes | No | **Planned** | |
| Calendar integration (RSVP) | Yes | No | **Deferred** | |

### AI / MCP Integration (ExpressDelivery Differentiator)

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| MCP server (SSE transport) | No | Yes | **Done** | Express 5, bearer token auth, bound to 127.0.0.1:3000 |
| AI email search | No | Yes | **Done** | search_emails MCP tool, FTS5 backend |
| AI read thread | No | Yes | **Done** | read_thread MCP tool |
| AI send email | No | Yes | **Done** | send_email MCP tool, wired to SMTP |
| AI create draft | No | Yes | **Done** | create_draft MCP tool, inserts to drafts table |
| AI smart summary | No | Yes | **Done** | get_smart_summary MCP tool (last 5 emails per account) |
| AI compose assistant | No | No | **Planned** | LLM-powered reply suggestions, tone adjustment |
| AI email categorization | No | No | **Planned** | Auto-label, priority scoring |
| Multi-client MCP transport | No | No | **Planned** | Currently single SSEServerTransport instance |

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
| Mailbox insights | Yes (Pro) | No | **Planned** | AI-powered via MCP tools |
| Optimal send time | Yes (Pro) | No | **Planned** | |
| Email activity breakdown | Yes (Pro) | No | **Planned** | |

### Build & Distribution

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Windows installer (NSIS) | Yes | Yes | **Done** | electron-builder, x64 |
| macOS DMG | Yes | Yes | **Done** | Configured but untested (no macOS build env) |
| Linux AppImage | Yes | Yes | **Partial** | Builds fail on Windows (symlink privilege); --dir works |
| Linux deb/rpm/snap | Yes | No | **Planned** | Only AppImage configured |
| Auto-update | Yes | No | **Planned** | No electron-updater configured |
| Code signing | Yes | No | **Planned** | NSIS: no signing configured |

### Testing

| Feature | Mailspring | ExpressDelivery | Status | Notes |
|---------|-----------|----------------|--------|-------|
| Unit tests | Yes | Yes | **Partial** | 10 files, 111 tests, ~45% coverage |
| Integration tests | Yes | No | **Planned** | IMAP/SMTP not tested |
| E2E tests | Yes | No | **Planned** | No Playwright/Spectron |
| Coverage thresholds | Unknown | No | **Planned** | @vitest/coverage-v8 not configured |

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
- [ ] File attachment support (compose + display)
- [ ] Email signature editor + per-account signatures
- [ ] Rich text compose (HTML editor)
- [ ] Inline image display in reading pane
- [ ] Remote image blocking with click-to-load
- [x] Archive action (IMAP MOVE + DB update, cross-account guard)
- [x] Move messages between folders (Radix DropdownMenu, IMAP MOVE, cross-account guard)
- [x] ComposeModal floating card redesign (solid bg, matches SettingsModal)

### Phase 3: AI-Powered Features (v0.3.0)
Leverage MCP integration as the key differentiator vs Mailspring.

- [ ] AI compose assistant (reply suggestions, tone adjustment)
- [ ] AI email categorization and priority scoring
- [ ] AI-powered mailbox insights and analytics
- [ ] Multi-client MCP transport (Map-based)
- [ ] Refactor tool dispatch to Map<name, handler>
- [ ] Smart summary improvements (actual LLM summarization vs hardcoded)

### Phase 4: Polish & Distribution (v0.4.0)
Production-ready release.

- [ ] Snooze messages
- [ ] Schedule send / send later
- [ ] Follow-up reminders
- [ ] Mail rules and filters
- [ ] Localization (i18n) framework
- [ ] Notification badges (OS-level)
- [ ] Auto-update (electron-updater)
- [ ] Code signing (Windows + macOS)
- [ ] Linux deb/rpm packages
- [ ] At-rest DB encryption (SQLCipher evaluation)

### Phase 5: Quality & Scale (v1.0.0)
Ship-ready with full test coverage and performance.

- [ ] Test coverage to 70%+ (IMAP, SMTP, ComposeModal, App, ThemeContext, OnboardingScreen)
- [ ] E2E tests with Playwright
- [ ] Migrate inline styles to CSS modules or full Tailwind
- [ ] Performance profiling and optimization
- [ ] Spell check enabled (Chromium built-in)
- [x] Upgrade Electron to 40+ (upgraded from 30 to 40)
- [x] Upgrade ESLint to flat config v10 (migrated from .eslintrc.cjs to eslint.config.js)
- [x] Upgrade React to 19 (from 18)
- [x] Upgrade Vite to 7 (from 5)
- [x] Upgrade TypeScript to 5.9 (from 5.2)

---

## What ExpressDelivery Has That Mailspring Doesn't

1. **MCP/AI Integration** -- 5 AI-accessible tools via Model Context Protocol. No other desktop email client offers this. AI agents can search, read, send, draft, and summarize emails.
2. **Modern React + Zustand** -- Mailspring uses older React class components + Flux stores. ExpressDelivery uses hooks, Zustand, and Radix UI primitives.
3. **Glassmorphism Design** -- Premium visual design with backdrop blur, floating organic shapes, gradient animations.
4. **Premium Onboarding** -- 4-step animated wizard with provider presets, brand colors, 9 CSS animations, WCAG 2.1 accessibility.
5. **SQLite FTS5** -- Full-text search built into the local database (Mailspring relies on its C++ sync engine for search).
6. **Simpler Architecture** -- Single TypeScript codebase (no separate C++ sync engine to maintain).

## What Mailspring Has That We Need

1. ~~**Full IMAP sync**~~ -- Done: body fetch, all folders, reconnect, connection testing
2. ~~**HTML email rendering**~~ -- Done: DOMPurify sanitization
3. ~~**Reply/Forward/Delete**~~ -- Done: wired to ComposeModal + IPC
4. **Rich text compose** -- HTML editor with formatting toolbar (Phase 2)
5. **Attachments** -- Send and display file attachments (Phase 2)
6. **Keyboard shortcuts** -- Power user productivity (Phase 2)
7. **Contact autocomplete** -- Address book integration (Phase 2)
8. **Snooze/Send Later/Reminders** -- Productivity features (Phase 4)
9. **Localization** -- Multi-language support (Phase 4)
10. **Auto-update + Code signing** -- Distribution ready (Phase 4)
