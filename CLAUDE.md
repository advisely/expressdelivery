# ExpressDelivery - AI-Powered Email Client

Electron desktop email client with MCP (Model Context Protocol) integration for AI-assisted email operations. **Status:** Phase 5 complete (v1.0.0). 12 components, 2 Zustand stores, 8 MCP tools, SQLite persistence (9 migrations), 4 themes, 21 test files (338 tests), ~54 IPC handlers. Full IMAP sync (body + folders + reconnect), HTML email rendering (DOMPurify), reply/forward/delete/star/archive/move, CC/BCC compose with contact autocomplete, contact auto-harvest, draft auto-save/resume, file attachments (send + receive, IMAP on-demand download, SQLite BLOB cache), keyboard shortcuts (mod+N/R/F/E/J/K/Delete/Escape), multi-account sidebar with unread badges + AI status indicator, connection testing, account editing, provider brand icons. Rich text compose (TipTap), per-account email signatures, inline CID image display, remote image blocking with privacy banner. AI-powered features: email categorization/priority/labels via MCP, mailbox analytics, suggest reply context, multi-client SSE transport, OpenRouter API key management (encrypted via safeStorage, Settings UI). App icon implemented (SVG source in `build/`, PNG/ICO generated via `npm run generate:icons`). Premium onboarding flow with 9 CSS animations, glassmorphism, and WCAG 2.1 reduced-motion support.

## Tech Stack

| Layer     | Technology                                                                                   |
| --------- | -------------------------------------------------------------------------------------------- |
| Frontend  | React 19, TypeScript 5.9 strict, Zustand (theme + email stores), Radix UI (Dialog, Tabs, Popover), TipTap (rich text), Lucide icons, Tailwind CSS v4, DOMPurify, react-i18next, CSS custom properties |
| Backend   | Electron 40, better-sqlite3 (WAL + FTS5), IMAPFlow, Nodemailer, Express 5, electron-updater    |
| AI/MCP    | @modelcontextprotocol/sdk (multi-client SSE transport on port 3000), 8 tools (search, read, send, draft, summary, categorize, analytics, suggest_reply) |
| Build     | Vite 7 + vite-plugin-electron, electron-builder (Windows NSIS, Linux AppImage/deb/rpm, macOS DMG, GitHub Releases publish) |
| Testing   | Vitest 4 + jsdom, @testing-library/react                                                     |

## Structure

```
electron/          # Main process (db, imap, smtp, crypto, mcp server, utils)
src/               # Renderer process (React SPA)
  components/      # UI components (10 files + 10 co-located .module.css files)
  stores/          # Zustand stores (themeStore, emailStore)
  lib/             # Shared utilities (ipc wrapper, providerPresets, providerIcons, useKeyboardShortcuts, i18n)
  assets/          # Static assets
public/            # Runtime assets (self-hosted fonts, icon.png)
src/locales/       # i18n translation files (en, fr, es, de)
build/             # electron-builder assets (icon.svg, icon.png, icon.ico, icon@2x.png)
scripts/           # Dev tooling (generate-icons.mjs, clean-build.mjs)
.github/workflows/ # CI/CD pipelines (ci.yml, release.yml)
release/           # Built app artifacts
```

## Key Files

| File                        | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `electron/main.ts`         | Electron entry, window + tray + ~50 IPC handlers (snooze, scheduled sends, reminders, rules, update, notifications) |
| `electron/db.ts`           | SQLite init, schema, 7 migrations (accounts, folders, emails, drafts, contacts, attachments, settings, snoozed_emails, scheduled_sends, reminders, mail_rules, FTS5) |
| `electron/mcpServer.ts`    | MCP multi-client SSE server (Map-based dispatch, connection callback, timing-safe auth) |
| `electron/mcpTools.ts`     | 8 MCP tool handlers + buildToolRegistry() Map factory |
| `electron/imap.ts`         | IMAP client (connect, IDLE, sync body + folders + attachments + Content-ID, reconnect, connection test, on-demand download, applyRulesToEmail on insert) |
| `electron/smtp.ts`         | SMTP sender via Nodemailer (host/port from DB, CC/BCC, attachments) |
| `electron/crypto.ts`       | OS keychain encryption (safeStorage)            |
| `electron/logger.ts`       | Shared debug logger (writes to `app.getPath('logs')`) |
| `electron/preload.ts`      | IPC bridge (scoped typed API with channel allowlist) |
| `electron/utils.ts`        | Shared utilities (FTS5 query sanitizer)         |
| `electron/scheduler.ts`    | 30s polling scheduler for snooze wake, scheduled sends, and reminder notifications |
| `electron/ruleEngine.ts`   | Mail rule matching + actions (from/subject/body/has_attachment x contains/equals/starts_with/ends_with) |
| `electron/updater.ts`      | electron-updater wrapper (autoDownload: false, GitHub Releases) |
| `electron/dbEncryption.ts` | SQLCipher migration stub (Phase 5 at-rest encryption) |
| `src/App.tsx`              | Root component, error boundary, data loading, reply/forward plumbing |
| `src/components/Sidebar.tsx`     | Multi-account switcher, folders with unread badges |
| `src/components/ThreadList.tsx`  | Email list with search (wired to IPC)      |
| `src/components/ReadingPane.tsx` | HTML email viewer, reply/forward/delete/star actions, CID inline images, remote image blocking |
| `src/components/ComposeModal.tsx`| Rich text email compose (TipTap) with To/CC/BCC, reply/forward prefill, signature preview |
| `src/components/SettingsModal.tsx`| Account management (add/edit/test/delete) + theme settings |
| `src/components/ThemeContext.tsx` | Layout context + theme class application   |
| `src/components/OnboardingScreen.tsx` | First-run account setup (4-step wizard, 9 CSS animations) |
| `src/components/DateTimePicker.tsx`   | Native datetime input with quick-select presets (1h, 3h, tomorrow, next week) |
| `src/components/UpdateBanner.tsx`     | In-app update available/download progress/install banner |
| `src/lib/providerPresets.ts`   | Email provider IMAP/SMTP presets (Gmail, Outlook, Yahoo, iCloud, Custom) |
| `src/lib/providerIcons.tsx`    | Provider brand SVG icons (Gmail, Outlook, Yahoo, iCloud, Custom) |
| `src/stores/themeStore.ts` | Zustand persisted theme + layout state          |
| `src/stores/emailStore.ts` | Zustand email/folder/account state             |
| `src/components/ContactAutocomplete.tsx` | ARIA combobox contact search (To/CC/BCC) |
| `src/lib/useKeyboardShortcuts.ts` | Global keyboard shortcut hook (mod/shift/alt combos) |
| `src/lib/formatFileSize.ts` | Human-readable file size formatter (shared utility) |
| `src/lib/ipc.ts`          | Typed IPC wrapper for renderer process          |
| `src/lib/i18n.ts`         | react-i18next init with 4 locales (en, fr, es, de) |
| `scripts/clean-build.mjs`  | Hydration + clean packaging (purge, rebuild native deps, package, verify) |
| `src/index.css`            | Global styles, 4 themes, self-hosted Outfit font, layout modes |

## Data Models

**SQLite Tables:** `accounts` (email, provider, encrypted password, IMAP/SMTP host/port, display_name, signature_html), `folders` (mailbox hierarchy), `emails` (messages + FTS5 index + has_attachments + ai_category + ai_priority + ai_labels + is_snoozed, schema_version=7), `attachments` (metadata + BLOB cache + content_id, FK cascade to emails, schema_version=5), `drafts` (pending emails with cc/bcc, schema_version=2), `contacts` (auto-harvested from sent mail), `settings` (key-value, includes schema_version), `snoozed_emails` (email_id, snooze_until, created_at), `scheduled_sends` (draft_id, send_at, status), `reminders` (email_id, remind_at, note, status), `mail_rules` (account_id, conditions JSON, actions JSON, order, enabled)

**Zustand Stores:**
- `themeStore` — `themeName`, `layout`, persisted to localStorage
- `emailStore` — `accounts`, `folders`, `emails`, `selectedEmail`, selection IDs, search state

**Layout:** `'vertical' | 'horizontal'` persisted via Zustand (themeStore), applied via ThemeContext

## MCP Tools

All handlers in `electron/mcpTools.ts`, dispatched via Map in `electron/mcpServer.ts`.

| Tool              | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `search_emails`   | FTS5 full-text search with AI metadata (JOIN to emails table, limit 20) |
| `read_thread`     | Fetch email thread by thread_id            |
| `send_email`      | Send via SMTP (attachments, filename sanitized, 500KB HTML cap) |
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
- Components use CSS Modules (co-located `.module.css` files)
- Electron main process uses `.js` extension in imports (ESM)
- Preload script exposes IPC via `contextBridge` (MUST build as CJS `.cjs` — Electron requires `require()` for preload in sandboxed mode; configured in `vite.config.ts`)
- Database uses WAL mode + foreign keys + FTS5 triggers (7 migrations)
- Passwords encrypted via `electron.safeStorage` (OS keychain)
- MCP server runs on localhost:3000 with multi-client SSE + POST transport (timing-safe auth, account ownership enforcement)

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

**Code review remediation (2026-02-24 round 6):**
- ~~MCP `send_email` CRLF injection~~ -- Fixed: `stripCRLF` applied to recipients and subject in MCP handler
- ~~MCP `create_draft` no account validation~~ -- Fixed: verify `account_id` exists before INSERT
- ~~`App.tsx handleDeleteSelected` no error handling~~ -- Fixed: try/catch + `result?.success` guard
- ~~Hardcoded indigo `rgba(59,130,246)` in Sidebar/ThreadList~~ -- Fixed: replaced with `rgba(var(--color-accent), ...)`
- ~~ThreadList rows not keyboard accessible~~ -- Fixed: added `role="button"`, `tabIndex={0}`, `onKeyDown`
- ~~`console.error/log` in imap.ts, smtp.ts, mcpServer.ts~~ -- Fixed: extracted shared `logDebug()` to `electron/logger.ts`, all 7 call sites migrated

**Code review remediation (2026-02-24 round 7 — Phase 2 features):**
- ~~Signature not DOMPurify-sanitized at send time~~ -- Fixed: `DOMPurify.sanitize(accountSignature)` before appending
- ~~CID data: URLs not MIME-validated~~ -- Fixed: `SAFE_IMAGE_MIMES` allowlist (png/jpeg/gif/webp/bmp)
- ~~attachments:by-cid no account ownership check~~ -- Fixed: verify email belongs to valid account
- ~~Insert Link accepts javascript: URLs~~ -- Fixed: `https?://` scheme validation
- ~~Unbounded signature_html size~~ -- Fixed: `slice(0, 10_000)` in accounts:add and accounts:update
- ~~data-blocked-src URL not HTML-encoded~~ -- Fixed: `escapeAttr()` helper
- ~~CID cap too generous (50)~~ -- Fixed: reduced to 10
- ~~extractCids ran on unsanitized HTML~~ -- Fixed: runs on `sanitizedBodyHtml` (DOMPurify output)
- ~~replaceCids fallback CID not escaped~~ -- Fixed: HTML-encoded in output
- ~~extractAttachments skipped children of inline nodes~~ -- Fixed: recurse into childNodes for non-image inline
- ~~Toolbar buttons missing type="button" and aria-label~~ -- Fixed: all 7 buttons accessible
- ~~Forward body interpolations not entity-escaped~~ -- Fixed: `esc()` applied in App.tsx handleForward

**Architecture gaps (Phase 3 resolved):** Multi-client MCP transport (Map-based), Map tool dispatch, timing-safe auth, account ownership on categorize/suggest_reply, attachment filename sanitization, body_text truncation, HTML body 500KB cap. **Resolved:** CSS modules migration complete (10 .module.css files)

**Code review remediation (2026-02-24 Phase 4):**
- ~~Cross-account ownership missing on scheduled:cancel/update, reminders:cancel, rules:update/delete/reorder~~ -- Fixed: all handlers verify resource belongs to requesting account
- ~~CRLF injection in scheduled:create subject~~ -- Fixed: stripCRLF applied to subject
- ~~rules:update/rules:test accept arbitrary field/operator/action strings~~ -- Fixed: VALID_FIELDS, VALID_OPERATORS, VALID_ACTIONS guard sets in main.ts
- ~~Scheduler snooze wake and scheduled sends not transactional~~ -- Fixed: status update + action wrapped in db.transaction()
- ~~Scheduler sends all due emails concurrently~~ -- Fixed: sequential await loop for scheduled sends
- ~~RuleEngine multi-rule apply not transactional~~ -- Fixed: batch apply wrapped in db.transaction()
- ~~ComposeModal scheduled:create IPC contract mismatch~~ -- Fixed: payload aligned to IPC handler schema
- ~~Toast timer overlap on rapid successive toasts~~ -- Fixed: clearTimeout before each new toast timer
- ~~JSON.parse of conditions/actions not guarded~~ -- Fixed: try/catch with fallback to empty array in scheduler and ruleEngine

**Code review remediation (2026-02-25 round 8 — v1.2.2 fixes):**
- ~~Sync indicator "Not synced" after successful connection~~ -- Fixed: `accounts:add` and `accounts:update` now emit `sync:status` IPC events; extracted `sendSyncStatus()` helper
- ~~Trash icon replaces date on hover~~ -- Fixed: date-col wrapper with `visibility: hidden/visible` instead of `display: none`, no height jitter
- ~~DOMPurify FORBID_TAGS regression~~ -- Fixed: sandboxed iframe rendering (`sandbox="allow-scripts"`, no `allow-same-origin`); `<style>` allowed within iframe (style-isolated); `<link>` still forbidden; iframe CSP `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; frame-ancestors 'none';`
- ~~uncaughtException kills app on non-fatal errors~~ -- Fixed: only exits for fatal (MODULE_NOT_FOUND via `err.code`, NODE_MODULE_VERSION, OOM regex)
- ~~log:error IPC handler allows log injection~~ -- Fixed: strip `\r\n\0`, prepend `[RENDERER]`, 4000-char cap
- ~~accounts:update catch block silently drops error~~ -- Fixed: added `logDebug` with error context
- ~~IMAP client.on('error') logs unsanitized messages~~ -- Fixed: HTML entity strip + control char replace + 500-char truncation
- ~~componentDidCatch stack truncated at 2000 chars~~ -- Fixed: pre-truncate stack and componentStack to 800 chars each
- ~~window.error handler can throw if preload unavailable~~ -- Fixed: wrapped in try-catch
- ~~child-process-gone not logged~~ -- Fixed: app event listener logs type/reason/exitCode
- ~~Renderer crashes not forwarded to log file~~ -- Fixed: `log:error` IPC + global error/rejection handlers + ErrorBoundary componentDidCatch

**Code review remediation (2026-02-25 round 9 — iframe sandbox):**
- ~~Email HTML rendered via dangerouslySetInnerHTML~~ -- Fixed: `SandboxedEmailBody` component with `<iframe sandbox="allow-scripts">` + `postMessage`-based auto-resize (ResizeObserver)
- ~~`allow-same-origin` on iframe creates latent parent-DOM access risk~~ -- Fixed: migrated to `allow-scripts` (no `allow-same-origin`) + ResizeObserver `postMessage` pattern
- ~~"Load images" button broken (iframe CSP blocks remote images)~~ -- Fixed: `buildIframeSrcdoc` accepts `allowRemoteImages` flag, dynamically adds `https:` to `img-src` CSP
- ~~`srcset` attribute bypasses remote image blocking~~ -- Fixed: `processRemoteImages()` now also strips `srcset` with remote URLs
- ~~`body_text` treated as HTML in thread view~~ -- Fixed: plain text is `escapeHtml()`-escaped and wrapped in `<pre style="white-space:pre-wrap">`
- ~~`PURIFY_CONFIG_THREAD` missing `ADD_URI_SAFE_ATTR`~~ -- Fixed: added `ADD_URI_SAFE_ATTR: ['src']` for CID data: URLs
- ~~Redundant `remoteImageCount` state + sync effect~~ -- Fixed: eliminated state, use `detectedRemoteCount` directly from `useMemo`
- ~~Dead CSS (`.email-body-html`, `.action-button`, `gap: 0`)~~ -- Fixed: removed from ReadingPane.module.css
- ~~`as string[]` type casts on DOMPurify config arrays~~ -- Fixed: removed unnecessary type assertions
- ~~No `will-navigate` / `setWindowOpenHandler` in main.ts~~ -- Fixed: defense-in-depth navigation blocking and window open denial
- ~~Iframe CSP missing `frame-ancestors 'none'`~~ -- Fixed: added to `buildIframeSrcdoc` CSP
- ~~`SandboxedEmailBody` not memoized~~ -- Fixed: wrapped with `React.memo`, `srcdoc` computed via `useMemo`
- ~~`buildIframeSrcdoc` dense one-liner~~ -- Fixed: expanded to multiline `join('')` for auditability

**Code review remediation (2026-02-25 round 10 — startup performance + charset):**
- ~~IMAP body hardcoded UTF-8 decoding~~ -- Fixed: charset-aware `decodeBuffer()` reads charset from `bodyStructure.parameters`, SAFE_CHARSETS allowlist, UTF-8 fallback
- ~~Sync indicator shows "Not synced" after successful connection~~ -- Fixed: 5-second IMAP status polling + push events, shows Connecting/Connected/Error/Last check
- ~~Startup ~10s delay~~ -- Fixed: deferred IMAP body downloads (on-demand via `refetchEmailBody`), short-circuit migration runner, lazy MCP server init, batched startup:load IPC (includes settings), Vite `manualChunks` vendor splitting
- ~~No loading progress indicator~~ -- Fixed: splash screen with progress bar (0-100%), step labels (Initializing/Loading accounts/Loading mailbox/Ready)
- ~~`emails:repair-bodies` unbounded IMAP load~~ -- Fixed: capped at 200 emails, filters `WHERE body_html IS NULL`, hoisted prepared statements
- ~~`TextDecoder` accepts exotic charsets~~ -- Fixed: `SAFE_CHARSETS` allowlist (30+ common charsets), rejects to UTF-8
- ~~`needsBodyFetch` dead logic clause~~ -- Fixed: simplified to `!email.body_html && !email.body_text`
- ~~`getMcpServer().stop()` unguarded in before-quit~~ -- Fixed: wrapped in try-catch
- ~~`MAX_BODY_BYTES` declared 3 times locally~~ -- Fixed: hoisted to module-level constant
- ~~`startup:load` undo_send_delay unbounded~~ -- Fixed: clamped `Math.min(Math.max(..., 0), 30)` server-side
- ~~Favicon points to `/vite.svg`~~ -- Fixed: changed to `/icon.png`
- ~~`getMcpServer()` called twice in startup~~ -- Fixed: cached to local `const mcp`
- Added `emails:refetch-body` (single email) and `emails:repair-bodies` (batch) IPC handlers for garbled email repair

### Test Coverage: ~68% (21 files, 338 tests)

**Tested:** crypto, db, mcpServer, mcpTools (all 8 handlers), imapSanitize, themeStore, emailStore, SettingsModal, ComposeModal (TipTap + signatures), ReadingPane (CID + remote image blocking), useKeyboardShortcuts, formatFileSize, smtp, ContactAutocomplete, scheduler, ruleEngine, App, ThemeContext, DateTimePicker, UpdateBanner, OnboardingScreen
**Untested critical paths:** IMAP client (P1 — integration complexity, deferred to E2E), ThreadList (P1 — no test file)

## Feature Status Summary

Full feature matrix and phased roadmap in `docs/ROADMAP.md`. Reference client: [Mailspring](https://github.com/Foundry376/Mailspring).

### What's Done (Phase 1 complete, Phase 2 complete, Phase 3 complete, Phase 4 complete, Phase 5 complete -- v1.0.0)
- Account management (add/remove/edit/test, 5 provider presets, brand icons)
- IMAP connect + IDLE + body fetch + folder sync + reconnect with exponential backoff
- Connection testing (10s timeout) — standalone Test Connection button + test-before-save, visual status (pass/fail/spinner)
- Post-add account auto-selection + folder loading + inbox auto-select
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
- ComposeModal floating card redesign (solid bg, matches SettingsModal)
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
- 337 tests across 21 files
- All packages upgraded: React 19, Electron 40, Vite 7, TypeScript 5.9, ESLint 10 (flat config)
- Snooze emails (30s polling scheduler, wake/unsnooze, snoozed virtual folder in Sidebar)
- Send later (scheduled sends with DateTimePicker, quick-select presets, scheduled virtual folder)
- Reminders (per-email, scheduled notifications, reminder management in ReadingPane)
- Mail rules engine (from/subject/body/has_attachment conditions, mark-read/star/move/delete/label actions, account-scoped, priority-ordered)
- i18n framework (react-i18next, 4 locales: en/fr/es/de, translation files in src/locales/)
- OS notifications (system tray notifications via Electron Notification API, triggered by scheduler)
- Auto-update banner (electron-updater, GitHub Releases, autoDownload: false, in-app UpdateBanner)
- Code signing config in electron-builder.json5 (Windows + macOS signing fields)
- Linux deb/rpm targets added to electron-builder.json5
- SQLCipher migration stub (electron/dbEncryption.ts, Phase 5 implementation ready)
- CSS modules migration complete (10 co-located .module.css files)
- i18n t() calls wired to all component render output (all 4 locales)
- GitHub Actions CI pipeline (ci.yml) and release pipeline (release.yml)
- React.memo ThreadItem optimization
- @vitest/coverage-v8 with coverage thresholds

### What's Not Done Yet (by phase)
- **Phase 3 (AI):** AI compose assistant (LLM-powered reply generation using suggest_reply context)
- **Phase 5 (remaining):** E2E tests, SQLCipher at-rest encryption

### Stubs (UI exists, not wired)
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
- [x] Migrate inline `<style>` to CSS modules
- [x] Multi-transport Map for MCP SSE connections
- [x] Refactor tool dispatch to Map<name, handler>
- [x] Evaluate SQLCipher for at-rest DB encryption -- Stubbed: electron/dbEncryption.ts documents migration path (Phase 5 implementation)
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
- [x] Add `@vitest/coverage-v8` + coverage thresholds
- [ ] Write tests for IMAP, SMTP, ComposeModal, App, ThemeContext
- [x] Add port range constraints (min=1, max=65535) to IMAP/SMTP port inputs in SettingsModal
- [ ] Remove dead `isLoading`/`setLoading` state from emailStore or wire to loading operations

### Phase 4 (known limitations)
- [x] i18n strings wired to all component render output
- [ ] Virtual folders __snoozed/__scheduled have basic query support; advanced filtering pending
- [x] Auto-update GitHub Releases publish config (release.yml)
- [ ] electron/dbEncryption.ts is a documentation stub; SQLCipher integration is Phase 5
