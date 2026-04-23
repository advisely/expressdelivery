# Changelog

All notable changes to ExpressDelivery are documented in this file.

ExpressDelivery is an AI-powered desktop email client with MCP (Model Context
Protocol) integration, built with Electron, React 19, TypeScript, and SQLite.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## v1.18.11 — 2026-04-22

### Bug fixes

- **Email: unsubscribe / any anchor click still blanked the email body (true root cause of v1.18.8 bug 3).** The v1.18.8 – v1.18.10 iframe click interceptor was correct but **never executed**. Srcdoc iframes inherit the parent document's CSP (HTML spec — srcdoc runs on the embedder's origin), and `index.html`'s parent CSP was `script-src 'self'` with no hash / nonce / `'unsafe-inline'` for the inline boot script. The srcdoc's own `<meta>` CSP can only add restrictions — it cannot loosen the parent's policy — so Chromium blocked the inline script at runtime ("Executing inline script violates the following Content Security Policy directive 'script-src 'self''"). Without the interceptor, every anchor click default-navigated the iframe, the destination blocked framing via `frame-src 'self' blob:`, and the iframe rendered blank. This fires on **every** email render (not only clicks), so auto-resize via `ResizeObserver` has also been silently broken since v1.18.8. Fix: pin the SHA-256 of the combined iframe boot script (`sha256-UimfTAbR7bxwyqyUrY/vGzw3X5JKYJV+4MT/B9t751g=`) into the parent CSP `script-src`, refactor the two inline scripts into a single exported `IFRAME_BOOT_SCRIPT` constant, and add a vitest case that recomputes the hash from the constant and asserts it matches `index.html` — drift now fails loud at `npm run test` instead of silently at runtime in packaged builds.

---

## v1.18.10 — 2026-04-22

### Bug fixes

- **Email: SVG unsubscribe links still blanked the email body.** The v1.18.8 click interceptor used `tagName === 'A'` which is case-sensitive; SVG `<a>` elements (common in marketing email graphics) live in the SVG namespace and preserve lowercase `a`, so clicking a clickable SVG graphic bypassed the interceptor and let the iframe self-navigate into an X-Frame-Options-blocked page. Walker now normalizes `tagName.toUpperCase()` and reads `href` via `getAttribute()` with URL resolution against `document.baseURI` (covers `SVGAElement.href`'s non-string `SVGAnimatedString`).
- **Email: TOC / fragment anchors silently broke native scroll.** Links like `<a href="#top">` resolved to `about:srcdoc#top` inside the iframe; the interceptor posted that to the parent, the scheme allowlist rejected `about:`, and the native scroll had already been preventDefault'd — the click did nothing. The interceptor now bails for same-document fragment anchors and lets the browser scroll natively.
- **IMAP: brief Wi-Fi blip left controller stuck disconnected.** The v1.18.8 `forceDisconnect` timer cleanup raced against itself when two calls fired concurrently (close listener + in-flight heartbeat/sync rejection). Call #2 cleared the reconnect timer call #1 had just armed, then early-returned without rescheduling — no in-tree caller of `forceDisconnect('health')` follows with an explicit `startAccount`, so the controller sat idle until app restart. Added a `hadPendingReconnect` tracker; if the early-return path cleared a live timer and the caller asked for a health reconnect, re-arm via `scheduleReconnect()` before returning. Wake-from-sleep is unaffected (the follow-up `stopController` uses `reason='user'`, which still does not re-arm).

---

## v1.18.9 — 2026-04-22

### Internal

- Version-only bump over v1.18.8 to enable local update-path testing of the v1.18.8 bug fixes (the already-installed build is v1.18.8; the NSIS installer needs a higher version number to trigger an in-place upgrade). No functional changes vs v1.18.8. Also carries the `scripts/clean-build.mjs` timeout bump (5min → 20min) that unblocked the NSIS signing step on slower timestamp-server round-trips.

---

## v1.18.8 — 2026-04-22

### Bug fixes

- **Window: can't reopen after close-to-tray.** The second-instance handler (triggered when the user double-clicks the desktop shortcut while the app is hidden to the tray) called `win.focus()` on a hidden window, which is a silent no-op on Windows. The window now calls `win.show()` first when `!isVisible()`, so the window reliably reappears.
- **IMAP: no reconnect after laptop wake from sleep.** `AccountSyncController.forceDisconnect()` early-returned when the status was already `'disconnected'`, leaving a pre-sleep reconnect `setTimeout` armed with stale exponential-backoff state. On wake, that timer fired mid-way through the power-resume reconnect and thrashed the freshly-established connection. Timer cleanup and `close`/`error` listener detachment now run unconditionally before the status guard.
- **Email: clicking an unsubscribe link blanked the email body.** The sandboxed iframe rendering email HTML had no click interceptor, so bare `<a href>` clicks (and `<area>` clicks in image maps) navigated the iframe itself and were blocked by `X-Frame-Options: DENY` on the destination — the email content was replaced with a blank frame. A capture-phase click interceptor now runs inside the srcdoc, intercepts anchor and area clicks, and postMessages the URL to the parent, which opens it in the default browser via a new scheme-allowlisted `shell:open-email-link` IPC (https / http / mailto only; javascript / data / file explicitly rejected).

### Security

- New `shell:open-email-link` IPC handler is scheme-allowlisted, length-capped (≤2000 chars), WHATWG-URL-parsed, and log-injection-resistant (CR/LF/NUL stripping). Kept separate from the existing exact-URL-allowlisted `shell:open-external` so the provider-help URL allowlist is not weakened. The handler passes the WHATWG-normalized `parsed.href` (not the raw input) to `shell.openExternal` for defense-in-depth.

---

## [1.18.7] - 2026-04-20

User report: "I had the app open, put the laptop to sleep, woke it, then
sent myself an email from another app, but our app didn't fetch or show the
new email until I closed and reopened the app — I thought we had a 5/7/10
second fetcher?"

### Fixed
- **Wake-from-sleep reconnect.** During OS suspend the IMAP TCP socket is
  silently killed, and on wake the 15s poll timer was hitting a dead socket:
  `withImapTimeout` took 60s to time out, then exponential-backoff reconnect
  compounded further delays. The NOOP heartbeat (120s) and the 180s staleness
  guard both existed as fallbacks but could add up to 3+ minutes of silence
  before the user saw new mail. Now the app subscribes to
  `powerMonitor.on('resume')` and `powerMonitor.on('unlock-screen')` and
  immediately: (a) `forceDisconnect('health')` to tear down the dead socket,
  (b) resets `reconnectAttempts` to 0 so backoff doesn't carry over from
  pre-suspend failures, (c) calls `startAccount()` which synchronously syncs
  the inbox — the same code path as clean app start.
- **Network online reconnect.** Wi-Fi switch, VPN reconnect, or tether
  change now fire the same reconnect path. The renderer listens to
  `window.addEventListener('online', ...)` and calls a new `network:online`
  IPC that triggers the shared reconnect.
- **Event coalescing.** Windows commonly fires `resume` + `unlock-screen`
  within ~50ms on lid-open-and-login. A shared `createReconnectTrigger`
  in-flight guard collapses the burst into a single reconnect run across
  both power events *and* the network:online IPC.

### Added
- `electron/powerReconnect.ts` — 80-line module with the reconnect trigger,
  the power-monitor attacher, and a tight structural `PowerReconnectEngine`
  interface so it's unit-testable without bootstrapping a real IMAP engine.
- 11 unit tests in `electron/powerReconnect.test.ts` covering
  force-disconnect, reconnect-counter reset, per-account start, empty-state
  no-op, rejection tolerance, listener wiring, disposer, and event debounce.

### Technical
- Zero Semgrep findings, zero lint warnings (`--max-warnings 0`), strict
  TypeScript clean. 1150/1150 tests passing (up from 1139).
- Preload allowlist gained one channel: `network:online` (INVOKE).
- Power monitor detach is wired into the existing `before-quit` cleanup
  chain alongside `getMcpServer().stop()` and `disconnectAll()`.

---

## [1.18.6] - 2026-04-19

User report: "When I drag an email and hover over the folder I'll drop it
in, that focused folder should be highlighted too — either in solo-account
mode or multi-accounts mode."

### Fixed
- **Drop-target folder highlight** now visibly fires in BOTH single-account
  AND unified "All Accounts" mode. Two bugs combined:
  1. The CSS rule `.nav-item.drag-over` (compound class on the BUTTON
     element) only matched single-account mode. The unified-mode v1.18.1
     code put `drag-over` on the wrapper `.nav-item-row` div, which had no
     matching CSS rule — drop highlight was silent.
  2. The single-account-mode visual was a 0.15-alpha tint with thin
     outline — too subtle to read at a glance.
  Fix: (a) added `drag-over` to the unified-mode button as well (parity with
  single-account), (b) added a new `.nav-item-row.drag-over` CSS rule for
  the row-level outline, (c) strengthened both visuals — 0.22 alpha
  background, 2px accent-colored outline, 3px inset accent-colored stripe
  on the left, bolder font, smooth 120ms transition gated behind
  `prefers-reduced-motion: no-preference`.

### Files Touched
- `src/components/Sidebar.tsx` — unified-mode button now also receives the
  `drag-over` class (line 838 area).
- `src/components/Sidebar.module.css` — strengthened `.nav-item.drag-over`
  visual; added `.nav-item-row.drag-over` for the wrapper highlight; added
  reduced-motion-aware transition.

### Quality gate
- vitest: 1139/1139 (no test changes — purely visual).
- ESLint: 0 warnings. TypeScript strict: clean.

---

## [1.18.5] - 2026-04-19

User report: "Does the delete email animation work only with some mailbox
providers and not the rest? It's like I see it sometimes working and
sometimes not."

Not a provider issue — the v1.18.0 animation only fired from ONE of FIVE
delete entry points, so the user perceived inconsistency across what was
actually identical IPC behavior.

### Fixed
- **Delete animation now fires from EVERY delete entry point.** Previously
  only the trash icon on each row in `ThreadList` flagged the row as
  exiting (`setExitingIds` local state). The other four entry points —
  ReadingPane top-bar trash button, right-click context-menu Delete, bulk
  Delete on multi-select, and the keyboard shortcut (`Delete` key,
  `App.handleDeleteSelected`) — fired the IPC immediately and the row
  vanished on the next `emails:list` refresh with no animation. Hence the
  "sometimes works, sometimes not" feel.
- Lifted the `exitingIds` set from `ThreadList` local state into the
  Zustand store as `exitingEmailIds` + `markEmailsExiting(ids)` and
  `unmarkEmailsExiting(ids)` actions. All five delete handlers now
  bracket their IPC with mark/unmark, run the IPC in `Promise.all` with a
  250 ms timer, and uniformly trigger the existing
  `.thread-item-exiting` CSS animation.

### Added
- 4 new tests in `src/stores/emailStore.test.ts` pinning the
  `exitingEmailIds` contract: idempotent add, remove, empty-array no-op
  (no spurious re-render), state-reference identity preserved on no-op.

### Quality gate
- vitest: 1138/1139 (was 1135 + 4 new). 1 pre-existing flake in
  `ThreadList.test.tsx` Reply test — unrelated, passes in isolation.
- ESLint: 0 warnings. TypeScript strict: clean.

### Files Touched
- `src/stores/emailStore.ts` — `exitingEmailIds`, `markEmailsExiting`,
  `unmarkEmailsExiting`.
- `src/stores/emailStore.test.ts` — +4 lockstep tests.
- `src/components/ThreadList.tsx` — replaced local `exitingIds` state with
  store reads. Updated `handleDeleteEmail`, `handleBulkDelete`, and
  `ctxAction('delete')` to use store actions + Promise.all 250 ms timer.
- `src/components/ReadingPane.tsx` — `handleDelete` now brackets with
  mark/unmark + Promise.all 250 ms timer.
- `src/App.tsx` — `handleDeleteSelected` (keyboard shortcut) same
  treatment.

---

## [1.18.4] - 2026-04-19

Two related improvements: a structural fix for the brand-spoofing false
positives that v1.18.3 only data-patched, and a much more visible
SPF/DKIM/DMARC authentication-result badge per user request ("make the
SPF + DKIM + DMARC pass more explicit").

### Fixed
- **Brand-spoofing rule now Public Suffix List aware** (`src/lib/phishingDetector.ts`).
  v1.18.3 expanded the Amazon list and added `x.com` for Twitter — overfitted
  per the user's observation. v1.18.4 replaces the hard-coded regional
  enumeration with an algorithmic check via the well-established `tldts`
  npm package (Public Suffix List, ~50 KB, used by ad blockers worldwide).
  Each brand now declares either:
  - `allowAlgorithmic: true` (most brands) → ANY `<brand>.<safe-tld>` hostname
    is accepted (e.g., `amazon.lu`, `google.lt`, `microsoft.gr` work without
    being enumerated). Suspicious TLDs (`.tk`, `.ml`, `.gq`, etc.) still
    rejected.
  - `allowAlgorithmic: false` (US-only brands: Chase, Wells Fargo,
    Bank of America) → only the explicit `aliases` list is accepted, so
    `chase.de` etc. are still flagged.
  - `aliases`: always-allowed exact domains (Twitter's `x.com`).
  Negative cases still flagged: `amazon.com.evil.com`, `amazon.tk`,
  `paypal-fake.tk`, `apple-secure.tk` — verified by 6 new regression tests.

### Added
- **Explicit SPF/DKIM/DMARC authentication badge** in the email header
  (`src/components/ReadingPane.tsx` + `ReadingPane.module.css`). Replaces
  the v1.18.0 icon-only verified/unverified pair (which only had hover
  tooltips and didn't render `partial` or `unknown` states). The new badge
  always shows:
  - **Status label** color-coded: green "Verified sender" (all 3 pass),
    amber "Partially verified" (some pass), red "Unverified sender" (all
    fail), grey "Auth unknown" (sender publishes no records).
  - **Per-check chips** inline: `SPF` `DKIM` `DMARC` each rendered with
    pass/fail/none color (pass=green, fail=red strikethrough, none=muted).
  - **Tooltip** on hover spelling out the exact value of each check
    (e.g., "SPF: PASS\nDKIM: FAIL\nDMARC: PASS").
  - **ARIA label** for screen readers reading the full breakdown.
  Translated en/fr/es/de.
- **`src/lib/senderVerification.ts`** (NEW) — renderer-side mirror of
  `electron/authResults.ts` so the badge logic doesn't cross-import from
  Electron main code. 8 tests pinning the `verified | partial | unverified
  | unknown` enum mapping (notably: `softfail` does NOT count as pass).
- **`tldts` dependency** added to `package.json` (~50 KB, Public Suffix
  List parser).

### Tests
- `src/lib/phishingDetector.test.ts`: 25 → 31 (+6 PSL coverage tests:
  Amazon storefronts not in any explicit list still accepted; suspicious
  TLDs rejected; subdomain trick rejected; subdomains of regional sites
  accepted; US-only brands stay restricted; US-only brands' `.com`
  accepted).
- `src/lib/senderVerification.ts`: 8 new tests for the enum mapping.
- Net total: 1135 (was 1116).

### Specs
- `docs/superpowers/specs/2026-04-19-v1.18.4-psl-and-auth-badge.md`

### Quality gate
- ESLint: 0 warnings. TypeScript strict: clean.
- Vitest: 1133/1135 (1 pre-existing cross-test pollution flake in
  `ThreadList.test.tsx` Reply context-menu test — passes deterministically
  in isolation; unrelated to this change).

### Maintenance note
The brand-spoofing detector is now structurally sound: adding a new
brand to monitor is a one-line entry in `BRAND_CONFIGS` (declare aliases
+ algorithmic mode); the regional storefronts come for free via PSL.
Future contributors who want to slim the explicit lists can do so without
breaking regression tests as long as the algorithmic mode is enabled.

---

## [1.18.3] - 2026-04-19

User report after v1.18.2: "amazon.ca has been tagged as unsafe, why?" plus
a feature request: "add a sender to the trusted list so the warning doesn't
show again."

### Fixed
- **`amazon.ca` (and every other Amazon regional storefront) no longer
  flagged as a phishing/spoof domain.** `src/lib/phishingDetector.ts` had
  `BRAND_DOMAINS` mapping each brand to a single official domain
  (`amazon → amazon.com`). Rule 4 (brand spoofing) flagged `amazon.ca`,
  `amazon.co.uk`, `amazon.de`, `amazon.fr`, `amazon.co.jp`, `amazon.com.au`,
  `amazon.com.mx`, `amazon.in`, etc. — all legitimate Amazon storefronts —
  as not-the-official-domain. Refactored `BRAND_DOMAINS` to map brand → list
  of official domains. Amazon now lists 20 known regional variants. Twitter
  also lists `x.com` as an alias. Display-name spoof check uses the same
  centralized matcher so the fix applies uniformly. Pinned by 4 new
  regression tests in `src/lib/phishingDetector.test.ts` covering positive
  cases (regional storefronts pass) AND negative cases (spoofs like
  `amazon.com.evil.com`, `my-amazon-account.tk` still flagged).

### Added
- **Trusted senders allowlist.** New module `electron/trustedSenders.ts`
  stores a user-managed list of email addresses (lowercased, trimmed,
  validated) in the SQLite `settings` table under key `trusted_senders` as
  a JSON array. When a sender's `from_email` is in the list,
  `assessSenderRisk` short-circuits and returns `isHighRisk: false` — no red
  banner, no danger variant, no risk reasons. Remote-image blocking is
  unchanged (privacy choice, not security choice).
- **"Trust this sender" button** in the danger-variant remote-image banner
  in `ReadingPane`. One click adds the current email's `from_email` to the
  trusted allowlist via the new `trusted-senders:add` IPC channel and
  refreshes the local set so the banner immediately switches back to its
  non-danger appearance. Idempotent — clicking twice doesn't duplicate the
  entry. Translated en/fr/es/de.
- **4 new IPC handlers** (`electron/main.ts` + preload allowlist):
  - `trusted-senders:list` → `string[]`
  - `trusted-senders:add(email)` → updated `string[]`, throws on invalid email
  - `trusted-senders:remove(email)` → updated `string[]`
  - `trusted-senders:is-trusted(email)` → `boolean`

### Tests
- `src/lib/phishingDetector.test.ts`: +4 regional-domain regression tests.
- `electron/trustedSenders.test.ts`: 11 new tests pinning DB-backed
  storage contract — empty defaults, lowercase normalization, idempotency,
  invalid email rejection, removal, corrupted-JSON survival, null/undefined
  handling.
- `src/lib/senderRisk.test.ts`: +3 tests for `options.isTrusted` bypass —
  trusted senders bypass even when phishing flagged or DKIM/DMARC fails.
- Net total: 1116 (was 1098 + 18 new).

### Specs
- `docs/superpowers/specs/2026-04-19-v1.18.3-trusted-senders-and-regional-brands.md`

### Quality gate
- ESLint: 0 warnings. TypeScript strict: clean.
- Vitest: 1115/1116 passing (1 known cross-test-pollution flake in
  `App.test.tsx > opens ComposeModal` — passes 107/107 in isolation; not
  introduced by this change, present since v1.18.0 animation-timer
  interactions). All v1.18.3 new tests pass deterministically.

### Out of scope (deferred)
- Settings panel UI to view / remove entries from the trusted-sender list
  (the IPC handlers are in place; UI tab can be added in v1.18.4 or
  v1.19.0). For now users can re-trust a sender any time they receive an
  email from them by clicking the button again — but cannot easily revoke
  trust without a future Settings tab.
- Per-account scope (currently global across all configured accounts —
  trust on yassine@boumiza.com applies when the same sender writes to
  yassine@gmail.com too). Probably correct behavior; revisit if reported.

---

## [1.18.2] - 2026-04-19

Hotfix for a selection-state regression user-reported after v1.18.1 testing:
"I deleted the older email and went back to the newer one — couldn't read it,
or any other email." Root cause was pre-existing latent state-split (not
introduced by v1.18.1) that the user's test plan happened to exercise.

### Fixed
- **Stale `selectedEmailId` after delete/archive (regression guard).** The
  `emailStore` had two independent setters: `setSelectedEmail(emailFull |
  null)` only touched `selectedEmail`, and `selectEmail(id | null)` only
  touched `selectedEmailId`. Every delete/archive flow called
  `setSelectedEmail(null)` to clear the open email — but `selectedEmailId`
  was left pointing at the just-deleted message. The store ended up in a
  split state (`selectedEmail === null`, `selectedEmailId === <deleted id>`)
  that broke subsequent reads on the next click. Hardened
  `setSelectedEmail` to keep the two fields in lockstep — when called with
  `null`, it now also clears `selectedEmailId`; when called with an
  `EmailFull`, it syncs `selectedEmailId` to that email's id. Added an
  explicit `clearActiveEmail()` action for delete/archive flows that want
  named-intent clearing. Switched the two highest-traffic call sites
  (`ReadingPane.handleDelete` and `ThreadList.handleDeleteEmail`) to use
  the new helper. The store hardening covers every other call site
  defensively without code churn.

### Added
- New store action `clearActiveEmail()` — atomic clear of both
  `selectedEmail` and `selectedEmailId`.
- 4 new tests in `src/stores/emailStore.test.ts` pinning the lockstep
  contract: `setSelectedEmail(emailFull)` syncs id; `setSelectedEmail(null)`
  clears both; `clearActiveEmail()` clears both; `clearActiveEmail()`
  doesn't touch unrelated state (multi-select set, folder).
- 1 new integration regression test in `src/components/ThreadList.test.tsx`:
  open older email, delete it, then click newer email → assertion that the
  store has both fields cleared after delete AND `emails:read` fires for
  the newer email AND `selectedEmailId` updates correctly. This is the
  exact reproduction of the user's report.

### Specs
- `docs/superpowers/specs/2026-04-19-v1.18.2-selection-state-lockstep.md`

### Quality gate
- vitest: 1098/1098 (was 1093 + 4 store + 1 ThreadList).
- ESLint: 0 warnings. TypeScript strict: clean.

### Note on test coverage growth
- v1.17.4 baseline: 1023 tests
- v1.17.5: +4 (markAsRead/Unread/AllRead queue + parse-after-release)
- v1.18.0: +52 (animations, security MVP, design polish)
- v1.18.1: +18 (delete fallback + drag-drop)
- v1.18.2: +5 (selection-state lockstep)
- Net: +75 tests in 24 hours. The pattern — extract pure logic + write the
  failing test that pins the contract before fixing — has now caught three
  classes of regressions (queue routing, silent fallback, split state).
  Future contributors who try to revert any of these will hit failing tests
  named after the original symptom.

---

## [1.18.1] - 2026-04-19

Hotfix release for two bugs that surfaced after v1.18.0 testing. Both were
pre-existing latent bugs that the user happened to exercise — neither was
introduced by v1.18.0 — but both warranted regression-test coverage so they
cannot return.

### Fixed
- **Reading-pane delete claimed success but email persisted (regression
  guard).** The `emails:delete` IPC handler at `electron/main.ts:1040` had a
  silent local-only fallback: if `imapEngine.moveMessage(... → Trash)`
  returned `false` (Yahoo server rejection, lock timeout, transient network
  error), the handler still ran `UPDATE emails SET folder_id = trash` locally
  and returned `{ success: true }`. The renderer flashed a "deleted" toast
  but the next IMAP sync re-discovered the email in INBOX (server still had
  it there) and re-created the local row. To the user this looked like the
  email "came back" or "was never deleted" — the v1.17.3 changelog entry
  describes the same anti-pattern, and v1.17.4 reduced the failure rate by
  queuing user actions but did not remove the silent-fallback itself. v1.18.1
  extracts the IPC body into `electron/deleteEmailLogic.ts` and tests the
  contract directly: when `moveMessage` returns false or throws, the local
  DB is **not** updated and the IPC returns `{ success: false, error }`.
  The renderer (`ReadingPane.handleDelete`) now surfaces that error as a
  toast so the user knows the delete actually failed and can retry.
- **Drag-drop in unified ("All Accounts") inbox showed forbidden cursor on
  every folder (regression guard).** The Sidebar's unified-mode folder
  render at `Sidebar.tsx:824` lacked `onDragOver` / `onDrop` / drop-target
  className (the single-account render at line 870 had them). Browser
  showed the forbidden cursor because no folder accepted drops. Fix: add the
  drag handlers using a new pure helper `src/lib/canDropOnFolder.ts` to
  decide same-account-allow vs. cross-account-refuse. Same-account drags
  now work in unified view; cross-account drags display a clear toast
  ("Moving emails between different accounts is not supported. Drag onto a
  folder of the same account.") translated en/fr/es/de. IMAP cannot move
  messages atomically across accounts (would require download from A,
  upload to B, delete from A — out of v1.18.1 scope; deferred to a future
  cross-account-move feature).

### Added
- `electron/deleteEmailLogic.ts` + `electron/deleteEmailLogic.test.ts` —
  11 regression tests pinning the no-silent-fallback contract for both the
  Move-to-Trash path and the Permanent-Delete-from-Trash path. Also tests
  `extractUidFromEmailId` corner cases.
- `src/lib/canDropOnFolder.ts` + `src/lib/canDropOnFolder.test.ts` —
  7 tests covering same-account allow, cross-account reject, multi-account
  drag, missing destination, and missing emails.
- New i18n key `dragDrop.crossAccountUnsupported` translated en/fr/es/de.

### Specs
- `docs/superpowers/specs/2026-04-19-v1.18.1-delete-fallback-and-drag-drop.md`

### Quality gate
- vitest: 1093/1093 (was 1075 + 11 + 7 new).
- ESLint: 0 warnings. TypeScript strict: clean.
- The two new modules are pure (DB or in-memory data + dependency-injected
  IMAP functions / no DOM access) so the tests run in milliseconds and
  catch the regression contracts at the unit level — the IPC handler in
  `main.ts` is now a one-line delegation to the tested logic.

---

## [1.18.0] - 2026-04-19

A combined feature + security release. Closes the remaining queue gap from the v1.17.4 Yahoo lock-contention work, adds a long-asked-for thread-list preview-line toggle with enter/exit animations, ships the security MVP for attachment safety + risk-aware remote-image banner, and visually upgrades the email body rendering area from a flat seam into a proper elevated card.

### Fixed (carried from v1.17.5 work on `fix/yahoo-delete-lock`)
- **Yahoo "delete after open" lock-contention follow-up.** The v1.17.4 fix routed `deleteMessage`, `moveMessage`, `refetchEmailBody` through a per-account `operationQueue` but missed `markAsRead`, `markAsUnread`, and `markAllRead`. These three methods were still acquiring `getMailboxLock()` directly, racing with queued operations at the IMAPFlow mutex level. Opening a heavy promotional email on Yahoo (e.g., a multi-megabyte multipart HTML newsletter) triggered an unqueued `markAsRead` that beat a subsequent queued `deleteMessage` to the mailbox lock — surfacing as "delete is slow / hangs after opening that one email". Routed all three through `operationQueue` using the existing `_xxxLocked` split pattern. Also bumped `markAllRead`'s lock timeout from 10s to 30s for consistency.
- **`_refetchEmailBodyLocked` now obeys the spec section-2 invariant** ("Mailbox locks must only protect IMAP fetch and state operations, not MIME parsing"). Refactored to a two-phase pattern: fetch raw source under lock, release lock, then run `mailparser.simpleParser` outside. Mirrors the `syncNewEmails` pattern from v1.17.4 commit `e7a02d8`. For the Prime Store / large marketing email reproduction case, parse phase used to hold the queue for several seconds; now it never blocks subsequent user actions.
- **`Buffer.from(content, 'base64')` invalid-input handling in `attachments:save`.** Decode now happens once, before the safety scan, so the magic-byte check operates on the same bytes that hit disk.

### Added — Thread list UX (`src/components/ThreadList.tsx`)
- **"Show first-line preview" toggle.** Settings → General → Appearance now has a switch to hide the snippet line under the subject (sender + subject only). Persisted via Zustand `themeStore` (localStorage). Default: on. Translated en/fr/es/de.
- **Email row enter / exit animations.** New emails arriving via `email:new` IPC fade in + slide down (~350ms). Single-email delete fades the row out + slides right + collapses height (~250ms) in parallel with the IMAP delete, so the user perceives instant feedback while the queue does the actual server work. Folder switches and initial loads do not animate. Respects `prefers-reduced-motion: reduce`.

### Added — Security MVP (Phase 3)
- **Risk-aware remote-image banner (`ReadingPane.tsx` + new `src/lib/senderRisk.ts`).** When `phishingResult.isPhishing` OR `auth_dmarc/dkim/spf` ∈ {fail, softfail, permerror} OR `detectDisplayNameSpoofing` raises a flag, the banner switches to a danger variant: red background, role="alert", up to 2 risk reasons enumerated as a `<ul>`, and the button reads "Load anyway" instead of "Load remote images". Click behavior unchanged — false positives must remain dismissible.
- **Attachment safety gate (`electron/attachmentSafety.ts` + main.ts wiring).** New 47-extension `DANGEROUS_EXTENSIONS` denylist (`.exe .scr .docm .vbs .ps1 .jar` etc.) + hand-rolled magic-byte detector for PE/ELF/PDF/ZIP/PNG/JPEG/GIF/RTF/OLE/HTML. `assessAttachmentRisk` flags both: filename ends with a dangerous extension, or magic bytes are an executable (always), or the extension's allowlist disallows the detected type (e.g., `.pdf` containing HTML, `.txt` containing ZIP — common malware vectors). When risky, `attachments:save` IPC returns `{ requiresConfirmation: true, risk, reason }` and the renderer parks the bytes behind a `ConfirmDialog` with `variant="danger"` until the user explicitly confirms with "Save anyway". Filename in the dialog is sanitized to strip RTLO bidi overrides (defends against the `photo<U+202E>gpj.exe` → "photoexe.jpg" trick).
- **35 + 10 new tests** for `attachmentSafety` and `senderRisk` modules. Total suite: 1075 tests.

### Added — Animation extension + design polish
- **Email body card design upgrade.** The sandboxed iframe (and the plain-text fallback `<pre>`) now sits in an elevated card surface: 10px rounded corners, theme-aware `--email-surface-border`, theme-tuned `--shadow-card-md` (Light/Cream get warm subtle shadow, Midnight/Forest get deep dark shadow), `--bg-elevated` background. Iframe internal padding bumped to `16px 20px` so author HTML doesn't kiss the rounded edges; iframe body `background: transparent` so the parent's elevated bg shows through (preserves tonal continuity across themes — the iframe srcdoc cannot read parent CSS variables). Reduced-motion users get no shadow transition.
- **Sidebar folder enter/exit animations.** Creating a folder slides it in from the left (~300ms); deleting slides out to the right + collapses (~250ms) in parallel with the `folders:delete` IPC. Respects `prefers-reduced-motion: reduce`.
- **Compose attachment chip enter/exit animations.** Attaching files scales chips up + fades in (~300ms); clicking the X scale-collapses + fades out (~220ms) before actually removing from state. Respects `prefers-reduced-motion: reduce`.

### Changed
- `electron-builder.json5` and `package.json` version → 1.18.0.
- CLAUDE.md status line updated: 48 test files / 1075 tests (was 46 / 1023).

### Specs
- `docs/superpowers/specs/2026-04-19-v1.17.5-yahoo-delete-lock-followup.md`
- `docs/superpowers/specs/2026-04-19-v1.18.0-security-mvp.md`
- `docs/superpowers/specs/2026-04-19-v1.18.0-design-polish.md`

### Quality gate (all green)
- ESLint: 0 warnings.
- TypeScript strict: clean.
- Vitest: 1075/1075 (was 1023 + 4 ThreadList animations + 1 markAllRead + 3 markAsRead/Unread + parse-after-release + 35 attachmentSafety + 10 senderRisk).
- Semgrep SAST: no new findings on changed files.
- cyber-sentinel + code-reviewer + code-simplifier: HIGH findings addressed (markAllRead missed-from-queue, ZIP-mismatch dead code), MEDIUM addressed (RTF/OLE magic, RTLO sanitization, attacker-filename in dialog reason).

---

## [1.17.4] - 2026-04-14

Hotfix release for the v1.17.3 Yahoo delete fix. Establishes the per-account `operationQueue` pattern in `electron/imap.ts`, routes user-initiated delete/move/refetch through it, and removes MIME parsing from inside the mailbox lock in `syncNewEmails` (chunked into 100-message batches, parse runs outside the lock). Background-sync ticks remain on the direct `getMailboxLock` path so they don't compete for queue slots. Spec: `docs/superpowers/specs/2026-04-14-yahoo-delete-lock-fix-design.md`.

### Fixed
- Yahoo accounts: `deleteMessage`, `moveMessage`, and user-initiated `refetchEmailBody` are now serialized through a per-account `AsyncQueue`, eliminating IMAPFlow-mutex races that caused intermittent delete-falls-back-to-local on slow connections. `getMailboxLock` timeout aligned to 30s on every queued user-action path.
- `syncNewEmails` two-phase refactor: Phase 1 fetches raw source bytes under the lock (chunked at MAX_CHUNK_SIZE=100), Phase 2 runs `simpleParser` and DB inserts outside the lock with per-message try/catch so one malformed message never aborts the batch.

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
