# ExpressDelivery - AI-Powered Email Client

Electron desktop email client with MCP (Model Context Protocol) integration for AI-assisted email operations. **Status:** Phase 2 in progress (v0.2.0). 10 components, 2 Zustand stores, 5 MCP tools, SQLite persistence, 4 themes, 10 test files (111 tests), 24 IPC handlers. Full IMAP sync (body + folders + reconnect), HTML email rendering (DOMPurify), reply/forward/delete/star/archive/move, CC/BCC compose with contact autocomplete, contact auto-harvest, draft auto-save/resume, keyboard shortcuts (mod+N/R/F/E/J/K/Delete/Escape), multi-account sidebar with unread badges, connection testing, account editing, provider brand icons. App icon implemented (SVG source in `build/`, PNG/ICO generated via `npm run generate:icons`). Premium onboarding flow with 9 CSS animations, glassmorphism, and WCAG 2.1 reduced-motion support.

## Tech Stack

| Layer     | Technology                                                                                   |
| --------- | -------------------------------------------------------------------------------------------- |
| Frontend  | React 19, TypeScript 5.9 strict, Zustand (theme + email stores), Radix UI (Dialog, Tabs), Lucide icons, Tailwind CSS v4, DOMPurify, CSS custom properties |
| Backend   | Electron 40, better-sqlite3 (WAL + FTS5), IMAPFlow, Nodemailer, Express 5                    |
| AI/MCP    | @modelcontextprotocol/sdk (SSE transport on port 3000), 5 tools (search, read, send, draft, summary) |
| Build     | Vite 7 + vite-plugin-electron, electron-builder (Windows NSIS, Linux AppImage, macOS DMG)    |
| Testing   | Vitest 4 + jsdom, @testing-library/react                                                     |

## Structure

```
electron/          # Main process (db, imap, smtp, crypto, mcp server, utils)
src/               # Renderer process (React SPA)
  components/      # UI components (8 files: Sidebar, ThreadList, ReadingPane, ComposeModal, ContactAutocomplete, SettingsModal, ThemeContext, OnboardingScreen)
  stores/          # Zustand stores (themeStore, emailStore)
  lib/             # Shared utilities (ipc wrapper, providerPresets, providerIcons, useKeyboardShortcuts)
  assets/          # Static assets
public/            # Runtime assets (self-hosted fonts, icon.png)
build/             # electron-builder assets (icon.svg, icon.png, icon.ico, icon@2x.png)
scripts/           # Dev tooling (generate-icons.mjs, clean-build.mjs)
release/           # Built app artifacts
```

## Key Files

| File                        | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `electron/main.ts`         | Electron entry, window + tray + 16 IPC handlers |
| `electron/db.ts`           | SQLite init, schema, migrations (accounts, folders, emails, drafts, contacts, settings, FTS5) |
| `electron/mcpServer.ts`    | MCP SSE server with 5 AI-accessible tools (send_email wired to SMTP) |
| `electron/imap.ts`         | IMAP client (connect, IDLE, sync body + folders, reconnect, connection test) |
| `electron/smtp.ts`         | SMTP sender via Nodemailer (host/port from DB, CC/BCC)  |
| `electron/crypto.ts`       | OS keychain encryption (safeStorage)            |
| `electron/preload.ts`      | IPC bridge (scoped typed API with channel allowlist) |
| `electron/utils.ts`        | Shared utilities (FTS5 query sanitizer)         |
| `src/App.tsx`              | Root component, error boundary, data loading, reply/forward plumbing |
| `src/components/Sidebar.tsx`     | Multi-account switcher, folders with unread badges |
| `src/components/ThreadList.tsx`  | Email list with search (wired to IPC)      |
| `src/components/ReadingPane.tsx` | HTML email viewer, reply/forward/delete/star actions |
| `src/components/ComposeModal.tsx`| Email compose with To/CC/BCC, reply/forward prefill |
| `src/components/SettingsModal.tsx`| Account management (add/edit/test/delete) + theme settings |
| `src/components/ThemeContext.tsx` | Layout context + theme class application   |
| `src/components/OnboardingScreen.tsx` | First-run account setup (4-step wizard, 9 CSS animations) |
| `src/lib/providerPresets.ts`   | Email provider IMAP/SMTP presets (Gmail, Outlook, Yahoo, iCloud, Custom) |
| `src/lib/providerIcons.tsx`    | Provider brand SVG icons (Gmail, Outlook, Yahoo, iCloud, Custom) |
| `src/stores/themeStore.ts` | Zustand persisted theme + layout state          |
| `src/stores/emailStore.ts` | Zustand email/folder/account state             |
| `src/components/ContactAutocomplete.tsx` | ARIA combobox contact search (To/CC/BCC) |
| `src/lib/useKeyboardShortcuts.ts` | Global keyboard shortcut hook (mod/shift/alt combos) |
| `src/lib/ipc.ts`          | Typed IPC wrapper for renderer process          |
| `scripts/clean-build.mjs`  | Hydration + clean packaging (purge, rebuild native deps, package, verify) |
| `src/index.css`            | Global styles, 4 themes, self-hosted Outfit font, layout modes |

## Data Models

**SQLite Tables:** `accounts` (email, provider, encrypted password, IMAP/SMTP host/port, display_name), `folders` (mailbox hierarchy), `emails` (messages + FTS5 index), `drafts` (pending emails with cc/bcc, schema_version=2), `contacts` (auto-harvested from sent mail), `settings` (key-value, includes schema_version)

**Zustand Stores:**
- `themeStore` — `themeName`, `layout`, persisted to localStorage
- `emailStore` — `accounts`, `folders`, `emails`, `selectedEmail`, selection IDs, search state

**Layout:** `'vertical' | 'horizontal'` persisted via Zustand (themeStore), applied via ThemeContext

## MCP Tools

| Tool              | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `search_emails`   | FTS5 full-text search (sanitized input)    |
| `read_thread`     | Fetch email thread by thread_id            |
| `send_email`      | Send via SMTP (wired to smtpEngine)        |
| `create_draft`    | Insert draft to DB for UI review           |
| `get_smart_summary` | Summarize recent emails for an account  |

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
npm run lint             # eslint (strict, 0 warnings)
```

### Build Notes (IMPORTANT)

**Use `scripts/clean-build.mjs`:** All `build:*` scripts use the clean build script which handles the full hydration sequence automatically: kill app, purge stale artifacts, delete old `better-sqlite3` build, rebuild native deps for Electron ABI, compile, package, verify binary, restore host binary for vitest.

**Why this matters:** `better-sqlite3` is a NAN-based native module (ABI-specific, not NAPI). Node.js v24 uses ABI 137 but Electron 40 uses ABI 143. If the wrong ABI binary is packaged, the app crashes with `NODE_MODULE_VERSION` mismatch. The clean build script purges the old binary and `.forge-meta` before every rebuild to prevent stale cache issues.

**Cross-platform build order:** Building Linux overwrites `better_sqlite3.node` with a Linux ELF binary. The clean build script handles this automatically — when `--linux --win` are both specified, it rebuilds native deps between platforms.

**Close the app before rebuilding:** electron-builder cannot overwrite `win-unpacked/` if the app is running (file locks). Check the system tray — the app may be minimized there. The clean build script attempts `taskkill` automatically.

**Manual rebuild (if needed):** `npx @electron/rebuild -v 40.6.0 -m . --only better-sqlite3 --force` then `npx electron-builder --win --dir`. Always delete `node_modules/better-sqlite3/build/` first to avoid stale `.forge-meta`.

**Restore host binary after manual builds:** `npm rebuild better-sqlite3` (restores ABI 137 for vitest). The clean build script does this automatically unless `--no-restore` is passed.

## Development Guidelines

- TypeScript strict mode, `noUnusedLocals`, `noUnusedParameters`
- Components use inline `<style>` tags (CSS-in-JS via template literals)
- Electron main process uses `.js` extension in imports (ESM)
- Preload script exposes IPC via `contextBridge` (MUST build as CJS `.cjs` — Electron requires `require()` for preload in sandboxed mode; configured in `vite.config.ts`)
- Database uses WAL mode + foreign keys + FTS5 triggers
- Passwords encrypted via `electron.safeStorage` (OS keychain)
- MCP server runs on localhost:3000 with SSE + POST transport

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

## Audit Reports (2026-02-22)

Full reports in `.claude/`: `security-audit-report.md`, `code-review-report.md`, `qa-report.md`, `cleanup-report.md`

### Security Posture: D -> B- (0 Critical, 1 High, 3 Medium remaining)

**Critical (all fixed):**
1. ~~MCP server: zero auth + wildcard CORS~~ -- Fixed: bearer token auth, `cors({ origin: false })`, bound to `127.0.0.1`
2. ~~Raw `ipcRenderer` exposed in preload~~ -- Fixed: scoped typed API with channel allowlist
3. ~~`asar: false`~~ -- Fixed: `asar: true` with `asarUnpack` for native modules
4. ~~MCP token exposed to renderer~~ -- Fixed: removed `mcp:get-token` from preload allowlist
5. ~~SMTP CRLF header injection~~ -- Fixed: strip `\r\n\0` from recipients/subject in IPC handler
6. ~~settings:set no key allowlist~~ -- Fixed: `ALLOWED_SETTINGS_KEYS` Set in main.ts
7. ~~No CSP policy~~ -- Fixed: CSP meta tag in index.html

**High (remaining):** decrypted passwords in V8 heap (inherent to JS; mitigate with short-lived scope)

**Phase 2 security remediation (2026-02-24):**
- ~~Cross-account move isolation missing~~ -- Fixed: `emails:move` and `emails:archive` verify `destFolder.account_id === email.account_id`
- ~~contacts:upsert no email validation~~ -- Fixed: RFC 5322 lightweight regex before insert
- ~~contacts:search no max length~~ -- Fixed: query truncated to 100 chars
- ~~Draft timer not cancelled before send~~ -- Fixed: `clearTimeout(draftTimerRef.current)` at top of `handleSend`
- ~~Draft auto-save missing CC/BCC~~ -- Fixed: added to payload and effect dependency array
- ~~ReadingPane handleDelete no success guard~~ -- Fixed: check `result?.success`, try/catch on all handlers
- ~~IMAP moveMessage no try/catch~~ -- Fixed: returns `false` on error instead of throwing
- ~~Hardcoded #F59E0B flag color~~ -- Fixed: extracted to `--color-flag` CSS variable
- ~~ReadingPane icon buttons missing aria-label~~ -- Fixed: all 6 buttons have aria-label
- ~~ContactAutocomplete missing aria-autocomplete/aria-haspopup~~ -- Fixed: added to combobox input
- ~~console.error in main.ts~~ -- Fixed: replaced with `logDebug()` for consistency

### Code Quality: Needs Work -> Good (all critical/high bugs fixed)

**Critical bugs (all fixed):**
- ~~ThemeProvider never rendered~~ -- Fixed: `<ThemeProvider>` wraps `<App>` in `main.tsx`
- ~~CSS variable mismatch~~ -- Fixed: alias variables added to `:root` and all 4 theme classes
- ~~Zero `ipcMain.handle` registrations~~ -- Fixed: 11 IPC handlers in `main.ts`
- ~~send_email/create_draft MCP tools are stubs~~ -- Fixed: send_email wired to smtpEngine, create_draft inserts to drafts table
- ~~syncNewEmails fetches entire mailbox~~ -- Fixed: tracks lastSeenUid, fetches only new messages
- ~~MCP auth token logged to stdout~~ -- Fixed: removed console.log
- ~~ComposeModal HTML injection~~ -- Fixed: entity escaping for `<>&"`
- ~~displayName header injection in SMTP~~ -- Fixed: uses nodemailer object form for `from`
- ~~Migration runner not transactional~~ -- Fixed: wrapped in `db.transaction()()`

**Code review remediation (2026-02-22 round 2):**
- ~~startIdle() deadlock~~ -- Fixed: removed mailbox lock from startIdle, only syncNewEmails holds lock
- ~~ReadingPane avatar crash~~ -- Fixed: `.charAt(0)` with `|| '?'` fallback
- ~~FTS5 backslash escape~~ -- Fixed: added `\\` to sanitizer strip set
- ~~Null password_encrypted crash~~ -- Fixed: guard throw before `Buffer.from` in imap.ts and smtp.ts
- ~~Search debounce race condition~~ -- Fixed: 300ms debounce + cancel on folder change
- ~~App.tsx folder loading race~~ -- Fixed: cancelled flag in useEffect cleanup
- ~~accounts:remove crash~~ -- Fixed: try/catch around IMAP disconnect
- ~~ComposeModal empty recipients~~ -- Fixed: filter empty strings after split
- ~~initDatabase failure silent~~ -- Fixed: show dialog and quit

**Code review remediation (2026-02-23 round 3):**
- ~~Dead `mcp:get-token` IPC handler in main.ts~~ -- Fixed: removed unreachable handler
- ~~MonitorPlay unreachable import in SettingsModal~~ -- Fixed: removed dead import
- ~~Form labels missing `htmlFor`/`id` associations~~ -- Fixed: all label/input pairs wired; full accessibility pass on both modals
- ~~Hardcoded `#ef4444` danger color~~ -- Fixed: extracted to `--color-danger` CSS variable in index.css
- ~~z-index inconsistency across modals~~ -- Fixed: both modals normalised to 1000/1001
- ~~Server settings toggle not keyboard-accessible~~ -- Fixed: `div onClick` replaced with `<button>`, `aria-expanded` added
- ~~SettingsModal/ComposeModal bespoke dialog logic~~ -- Fixed: migrated to @radix-ui/react-dialog and @radix-ui/react-tabs
- ~~Password state persists after modal close~~ -- Fixed: cleared in `useEffect` cleanup on unmount
- ~~THEME_ICONS/LAYOUTS/providerLabel recreated on each render~~ -- Fixed: hoisted to module-level constants

**Code review remediation (2026-02-23 round 4):**
- ~~Preload ESM (.mjs) fails in production asar~~ -- Fixed: build as CJS (.cjs) via vite.config.ts, main.ts references `preload.cjs`
- ~~sandbox: false regression~~ -- Fixed: restored `sandbox: true` (CJS preload works in sandboxed mode)
- ~~Provider card hover locks in jiggled state~~ -- Fixed: replaced `animation: ob-jiggle` with `transition: transform` on hover
- ~~Container gradient burns GPU permanently~~ -- Fixed: added `will-change: background-position`
- ~~Missing `aria-valuemin` on progressbar~~ -- Fixed: added `aria-valuemin={1}` + `aria-label="Setup progress"`
- ~~`.glass` class conflicts with `.ob-card`~~ -- Fixed: removed `.glass` from onboarding card
- ~~No `prefers-reduced-motion` support~~ -- Fixed: full `@media (prefers-reduced-motion: reduce)` block (WCAG 2.1 SC 2.3.3)
- ~~No app icon on exe/tray~~ -- Fixed: custom SVG icon, electron-builder icon config for all platforms, tray uses `icon.png` with fallback
- ~~Button hover uses animation (can lock)~~ -- Fixed: all buttons use `transition: transform` instead

**Code review remediation (2026-02-24 round 5):**
- ~~IMAP `secure: true` hardcoded~~ -- Fixed: `secure: port === 993` in both `testConnection()` and `connectAccount()` (STARTTLS on 587 now works)
- ~~Hardcoded green `#22c55e` in test-passed button~~ -- Fixed: extracted to `--color-success` CSS variable in index.css
- ~~SettingsModal animations lack `prefers-reduced-motion`~~ -- Fixed: `@media (prefers-reduced-motion: reduce)` block for overlay, modal, and spinner (WCAG 2.1 SC 2.3.3)
- ~~`console.log` leaks message IDs in smtp.ts~~ -- Fixed: removed production stdout leak
- ~~IMAP error messages not sanitized~~ -- Fixed: strip HTML entities + control chars, truncate to 500 chars
- ~~`rmSafe()` call sites pass unused label arguments~~ -- Fixed: removed extra args in clean-build.mjs
- ~~Duplicate test connection logic~~ -- Fixed: extracted shared `runConnectionTest()` helper
- ~~SMTP field changes don't reset test status~~ -- Fixed: added `resetTestStatus()` to SMTP host/port onChange

**Architecture gaps:** Single MCP transport, flat tool dispatch, inline styles in every component

### Test Coverage: ~45% (10 files, 111 tests, target 70%)

**Tested:** crypto, db, mcpServer, imapSanitize, themeStore, emailStore, SettingsModal, ComposeModal, ReadingPane, useKeyboardShortcuts
**Untested critical paths:** IMAP client (P1), SMTP sender (P1), ContactAutocomplete (P2), App orchestration (P2), ThemeContext (P3), OnboardingScreen (P3)

## Feature Status Summary

Full feature matrix and phased roadmap in `docs/ROADMAP.md`. Reference client: [Mailspring](https://github.com/Foundry376/Mailspring).

### What's Done (Phase 1 complete, Phase 2 partial -- v0.2.0-in-progress)
- Account management (add/remove/edit/test, 5 provider presets, brand icons)
- IMAP connect + IDLE + body fetch + folder sync + reconnect with exponential backoff
- Connection testing (10s timeout) — standalone Test Connection button + test-before-save, visual status (pass/fail/spinner)
- Post-add account auto-selection + folder loading + inbox auto-select
- SMTP send with CC/BCC (TLS/STARTTLS, injection-safe)
- Full-text search (FTS5, debounced)
- Email compose with To/CC/BCC + contact autocomplete (ARIA combobox), reply/forward prefill
- HTML email rendering with DOMPurify sanitization
- Reply, Forward, Delete, Star/Flag, Archive, Move-to-folder actions wired
- Keyboard shortcuts: mod+N compose, R reply, F forward, E archive, J/K navigate, Delete, Escape
- Contact autocomplete in To/CC/BCC (200ms debounce, auto-harvest on send, email validation)
- Draft auto-save (2s debounce, CC/BCC preserved, delete on send, resume via draftId)
- ComposeModal floating card redesign (solid bg, matches SettingsModal)
- Multi-account sidebar with provider icons and unread badges
- `email:new` IPC event emitted from main process
- 4 themes + 2 layouts (persisted)
- Premium onboarding wizard (4-step, 9 animations, WCAG 2.1, connection testing)
- MCP server with 5 AI tools (search, read, send, draft, summary)
- Security hardened (auth, sandbox, CSP, scoped IPC, encrypted passwords, cross-account guards)
- System tray with icon
- 111 tests across 10 files
- All packages upgraded: React 19, Electron 40, Vite 7, TypeScript 5.9, ESLint 10 (flat config)

### What's Not Done Yet (by phase)
- **Phase 2 (Productivity):** Attachments, signatures, rich text compose, inline images
- **Phase 3 (AI):** AI compose assistant, email categorization, AI insights, multi-client MCP, LLM summarization
- **Phase 4 (Polish):** Snooze, send later, reminders, mail rules, i18n, OS notifications, auto-update, code signing
- **Phase 5 (Quality):** 70%+ test coverage, E2E tests, CSS modules migration, perf optimization

### Stubs (UI exists, not wired)
- ComposeModal: Format, Insert Link, Attach Files toolbar buttons
- emailStore: isLoading/setLoading state

## Known Issues & Technical Debt

### Critical (fix before any real user data) -- ALL RESOLVED 2026-02-22
- [x] Add token auth to MCP `/sse` and `/message` endpoints
- [x] Replace raw `ipcRenderer` bridge with scoped, typed API functions
- [x] Set `asar: true` with `asarUnpack: ["**/*.node"]`
- [x] Wrap `<App>` in `<ThemeProvider>` in `src/main.tsx`
- [x] Fix CSS variable names in all component `<style>` blocks (add alias vars to `:root`)

### High (core functionality) -- ALL RESOLVED 2026-02-22
- [x] Register `ipcMain.handle` endpoints for all data operations
- [x] Wire ThreadList/ReadingPane/ComposeModal/Sidebar to real DB data via IPC
- [x] Connect `send_email` MCP tool to `smtpEngine.sendEmail`
- [x] Bind MCP server to `127.0.0.1`, replace `cors()` with `cors({ origin: false })`
- [x] Rename package from `tmp-app` to `expressdelivery`
- [x] Add `release/` and `dist-electron/` to `.gitignore`
- [x] Sanitize FTS5 query input, replace SELECT * with explicit columns
- [x] Add IMAP/SMTP host/port columns to accounts schema
- [x] Add schema version + migration runner to `db.ts`

### Medium (architecture)
- [x] IMAP full body fetch (fetches first MIME part, stored in body_text)
- [x] IMAP folder sync (listAndSyncFolders with RFC 6154 classification)
- [x] IMAP reconnect/retry on disconnect (exponential backoff, max 5 retries)
- [x] Emit `email:new` from main process after IMAP sync (callback pattern)
- [x] Add DOMPurify for HTML email rendering
- [ ] Migrate inline `<style>` to CSS modules
- [ ] Multi-transport Map for MCP SSE connections
- [ ] Refactor tool dispatch to Map<name, handler>
- [ ] Evaluate SQLCipher for at-rest DB encryption
- [x] Fix `exists` listener leak in `imap.ts`
- [x] Self-host Outfit font (remove Google Fonts CDN)
- [x] Add explicit `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` to BrowserWindow (preload MUST be `.cjs` for sandbox to work)
- [x] Move debug/crash logs to `app.getPath('logs')`, sanitize PII
- [x] Persist layout preference (extend Zustand store)
- [x] Add React error boundary
- [x] Add CSP meta tag to index.html

### Low (cleanup)
- [x] Remove dead code: empty `did-finish-load` handler, commented-out `loadFile`, unused React imports
- [x] Remove dead `mcp:get-token` IPC handler from main.ts and unreachable MonitorPlay import
- [ ] Remove unused CSS utility classes or adopt them
- [x] Add package metadata (description, author, license)
- [x] Upgrade Electron to 40 (from 30), React to 19, Vite to 7, TypeScript to 5.9, ESLint to 10 (flat config)
- [ ] Add `@vitest/coverage-v8` + coverage thresholds
- [ ] Write tests for IMAP, SMTP, ComposeModal, App, ThemeContext
- [x] Add port range constraints (min=1, max=65535) to IMAP/SMTP port inputs in SettingsModal
- [ ] Remove dead `isLoading`/`setLoading` state from emailStore or wire to loading operations
