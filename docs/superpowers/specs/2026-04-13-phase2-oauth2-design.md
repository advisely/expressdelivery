# Phase 2 — OAuth2 for Gmail and Microsoft

**Date:** 2026-04-13
**Status:** Draft (pending user review of this spec)
**Phase:** 16 → 17 prep
**Related:** Phase 1 Provider Auth Guidance (`2026-04-12-phase1-provider-auth-guidance-design.md`)

---

## 1. Summary

Add real OAuth2 support to ExpressDelivery for Google (Gmail personal) and Microsoft (both Microsoft 365 work/school and personal Outlook.com / hotmail / live / msn). Phase 1 disabled the new-account path for Outlook presets and left a "Use Other / Custom instead" escape hatch because OAuth2 was not yet implemented; Phase 2 closes that gap and ships the real flow.

The implementation covers four large pieces:

1. **Browser-based OAuth2 authorization flow** for both providers, using the loopback redirect pattern + system browser (RFC 8252 compliant — the only pattern both Google and Microsoft allow in 2026).
2. **Token storage and refresh lifecycle** via a new `AuthTokenManager` service with per-account refresh deduplication, JIT pre-flight validation, and on-401 reactive retry.
3. **Dual send paths** — XOAUTH2 SASL via Nodemailer for Google and Microsoft 365 business accounts (continuing to use SMTP), and a new Microsoft Graph API `POST /me/sendMail` path for personal Outlook accounts (where SMTP Basic Auth has been removed and OAuth2 SMTP on personal is being phased out).
4. **In-place re-authentication migration** for legacy Outlook accounts created in v1.16.x, preserving all account-linked local state (emails, folders, drafts, tags, rules, contacts).

Yahoo and iCloud do not change — they continue to use the app-password flow shipped in v1.16.0 because neither provider offers OAuth2 for third-party mail clients.

The Phase 2 implementation is meaningfully larger than Phase 1: new schema (one DB migration + one data migration), four new modules, two modified modules, four new IPC channels, three new i18n key sub-trees, expanded test infrastructure (nock-based protocol tests + new fixture files), and a new build-time environment variable injection step. Estimated implementation effort: 2-4 weeks of focused development plus a 4-12 week parallel calendar window for Google's OAuth verification review.

## 2. Scope

### In scope

- Google OAuth2 sign-in for Gmail personal accounts via `https://accounts.google.com/o/oauth2/v2/auth` with PKCE
- Microsoft OAuth2 sign-in for both Microsoft 365 business and personal Microsoft accounts (hotmail.com, outlook.com, live.com, msn.com) via Microsoft Entra `common` tenant authority
- Loopback redirect (`http://127.0.0.1:<random-port>/callback`) using the system browser launched via `shell.openExternal`
- New `AuthTokenManager` singleton service in main process with per-account refresh dedup
- New `electron/oauth/google.ts` provider adapter wrapping `google-auth-library`
- New `electron/oauth/microsoft.ts` provider adapter wrapping `@azure/msal-node`
- New `electron/sendMail.ts` dispatcher that routes outbound mail to either `electron/smtp.ts` (Nodemailer XOAUTH2 / password) or new `electron/graphSend.ts` (Microsoft Graph)
- New `electron/graphSend.ts` module implementing `POST /me/sendMail` via raw `fetch()` for personal Outlook accounts
- Modified `electron/smtp.ts` with an XOAUTH2 branch in its auth setup
- Modified `electron/imap.ts` (`AccountSyncController`) to fetch tokens via `AuthTokenManager` for OAuth accounts and pass them to IMAPFlow
- New SQLite schema (`oauth_credentials` table + `accounts.auth_type` + `accounts.auth_state` columns) via migration 16
- Data migration (migration 17) marking existing `provider='outlook'` accounts as `auth_state = 'recommended_reauth'` without touching their stored basic-auth credentials
- New OnboardingScreen credentials step layout: OAuth sign-in button + (for Gmail only) existing app-password form below
- New SettingsModal account add/edit flows mirroring the OnboardingScreen layout
- New sidebar reauth indicators (yellow for `recommended_reauth`, red for `reauth_required`) with three entry points to the re-auth flow
- New IPC channels for OAuth flow lifecycle, token retrieval, account state queries, and re-auth start
- New i18n keys for OAuth UI copy in all four supported locales (`en`, `fr`, `es`, `de`)
- New build-time Vite `define` injection of OAuth client IDs from environment variables
- New layered test strategy: `vi.mock()` for orchestration layers + `nock` for protocol-layer integration tests + new fixture files in `tests/fixtures/oauth/`
- New E2E coverage for OAuth UI presence (sign-in button renders, click fires expected IPC, mocked success advances wizard)
- New `release.yml` pre-package check for required OAuth env vars

### Explicit non-goals

- Yahoo OAuth2 (Yahoo does not offer OAuth2 for third-party mail clients)
- iCloud OAuth2 (Apple does not offer OAuth2 for third-party mail clients)
- User-supplied OAuth client credentials in Settings UI (deferred — see §17 Open Risks for the 100-user test mode cap discussion)
- Replacing the existing app-password flow for Gmail (kept as fallback for orgs that block OAuth consent)
- Calendar, Contacts, or Drive Graph API integration (Phase 2 only ships `Mail.Send` for Microsoft Graph)
- Multi-account-per-OAuth-flow selection (the Google account chooser screen handles this naturally; we don't need a custom picker)
- Background pre-emptive token refresh via timer (we use JIT pre-flight checks instead, see Decision D5.1)
- Account-level OAuth scope customization — the requested scope set is fixed at the architecture level
- macOS / Linux signing (still TBD — out of scope for Phase 2)

## 3. Architectural Decisions

This spec is the result of a brainstorming session that locked ~50 explicit decisions. The decisions are grouped by topic below, numbered with stable IDs (`D<n>.<m>`) so the implementation plan and review checklists can reference them precisely.

### 3.1 Scope (Q1)

- **D1.1** — Phase 2 covers Google personal + Microsoft 365 business + Microsoft personal (hotmail/outlook/live/msn).
- **D1.2** — Yahoo and iCloud remain on the app-password flow shipped in v1.16.0. No changes to those preset flows.
- **D1.3** — Personal Microsoft accounts use a dual transport: IMAP receive via XOAUTH2 (same pipe as business), and Microsoft Graph API `POST /me/sendMail` for the send path (because SMTP Basic Auth on personal accounts was removed April 30, 2026 and OAuth2 SMTP on personal is being progressively phased out by Microsoft).

### 3.2 OAuth client registration strategy (Q2)

- **D2.1** — Hybrid registration. ExpressDelivery owns the Google Cloud project and the Microsoft Entra app registration. Client IDs are bundled into the binary at build time.
- **D2.2** — Ship in Google's "unverified" state at v1.17.0 release time. File the OAuth verification review with Google in parallel with implementation. When approved, flip a build-time flag and ship a v1.17.x patch that removes the unverified warning.
- **D2.3** — Microsoft Entra app registration is multi-tenant with `signInAudience: AzureADandPersonalMicrosoftAccount` and ships verified from day 1 (no formal review needed for basic Mail.Send/Mail.Read scopes).
- **D2.4** — Accept the 100-user-per-day Google test-mode cap as a known interim risk for the verification review window. Track in §17 Open Risks. Do not ship a user-supplied-credentials escape hatch in v1.17.0 (deferred per D10.6).

### 3.3 OAuth flow mechanism (Q3)

- **D3.1** — Loopback IP redirect (`http://127.0.0.1:<random-port>/callback`) with PKCE is the only OAuth flow used. This is the only pattern both Google and Microsoft allow in 2026.
- **D3.2** — System browser launch via `shell.openExternal()`. No embedded BrowserWindow, no custom protocol scheme. Both providers actively block embedded webviews; both deprecated custom URI schemes for installed apps.
- **D3.3** — Microsoft uses `@azure/msal-node`'s built-in `acquireTokenInteractive` API which encapsulates the entire flow (loopback server, PKCE, code exchange). Implementation passes `shell.openExternal` to MSAL via the `openBrowser` callback parameter.
- **D3.4** — Google uses `google-auth-library`'s `OAuth2Client` for protocol primitives. The loopback HTTP server is hand-written using Node's `http.createServer` (~50-80 lines) because Google's first-party `@google-cloud/local-auth` package has different conventions and adds dependency weight that doesn't pay back at our scale.
- **D3.5** — Both flows require a 60-second timeout on the loopback listener. If no callback received within 60s, listener shuts down, surfaces "Sign in cancelled or timed out" toast, returns to credentials step. Listener is closed cleanly via `app.on('before-quit')` handler if app quits during in-flight flow.

### 3.4 Token storage (Q4)

- **D4.1** — Token storage uses a separate `oauth_credentials` table joined to `accounts` via FK CASCADE (the "B-lite" shape from the brainstorm). Reasoning: clear separation, no overloading of `password_encrypted`, room for future provider-specific metadata, JOIN cost is negligible for desktop scale.
- **D4.2** — `accounts.password_encrypted` continues to mean exactly what it did pre-Phase-2: a base64-encoded `safeStorage`-encrypted password for password-mode accounts. Never repurposed for OAuth tokens.
- **D4.3** — `accounts.auth_type` discriminator added with values `'password' | 'oauth2'`. Default `'password'` for migration compatibility.
- **D4.4** — `accounts.auth_state` added with values `'ok' | 'recommended_reauth' | 'reauth_required'`. Default `'ok'`. Stored on `accounts` (NOT on `oauth_credentials`) so legacy password-mode accounts can carry the proactive migration warning state without needing a partial OAuth credential row. See §4 for full schema.
- **D4.5** — `oauth_credentials` table includes `provider_account_email TEXT NULL` as a forward-compat field for matching tokens to provider identity (cheap to add now, painful to add later).

### 3.5 Token refresh lifecycle and ownership (Q5)

- **D5.1** — Refresh strategy: JIT pre-flight check (`expires_at <= now + 60_000`) + on-401 reactive retry. No background timer.
- **D5.2** — `AuthTokenManager` is a singleton service in main process. Public API: `getValidAccessToken(accountId, options?)` and `invalidateToken(accountId, reason?)`. Optional sugar `withFreshToken(accountId, fn)` is implementation-discretionary, not mandatory.
- **D5.3** — Per-account refresh dedup via `Map<number, Promise<TokenResult>>`. Second concurrent caller for the same account awaits the first caller's in-flight promise instead of triggering a duplicate refresh.
- **D5.4** — **Only overwrite stored refresh token if provider returned a new one.** Google rotates refresh tokens occasionally; Microsoft does not. The provider adapter returns `refreshToken?: string` (optional). The manager only writes the new value if defined.
- **D5.5** — Atomic persistence after successful refresh (single SQLite UPDATE wrapped in a transaction).
- **D5.6** — Ownership boundaries: `AuthTokenManager` OWNS reading/writing `oauth_credentials`, refresh decisions, provider adapter dispatch, in-flight dedup, forced invalidation. It does NOT OWN IMAP reconnect logic, SMTP retry policy, or Graph request construction. Those stay in `AccountSyncController` / `smtp.ts` / `graphSend.ts`.
- **D5.7** — Provider files (`electron/oauth/google.ts`, `electron/oauth/microsoft.ts`) are stateless pure adapters. Signature: `refreshAccessToken(refreshToken, clientConfig, metadata?) → Promise<{accessToken, refreshToken?, expiresAt, scope?, tokenType?}>`. Tests can run these in isolation against intercepted HTTP.
- **D5.8** — IMAPFlow and Nodemailer receive `{ type: 'OAuth2', user, accessToken }` configs. The app **never** manually constructs XOAUTH2 SASL blobs (`user=...^Aauth=Bearer ...^A^A`). The libraries handle SASL framing internally.
- **D5.9** — SQLite `oauth_credentials` is the **single source of truth** for OAuth token persistence. No second durable cache anywhere in the system: no MSAL persistent cache on disk, no separate JSON files, no in-memory shadow store outside the per-account dedup map. The Microsoft integration uses the simplest MSAL flow that can refresh from a stored refresh token without introducing a parallel cache. **This spec deliberately does not name a specific MSAL API method** (e.g., `acquireTokenByRefreshToken`) because the exact API surface depends on the `@azure/msal-node` version selected at implementation time — the architectural constraint is "no second durable cache," not "use this specific method."
- **D5.10** — On refresh failure with a **permanent OAuth error** (`invalid_grant`, revoked consent, deleted account on provider side, scope no longer granted, etc.), the account transitions to `auth_state = 'reauth_required'`. The account does NOT enter infinite reconnect/backoff. Transient errors (network timeout, 5xx, rate limit) are NOT permanent — they go through normal reconnect-with-backoff. The discriminator between transient and permanent is the OAuth standard error code returned by the provider (`invalid_grant`, `invalid_client`, etc.) plus a small allowlist of known permanent HTTP statuses.

### 3.6 Send path abstraction (Q6)

- **D6.1** — `electron/sendMail.ts` is the single entry point for outbound mail dispatch. All call sites import `sendMail` from this module. The existing `import { sendEmail } from './smtp.js'` call sites in `main.ts` and elsewhere are migrated.
- **D6.2** — Strict module responsibilities. `smtp.ts` remains SMTP-only (Nodemailer + XOAUTH2). `graphSend.ts` remains Microsoft Graph send-only. `sendMail.ts` performs dispatch only and contains no transport-specific request construction.
- **D6.3** — Unified `Draft` contract. `sendMail.ts` accepts a transport-agnostic normalized draft shape. Each transport implementation converts to its native format internally (Nodemailer Buffer attachments vs Graph base64 attachments).
- **D6.4** — Microsoft Graph send uses raw `fetch()` with a small typed wrapper — NOT `@microsoft/microsoft-graph-client`. Reasoning: one endpoint, smaller dependency surface, lower bundle weight, well-documented stable schema.
- **D6.5** — Unified attachment shape in the dispatcher boundary. `Draft.attachments[]` items carry `{ filename: string, content: Buffer, contentType: string, contentId?: string }`. Nodemailer accepts the Buffer directly; Graph converts to base64 internally.
- **D6.6** — Routing decision is based on persisted classification (`oauth_credentials.provider`), not by probing token claims at send time. Classification happens once during account setup / OAuth completion via `id_token.tid` (see D6.7) and is stored. Send-time routing is a single SQL lookup.
- **D6.7** — OAuth classification of Microsoft account type is authoritative via `id_token.tid` (tenant ID claim). The magic GUID `9188040d-6c67-4c5b-b112-36a304b66dad` indicates a personal Microsoft account; any other GUID indicates a real Entra tenant (work/school). Classification result lives in `oauth_credentials.provider` as `'google' | 'microsoft_personal' | 'microsoft_business'`.
- **D6.8** — Post-OAuth silent reconciliation updates `accounts.provider` to match the classified Microsoft account type. If a user clicked "Outlook (Personal)" in onboarding but signed in with their work account, `accounts.provider` is updated to `outlook-business` after OAuth completes. No user-visible error; the preset selection is just a UI label.

### 3.7 UI integration (Q7)

- **D7.1** — UI shape: for OAuth-capable providers, add a provider-specific OAuth sign-in button at the top of the existing credentials step. Do NOT add a separate auth-method step. The 4-step onboarding wizard (welcome / provider / credentials / server) stays at 4 steps.
- **D7.2** — Gmail credentials step layout: `Sign in with Google` primary button → short recommendation note → existing `ProviderHelpPanel` (app-password steps) → `Or use an app password` divider → existing email+password form. Both paths visible; OAuth is recommended; app-password is preserved for orgs that block OAuth consent.
- **D7.3** — Outlook Personal credentials step layout: `Sign in with Microsoft` primary button → updated `ProviderHelpPanel` with new short note (no app-password steps anymore — there is no app-password fallback for personal Outlook post-April-30-2026) → "Use Other / Custom instead" tertiary fallback button retained from Phase 1. Warning banner stays but with updated copy.
- **D7.4** — Outlook Business credentials step layout: `Sign in with Microsoft` primary button → updated `ProviderHelpPanel` with new short note → "Use Other / Custom instead" tertiary fallback. No warning banner (April-30 deadline only applied to personal accounts).
- **D7.5** — Yahoo / iCloud / Custom: completely unchanged from Phase 1.
- **D7.6** — `ProviderHelpPanel` remains the shared component. It evolves to support OAuth notes and provider-specific button labels/content. It is not replaced.
- **D7.7** — SettingsModal account add/edit flows mirror the OnboardingScreen credentials step layout exactly. The same OAuth button surface is rendered in both places, dispatching the same IPC channel.

### 3.8 Legacy outlook account migration (Q8)

- **D8.1** — Migration state model: `accounts.auth_state TEXT NOT NULL DEFAULT 'ok'` with values `'ok' | 'recommended_reauth' | 'reauth_required'`. Three states, not four. Same yellow state for both personal and business legacy outlook accounts; provider-specific copy differentiates the message. Sidebar indicator priority order (highest to lowest): `reauth_required` (red) → existing sync error (red) → existing stale-sync (amber) → `recommended_reauth` (yellow) → existing fresh-sync (green). Yellow only displaces the green "fresh" state — a stale sync (amber) is a more urgent signal because the user can't currently receive mail at all, while `recommended_reauth` is a "should re-auth soon" advisory. See §9.3 for the rendering rules.
- **D8.2** — In-place re-auth is mandatory and non-negotiable. Single SQLite transaction that preserves `accounts.id` and ALL FK-related rows (`emails`, `folders`, `drafts`, `tags`, `email_tags`, `mail_rules`, `contacts`, `attachments`, `snoozed_emails`, `scheduled_sends`, `reminders`). Transaction contents and ordering: insert `oauth_credentials` row, update `accounts.auth_type = 'oauth2'`, update `accounts.provider` per silent reconciliation (D6.8), update `accounts.auth_state = 'ok'`, set `accounts.password_encrypted = NULL`, commit. **The `password_encrypted = NULL` step happens LAST**, after OAuth tokens are successfully persisted. If the OAuth flow fails mid-transaction, rollback leaves the legacy basic auth password intact.
- **D8.3** — Ambiguous-domain edge case: classification is non-destructive. Email matching `/@(outlook|hotmail|live|msn)\.com$/i` gets personal CTA copy; otherwise business/ambiguous gets generic Microsoft reauth copy. No hard-fail on domain heuristic. Real classification settles via `id_token.tid` after OAuth completes.
- **D8.4** — Migration 17 (the data migration; the column add lives in migration 16): sets `auth_state = 'recommended_reauth'` for all rows where `provider = 'outlook'`, does NOT touch `password_encrypted`, does NOT touch `auth_type`, does NOT create `oauth_credentials` rows.
- **D8.5** — Phase 1's `OUTLOOK_LEGACY_PRESET` and the `getPresetForAccount` resolver remain intact in Phase 2. Legacy `provider='outlook'` accounts continue to resolve to `OUTLOOK_LEGACY_PRESET` for the SettingsModal edit flow's preset display (icon, label, host fields) until the user completes in-place re-auth. After successful re-auth per D8.2, `accounts.provider` is updated to `outlook-personal` or `outlook-business` (silent reconciliation per D6.8) and the resolver naturally returns the new preset on subsequent reads. Some users may never re-auth their business outlook accounts (basic auth may continue to work for them indefinitely), so `OUTLOOK_LEGACY_PRESET` cannot be removed in Phase 2 — it stays as the backwards-compat anchor for any legacy row that lingers in `provider='outlook'` state.

### 3.9 Test strategy (Q9)

- **D9.1** — Layered test strategy: pure Vitest with `vi.mock()` for orchestration layers (`AuthTokenManager`, `sendMail.ts`, `AccountSyncController` integration); `nock` HTTP interception for protocol-layer integration tests (`google.ts`, `microsoft.ts`, `graphSend.ts`).
- **D9.2** — No real provider traffic in CI. Google and Microsoft endpoints are never hit from automated tests. All tests run hermetic.
- **D9.3** — E2E scope stays UI/integration only. Playwright Console Health verifies: OAuth buttons render on the credentials step, click fires the expected IPC channel, the in-flight state disables the button, mocked success/failure advances the wizard or surfaces an error correctly. E2E does not attempt real OAuth consent flows.
- **D9.4** — `safeStorage` remains mocked in Vitest per the existing `tests/setup.ts` pattern. Provider adapter tests work with raw token strings; encryption/decryption is covered at the manager layer.
- **D9.5** — OAuth/Graph protocol tests use committed scrubbed fixtures derived from real responses. Source: captured from real successful and error responses once during implementation. Sanitization: remove/redact tokens, client IDs, account identifiers, tenant-specific values. Storage: committed under `tests/fixtures/oauth/`. Each fixture file is a small human-readable JSON document, ~30-80 lines. Documentation: a brief README in `tests/fixtures/oauth/README.md` explains how to capture new fixtures and the redaction checklist.
- **D9.6** — Library-boundary tests vs wire-shape tests: provider adapter tests have two assertion modes. For thin wrappers around `msal-node` and `google-auth-library`, assertions are at the library boundary (inputs to / outputs from the wrapper). For `graphSend.ts` (raw `fetch`), assertions are wire-shape: HTTP method, URL, headers, JSON body shape, attachment base64 encoding, response parsing, error mapping.

### 3.10 OAuth client ID embedding (Q10)

- **D10.1** — OAuth client values are injected at build time via Vite `define` plugin reading from environment variables (`VITE_OAUTH_GOOGLE_CLIENT_ID`, `VITE_OAUTH_GOOGLE_CLIENT_SECRET`, `VITE_OAUTH_MICROSOFT_CLIENT_ID`).
- **D10.2** — Missing OAuth env vars are tolerated in non-release CI builds. The `ci.yml` workflow does not require these secrets — tests are mocked and don't exercise the OAuth client config.
- **D10.3** — Validation of OAuth client config is **lazy**, only executed when OAuth functionality is actually initialized. The `clientConfig.ts` module exports accessor functions (`getGoogleOAuthConfig()`, `getMicrosoftOAuthConfig()`) that throw a clear actionable error only at call time. **No top-level throw at module evaluation** — that would crash unrelated code paths that happen to import the module indirectly.
- **D10.4** — Release builds fail fast if required OAuth env vars are missing. The `release.yml` workflow includes an explicit pre-package check that verifies `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_MICROSOFT_CLIENT_ID` are present before invoking electron-builder.
- **D10.5** — Repo includes `.env.example` with placeholder OAuth vars and setup guidance for local development. `.env.local` is added to `.gitignore` if not already.
- **D10.6** — User-supplied custom OAuth credentials in Settings UI is OUT OF SCOPE for v1.17.0 and tracked as a future enhancement if Google's test-mode cap becomes a real adoption blocker during the verification review window.

### 3.11 Edge cases (Q11)

- **D11.1** (E1) — Token revocation on account delete: best-effort, time-bounded (5-second timeout per provider call), provider-asymmetric:
  - **Google** has a clean per-token revoke endpoint: `POST https://oauth2.googleapis.com/revoke?token=<refresh_token>`. Phase 2 calls this on account delete. Wrapped in try/catch with explicit 5s timeout. Revocation failure does NOT block the local DB delete.
  - **Microsoft** does NOT have a clean per-token revoke endpoint. The closest API is `POST https://graph.microsoft.com/v1.0/me/revokeSignInSessions`, which is **nuclear** — it revokes ALL refresh tokens for that user across every app, not just ours. We will NOT call it. Instead, on Microsoft account delete, Phase 2 simply deletes the local `oauth_credentials` row and lets the refresh token age out naturally on Microsoft's side (refresh tokens have a default lifetime of 90 days for inactive use). The implementer should leave a code comment in the delete handler explaining why no Microsoft revoke call is made.
  - All revocation outcomes (success, failure, skipped-for-microsoft) are logged via `logDebug()` with `[OAUTH]` prefix per D11.10.
- **D11.2** (E2) — OAuth flow user-cancellation handling: 60-second loopback listener timeout. Timeout and user-abort are treated as **non-error UX states** (no scary toast — informational message "Sign in cancelled or timed out") but still logged with `[OAUTH]` for diagnostics.
- **D11.3** (E3) — Concurrent OAuth flow handling: singleton in-flight flow per app instance via `let activeOAuthFlow: { provider, accountId, abortController } | null = null` in the manager. Second click is rejected via toast "Another sign-in is in progress"; the new "Sign in" button is disabled while a flow is active.
- **D11.4** (E4) — Re-auth email mismatch: hard reject. Read `id_token.email` (or `preferred_username` for Microsoft) and compare against `accounts.email`. If mismatch, abort the in-place re-auth, surface clear error toast naming both addresses, roll back any token writes, leave the legacy account in `recommended_reauth` state. Adding the second account separately via "Add account" remains supported.
- **D11.5** (E5) — Initial signup credentials step email-field rules differ by provider, because Gmail keeps its dual-path layout per D7.2 while Microsoft is OAuth-only:
  - **Microsoft (Outlook Personal / Outlook Business)** — OAuth-only; the credentials step has **no email field**. The `Sign in with Microsoft` button is the only input. `accounts.email` is populated from the `id_token.email` (or `preferred_username`) claim after OAuth completion.
  - **Gmail** — Dual-path; the credentials step keeps the existing email + password form visible below the "Sign in with Google" button + "Or use an app password" divider per D7.2. The email field is part of the app-password fallback flow only. When the user clicks "Sign in with Google", the email field input is ignored (if any) and `accounts.email` is populated from the `id_token.email` claim. When the user fills in the form and submits the password-mode flow, the email field value is used as `accounts.email` directly.
  - **Universal rule for OAuth completion paths**: `accounts.email` always comes from the provider identity (`id_token.email`), never from a pre-entered form field, regardless of which provider.
- **D11.5b** — Account creation timing for OAuth signup: the new `accounts` row is created **only after successful OAuth completion**, never provisionally before the system browser launches. Phase 2 does NOT pre-allocate an account row with a placeholder `accounts.id` and then update it after the OAuth flow returns. The full OAuth flow (browser launch → consent → callback → token exchange → id_token classification per D6.7 → silent reconciliation per D6.8) runs first, and the resulting `accounts` row + `oauth_credentials` row are inserted in a single transaction at the end. Cancellation, timeout, or error during any step leaves the database completely untouched. This avoids orphaned partial accounts and simplifies cancellation semantics. The `accounts.id` is generated server-side (in the IPC handler) immediately before the insert, not at flow start time. Re-auth flows (D8.2) are different — they update an existing row in-place rather than creating a new one.
- **D11.6** (E6) — Google refresh token rotation: covered by D5.4 (only overwrite if returned) + D5.10 (permanent failure transitions to reauth_required). No additional logic needed.
- **D11.7** (E7) — Microsoft scopes requested at signup (no incremental consent prompts):
  - `https://outlook.office.com/IMAP.AccessAsUser.All` (IMAP receive)
  - `https://outlook.office.com/SMTP.Send` (SMTP send for business; ignored on personal)
  - `https://graph.microsoft.com/Mail.Send` (Graph send for personal)
  - `offline_access` (refresh tokens)
  - `openid profile email` (id_token + tid claim for classification per D6.7)
  - The implementer may adjust the exact requested scope set if Microsoft rejects any specific combination differently for personal vs business, **without changing the one-consent-flow design goal**.
- **D11.8** (E8) — Google scopes requested at signup:
  - `https://mail.google.com/` (full IMAP+SMTP — restricted scope, triggers verification review)
  - `openid email profile` (id_token for matching during re-auth per D11.4)
- **D11.9** (E9) — Re-auth flow has three entry points: sidebar account row context menu → "Sign in again", SettingsModal → Accounts → click affected account → "Sign in again" CTA in edit pane, sidebar yellow/red badge → click → opens flow. All three call the same IPC channel `auth:start-reauth-flow` with `{ accountId }`.
- **D11.10** (E10) — All OAuth errors logged with `[OAUTH]` prefix via `logDebug()`. Never via `console.error` (would surface in Console Health and could fail E2E). Log payload: provider name, error code, redacted account hint (e.g., `b***@hotmail.com`), no full tokens or refresh tokens ever logged. Re-use the existing `sanitizeForLog()` helper from v1.16.1 for any user-controlled strings interpolated into log messages.

## 4. Data Model

**Verified facts about the existing schema (verified against `electron/db.ts` at v1.16.1):**

- `accounts.id` is `TEXT PRIMARY KEY`, not `INTEGER`. All FK columns referencing it use `TEXT`.
- The encrypted password column is named `password_encrypted`, not `password_enc`. It is `TEXT`, storing base64-encoded bytes from `safeStorage.encryptString().toString('base64')`. The decrypt pattern in `main.ts:329` is `decryptData(Buffer.from(row.password_encrypted, 'base64'))`.
- `CURRENT_SCHEMA_VERSION` at v1.16.1 is **15**, not 12. Phase 2 must bump to **17** after applying both new migrations.
- The next free migration numbers are **16** and **17**, not 13 and 14.

These corrections were caught during spec review and are embedded throughout the rest of the spec.

### 4.1 New columns on `accounts` (added by migration 16)

```sql
ALTER TABLE accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'password';
ALTER TABLE accounts ADD COLUMN auth_state TEXT NOT NULL DEFAULT 'ok';
```

- `auth_type`: `'password' | 'oauth2'`. Discriminates which credential lookup path to use. Default `'password'` preserves existing v1.16.x rows in their current mode.
- `auth_state`: `'ok' | 'recommended_reauth' | 'reauth_required'`. Default `'ok'`. Drives sidebar badge color and re-auth CTA visibility.

### 4.2 New `oauth_credentials` table (added by migration 16)

```sql
CREATE TABLE oauth_credentials (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    -- provider is logically constrained to one of: 'google', 'microsoft_personal',
    -- 'microsoft_business'. SQLite does not enforce enums; the constraint is
    -- enforced in the application code (electron/db.ts insertOAuthCredential).
    provider TEXT NOT NULL,
    -- Tokens are stored as base64-encoded TEXT, matching the existing
    -- accounts.password_encrypted convention. The encode pattern is
    -- safeStorage.encryptString(token).toString('base64'). Decode is
    -- decryptData(Buffer.from(row.access_token_encrypted, 'base64')).
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    expires_at INTEGER NOT NULL,               -- epoch ms when access_token expires
    scope TEXT,                                -- granted scope string from token response
    token_type TEXT,                           -- usually 'Bearer'
    provider_account_email TEXT,               -- email from id_token, for matching during re-auth
    provider_account_id TEXT,                  -- sub claim from id_token, stable user id
    created_at INTEGER NOT NULL,               -- epoch ms
    updated_at INTEGER NOT NULL                -- epoch ms, updated on every refresh
);

-- accounts.auth_state is also logically constrained — see D4.4 in §3.4 for
-- the value space. Application code in electron/db.ts setAuthState enforces it.

CREATE INDEX idx_oauth_credentials_provider ON oauth_credentials(provider);
```

- `account_id` is both PK and FK to `accounts(id)` with cascade delete. **`TEXT`, not `INTEGER`** — matches the existing `accounts.id TEXT PRIMARY KEY`. One row per account; deleting the account removes its OAuth credential row atomically.
- `provider` is the **classified** provider, not the user's preset selection. Read this field for send-path routing per D6.6.
- `access_token_encrypted` and `refresh_token_encrypted` are base64-encoded `TEXT` columns following the same `safeStorage` + base64 pattern as `accounts.password_encrypted`. Storing as TEXT (not BLOB) is the established convention in this codebase.
- `expires_at` is epoch milliseconds. JIT pre-flight check is `expires_at <= Date.now() + 60_000`.
- `provider_account_email` and `provider_account_id` are used for the re-auth email mismatch check (D11.4) and as a forward-compat hook for future per-provider-account features (D4.5).

### 4.3 Migration 17 (data migration for legacy outlook accounts)

```sql
-- Migration 17: mark legacy Outlook accounts as recommended_reauth without
-- touching their stored basic-auth credentials. The password stays valid and
-- usable until either (a) Microsoft rejects it server-side and D5.10 transitions
-- the account to 'reauth_required', or (b) the user clicks "Sign in again" and
-- the in-place re-auth flow (D8.2) clears it as part of the OAuth swap.
UPDATE accounts
   SET auth_state = 'recommended_reauth'
 WHERE provider = 'outlook'
   AND auth_state = 'ok';
```

This migration runs once at startup of v1.17.0 and is a no-op on subsequent runs. It does NOT touch `password_encrypted`, `auth_type`, or any other column. It does NOT create `oauth_credentials` rows for legacy accounts (those rows only exist after a successful OAuth flow).

### 4.4 `CURRENT_SCHEMA_VERSION` bump

`electron/db.ts` increments `CURRENT_SCHEMA_VERSION` from **15 to 17** (one migration adds schema, the second performs the data update; both new versions are applied sequentially by the existing migration runner). The runner short-circuits at the new version per the existing pattern.

## 5. `AuthTokenManager` Service

### 5.1 File layout

```
electron/auth/
├── tokenManager.ts          # singleton service (~250 lines)
├── google.ts                # provider adapter (~150 lines)
├── microsoft.ts             # provider adapter (~120 lines, mostly MSAL passthrough)
├── clientConfig.ts          # build-time injected client IDs with lazy accessors (~50 lines)
├── tokenManager.test.ts     # Vitest unit tests (~200 lines)
├── google.test.ts           # nock-based protocol tests (~150 lines)
└── microsoft.test.ts        # vi.mock + boundary tests (~100 lines)
```

### 5.2 Public API

```ts
export interface ValidTokenResult {
    accessToken: string;
    expiresAt: number;
}

export interface AuthTokenManager {
    /**
     * Returns a valid access token for the given account, refreshing if the
     * cached token is within 60s of expiry. Throws if the account is not OAuth,
     * if no refresh token exists, or if the provider returned a permanent error.
     * Per-account refresh dedup ensures concurrent callers share the same
     * in-flight refresh promise.
     */
    getValidAccessToken(accountId: string, options?: { forceRefresh?: boolean }): Promise<ValidTokenResult>;

    /**
     * Marks the cached token for the given account as invalid. Next call to
     * getValidAccessToken will trigger a refresh. Used by the on-401 reactive
     * retry path in AccountSyncController and smtp.ts.
     */
    invalidateToken(accountId: string, reason?: string): void;

    /**
     * Persists a fresh OAuth credential row, used by the initial OAuth signup
     * flow and the in-place re-auth flow. Wraps the SQLite upsert in a
     * transaction with the accounts row update per D8.2.
     */
    persistInitialTokens(params: {
        accountId: string;
        provider: 'google' | 'microsoft_personal' | 'microsoft_business';
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        scope?: string;
        tokenType?: string;
        providerAccountEmail?: string;
        providerAccountId?: string;
    }): Promise<void>;
}

export const authTokenManager: AuthTokenManager;
```

Note: `accountId` is `string` throughout because `accounts.id` is `TEXT PRIMARY KEY` in the existing schema. All Phase 2 code paths preserve this.

### 5.3 Per-account refresh dedup

```ts
const inFlightRefreshes = new Map<string, Promise<ValidTokenResult>>();

async function getValidAccessToken(accountId: string, options?): Promise<ValidTokenResult> {
    // Read current token from SQLite via getOAuthCredential(accountId)
    const cred = getOAuthCredential(accountId);
    if (!cred) throw new Error(`No OAuth credential for account ${accountId}`);

    const now = Date.now();
    if (!options?.forceRefresh && cred.expiresAt > now + 60_000) {
        return { accessToken: cred.accessToken, expiresAt: cred.expiresAt };
    }

    // Check for in-flight refresh; second caller awaits the first
    let promise = inFlightRefreshes.get(accountId);
    if (!promise) {
        promise = doRefresh(accountId, cred).finally(() => {
            inFlightRefreshes.delete(accountId);
        });
        inFlightRefreshes.set(accountId, promise);
    }
    return promise;
}
```

The `finally` cleanup ensures the map entry is removed even on refresh failure, so a subsequent call after a transient failure can start a new refresh attempt.

### 5.4 Provider dispatch

```ts
async function doRefresh(accountId: string, cred: OAuthCredential): Promise<ValidTokenResult> {
    let result;
    try {
        if (cred.provider === 'google') {
            result = await googleAdapter.refreshAccessToken(cred.refreshToken, getGoogleOAuthConfig());
        } else if (cred.provider === 'microsoft_personal' || cred.provider === 'microsoft_business') {
            result = await microsoftAdapter.refreshAccessToken(cred.refreshToken, getMicrosoftOAuthConfig());
        } else {
            throw new Error(`Unknown OAuth provider: ${cred.provider}`);
        }
    } catch (err) {
        if (isPermanentOAuthError(err)) {
            setAuthState(accountId, 'reauth_required');
            logDebug(`[OAUTH] permanent error for account ${redactAccount(accountId)}: ${sanitizeForLog(err)}`);
        } else {
            logDebug(`[OAUTH] transient error for account ${redactAccount(accountId)}: ${sanitizeForLog(err)}`);
        }
        throw err;
    }

    // Persist atomically; D5.4 only overwrites refresh token if provided
    persistRefreshedTokens(accountId, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken, // may be undefined; persistRefreshedTokens handles
        expiresAt: result.expiresAt,
    });

    return { accessToken: result.accessToken, expiresAt: result.expiresAt };
}
```

### 5.5 Permanent vs transient OAuth error classification

```ts
const PERMANENT_OAUTH_ERRORS = new Set([
    'invalid_grant',           // refresh token revoked or expired
    'invalid_client',          // client ID/secret mismatch
    'unauthorized_client',     // client not authorized for this grant
    'invalid_scope',           // requested scope no longer granted
    'access_denied',           // user revoked consent
]);

function isPermanentOAuthError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { error?: string; code?: string; status?: number };
    if (e.error && PERMANENT_OAUTH_ERRORS.has(e.error)) return true;
    if (e.code && PERMANENT_OAUTH_ERRORS.has(e.code)) return true;
    return false;
}
```

Network errors, 5xx responses, rate limiting (429), and timeouts are all transient by definition — they don't match the permanent set and fall through to normal reconnect-with-backoff.

## 6. Provider Adapters

### 6.1 `electron/oauth/google.ts`

Stateless functions wrapping `google-auth-library`'s `OAuth2Client`. Exports:

```ts
export async function startInteractiveFlow(params: {
    onAuthUrl: (url: string) => Promise<void>;  // called with the URL to open in system browser
    abortSignal: AbortSignal;
}): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    idToken: string;  // for parsing email + sub claims
    scope: string;
    tokenType: string;
}>;

export async function refreshAccessToken(
    refreshToken: string,
    clientConfig: GoogleOAuthConfig,
): Promise<{
    accessToken: string;
    refreshToken?: string;  // Google sometimes rotates; D5.4 honors this
    expiresAt: number;
    scope?: string;
    tokenType?: string;
}>;

export async function revokeRefreshToken(refreshToken: string): Promise<void>;
```

Internal flow for `startInteractiveFlow`:
1. Generate PKCE code verifier + challenge using `crypto.randomBytes`
2. Generate state token (random 32-byte hex) for CSRF protection
3. Pick a free port via `net.createServer().listen(0)` then close
4. Start an HTTP server on that port, listening on `127.0.0.1` only (NOT `0.0.0.0`)
5. Construct the auth URL via `OAuth2Client.generateAuthUrl({ scope, code_challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' })`
6. Call `onAuthUrl(url)` (caller invokes `shell.openExternal(url)`)
7. Wait for the callback request on the loopback HTTP server
8. Validate `state` parameter matches, validate `code` parameter present
9. Exchange `code` + `code_verifier` for tokens via `OAuth2Client.getToken(code)`
10. Serve a "You can close this tab" success page (or error page on validation failure)
11. Shut down the HTTP server, abort the timeout
12. Return the tokens
13. On `abortSignal` abort, shut down the HTTP server cleanly and reject with `{ error: 'cancelled' }`
14. On 60-second timeout, shut down and reject with `{ error: 'timeout' }`

The HTTP server only handles the single expected callback path, returns 404 for everything else, and never serves user-controlled content.

### 6.2 `electron/oauth/microsoft.ts`

Thin wrapper around `@azure/msal-node`'s `PublicClientApplication`. Exports the same shape as `google.ts` for consistency, but the implementation is mostly MSAL passthrough:

```ts
export async function startInteractiveFlow(params: {
    onAuthUrl: (url: string) => Promise<void>;
    abortSignal: AbortSignal;
}): Promise<TokenResult & { idTokenClaims: { tid: string; email?: string; preferred_username?: string; sub?: string } }>;

export async function refreshAccessToken(
    refreshToken: string,
    clientConfig: MicrosoftOAuthConfig,
): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    scope?: string;
    tokenType?: string;
}>;

export async function revokeRefreshToken(refreshToken: string): Promise<void>;
```

The `startInteractiveFlow` uses MSAL's `acquireTokenInteractive` API with the `openBrowser` callback wired to `params.onAuthUrl`. MSAL handles the loopback server, PKCE, code exchange, and id_token parsing internally. The wrapper extracts `idTokenClaims.tid`, `idTokenClaims.email`, etc. from the response for D6.7 classification and D11.4 mismatch checks.

The `refreshAccessToken` implementation must satisfy D5.9 (no second durable cache). The exact MSAL API method is implementation-discretionary — the architectural constraint is "refresh from a stored refresh token without introducing a parallel cache." Candidates include `acquireTokenByRefreshToken` (if supported by the chosen MSAL version) or constructing a fresh `PublicClientApplication` per-call without persistent cache plugin.

### 6.3 `electron/oauth/clientConfig.ts`

```ts
// Lazy accessors per D10.3 — never throw at top-level module evaluation.
// Validation happens only when OAuth functionality is actually initialized.

export interface GoogleOAuthConfig {
    clientId: string;
    clientSecret: string;
}

export interface MicrosoftOAuthConfig {
    clientId: string;
    tenantId: 'common';
    authority: 'https://login.microsoftonline.com/common';
}

let cachedGoogleConfig: GoogleOAuthConfig | null = null;
let cachedMicrosoftConfig: MicrosoftOAuthConfig | null = null;

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
    if (cachedGoogleConfig) return cachedGoogleConfig;
    const clientId = import.meta.env.VITE_OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = import.meta.env.VITE_OAUTH_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error(
            'Google OAuth client config is not set. Add VITE_OAUTH_GOOGLE_CLIENT_ID and ' +
            'VITE_OAUTH_GOOGLE_CLIENT_SECRET to .env.local for development. See CONTRIBUTING.md.'
        );
    }
    cachedGoogleConfig = { clientId, clientSecret };
    return cachedGoogleConfig;
}

export function getMicrosoftOAuthConfig(): MicrosoftOAuthConfig {
    if (cachedMicrosoftConfig) return cachedMicrosoftConfig;
    const clientId = import.meta.env.VITE_OAUTH_MICROSOFT_CLIENT_ID;
    if (!clientId) {
        throw new Error(
            'Microsoft OAuth client config is not set. Add VITE_OAUTH_MICROSOFT_CLIENT_ID to ' +
            '.env.local for development. See CONTRIBUTING.md.'
        );
    }
    cachedMicrosoftConfig = {
        clientId,
        tenantId: 'common',
        authority: 'https://login.microsoftonline.com/common',
    };
    return cachedMicrosoftConfig;
}
```

The cached config is module-scoped so repeated calls don't re-validate. The cache is process-lifetime, which is fine because the build-time env vars never change at runtime.

## 7. Send Path

### 7.1 `electron/sendMail.ts` dispatcher

```ts
export interface NormalizedDraft {
    accountId: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    attachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
        contentId?: string;
    }>;
    inReplyTo?: string;
    references?: string[];
}

export interface SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Single entry point for all outbound mail. Routes to either smtp.ts or
 * graphSend.ts based on the account's persisted classification per D6.6.
 */
export async function sendMail(draft: NormalizedDraft): Promise<SendResult> {
    const account = getAccount(draft.accountId);
    if (!account) return { success: false, error: 'Account not found' };

    if (account.auth_type === 'oauth2') {
        const cred = getOAuthCredential(draft.accountId);
        if (!cred) return { success: false, error: 'Missing OAuth credential' };

        if (cred.provider === 'microsoft_personal') {
            // Personal Outlook: SMTP basic auth removed, OAuth2 SMTP being phased out.
            // Use Microsoft Graph /me/sendMail.
            return graphSend.sendViaGraph(draft, account, cred);
        }
        // Google or microsoft_business: Nodemailer with XOAUTH2.
        return smtp.sendViaSmtp(draft, account, /* useOAuth2 */ true);
    }

    // Password-mode account (Gmail app password, Yahoo, iCloud, custom).
    return smtp.sendViaSmtp(draft, account, /* useOAuth2 */ false);
}
```

The dispatcher is ~30 lines of routing code. It contains no transport-specific logic — every call delegates to `smtp.ts` or `graphSend.ts`.

### 7.2 `electron/graphSend.ts`

```ts
import { authTokenManager } from './auth/tokenManager.js';
import { sanitizeForLog } from './utils.js';
import { logDebug } from './logger.js';

const GRAPH_SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';

export async function sendViaGraph(
    draft: NormalizedDraft,
    account: Account,
    cred: OAuthCredential,
): Promise<SendResult> {
    const { accessToken } = await authTokenManager.getValidAccessToken(draft.accountId);

    const body = {
        message: {
            subject: draft.subject,
            body: { contentType: 'HTML', content: draft.bodyHtml },
            toRecipients: draft.to.map(addr => ({ emailAddress: { address: addr } })),
            ccRecipients: draft.cc.map(addr => ({ emailAddress: { address: addr } })),
            bccRecipients: draft.bcc.map(addr => ({ emailAddress: { address: addr } })),
            attachments: draft.attachments.map(att => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: att.filename,
                contentType: att.contentType,
                contentBytes: att.content.toString('base64'),
                ...(att.contentId ? { contentId: att.contentId, isInline: true } : {}),
            })),
        },
        saveToSentItems: true,
    };

    let response;
    try {
        response = await fetch(GRAPH_SEND_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    } catch (err) {
        logDebug(`[OAUTH] [GRAPH-SEND] network error: ${sanitizeForLog(err)}`);
        return { success: false, error: 'Network error sending mail via Graph' };
    }

    if (response.status === 401) {
        // On-401 reactive retry per D5.1; invalidate token and retry once.
        authTokenManager.invalidateToken(draft.accountId, 'graph-send 401');
        const { accessToken: freshToken } = await authTokenManager.getValidAccessToken(draft.accountId, { forceRefresh: true });
        response = await fetch(GRAPH_SEND_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${freshToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    }

    if (!response.ok) {
        const errorBody = await response.text();
        logDebug(`[OAUTH] [GRAPH-SEND] HTTP ${response.status}: ${sanitizeForLog(errorBody)}`);
        return { success: false, error: `Graph send failed: HTTP ${response.status}` };
    }

    // Graph send returns 202 Accepted with no body on success
    return { success: true };
}
```

Wire-shape tests (D9.6) verify: HTTP method POST, exact URL, Bearer header construction, JSON body shape (toRecipients/ccRecipients/bccRecipients format, attachments with `@odata.type`, base64 encoding, `saveToSentItems: true`), 401 retry behavior, error mapping.

### 7.3 `electron/smtp.ts` modifications

The existing `sendEmail` function is renamed to `sendViaSmtp` and gains an `useOAuth2` boolean parameter. When `useOAuth2 === true`, the Nodemailer `auth` config switches from `{ user, pass }` to `{ type: 'OAuth2', user, accessToken }`. The access token is fetched via `authTokenManager.getValidAccessToken(account.id)` immediately before constructing the Nodemailer transporter. On a 535 SMTP response (auth failure), the existing error path triggers `authTokenManager.invalidateToken(account.id)` and the controller's reconnect path retries with a fresh token.

The XOAUTH2 SASL framing is handled entirely by Nodemailer per D5.8 — the application code never touches the raw `user=...^Aauth=Bearer ...^A^A` string.

## 8. AccountSyncController Integration

`electron/imap.ts` `AccountSyncController` is modified in three places:

1. **Connection construction (`connect()`)** — replaces the password lookup with a branch on `account.auth_type`. For OAuth accounts, calls `await authTokenManager.getValidAccessToken(account.id)` and passes `{ type: 'OAuth2', user: account.email, accessToken }` to the IMAPFlow constructor's `auth` field. IMAPFlow handles XOAUTH2 SASL internally.

2. **Reconnect path** — on auth failure (IMAPFlow throws `IMAPError` with category `auth`), checks `account.auth_type`. For OAuth accounts, calls `authTokenManager.invalidateToken(account.id, 'imap auth failure')` before triggering the reconnect-with-backoff loop. The next connect attempt fetches a fresh token. If the second attempt also fails with auth error, D5.10's permanent-error detection in the manager transitions the account to `reauth_required` and the controller stops the reconnect loop.

3. **Heartbeat (NOOP)** — unchanged. NOOP doesn't need a token refresh because IMAPFlow holds the auth state for the duration of the connection. Token expiry mid-IDLE is handled by the on-401 path, not by the heartbeat.

## 9. UI Changes

### 9.1 `OnboardingScreen.tsx` credentials step

For **Gmail**:
1. Render `<button>Sign in with Google</button>` at the top with provider-branded styling
2. Render a short recommendation note: `t('onboarding.signInWithGoogleRecommended')` — "Sign in with Google is the easiest way to add your account."
3. Render existing `<ProviderHelpPanel preset={gmail} />` (app-password steps still useful for orgs that block OAuth)
4. Render an `<hr>` divider with text `t('onboarding.orUseAppPassword')` — "Or use an app password"
5. Render existing email + password form below

For **Outlook Personal / Outlook Business**:
1. Render `<button>Sign in with Microsoft</button>` at the top
2. Render an updated `<ProviderHelpPanel preset={outlookPersonal/Business} />` with new short note (no app-password steps — there are no manual setup instructions for OAuth)
3. Render the "Use Other / Custom instead" tertiary fallback button retained from Phase 1 (kept because some orgs block OAuth consent)
4. The Phase 1 disabled state is removed

For **Yahoo / iCloud / Custom**: completely unchanged.

The "Sign in with Google/Microsoft" buttons dispatch IPC channel `auth:start-oauth-flow` with `{ provider: 'google' | 'microsoft', presetId }`. The button is disabled while a flow is in flight (D11.3). On success, the wizard advances to a confirmation step or directly to the main app. On error or cancellation, the wizard stays on the credentials step with an inline non-error message (D11.2).

### 9.2 `SettingsModal.tsx` account add/edit flows

Mirrors `OnboardingScreen.tsx` exactly for the credentials surface. Both flows use the same `<OAuthSignInButton provider={...} />` component (extracted to `src/components/OAuthSignInButton.tsx`) so the layout stays consistent.

Edit flow gains a new "Sign in again" CTA that's visible when `account.auth_type === 'oauth2'` OR `account.auth_state ∈ {'recommended_reauth', 'reauth_required'}`. Clicking it dispatches `auth:start-reauth-flow` with `{ accountId }` per D11.9.

### 9.3 `Sidebar.tsx` reauth indicators

The existing 3-state staleness indicator (green/amber/red) gains a 4th yellow state for `recommended_reauth` and a stronger red state for `reauth_required`. Priority order: `reauth_required` > sync error > stale > `recommended_reauth` > fresh. The yellow `recommended_reauth` only takes priority over the green "fresh" state, not over actual sync errors.

A new context menu item "Sign in again" appears on right-click for any account with `auth_type === 'oauth2'` or `auth_state !== 'ok'`. Clicking it dispatches `auth:start-reauth-flow`.

The yellow/red badges are also clickable — clicking them is equivalent to the context menu "Sign in again".

### 9.4 `ProviderHelpPanel.tsx` evolution

The component gains support for OAuth-specific copy. New optional props (or new behavior driven by the existing `preset.authModel` field):

- For `authModel === 'password-supported'` providers (Gmail, Yahoo, iCloud): unchanged from Phase 1
- For Gmail specifically with the new OAuth path: same panel content, but a new short note above explaining "Sign in with Google is recommended; the steps below are only needed if your org blocks OAuth consent"
- For `outlook-personal` and `outlook-business`: the Phase 1 "coming soon" message is removed; the warning banner stays for outlook-personal with updated copy ("Microsoft has ended password-based Outlook.com sending — sign in with Microsoft to continue using your account"); the steps disclosure is hidden (there are no manual steps for OAuth); the help link stays

### 9.5 New `OAuthSignInButton.tsx` component

Extracted shared component used by both `OnboardingScreen` and `SettingsModal`. Props:

```tsx
interface OAuthSignInButtonProps {
    provider: 'google' | 'microsoft';
    onSuccess: (result: { accountId: string }) => void;
    onError: (err: { code: string; message: string }) => void;
    /** Optional: existing account id for in-place re-auth (D8.2) */
    existingAccountId?: string;
    /** Disabled while another OAuth flow is in flight (D11.3) */
    disabled?: boolean;
}
```

Internally calls IPC `auth:start-oauth-flow` (or `auth:start-reauth-flow` if `existingAccountId` is set) and listens for `auth:flow-result` events. Renders a button with provider branding and an in-flight spinner.

## 10. IPC Channels

### 10.1 New channels

| Channel | Direction | Payload | Response | Purpose |
|---|---|---|---|---|
| `auth:start-oauth-flow` | renderer → main | `{ provider: 'google' \| 'microsoft', presetId: string }` | `{ success: boolean; accountId?: string; error?: string }` | Initial OAuth signup flow. Creates a new account row + oauth_credentials row on success per D11.5b (only after OAuth completion, never provisional). |
| `auth:start-reauth-flow` | renderer → main | `{ accountId: string }` | `{ success: boolean; error?: string }` | In-place re-auth for an existing account. Preserves accounts.id. Wraps the entire token swap in a single transaction per D8.2. |
| `auth:cancel-flow` | renderer → main | `{}` | `{ success: boolean }` | Cancel the in-flight OAuth flow if any. Used when user closes the modal mid-flow. |
| `auth:flow-status` | renderer → main | `{}` | `{ inFlight: boolean; provider?: string }` | Check whether an OAuth flow is currently in progress (for disabling other buttons per D11.3). |

### 10.2 Modified channels

| Channel | Change |
|---|---|
| `accounts:add` | Now accepts an optional `auth_type: 'oauth2'` mode. When set, the existing password parameter is ignored and the OAuth signup flow is responsible for populating credentials. |
| `accounts:delete` | Now triggers best-effort token revocation (D11.1) before the local DB delete for OAuth accounts. |

### 10.3 Preload allowlist

The `electron/preload.ts` channel allowlist is extended to include `auth:start-oauth-flow`, `auth:start-reauth-flow`, `auth:cancel-flow`, `auth:flow-status`. The existing `shell:open-external` channel from Phase 1 is reused for opening provider help URLs (no change there).

The OAuth flow does NOT use `shell:open-external` for the consent URL — that channel has an exact-URL allowlist for provider help pages. The OAuth consent URL has dynamic `state` and `code_challenge` query parameters that wouldn't match an exact-URL check. Instead, the main process calls `shell.openExternal(authUrl)` directly from inside the `auth:start-oauth-flow` IPC handler, where the URL is constructed and validated locally (URL must start with `https://accounts.google.com/o/oauth2/` or `https://login.microsoftonline.com/`).

## 11. i18n Additions

New keys under `auth.*` and `providerHelp.*` namespaces in all four locales (en, fr, es, de):

```json
{
  "auth": {
    "signInWithGoogle": "Sign in with Google",
    "signInWithMicrosoft": "Sign in with Microsoft",
    "signingIn": "Signing in…",
    "signInCancelled": "Sign in cancelled or timed out",
    "signInFailed": "Sign in failed: {{error}}",
    "anotherFlowInProgress": "Another sign-in is already in progress",
    "emailMismatchTitle": "Wrong account",
    "emailMismatchBody": "This sign-in is for {{signedInEmail}} but you're re-authenticating {{expectedEmail}}. Please sign in with the correct account.",
    "recommendedReauth": {
      "outlookPersonal": "Microsoft has ended password-based Outlook.com sending. Sign in with Microsoft to keep this account working.",
      "outlookBusiness": "Microsoft is moving away from password-based sign-in. Sign in with Microsoft now to avoid future disruption."
    },
    "reauthRequired": {
      "title": "Sign in again",
      "body": "{{provider}} has rejected this account's saved credentials. Please sign in again to continue."
    },
    "signInAgain": "Sign in again"
  },
  "onboarding": {
    "signInWithGoogleRecommended": "Sign in with Google is the easiest way to add your account.",
    "orUseAppPassword": "Or use an app password"
  },
  "providerHelp": {
    "common": {
      "signInWithGoogle": "Sign in with Google",
      "signInWithMicrosoft": "Sign in with Microsoft"
    },
    "gmail": {
      "oauth2Note": "Sign in with Google is recommended. The steps below are only needed if your organization blocks OAuth consent."
    },
    "outlookPersonal": {
      "oauth2Note": "Outlook.com personal accounts now use Sign in with Microsoft.",
      "warning": "Microsoft removed password-based Outlook.com sending on April 30, 2026. Sign in with Microsoft to use this account."
    },
    "outlookBusiness": {
      "oauth2Note": "Microsoft 365 Work/School accounts use Sign in with Microsoft."
    }
  }
}
```

All four locales receive the same key structure with translated values. Translations follow the same approach as Phase 1: clear, neutral, no marketing copy, no idioms.

The Phase 1 keys `providerHelp.outlookPersonal.comingSoonMessage` and `providerHelp.outlookBusiness.comingSoonMessage` are removed (or kept as aliases that point to the new copy if the implementer prefers a graceful deprecation).

## 12. Build & Release Process Changes

### 12.1 New environment variables

Required at release time (production build):
- `OAUTH_GOOGLE_CLIENT_ID`
- `OAUTH_GOOGLE_CLIENT_SECRET`
- `OAUTH_MICROSOFT_CLIENT_ID`

Required for local development (only if the developer wants to test real OAuth flows):
- `VITE_OAUTH_GOOGLE_CLIENT_ID`
- `VITE_OAUTH_GOOGLE_CLIENT_SECRET`
- `VITE_OAUTH_MICROSOFT_CLIENT_ID`

The release pipeline maps the `OAUTH_*` repository secrets to `VITE_OAUTH_*` env vars before invoking the build step.

### 12.2 New `.env.example` file

```env
# Local development OAuth client config.
# Copy this file to .env.local and fill in your own values.
# See CONTRIBUTING.md for instructions on registering a personal Google Cloud
# project and a Microsoft Entra app for development.
#
# These values are NOT secrets in the traditional sense — for installed
# desktop apps, OAuth client IDs are public per RFC 8252. They are kept
# out of source control for operational hygiene and to allow each
# contributor to use their own quota.

VITE_OAUTH_GOOGLE_CLIENT_ID=
VITE_OAUTH_GOOGLE_CLIENT_SECRET=
VITE_OAUTH_MICROSOFT_CLIENT_ID=
```

### 12.3 `.gitignore` additions

```
.env.local
.env.*.local
```

(Verify these are not already present.)

### 12.4 `release.yml` pre-package check

Add a step before the `Build Electron app` step that fails fast if any required OAuth secret is missing:

```yaml
- name: Verify OAuth secrets are configured
  shell: bash
  run: |
    if [ -z "${{ secrets.OAUTH_GOOGLE_CLIENT_ID }}" ]; then
      echo "::error::OAUTH_GOOGLE_CLIENT_ID secret is not set"
      exit 1
    fi
    if [ -z "${{ secrets.OAUTH_GOOGLE_CLIENT_SECRET }}" ]; then
      echo "::error::OAUTH_GOOGLE_CLIENT_SECRET secret is not set"
      exit 1
    fi
    if [ -z "${{ secrets.OAUTH_MICROSOFT_CLIENT_ID }}" ]; then
      echo "::error::OAUTH_MICROSOFT_CLIENT_ID secret is not set"
      exit 1
    fi
    echo "All OAuth secrets are configured."
```

The `Build Electron app` step then exposes the secrets to the build environment via `env:` block:

```yaml
- name: Build Electron app
  env:
    VITE_OAUTH_GOOGLE_CLIENT_ID: ${{ secrets.OAUTH_GOOGLE_CLIENT_ID }}
    VITE_OAUTH_GOOGLE_CLIENT_SECRET: ${{ secrets.OAUTH_GOOGLE_CLIENT_SECRET }}
    VITE_OAUTH_MICROSOFT_CLIENT_ID: ${{ secrets.OAUTH_MICROSOFT_CLIENT_ID }}
  run: |
    npx tsc
    npx vite build
```

Both `build-windows` and `build-linux` jobs receive the same env injection.

### 12.5 `ci.yml` (no changes required)

The `ci.yml` workflow does NOT need OAuth env vars per D10.2. Tests are mocked and don't exercise the OAuth client config. Lazy validation per D10.3 means the missing env vars don't crash anything until OAuth functionality is actually initialized, which never happens in the test path.

### 12.6 New CONTRIBUTING.md section (or README update)

A new section "Setting up OAuth for local development" explaining:
- How to create a Google Cloud project, enable Gmail API, create OAuth credentials of type "Desktop app"
- How to register a Microsoft Entra app with the right redirect URI and signInAudience
- How to populate `.env.local` with the resulting client IDs
- That OAuth env vars are optional — contributors who don't need to test real OAuth flows can skip this and the rest of the codebase still works

## 13. Test Strategy

### 13.1 New unit test files

| File | Layer | Mocking strategy | Approximate test count |
|---|---|---|---|
| `electron/auth/tokenManager.test.ts` | Orchestration | `vi.mock` provider adapters, `vi.mock` SQLite layer | ~25-30 tests |
| `electron/auth/google.test.ts` | Protocol | `nock` HTTP interception with fixtures | ~20-25 tests |
| `electron/auth/microsoft.test.ts` | Library boundary | `vi.mock('@azure/msal-node')` | ~15-20 tests |
| `electron/auth/clientConfig.test.ts` | Pure | None | ~8-10 tests |
| `electron/sendMail.test.ts` | Orchestration | `vi.mock('./smtp.js')`, `vi.mock('./graphSend.js')` | ~12-15 tests |
| `electron/graphSend.test.ts` | Protocol | `nock` HTTP interception | ~15-20 tests |
| `electron/db.migrations.test.ts` | Schema | None (real in-memory SQLite) | ~10-15 tests for migrations 13 + 14 |

### 13.2 Modified unit test files

| File | What changes |
|---|---|
| `electron/imap.test.ts` (existing `imapSync.test.ts`) | New tests for the AuthTokenManager wiring in connect() and reconnect() paths. Mock authTokenManager. |
| `electron/smtp.test.ts` | New tests for the OAuth2 auth branch. Mock authTokenManager. |
| `src/components/OnboardingScreen.test.tsx` | New tests for the OAuth button rendering, click → IPC dispatch, in-flight disabled state, success → wizard advance, cancellation → no state change. |
| `src/components/SettingsModal.test.tsx` | New tests mirroring the OnboardingScreen changes plus the "Sign in again" CTA for legacy and oauth accounts. |
| `src/components/Sidebar.test.tsx` (if exists, otherwise add) | New tests for the yellow/red reauth indicators and the context menu "Sign in again" item. |
| `src/lib/providerPresets.test.ts` | Updated tests reflecting the changes to `authModel` for outlook-personal and outlook-business (no longer 'oauth2-required' in the disabled sense, but still distinguished). Or — leave the `authModel` field alone and let the Phase 2 code branch on `auth_type` instead. Implementer's choice. |

### 13.3 New fixture files in `tests/fixtures/oauth/`

```
tests/fixtures/oauth/
├── README.md                                      # Capture & redaction instructions
├── google-token-success.json                      # POST /token success response
├── google-token-refresh-success.json              # POST /token refresh success
├── google-token-refresh-with-rotation.json        # POST /token refresh that returns a new refresh_token
├── google-token-invalid-grant.json                # POST /token failure: invalid_grant
├── google-token-network-timeout.json              # Synthetic transient error fixture
├── google-revoke-success.json                     # POST /revoke success
├── microsoft-token-success.json                   # MSAL acquireTokenInteractive response shape
├── microsoft-token-refresh-success.json           # MSAL acquireTokenSilent response shape
├── microsoft-token-invalid-grant.json             # MSAL refresh failure
├── microsoft-id-token-personal-claims.json        # Decoded id_token claims with consumer tid
├── microsoft-id-token-business-claims.json        # Decoded id_token claims with real tenant tid
├── graph-send-success.json                        # POST /me/sendMail 202 Accepted response
├── graph-send-401-unauthorized.json               # POST /me/sendMail 401 retry-trigger
├── graph-send-throttled.json                      # POST /me/sendMail 429 rate limited
└── graph-send-bad-request.json                    # POST /me/sendMail 400 validation error
```

Each fixture is a small human-readable JSON file. The README explains:
1. How to capture a real response (run a real OAuth flow with debug HTTP logging, copy the response body)
2. The redaction checklist: replace tokens with `[REDACTED-ACCESS-TOKEN]`, `[REDACTED-REFRESH-TOKEN]`, `[REDACTED-ID-TOKEN]`, replace email addresses with `test@example.com`, replace tenant IDs with the magic consumer GUID (for personal) or a fake GUID (for business)
3. When to refresh fixtures: only if Google/Microsoft response shapes change in a way that breaks parsing tests

### 13.4 New E2E tests in `tests/e2e/console-health.spec.ts`

Three new tests added to the existing `Console Health` describe block (so the CI grep pattern picks them up):

1. **`onboarding: Sign in with Google button renders on Gmail credentials step and dispatches IPC on click`** — Renders the credentials step, asserts the OAuth button is visible, clicks it, asserts the `auth:start-oauth-flow` IPC was dispatched (via mocked main process), asserts the button is in disabled in-flight state.
2. **`onboarding: Sign in with Microsoft button renders on Outlook Personal credentials step and dispatches IPC on click`** — Same as #1 for Microsoft.
3. **`settings modal: Sign in again CTA renders for accounts in recommended_reauth state and dispatches reauth IPC on click`** — Pre-seeds an account with `auth_state = 'recommended_reauth'`, renders SettingsModal Accounts tab, clicks the affected account, asserts the "Sign in again" CTA is visible, clicks it, asserts `auth:start-reauth-flow` is dispatched.

E2E tests do NOT exercise the real OAuth flow per D9.3 — they verify the UI surface and the IPC contract. Real OAuth testing happens manually during implementation and during the verification review submission process.

### 13.5 Test count target

Phase 2 should add roughly 100-150 new unit tests across the new files plus modifications. The test count target is **919-969 tests** (up from the v1.16.1 baseline of 819). The exact count depends on implementer judgment about test granularity.

## 14. Security Analysis

### 14.1 New attack surface

- **Loopback HTTP listener** during OAuth flows (60s window per flow, bound to `127.0.0.1:<random-port>`, rejects all requests except the expected callback path, rejects requests with mismatched `state` parameter). Mitigated by: short window, loopback-only binding, PKCE, state validation, single-use design (server shuts down after one valid callback).
- **OAuth tokens in V8 heap** during refresh operations and IPC payload construction. Same risk as decrypted passwords in v1.16.x — inherent to JavaScript, no clean mitigation, mitigated by short-lived scope.
- **Refresh tokens at rest** in `oauth_credentials.refresh_token_encrypted`. Encrypted via `safeStorage` (OS keychain), base64-encoded as TEXT to match the `accounts.password_encrypted` convention. Same threat model as `accounts.password_encrypted` today.
- **Microsoft Graph API endpoint** as a new outbound destination (HTTPS to `graph.microsoft.com`). No new inbound exposure.

### 14.2 Defenses already in place that continue to apply

- `safeStorage` encryption for tokens at rest
- `sanitizeForLog()` (from v1.16.1) for any user-controlled or token-adjacent strings interpolated into log messages
- IPC channel allowlist in preload (extended for new auth channels)
- CSP meta tag in index.html (not affected; OAuth flow happens in main process, not renderer)
- `cors({ origin: false })` on MCP server (unchanged)
- Cross-account ownership enforcement on email/folder/sched/reminder/rule IPC handlers (unchanged; new auth IPC handlers also enforce it)
- `will-navigate` and `setWindowOpenHandler` defense-in-depth in main.ts (unchanged)
- `electron.safeStorage` for password encryption (extended to encrypt OAuth tokens with the same API)

### 14.3 New defenses introduced by Phase 2

- **PKCE for all OAuth flows** with S256 code challenge method (mandatory for Google's installed app type, recommended for Microsoft)
- **State parameter** for CSRF protection on the loopback callback (random 32-byte hex, validated before code exchange)
- **Loopback listener bound to `127.0.0.1` only**, not `0.0.0.0` (no network-layer exposure)
- **Single-use loopback listener** that shuts down after one valid callback or timeout
- **OAuth URL allowlist** for the system browser launch path: only URLs starting with `https://accounts.google.com/o/oauth2/` or `https://login.microsoftonline.com/` are passed to `shell.openExternal` from the OAuth IPC handler
- **Token redaction** in all log lines: full tokens never logged, only short hashes or first/last 4 chars if needed for diagnostics
- **Email redaction** in log lines: account hint shows first character + `***` + domain (e.g., `b***@hotmail.com`) per D11.10
- **Permanent vs transient error classification** per D5.10 prevents silent infinite retry loops on revoked consent
- **Best-effort time-bounded token revocation** on account delete per D11.1 (5-second timeout, non-blocking)

### 14.4 Threat model: what Phase 2 does NOT defend against

- A local attacker with code execution privileges on the user's machine can read tokens from V8 heap (same as the existing password threat — out of scope per CLAUDE.md security posture)
- A malicious package update to `@azure/msal-node`, `google-auth-library`, or any transitive dep could exfiltrate tokens (mitigated by `npm audit` in the quality gate, by package-lock pinning, by GitHub's Dependabot, but no in-app sandbox)
- Microsoft / Google compromise of their own OAuth infrastructure (out of scope)
- A user who installs a fake ExpressDelivery app and uses it to harvest OAuth tokens (mitigated by Google's verification review process, by Microsoft's app verification, but the desktop client is fundamentally a public client)

## 15. Open Risks

### 15.1 Google verification review timeline

**Risk:** Google's OAuth verification review for the `https://mail.google.com/` restricted scope can take 4-12 weeks of calendar time. Until verification completes, the app shows an "unverified" warning during consent and is hard-capped at 100 test users per day.

**Likelihood:** High — this is the documented timeline.

**Impact:** Until verification, the user-visible warning is uncomfortable and the test-mode cap could become binding if early adoption exceeds 100 users/day during the window.

**Mitigation:**
- Start the verification review submission process at the beginning of Phase 2 implementation, not at the end. The 4-12 week clock runs in parallel with development.
- Privacy policy URL and demo video are mandatory submission requirements — prepare them during the implementation phase.
- D10.6 reserves the option to ship a user-supplied-credentials escape hatch (Settings UI) in v1.18.x if the cap becomes binding.
- Publish the unverified warning behavior prominently in the v1.17.0 release notes so early adopters know what to expect.

### 15.2 Microsoft Graph API rate limits

**Risk:** Graph API has per-user rate limits that may be tighter than SMTP rate limits for high-volume senders.

**Likelihood:** Low for individual users, moderate for power users sending bulk mail.

**Impact:** 429 errors during burst sends. The `graphSend.ts` error mapping should distinguish 429 (transient, retry with backoff) from 4xx (permanent, surface to user).

**Mitigation:** Implement retry-with-backoff on 429 in `graphSend.ts` per `Retry-After` header. Document the rate limit as a known limitation for personal Outlook accounts in CHANGELOG release notes.

### 15.3 MSAL-node API stability

**Risk:** `@azure/msal-node` is actively developed; the exact API surface for refreshing without a persistent cache (D5.9) may change between versions.

**Likelihood:** Medium — Microsoft has historically been good about backwards compatibility but not perfect.

**Impact:** Phase 2 implementation may need to pin a specific MSAL version or adjust the wrapper code if the underlying API shifts.

**Mitigation:** D5.9 deliberately avoids naming a specific MSAL API method in the spec. The wrapper in `electron/oauth/microsoft.ts` is a small stable abstraction; if MSAL changes, only the wrapper needs to update. `npm audit` and pin to the latest stable MSAL version at implementation time.

### 15.4 Personal Outlook Graph API send semantics

**Risk:** Microsoft Graph `/me/sendMail` is HTTP POST to a REST API, not SMTP. The semantics are subtly different from SMTP: no implicit "sent items" save (controllable via `saveToSentItems: true`), different error model (HTTP status codes vs SMTP response codes), different envelope-from handling, different DSN/bounce behavior.

**Likelihood:** Medium — Microsoft Graph is well-documented but the implementer needs to understand the differences.

**Impact:** Subtle send-path bugs that only manifest for personal Outlook users (e.g., bounces not propagating, mail not appearing in Sent Items, recipient header construction edge cases).

**Mitigation:** Wire-shape tests in `graphSend.test.ts` (D9.6) verify the request body construction. Manual end-to-end testing during implementation against a real personal Outlook account before release.

### 15.5 Provider classification edge cases

**Risk:** D6.7 classifies Microsoft accounts as personal vs business via the `id_token.tid` claim. There may be edge cases where the claim is missing, malformed, or has a value that doesn't match either pattern (e.g., a hybrid Entra B2B guest scenario).

**Likelihood:** Low — Entra always issues `tid` for tokens issued via the `common` authority.

**Impact:** Classification failure would default the routing to whichever code path is the fallback, potentially using the wrong send transport.

**Mitigation:** `oauth/microsoft.ts` validates `tid` is present and is a valid GUID before classifying. If `tid` is missing or malformed, the OAuth flow fails with a clear error rather than guessing. The user can retry. Logged with `[OAUTH]` for diagnostics.

### 15.6 Existing v1.16.x users with custom outlook configurations

**Risk:** Some v1.16.x users may have manually configured their `provider='outlook'` accounts with non-default IMAP/SMTP hosts (e.g., a relay through their company's IMAP gateway).

**Likelihood:** Low.

**Impact:** Migration 14 marks them as `recommended_reauth` based purely on `provider='outlook'`. When they click "Sign in again", the OAuth flow uses the standard Microsoft endpoints, ignoring their custom hosts. The resulting account will have the custom hosts overwritten by Microsoft's defaults.

**Mitigation:** The "Sign in again" CTA explicitly warns "your custom server settings will be replaced by Microsoft's defaults" if the account had non-default hosts. User can choose to keep using the legacy account with its custom hosts (basic auth + custom hosts may still work for some configurations).

## 16. Out of Scope for Phase 2 (Phase 3+)

- **OAuth2 for Yahoo and iCloud** — neither provider offers OAuth2 for third-party mail clients as of April 2026. App-password flow continues to be the only path.
- **Calendar integration** — Phase 2 only ships `Mail.Send` for Microsoft Graph. Calendar (Outlook Calendar / Google Calendar) is a separate phase.
- **Contacts integration** — same as Calendar.
- **User-supplied OAuth client credentials in Settings UI (D10.6)** — deferred until/unless the Google test-mode cap becomes a real adoption blocker.
- **OAuth for additional Google services** (Drive, Docs, etc.) — not relevant to a mail client.
- **macOS / Linux code signing** — still TBD, separate phase.
- **OAuth flow analytics / telemetry** — no opt-in metrics infrastructure in the codebase yet, out of scope.
- **Multiple Google accounts per OAuth client per user** — Google handles this naturally via the account chooser screen, no custom UI needed.
- **Refresh token re-encryption on key rotation** — `safeStorage` keys are managed by the OS keychain, no rotation story needed at the app level.

## 17. Acceptance Criteria

Phase 2 ships when ALL of the following are true:

1. **Schema migrations 13 + 14 land cleanly** on a v1.16.1 user database with no data loss and all existing tests still pass.
2. **OAuth signup flow works end-to-end** for a real Gmail personal account, real Microsoft 365 business account, and real Microsoft personal account (hotmail.com or outlook.com), tested manually on a Windows build.
3. **In-place re-auth** of a v1.16.1 legacy outlook account preserves all FK-related data (verified by checking `emails`, `folders`, `drafts`, `tags`, `mail_rules`, `contacts` rows still exist with the same `account_id`).
4. **Microsoft Graph send** successfully sends a test email (with at least one attachment) from a personal Outlook account and the message appears in the recipient's inbox.
5. **All 50+ architectural decisions** from §3 are implemented and verifiable in the code.
6. **Quality pipeline green:** ESLint `--max-warnings 0`, `tsc --noEmit` clean, Vitest 919+ passing, Semgrep SAST zero findings on Phase 2 production files, `npm audit` zero vulnerabilities, `npm run build:win` produces a packaged binary, E2E Console Health all tests passing including the 3 new Phase 2 tests.
7. **CI workflow passes** on both Ubuntu and Windows runners for the final commit on the Phase 2 branch.
8. **Release workflow** (release.yml) successfully verifies OAuth secrets are configured, packages binaries on both Windows and Linux runners, signs the Windows binary if `CSC_LINK` is set, publishes to GitHub Releases via `--publish always`.
9. **CHANGELOG.md updated** with a v1.17.0 entry following the Keep a Changelog format used in v1.16.0 / v1.16.1.
10. **CLAUDE.md updated** to reflect Phase 17 status, new file/test counts, and the architectural changes.
11. **Google OAuth verification review** is at least submitted (not necessarily approved) before the v1.17.0 tag push. Approval can come later as a v1.17.x patch.
12. **`.env.example` and CONTRIBUTING.md OAuth setup section** are committed.
13. **The 4 baseline E2E tests from v1.16.1** (Console Health app launch, settings modal, Gmail credentials, Outlook Personal disabled state, Microsoft 365 business disabled state) are updated to reflect Phase 2's new credentials step layout and still pass.

## 18. Verification items to resolve during implementation (not at spec time)

These are deliberate "I'll find out when I get there" items that don't block the spec but need to be answered during implementation:

1. **Exact `@azure/msal-node` version and the specific method to refresh from a stored refresh token without persistent cache.** The spec mandates "no second durable cache" but leaves the API choice to implementation.
2. **Whether IMAPFlow's XOAUTH2 auth callback returns errors in a way that lets us cleanly distinguish 401-equivalent token expiry from network errors.** The spec assumes it does; the implementer verifies and adjusts the on-401 retry path if not.
3. **Exact Google OAuth scope strings** — the spec says `https://mail.google.com/` but the actual string format may have a trailing slash, may need URL encoding in the auth URL, etc. Verify against `google-auth-library` examples.
4. **Microsoft scope rejection behavior** for personal vs business accounts. Per D11.7 the implementer may adjust the requested scope set if Microsoft rejects a specific combination, without changing the one-consent-flow design goal.
5. **Whether Google's OAuth verification review process has changed** in 2026 from the documented 4-12 week timeline. Submit early; adjust expectations based on actual response.
6. **Microsoft Graph rate limits** for personal accounts — exact request/minute caps. Implement retry-with-backoff per Retry-After header.
7. **Whether the existing `electron/scheduler.ts` 30s polling loop** needs any awareness of `auth_state = 'reauth_required'` accounts to skip them, or whether the existing `AccountSyncController` short-circuit is sufficient.

## 19. References

- [Phase 1 spec: Provider Auth Guidance Overhaul](2026-04-12-phase1-provider-auth-guidance-design.md)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [RFC 7636 — Proof Key for Code Exchange (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636)
- [Google OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google OAuth Loopback IP Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)
- [Google OAuth Custom URI Scheme Restrictions](https://developers.googleblog.com/improving-user-safety-in-oauth-flows-through-new-oauth-custom-uri-scheme-restrictions/)
- [Google OAuth Embedded Webview Block](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)
- [Microsoft Entra Electron Tutorial](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-nodejs-desktop)
- [Microsoft Entra Configure Desktop Apps](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration)
- [Microsoft Entra Redirect URI Best Practices](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
- [Microsoft Graph `/me/sendMail` reference](https://learn.microsoft.com/en-us/graph/api/user-sendmail)
- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
- [CLAUDE.md — ExpressDelivery project guidelines](../../CLAUDE.md)
