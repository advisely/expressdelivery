# Phase 1 — Provider Auth Guidance Overhaul

**Date:** 2026-04-12
**Status:** Approved (pending user review of this spec)
**Phase:** 15 → 16 prep
**Related:** Phase 2 OAuth2 (separate spec, not yet written)

## 1. Summary

Rewrite the new-account workflow's provider guidance so it matches what Gmail, Microsoft, Yahoo, and Apple actually require in April 2026. The current presets and onboarding copy pre-date two major industry shifts:

- **Gmail removed legacy basic auth for IMAP/SMTP on March 14, 2025.** App Passwords still work for personal Gmail with 2-Step Verification, but OAuth2 (SASL XOAUTH2) is the officially blessed path.
- **Outlook.com / Microsoft accounts are finishing Basic Auth SMTP removal on April 30, 2026.** Business Exchange Online removed it in 2022. Personal Outlook.com is at 100% rejection in eighteen days from this spec date. App passwords no longer function.

Yahoo and iCloud continue to require app-specific passwords and do not offer OAuth2 for third-party mail clients, so the app must permanently support both auth models.

Phase 1 is **pure frontend + copy** — no OAuth2 implementation, no DB schema changes, no protocol changes. Phase 2 (separate spec) will add OAuth2 for Gmail and Microsoft. The goal of Phase 1 is to stop sending users into failing password flows and to surface accurate, provider-specific setup instructions at the point of failure.

## 2. Scope

### In scope

- Extend `ProviderPreset` with guidance metadata
- Split the single `outlook` preset into `outlook-personal` and `outlook-business` for new adds
- Introduce an invisible `outlook-legacy` preset used only by the settings edit flow to represent existing `accounts.provider === 'outlook'` rows
- Build a reusable `ProviderHelpPanel` component (short note, collapsible steps, official help link, optional warning banner)
- Integrate the panel into `OnboardingScreen` (provider select + credentials steps) and `SettingsModal` (add account + edit account flows)
- Add one new IPC handler `shell:open-external` backed by an exact-URL allowlist
- Add new i18n keys under `providerHelp.*` in all four supported locales (`en`, `fr`, `es`, `de`)
- Update and add tests: `ProviderHelpPanel`, `OnboardingScreen`, `SettingsModal`, `providerPresets`, and `shell:open-external` handler
- Disable the new-account entry for `outlook-personal` and `outlook-business` with a clear explanation and a "Use Other / Custom" escape hatch
- Keep the edit flow for existing `outlook-legacy` accounts fully editable (fields, test, save) with a non-blocking warning banner

### Explicit non-goals

- No OAuth2 flow implementation (BrowserWindow, PKCE, XOAUTH2, token refresh) — deferred to Phase 2
- No changes to `electron/imap.ts` or `electron/smtp.ts`
- No changes to `electron/crypto.ts` or the `accounts` DB schema
- No DB migration (decision documented in §6)
- No new account columns (`auth_type`, `refresh_token_enc`, etc.) — deferred to Phase 2
- No changes to MCP or scheduler
- No automatic re-classification of existing Outlook accounts as personal vs. business — the app does not have the information to make that call honestly

## 3. Data model

### 3.1 `ProviderPreset` interface

Extend the existing interface in `src/lib/providerPresets.ts`:

```ts
export type ProviderId =
  | 'gmail'
  | 'outlook-personal'
  | 'outlook-business'
  | 'outlook-legacy'   // internal only, not shown in provider grid
  | 'yahoo'
  | 'icloud'
  | 'custom'

export type AuthModel =
  | 'password-supported'   // app password is the working path (Gmail, Yahoo, iCloud)
  | 'oauth2-required'      // password auth does not work; OAuth2 not yet built (Outlook personal/business)
  | 'password'             // unopinionated (Custom/Other)
  | 'legacy'               // existing outlook accounts, editable but warned (outlook-legacy)

export interface ProviderPreset {
  id: ProviderId
  label: string                  // display label (not i18n — brand name)
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  authModel: AuthModel
  shortNoteKey: string           // i18n key for the one-line note
  stepsKey: string | null        // i18n key for the step list; null for custom/legacy
  helpUrl: string | null         // exact URL, allowlisted in main process
  warningKey: string | null      // optional prominent warning banner key
  hiddenFromGrid?: boolean       // true for outlook-legacy
}
```

**Semantics of `authModel`** — this field drives UI behavior only (is the password field rendered? is the submit button enabled? is a warning banner shown?). It does **not** imply anything about the provider's strategic direction. Gmail's OAuth-preferred direction lives in its `shortNote` copy, not its enum value. This is deliberate: future readers should not infer that Gmail is fundamentally an app-password provider.

### 3.2 The presets

| `id` | Label | IMAP | SMTP | `authModel` | In grid? |
|---|---|---|---|---|---|
| `gmail` | Gmail | `imap.gmail.com:993` | `smtp.gmail.com:465` | `password-supported` | yes |
| `outlook-personal` | Outlook.com (Personal) | `outlook.office365.com:993` | `smtp-mail.outlook.com:587` | `oauth2-required` | yes |
| `outlook-business` | Microsoft 365 (Work/School) | `outlook.office365.com:993` | `smtp.office365.com:587` | `oauth2-required` | yes |
| `outlook-legacy` | Outlook (Legacy) | `outlook.office365.com:993` | `smtp.office365.com:587` | `legacy` | **no** |
| `yahoo` | Yahoo Mail | `imap.mail.yahoo.com:993` | `smtp.mail.yahoo.com:465` | `password-supported` | yes |
| `icloud` | iCloud Mail | `imap.mail.me.com:993` | `smtp.mail.me.com:587` | `password-supported` | yes |
| `custom` | Other / Custom | — | — | `password` | yes |

**Six cards are visible in the provider grid. `outlook-legacy` is not.**

### 3.3 Preset resolution for existing accounts

A new helper `getPresetForAccount(account: Account): ProviderPreset` maps stored `account.provider` strings to presets:

- `account.provider === 'outlook'` → `outlook-legacy`
- any other exact match → the matching preset
- unknown value → `custom`

This keeps stored data untouched and pushes the old/new distinction into the UI mapping layer. There is **no database migration** in Phase 1.

## 4. `ProviderHelpPanel` component

### 4.1 File layout

```
src/components/ProviderHelpPanel.tsx
src/components/ProviderHelpPanel.module.css
src/components/__tests__/ProviderHelpPanel.test.tsx
```

### 4.2 Props

```ts
interface ProviderHelpPanelProps {
  preset: ProviderPreset
}
```

The component is self-contained — it reads i18n keys from `preset` and calls the `shell:open-external` IPC directly. It does not expose callbacks.

### 4.3 Visual structure

```
┌─────────────────────────────────────────────────────┐
│ ⚠  [warningKey]  (only if preset.warningKey)        │   ← amber banner
│                                                      │
│ ⓘ  [shortNoteKey]                                   │   ← one-line note
│                                                      │
│    ▸ Show steps                                      │   ← Radix Collapsible trigger
│    ↗ Open official page                              │   ← shell:open-external
└─────────────────────────────────────────────────────┘
```

When expanded:

```
┌─────────────────────────────────────────────────────┐
│ ⓘ  [shortNoteKey]                                   │
│                                                      │
│    ▾ Hide steps                                      │
│    1. [stepsKey.0]                                   │
│    2. [stepsKey.1]                                   │
│    3. [stepsKey.2]                                   │
│    4. [stepsKey.3]                                   │
│    5. [stepsKey.4]                                   │
│                                                      │
│    ↗ Open official page                              │
└─────────────────────────────────────────────────────┘
```

### 4.4 Behavior

- Disclosure state is **local** (`useState`, not persisted). Per-session is fine.
- If `preset.stepsKey === null`, the disclosure is not rendered (applies to Custom and Legacy).
- If `preset.helpUrl === null`, the "Open official page" button is not rendered (applies to Custom).
- The "Open official page" button calls `ipcInvoke('shell:open-external', { url: preset.helpUrl })`. On error (allowlist rejection), shows an inline error state — the button becomes non-functional rather than crashing.
- The warning banner is rendered only if `preset.warningKey !== null`.
- The component is accent-color aware via existing CSS custom properties.

### 4.5 Accessibility

- `role="region"` with `aria-label` set to the localized preset label
- Disclosure button has `aria-expanded` and `aria-controls`
- Step list uses semantic `<ol>`
- Warning banner has `role="alert"` only when first rendered (not on subsequent re-renders, to avoid screen reader spam)

## 5. Outlook add vs. edit split

This is the most opinionated part of the design. It was revised once during brainstorming.

### 5.1 Add flow (OnboardingScreen + SettingsModal "Add Account")

When `preset.authModel === 'oauth2-required'`:

- The password input field is **not rendered**
- The "Test & Connect" / "Save" button is **hidden**
- In its place, a message panel:
  > "Outlook accounts now require OAuth2 / Modern Auth, which this app does not support yet. Use **Other / Custom** only if your organization still allows password-based IMAP/SMTP."
- The Custom preset CTA button brings the user to the custom flow with empty host fields.

The user is never invited into a flow that is 100% guaranteed to fail. This directly addresses the original complaint (Yahoo setup trap) and the parallel Outlook trap.

### 5.2 Edit flow (SettingsModal "Edit Account")

When an existing account has `provider === 'outlook'` (mapped to `outlook-legacy`):

- The full edit form renders normally: display name, IMAP host/port, SMTP host/port, password — all editable.
- The `ProviderHelpPanel` renders above the form with the `outlook-legacy` warning banner:
  > "Outlook accounts now require OAuth2 sign-in. This account was added before that change and may stop working on or after April 30, 2026."
- The `shortNote` for legacy reads:
  > "This is an existing Outlook account using Basic Authentication. You can still edit its settings, but new Outlook accounts must wait for OAuth2 support."
- No step list, no help URL — `stepsKey: null`, `helpUrl: null` on the legacy preset.
- The "Test Connection" button remains wired. The "Save" button remains wired. The user is not locked out of their own working account.

This is a soft-warn edit path. The user retains full control over their data and their settings.

### 5.3 Why this split

- **New adds:** the app has no way to honor a password attempt (Basic Auth is gone for Microsoft). Disabling the flow is honest.
- **Legacy edits:** the app already knows this account was working at some point. Some business tenants may still work for weeks. Hard-locking the edit form would be user-hostile and risks blocking recovery scenarios (password rotation, host corrections).
- **No reclassification guesswork:** the app does not auto-migrate `outlook` → `outlook-personal` because it cannot reliably know which sub-category an existing account belongs to. Domain heuristics are unreliable for corporate tenants that use vanity domains.

## 6. No database migration

Originally the design proposed a migration renaming `accounts.provider = 'outlook'` to `outlook-personal`. That proposal is **rejected**.

### Reasons

- Phase 1 is frontend + copy. A schema write introduces persistence churn for limited gain.
- The mapping `outlook` → `outlook-personal` is a guess. Some existing accounts are business tenants with custom domains. Bulk-rewriting them bakes in a known-wrong classification.
- The UI mapping layer (`getPresetForAccount`) is sufficient to handle legacy values without touching stored data.
- Future cleanup (Phase 2+) can migrate intelligently using stored SMTP host, user consent, or OAuth re-enrollment flow.

### Consequence

`accounts.provider` in the DB can contain:
- new strings: `gmail`, `outlook-personal`, `outlook-business`, `yahoo`, `icloud`, `custom`
- legacy strings: `outlook`

All code paths that read `account.provider` must route through `getPresetForAccount()` and never assume the stored value is one of the new IDs directly. This is a testable invariant.

## 7. `shell:open-external` IPC

### 7.1 Rationale

The renderer process cannot safely call `electron.shell.openExternal` directly — it would require exposing `shell` through preload, broadening the attack surface for any XSS or prompt-injection in rendered content. A dedicated IPC handler with an **exact-URL allowlist** is tighter than a host allowlist and trivially auditable.

### 7.2 Handler

New handler in `electron/main.ts`:

```ts
import { HELP_URLS } from '../src/lib/providerPresets'  // shared source of truth

const ALLOWED_HELP_URLS: ReadonlySet<string> = new Set(HELP_URLS)

ipcMain.handle('shell:open-external', async (_event, args: { url: string }) => {
  if (typeof args?.url !== 'string' || !ALLOWED_HELP_URLS.has(args.url)) {
    logDebug('shell:open-external rejected', { url: args?.url })
    return { success: false, error: 'URL not allowlisted' }
  }
  try {
    await shell.openExternal(args.url)
    return { success: true }
  } catch (err) {
    logDebug('shell:open-external failed', { err: String(err) })
    return { success: false, error: 'Failed to open URL' }
  }
})
```

### 7.3 Allowlist source of truth

The exact URLs are exported from `src/lib/providerPresets.ts` as:

```ts
export const HELP_URLS: readonly string[] = [
  'https://support.google.com/mail/answer/185833',
  'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040',
  'https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth',
  'https://help.yahoo.com/kb/SLN15241.html',
  'https://support.apple.com/en-us/102654',
] as const
```

Both the renderer (via `ProviderHelpPanel`) and the main process (via the IPC handler) import the same constant. There is no duplication, therefore no synchronization burden.

**If the electron-builder / vite-plugin-electron build topology does not permit `electron/main.ts` to import from `src/lib/providerPresets.ts`** (main and renderer are separately bundled), the fallback is:
1. Move `HELP_URLS` to a shared location readable by both bundles (e.g., `shared/helpUrls.ts`)
2. OR duplicate the constant in `electron/main.ts` with a unit test that imports both and asserts set equality
Verification of the build topology happens during implementation, not at spec-time. This is flagged in the implementation plan.

### 7.4 Preload exposure

Add `'shell:open-external'` to the preload channel allowlist in `electron/preload.ts`. This is the only preload change in Phase 1.

## 8. i18n

### 8.1 Key structure

New keys under `providerHelp.*` in `src/locales/{en,fr,es,de}.json`:

```
providerHelp:
  common:
    showSteps: "Show steps"
    hideSteps: "Hide steps"
    openHelpPage: "Open official page"
  gmail:
    shortNote: "..."
    steps: ["...", "...", "...", "...", "..."]
  outlookPersonal:
    warning: "..."
    shortNote: "..."
    comingSoonMessage: "..."   // used by the disabled add-flow panel
  outlookBusiness:
    warning: "..."
    shortNote: "..."
    comingSoonMessage: "..."
  outlookLegacy:
    warning: "..."
    shortNote: "..."
  yahoo:
    shortNote: "..."
    steps: ["...", "...", "...", "...", "..."]
  icloud:
    shortNote: "..."
    steps: ["...", "...", "...", "..."]
```

### 8.2 Array vs. indexed keys

`stepsKey` resolves via `t('providerHelp.gmail.steps', { returnObjects: true }) as string[]`. react-i18next supports `returnObjects: true` natively. Before committing the final shape, implementation will verify that the existing `src/lib/i18n.ts` configuration does not disable `returnObjects`. If it does, fall back to indexed keys (`providerHelp.gmail.steps.0` … `.4`) with a small `useSteps(preset)` helper hook that loops until a missing key.

This is a verification step, not a design decision.

### 8.3 Translation approach

- Draft `en` copy first with short, procedural sentences — no idioms, no marketing phrasing.
- Machine-translate to `fr`, `es`, `de` using the existing locale files as tone reference (mirror the phrasing register already in use).
- Author review in the PR before merge.
- Domain/brand names (Gmail, Outlook, Yahoo, iCloud, Apple Account) are **not translated**.
- URLs are **not in the locale files** — they live in `providerPresets.ts` as infrastructure.

### 8.4 Copy principles

- No timing promises. Never say "coming in a future release" or "will be added in v1.16". Use "not supported yet" or "this app does not support ... yet."
- Warn without blaming — the user is not wrong for trying, the industry changed.
- Concrete steps preferred over abstract guidance ("Go to your Google Account → Security → App passwords" not "Follow Google's instructions to generate an app password").

## 9. Integration points

### 9.1 `OnboardingScreen.tsx`

- **Step 2 (provider grid):** Unchanged structurally. Each card still uses `preset.label` and a localized short note resolved from `preset.shortNoteKey` via i18n (replacing the previous hardcoded `notes` string on the interface). Card count grows from 5 to 6 (Outlook splits).
- **Step 3 (credentials):** Insert `<ProviderHelpPanel preset={selectedPreset} />` between the step title and the email input field. If `selectedPreset.authModel === 'oauth2-required'`, render the disabled state panel instead of the credentials form.
- **No other structural changes.** Step dots, animations, back button, test flow all unchanged.

### 9.2 `SettingsModal.tsx`

- **Add Account view:** Insert `<ProviderHelpPanel preset={currentPreset} />` above the form fields. Same `oauth2-required` disabled handling as onboarding. The existing provider dropdown is updated to show 5 cards (Gmail, Outlook Personal, Outlook Business, Yahoo, iCloud, Custom — note `outlook-legacy` is excluded).
- **Edit Account view:** Resolve the preset via `getPresetForAccount(account)`. If the result is `outlook-legacy`, render the legacy warning banner but keep the form fully editable. For any other provider, render the normal help panel.

### 9.3 No changes to

- `electron/db.ts` (no migration)
- `electron/imap.ts`, `electron/smtp.ts` (no protocol changes)
- `electron/crypto.ts` (no new secret types)
- `electron/main.ts` other than the new `shell:open-external` handler
- `src/stores/emailStore.ts`
- MCP tools, scheduler, rule engine

## 10. Testing

### 10.1 New test files

**`src/components/__tests__/ProviderHelpPanel.test.tsx`**
- Renders short note from i18n key for each preset (gmail, yahoo, icloud, outlook-*)
- Disclosure toggles on click; step list appears/disappears
- "Open official page" button invokes `shell:open-external` IPC with the preset's exact URL
- `oauth2-required` preset renders the disabled state with the Custom CTA
- `outlook-legacy` renders warning banner but no step list and no help link
- Custom preset renders shortNote only (no steps, no help link)
- `role="alert"` fires on first render of warning banner

**`electron/__tests__/shellOpen.test.ts`**
- Allowlist acceptance: each URL in `HELP_URLS` is accepted
- Allowlist rejection: non-allowlisted URL returns `{ success: false, error: 'URL not allowlisted' }`
- Rejection on non-string `url` argument
- Rejection on missing `url` argument
- Logs rejection via `logDebug`

**`src/lib/__tests__/providerPresets.test.ts`** (new if not existing)
- Locks the exact preset list: 6 visible in `PROVIDER_PRESETS`, `outlook-legacy` exported separately as internal
- `getPresetForAccount({ provider: 'outlook' })` returns `outlook-legacy`
- `getPresetForAccount({ provider: 'outlook-personal' })` returns `outlook-personal`
- `getPresetForAccount({ provider: 'unknown' })` returns `custom`
- `HELP_URLS` contains exactly 5 entries and each matches a preset's `helpUrl`

### 10.2 Updated test files

**`src/components/__tests__/OnboardingScreen.test.tsx`**
- Provider grid renders 6 cards
- Clicking Gmail shows ProviderHelpPanel with Gmail short note
- Clicking Outlook Personal shows disabled state, no password field, Custom CTA present
- Clicking Outlook Business same as Personal
- Existing test assertions for the happy path (Gmail add) still pass

**`src/components/__tests__/SettingsModal.test.tsx`**
- Add Account flow: ProviderHelpPanel renders for selected preset
- Edit Account flow with stored `provider === 'outlook'`: legacy warning banner present, form editable, password field editable, Test button wired, Save button wired
- Edit Account flow with stored `provider === 'gmail'`: normal help panel, no warning banner

### 10.3 E2E

No new E2E tests in Phase 1. The existing onboarding E2E flow in the Playwright harness should continue to pass against the new panel. If it asserts on specific preset IDs, it may need a one-line update.

### 10.4 Test count target

Current: 779 tests across 32 files.
Target after Phase 1: ~820-830 tests across 35 files (+3 new files, +~40 tests).

## 11. Risks & rollback

### Risks

1. **Disabled Outlook add is a UX regression** for anyone who was successfully adding business tenants with Basic Auth. Mitigation: Custom preset escape hatch with clear messaging; Edit flow remains open for existing accounts.
2. **Machine translations may read awkwardly** in `fr`, `es`, or `de`. Mitigation: author review at PR time; native speaker issue reports can be fixed in point releases.
3. **`shell:open-external` is a new security-sensitive surface.** Mitigation: exact-URL allowlist, unit tests on allowlist enforcement, preload channel allowlist, handler logs rejections for audit.
4. **Build topology may prevent main-process import of `HELP_URLS` from `src/lib/providerPresets.ts`.** Mitigation: verification step during implementation; fallback plans documented in §7.3.
5. **react-i18next `returnObjects` may not be enabled.** Mitigation: verification step during implementation; fallback to indexed keys.

### Rollback

- Single-commit revert restores prior behavior entirely. No DB state to unwind.
- Each new piece is additive (new component, new i18n keys, new IPC handler). The only modifications to existing files are in `providerPresets.ts`, `OnboardingScreen.tsx`, `SettingsModal.tsx`, `electron/main.ts`, `electron/preload.ts`, and the four locale files.

## 12. What this does NOT fix

Phase 1 still leaves users unable to actually add new Outlook accounts. That is intentional and honest: the app currently cannot authenticate to Microsoft's IMAP/SMTP with the only auth method it supports. Pretending otherwise would be worse than a clear "not yet supported" state.

Phase 2 (separate spec, not yet written) will add real OAuth2 support for Gmail and Microsoft — BrowserWindow-based authorization code flow with PKCE, XOAUTH2 SASL in IMAPFlow and Nodemailer, refresh token handling in `AccountSyncController`, `accounts.auth_type` + `accounts.refresh_token_enc` schema additions, and Graph API send fallback for personal Outlook.com.

## 13. Out of scope for Phase 1 (parked for Phase 2)

- OAuth2 BrowserWindow flow with PKCE
- Google Cloud OAuth client registration + scope review (restricted scope `https://mail.google.com/` requires Google verification)
- Microsoft Entra app registration
- `accounts.auth_type` column and `refresh_token_enc` column
- XOAUTH2 wiring in `electron/imap.ts` and `electron/smtp.ts`
- Microsoft Graph API `/me/sendMail` fallback for personal Outlook.com
- Token refresh loop in `AccountSyncController`
- Intelligent migration of `outlook-legacy` accounts into `outlook-personal` / `outlook-business` based on OAuth re-enrollment

## 14. Open verification items (do during implementation, not at spec time)

- Confirm `returnObjects: true` is supported by the current `src/lib/i18n.ts` config
- Confirm `electron/main.ts` can import from `src/lib/providerPresets.ts` under the current vite-plugin-electron build topology, or commit to a shared `shared/helpUrls.ts` location
- Confirm the four official help URLs still resolve without redirects (exact-URL allowlist is brittle to redirects; if any redirect, record the final URL instead)
- Confirm Playwright E2E harness does not hard-assert on the 5-card grid count

## 15. Acceptance criteria

Phase 1 is complete when:

1. The onboarding provider grid shows 6 cards (Gmail, Outlook.com Personal, Microsoft 365 Work/School, Yahoo, iCloud, Other/Custom)
2. Selecting any provider in onboarding or "Add Account" shows the new `ProviderHelpPanel`
3. Selecting Outlook.com Personal or Microsoft 365 Work/School shows the disabled state with a clear message and a Custom escape hatch
4. Existing accounts with `provider === 'outlook'` remain editable and testable in the Edit Account flow with a non-blocking warning banner
5. The "Open official page" button opens the provider's exact help URL via the allowlisted IPC
6. All new strings are present in `en`, `fr`, `es`, `de`
7. New test files exist and pass: `ProviderHelpPanel.test.tsx`, `shellOpen.test.ts`, `providerPresets.test.ts` (or updated)
8. Existing `OnboardingScreen` and `SettingsModal` test suites still pass with updated assertions
9. `npm run lint` passes with zero warnings
10. `npm run build:win` succeeds
11. No changes to DB schema version, no new migrations
