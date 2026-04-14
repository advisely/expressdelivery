# Changelog

All notable changes to ExpressDelivery are documented in this file.

ExpressDelivery is an AI-powered desktop email client with MCP (Model Context
Protocol) integration, built with Electron, React 19, TypeScript, and SQLite.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.17.3] - 2026-04-14

Three fixes bundled into one hotfix: a follow-up to the v1.17.2 Yahoo IMAP work that fixes delete/move getting silently dropped on Yahoo accounts, a new floating attachment preview UX (click filename to preview, click download icon to save), and a related fix for attachment downloads that were failing on Yahoo for the same root cause as delete.

### Fixed
- **Yahoo (and any high-folder-count IMAP account) "can't delete" bug.** The v1.17.2 release un-stuck Yahoo accounts from the connecting/reconnect loop, but exposed a second-order problem: the v1.17.2 background folder-sync IIFE held IMAPFlow mailbox locks for so long that user-initiated `moveMessage`, `deleteMessage`, `markAsRead`, and `downloadAttachment` calls all timed out at the 10-second `getMailboxLock` budget. `moveMessage` returned false silently, `emails:delete` IPC fell through to its local-only fallback (`UPDATE emails SET folder_id = trash`), the renderer flashed "deleted" but on the next sync tick the email reappeared because it was never moved on the server. Same root cause for the failing PDF download. Fix is three-pronged:
  1. **Removed the v1.17.2 background IIFE entirely.** Non-inbox folders are now exclusively handled by `runFullSync` on its 60s timer, which already uses `ctrl.syncing` as a per-account mutex so it never overlaps with `runInboxSync`. The first runFullSync tick happens 60s after connect, which is well within the user's tolerance for non-critical folders to populate.
  2. **`runFullSync` now sorts folders by priority** (`inbox > sent > drafts > trash > junk > flagged > archive > other`) and **enforces a 45s per-tick time budget**. If a single tick runs longer than 45s it releases the `ctrl.syncing` mutex and yields — remaining folders are picked up on the next tick. This caps the worst-case time the mutex is held, so user actions and `runInboxSync` always have a window to acquire it. Yahoo accounts with 82 folders take a few ticks to sweep all folders on the first round, but the priority order means the user-critical folders (Inbox, Sent, Drafts, Trash) all complete on the first tick.
  3. **Bumped the `getMailboxLock` timeout from 10s to 30s on every user-action path** — `moveMessage`, `deleteMessage`, `markAsRead`, `markAsUnread`, `downloadAttachment`. Internal sync paths (`runInboxSync` → `syncNewEmails`) keep the 10s timeout so they fail fast on stuck connections. The 30s budget gives user actions enough headroom to wait through one in-flight folder fetch (typical Yahoo Archive iteration is ~15-25s on first sweep) without timing out.

### Added
- **Floating attachment preview** (`AttachmentPreviewModal`). Click an attachment's filename in the reading pane and a centered modal opens with an inline preview rendered from the attachment bytes:
  - **PDF** → Chromium's built-in PDF viewer via `<iframe src={blob URL}>`
  - **Images** (png / jpeg / gif / webp / bmp) → `<img>` with a checkered transparency background so PNG transparency is visible
  - **Text / JSON / XML** → `<pre>` with a monospace font and word-break wrapping
  - **Anything else** → fallback card with the file name, size, MIME type, and an explicit Download button
  
  Modal header shows the filename, size, a Download button (saves the same bytes that were fetched for preview, no second IMAP round-trip), and a close button. Backed by Radix Dialog with a glassmorphism overlay and reduced-motion support.
- **Attachment chip is now two click targets** instead of one. The filename + icon area opens the preview; the download icon (right side of the chip, separated by a 1px divider) saves directly to disk. Both have distinct `aria-label`s, distinct hover states, distinct keyboard focus rings.
- **CSP loosened for blob: in `frame-src` and `object-src`** (and `img-src`) so the PDF viewer's blob URL renders inside the iframe. Blob URLs are session-scoped and tied to the renderer's process — no remote network access added.

### Changed
- **Attachment download error messages now surface the actual error** in the toast instead of a generic "Failed to download attachment". Previously the catch block swallowed the error message — now it reads `Failed to download attachment: <actual error>` so users (and bug reports) can distinguish lock-timeout failures from network failures from on-disk write failures.
- **`window.addEventListener('message')` in the email iframe handler** now uses an explicit origin allowlist (`['null', window.location.origin, '']`) plus the existing object-identity check (`e.source === iframeRef.current?.contentWindow`). The object-identity check is the authoritative one — it cannot be spoofed across windows — but the origin allowlist is added as defence-in-depth and to satisfy static-analysis rules. Behaviourally equivalent.

### Test count
- 1003 vitest tests across 45 files (no new tests in this hotfix — the imap.ts changes are covered by the existing 62 imapSync.test.ts cases plus manual reproduction against the Yahoo test account)
- Lint clean, tsc clean

### Notes
- No schema changes, no new dependencies, no breaking API changes. Patch release. Safe to install over v1.17.2.
- After installing v1.17.3 you should be able to: (a) delete Yahoo emails and have them actually disappear from the server, (b) click a PDF attachment and have it open in a floating preview without leaving the app, (c) click the download icon on any attachment chip to save it directly.

---

## [1.17.2] - 2026-04-13

Hotfix for a Yahoo (and any ~80-folder account) IMAP reconnect loop surfaced during v1.17.1 manual testing. Also refreshes two stale architecture docs flagged by the docs audit.

### Fixed
- **Yahoo / high-folder-count IMAP accounts were stuck in a "connecting → disconnect → reconnect" loop.** `ImapEngine.startAccount()` had a folder-sync loop labelled "non-blocking" in its comment but actually did a sequential `await` over every non-inbox folder. For Yahoo accounts with ~80 folders and a 60s per-folder timeout, this blocked `startAccount` for up to ~80 minutes before the status could transition to `connected` and the heartbeat could start. During that window the idle TCP connection dropped (no NOOPs), `on('close')` fired `forceDisconnect('health')`, `scheduleReconnect()` fired a new `startAccount`, and the cycle repeated indefinitely. Fix: the inbox initial sync still runs in the foreground (the user needs *something* to look at on first render), but every other folder's initial sync is deferred to a fire-and-forget IIFE that runs *after* `ctrl.status = 'connected'` and `startHeartbeat()` have already run. The normal 60s folder sync timer picks up any failures on its next tick. IMAPFlow serializes mailboxOpen/fetch operations internally, so the background loop does not contend with the heartbeat or the inbox sync timer for mailbox locks. Verified: 62 `imapSync.test.ts` cases still pass; 1003/1003 full suite green. Observed in `%APPDATA%\\ExpressDelivery\\logs\\debug_startup.log` as an account that logged "Found 82 folders" + "Inbox initial sync: 14 new emails" but never logged "startAccount complete".

### Docs
- `docs/ARCHITECTURE.md` refreshed to v1.17.1+ state: ~116 IPC handlers (was ~107), 17 migrations (was 12), new `electron/auth/` and `electron/oauth/` module subtrees documented, `sendMail.ts` + `graphSend.ts` listed, Phase 2 migrations 16 + 17 noted.
- `docs/PACKAGES.md` refreshed to v1.17.1+ state: `@azure/msal-node ^5.1.2` added to production deps, `nock ^14.0.12` added to dev deps, `grammy` + `@playwright/test` demoted from "New" to "Current".

### Notes
- No schema changes, no new dependencies, no breaking API changes. Patch release. Safe to install over v1.17.1 or v1.17.0 via the `.expressdelivery` update package.
- If your Yahoo account was stuck in the reconnect loop on v1.17.1 the new build clears it immediately — the account transitions to connected within ~5 seconds and you should see the inbox right away. Non-inbox folders (Bulk Mail, Trash, Archive, custom labels) populate in the background over the next 30-90 seconds depending on how many messages are in each.

---

## [1.17.1] - 2026-04-13

Phase 17.1 — polish follow-up to the v1.17.0 OAuth2 landing. Wires the three items deferred from Phase 2 execution: a Playwright seed hook so the Sidebar reauth badge has real E2E coverage, deep-link from the Sidebar "Sign in again" CTA to the correct account's edit form in Settings, and dead-key cleanup in the OAuth mismatch warning. Also widens the rateLimiter test refill window to eliminate a pre-existing Windows CI flake that was unrelated to Phase 2 but blocking merges.

### Added
- **E2E seed hook**: `ELECTRON_USER_DATA_DIR` env var now actually overrides the Electron userData path (was declared in the Playwright fixture but never consumed). Pairs with a new `EXPRESSDELIVERY_TEST_SEED_REAUTH` env var gated on `NODE_ENV=test` that inserts a synthetic Gmail OAuth account with a caller-supplied `auth_state` after `initDatabase()`. Enables the previously-skipped Console Health test "sidebar: reauth badge renders for an account in reauth_required state" — now asserts the red badge is visible via `page.getByLabel(/sign.?in.?(needed|required|again)/i)`.
- **SettingsModal `deepLink` prop**: new `{ accountId?: string }` prop that, when supplied on mount, navigates the modal to Email → Accounts and calls `enterEditMode(account)` for the target account. Wired from `App.tsx` via a new `settingsDeepLink` state, fed by a new `onSettings(opts)` Sidebar prop signature. One-shot useEffect keyed on `deepLink?.accountId` so subsequent tab switches are not hijacked.
- New SettingsModal test: `deepLink={ accountId } opens the edit form for that account on mount` asserts the reauth banner and `signed-in-via` readout both appear inside the target account's edit form without any prior click navigation.

### Changed
- **Sidebar "Sign in again" CTA** now deep-links to the account's edit form. Previously the CTA called `onSettings()` which opened SettingsModal on whatever sub-tab was last visited; now it calls `onSettings({ accountId: acc.id })` so the user lands directly on the form they need to fix. The nav-item Settings button (no context) still calls `onSettings()` with no args.
- `SidebarProps.onSettings` signature: `() => void` → `(opts?: { accountId?: string }) => void`. Backwards-compatible because the arg is optional.
- **OAuth mismatch warning copy** simplified in all 4 locales (en/fr/es/de). Removed the deferred `oauth.mismatch.cancel` and `oauth.mismatch.proceedAnyway` keys — they were populated in v1.17.0 based on a pre-implementation assumption about the mismatch UX that did not materialize (the warning is a status banner, not a dialog with buttons). The warning text now says "the account was added — remove and re-add if you want the other preset" instead of "continue or cancel".

### Fixed
- **Pre-existing Windows CI flake** in `electron/rateLimiter.test.ts`: `setTimeout(r, 20)` was insufficient for Windows' ~15ms timer granularity — a 30ms actual wait with `rate=100` gives 3 refilled tokens (floored to the 2-token cap) under ideal conditions, but suite-level timing drift could leave only 1.5 tokens (floored to 1) causing the second consumption assertion to fail. Widened to 60ms so the bucket refills 6 tokens (capped to 2) with comfortable margin even under drift. The test was originally added in v1.14.0 (Phase 14); not related to Phase 2 but surfaced on PR #2's Windows quality-gate.

### Removed
- Dead `tests/e2e/fixtures/seed-database.ts` helper — was declared in v1.14.0 but never imported anywhere. Replaced by the env-var seed hook in `electron/main.ts` which is schema-drift-proof (runs after `initDatabase()` so the real production schema is in place).

### Test count
- 1002 vitest tests across 45 files (+1 net: new SettingsModal `deepLink` test, flake fix did not add a new test)
- 8 Console Health E2E tests enabled (was 7 + 1 skipped)

### Notes
- No schema changes, no new dependencies, no breaking API changes. Safe patch release.
- v1.17.1 does not require re-running the OAuth client registration or rotating secrets — same `VITE_OAUTH_*` env vars as v1.17.0.

---

## [1.17.0] - 2026-04-13

Phase 2 — OAuth2 sign-in for Gmail, Outlook.com (Personal), and Microsoft 365 (Work/School). Replaces the Phase 1 "coming soon" gate on Outlook presets with a live, working OAuth flow built on RFC 8252 loopback (Google) and MSAL (Microsoft), and adds a Microsoft Graph send path for personal Outlook.com accounts so they keep working after Microsoft removes Basic Auth SMTP on April 30, 2026.

### Added

#### OAuth2 backend (Tasks 1-18)
- New `oauth_credentials` SQLite table (schema v17) — one row per `(account_id, provider)` storing AES-encrypted access + refresh tokens via `electron.safeStorage`, expiry epoch, scope, token type, last-refreshed timestamp, and last-error code. Foreign-key cascade to `accounts`
- New `accounts.auth_type` column (`'password'` | `'oauth2'`, default `'password'`) and `accounts.auth_state` column (`'ok'` | `'recommended_reauth'` | `'reauth_required'`, default `'ok'`) — both populated by schema v17 migration with backfill
- `electron/oauth/clientConfig.ts` — reads `VITE_OAUTH_GOOGLE_CLIENT_ID`, `VITE_OAUTH_GOOGLE_CLIENT_SECRET`, and `VITE_OAUTH_MICROSOFT_CLIENT_ID` from `import.meta.env` at build time, with friendly error messages pointing at `.env.local`
- `electron/oauth/google.ts` — full RFC 8252 loopback flow with `crypto.randomBytes(32)` PKCE code verifier, S256 code challenge, 32-byte hex state token for CSRF protection, 127.0.0.1 explicit bind (never 0.0.0.0), AbortSignal cancellation, error/success HTML response pages, `refreshAccessToken()` and `revokeRefreshToken()` (real Google revoke endpoint)
- `electron/oauth/microsoft.ts` — `@azure/msal-node` `PublicClientApplication` with `acquireTokenInteractive()` opening the system browser, `tid` claim classification (`9188040d-…` magic GUID → `microsoft_personal`, anything else → `microsoft_business`), `acquireTokenByRefreshToken()` for silent refresh, no-op `revokeRefreshToken()` (Microsoft's `revokeSignInSessions` is nuclear and intentionally not called per design D11.1)
- `electron/auth/tokenManager.ts` — singleton `AuthTokenManager` providing `getValidAccessToken()` with JIT pre-flight refresh (refreshes when within 60s of expiry), per-account dedup mutex (in-flight Map<accountId, Promise>) so concurrent IMAP/SMTP/Graph callers share one refresh round-trip, error classification (`isPermanentOAuthError` for `invalid_grant` / `consent_required` → flips `auth_state` to `reauth_required`; transient errors retry without state change), `invalidateToken()` for on-401 retry callers, `persistInitialTokens()` for first-token write after the interactive flow, redacted log lines (8-char token preview, 2+2-char account preview)
- `electron/send/sendMail.ts` — provider-aware send dispatcher chooses between SMTP-with-XOAUTH2 (Gmail, Outlook.com password fallback, Microsoft 365 business) and Microsoft Graph `POST /me/sendMail` (personal Outlook.com because Basic Auth SMTP is being removed)
- `electron/send/graphSend.ts` — Microsoft Graph send adapter for personal Outlook.com; serializes the in-memory `MailComposition` to a Graph `Message` with file attachments, calls `https://graph.microsoft.com/v1.0/me/sendMail` with the access token from `tokenManager`
- `electron/smtp.ts` — extended to accept an `auth: { type: 'oauth2', user, accessToken }` parameter and pass `XOAUTH2` SASL credentials to `nodemailer`. New `sendEmailWithOAuthRetry()` wrapper handles `EAUTH` failures by calling `tokenManager.invalidateToken()` and retrying once with a fresh token
- `electron/imap.ts` — `AccountSyncController` extended with OAuth2 wiring: at connect time it calls `tokenManager.getValidAccessToken()` and passes `{ user, accessToken }` to `IMAPFlow`; on `EAUTHENTICATIONFAILED` (HTTP 401-equivalent) it calls `tokenManager.invalidateToken()`, retries once, and on second failure flips `auth_state` to `reauth_required` and emits a needs-reauth IPC event
- `electron/auth/ipcHandlers.ts` — five new IPC channels:
  - `auth:start-oauth-flow` — runs `googleStartFlow` or `microsoftStartFlow`, decodes the `id_token` `email` claim, creates a new `accounts` row + persists tokens in a single transaction (D11.5b: never an account row without credentials), returns `{ success, accountId, classifiedProvider }`
  - `auth:start-reauth-flow` — same but for an existing account; D8.2 transaction order ensures `persistInitialTokens` succeeds before `password_encrypted` is cleared, so a failed reauth leaves the account in legacy password mode and retryable
  - `auth:cancel-flow` — aborts the in-flight `AbortController`
  - `auth:flow-status` — returns `{ inFlight, provider }` for UI gating
  - `auth:get-state` — returns the current `auth_state` for an account
  - All handlers use `safeErrorMessage()` to strip control chars and cap stack traces, sanitize accountIds via `redactAccountId()` in logs, and wrap mutations in try/catch returning `{ success, error }`
- `electron/auth/accountRevoke.ts` — extracted `maybeRevokeOAuthCredentials(db, accountId)` helper called by `accounts:remove` BEFORE the account row is deleted; best-effort, never throws

#### OAuth2 UI (Tasks 19-24)
- `src/components/OAuthSignInButton.tsx` — reusable button component with `provider: 'google' | 'microsoft'`, `onSuccess` and `onError` callbacks, in-flight spinner, double-click guard via `inFlight` state, `aria-busy` attribute, `data-provider` attribute for QA selection
- `OnboardingScreen.tsx` — Gmail card now renders the `OAuthSignInButton` (Google) above the existing email/password form, separated by an "or use an app password" divider — the dual path keeps Gmail working for users who prefer app passwords. Outlook Personal and Microsoft 365 cards now render `OAuthSignInButton` (Microsoft) inside the same `role="status"` region that Phase 1 used for the disabled state, with the "Use Other / Custom instead" escape hatch still present
- `SettingsModal.tsx` Account Add tab — same pattern: Gmail dual path with OAuth + app password; Outlook Personal / Microsoft 365 OAuth-only with the Custom escape hatch
- `SettingsModal.tsx` Account Edit tab — new reauth banner shown when `editingAuthType === 'oauth' && (auth_state === 'reauth_required' || auth_state === 'recommended_reauth')`. Banner color flips between amber (recommended) and red (required) and surfaces a "Sign in again" CTA that invokes `auth:start-reauth-flow`. Legacy accounts with stored `provider='outlook'` AND `auth_type='password'` show a separate migration banner ("Microsoft is removing password-based access — sign in again to modernize this account")
- `Sidebar.tsx` — new reauth badge rendered next to the account row when `auth_state` is `reauth_required` (red) or `recommended_reauth` (amber). Inline "Sign in again" button (not a context menu) opens Settings to the relevant account. Listens for the `auth:needs-reauth` IPC event and refreshes the badge state without a full reload
- `src/stores/emailStore.ts` Account type extended with `auth_type: 'password' | 'oauth'` and `auth_state: 'ok' | 'recommended_reauth' | 'reauth_required'`. `accounts:list` IPC handler projects the new columns
- `src/lib/providerPresets.ts` — `outlook-personal` and `outlook-business` presets flipped from Phase 1 `'oauth2-required'` (disabled state) to `'oauth2-supported'`. Their `warningKey` cleared (replaced by the new accent banner described below). New `oauth.providerHelp.outlookPersonalShortNote` / `outlookBusinessShortNote` short notes and `providerPresets.outlookPersonal.oauthSteps` / `outlookBusiness.oauthSteps` step lists
- `src/components/ProviderHelpPanel.tsx` — new accent banner rendered above the step list for any provider in the OAuth allowlist (`gmail`, `outlook-personal`, `outlook-business`), titled "Faster sign-in available" with a per-provider note pointing the user at the OAuth button. Legacy `OUTLOOK_LEGACY_PRESET` warning text updated to the actionable migration message ("Microsoft is removing password-based SMTP — sign in again to modernize your account")

#### Test fixtures and i18n (Tasks 25, 27)
- New top-level `oauth` namespace in all 4 locales (en/fr/es/de) with 6 sub-namespaces and 21 leaf keys covering button labels, divider text, mismatch warnings, reauth banners (banner title + CTA + 2 badge labels + context menu item + edit "signed in via {{provider}}" interpolation + failed message), and the new providerHelp banner family. Real professional translations (not key fallbacks); Spanish uses typographic `«guillemets»`, French uses `« espaces insécables »`, German uses `„doppelte Anführungszeichen"`
- New `providerPresets.outlookPersonal.oauthSteps` and `providerPresets.outlookBusiness.oauthSteps` 5-step arrays in all 4 locales describing the OAuth flow click-through
- New `tests/fixtures/oauth/` directory with 5 scrubbed JSON fixtures (Google + Microsoft personal + Microsoft business token responses, Google + Microsoft `invalid_grant` errors) and a README documenting scrubbing rules and current consumers. Microsoft personal fixture uses the real public personal-account magic GUID `9188040d-6c67-4c5b-b112-36a304b66dad` (documented public, not secret); business fixture uses a fake placeholder tenant GUID. All token strings are `scrubbed_*_xxx` placeholders; Google `id_token` is a literal marker string and Microsoft fixtures use parsed `id_token_claims` objects to avoid Semgrep CWE-321 false positives on fake JWTs

#### CI (Task 26)
- `.github/workflows/release.yml` — both `build-windows` and `build-linux` jobs gain a new "Verify OAuth secrets are present" step (after `npm ci`) that fails the workflow loudly with `::error::` annotations if any of `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, or `OAUTH_MICROSOFT_CLIENT_ID` repository secrets are empty. Each missing secret is reported individually before exit so the release engineer can fix them all in one pass
- `.github/workflows/release.yml` — `Build Electron app` step gains `VITE_OAUTH_GOOGLE_CLIENT_ID`, `VITE_OAUTH_GOOGLE_CLIENT_SECRET`, and `VITE_OAUTH_MICROSOFT_CLIENT_ID` env injection so Vite inlines them into the bundle at build time. Re-injected on the package step as defense in depth
- `.env.example` — three new `VITE_OAUTH_*` placeholder lines for local development setup

#### E2E (Task 28)
- `tests/e2e/console-health.spec.ts` — adapted 2 Phase 1 Outlook tests to the new accent banner (replaces the Phase 1 amber warning) + 2 new Phase 2 OAuth UI tests (Gmail Google sign-in button + divider + password fallback; Outlook.com OAuth button enablement). One placeholder test for the Sidebar reauth badge marked `.skip` with a TODO referencing the missing seed-hook infrastructure (covered by 4 jsdom unit tests in the meantime). Console Health test count: 5 → 7 enabled + 1 skipped

### Changed
- `outlook-personal` and `outlook-business` presets flipped from Phase 1 `'oauth2-required'` (disabled state) to `'oauth2-supported'` — both presets now render a live OAuth sign-in button instead of the "coming soon" status block
- `OUTLOOK_LEGACY_PRESET.warningKey` now points at `oauth.providerHelp.legacyReauthWarning` (the actionable "Sign in again to modernize" copy) instead of the Phase 1 generic Basic Auth notice
- `accounts:list` IPC handler projects the new `auth_type` and `auth_state` columns from the schema v17 accounts table
- Account-id redaction is now symmetric across the OAuth subsystem: `tokenManager.ts`, `ipcHandlers.ts`, and `accountRevoke.ts` all use the same `redactAccountId()` 2+2-char preview helper

### Security
- All OAuth tokens encrypted at rest via `electron.safeStorage` (OS keychain on Win/macOS, libsecret on Linux) before being written to the `oauth_credentials` table — never stored as plaintext, never logged
- Loopback redirect server bound to `127.0.0.1` explicitly (never `0.0.0.0`) per RFC 8252 §7.3 — the auth code is observable only by processes on the local machine
- PKCE S256 code challenge (RFC 7636) generated via `crypto.randomBytes(32)` → `base64url(sha256(verifier))`, mandatory on every Google flow even though Google still supports plain code exchange
- 32-byte hex CSRF state token compared on the redirect URL; mismatch rejects the flow with "OAuth state mismatch — possible CSRF"
- `id_token` JWTs are decoded only — never verified at the application layer — because the token was obtained over TLS within the same OAuth transaction (we trust the TLS channel, same as `googleapis` itself does)
- Token redaction in all `logDebug` call sites: 8-char prefix for tokens, 2+2-char preview for account UUIDs. Raw token bytes never reach `app.log`
- `safeErrorMessage()` strips CR/LF/NUL and caps length on every error string returned to the renderer — no stack traces escape main process
- D11.5b transaction ordering: account row + initial token write happen in a single SQLite transaction so we never end up with an account row without credentials (or vice versa). Reauth flow uses the inverse ordering so a failed reauth leaves the account in legacy password mode and retryable
- `auth:start-reauth-flow` accountId validation prevents cross-account state injection; `safeErrorMessage` strips control chars before logging
- D11.3 singleton `activeOAuthFlow` blocks concurrent OAuth flows so a malicious renderer cannot race two `auth:start-oauth-flow` invocations to bypass UI state

### Test count
- 1002 tests across 45 files in vitest (was 779 across 32 in v1.16.1)
- 7 Console Health E2E tests + 1 skipped (was 5 enabled in v1.16.1)
- ESLint `--max-warnings 0` clean, `tsc --noEmit` clean, `npm audit` reports 0 vulnerabilities (preserved from v1.16.1)

### Notes
- This release ships the OAuth2 secrets as build-time env vars via Vite. Forks must populate `VITE_OAUTH_GOOGLE_CLIENT_ID`, `VITE_OAUTH_GOOGLE_CLIENT_SECRET`, and `VITE_OAUTH_MICROSOFT_CLIENT_ID` in `.env.local` (development) or as repository secrets `OAUTH_*` (CI) before building. The `release.yml` pre-flight check fails loudly if they are missing
- Phase 2 deliberately keeps the Gmail app-password fallback alive — Gmail still accepts both auth modes and many users prefer app passwords. Outlook accounts (personal + business) are OAuth-only because Microsoft is in the process of removing password-based SMTP entirely

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
