# Deferred Features: Risk/Reward Analysis

**ExpressDelivery v1.7.0** | Last updated: 2026-02-28

This report evaluates all features currently marked as "Deferred" or "Planned" in the roadmap. Each feature is assessed on effort, risk, user impact, and recommendation.

---

## Summary Matrix

| Feature | Effort | Risk | User Impact | Recommendation |
|---------|--------|------|-------------|----------------|
| PGP/S-MIME Encryption | 8-12 days | HIGH | Medium | Phase 10+ |
| Read Receipts | 3-5 days | MEDIUM | Low | Skip |
| Link Tracking | 4-6 days | HIGH | Low | Skip |
| Calendar Integration (RSVP) | 5-7 days | MEDIUM | High | Phase 10 |
| POP3 Protocol | 4-6 days | LOW-MEDIUM | Low | Skip |
| CardDAV Contact Sync | 4-5 days | MEDIUM | Medium | Phase 11 |
| CalDAV Calendar Sync | 4-5 days | MEDIUM | Medium | Phase 11 (with Calendar) |
| NNTP/RSS Feeds | 5-8 days | MEDIUM-HIGH | Very Low | Skip |
| Touch/Gesture Support | 2-3 days | LOW | Medium | Phase 10 |
| RTL Layout Support | 3-4 days | LOW-MEDIUM | Medium | Phase 10 |
| Contact Profiles | 2-3 days | LOW | Medium | **v1.7.0** (done) |
| Company Information | 3-4 days | HIGH | Low | Skip |
| Code Signing | 1-2 days | LOW | High | Phase 10 |
| SQLCipher Encryption | 3-5 days | MEDIUM | Low | Phase 11 |
| E2E Tests (Playwright) | 10-14 days | MEDIUM | N/A (quality) | Phase 10 |
| Integration Tests | 5-8 days | LOW | N/A (quality) | Phase 10 |

---

## Detailed Analysis

### 1. PGP/S-MIME Encryption

**What it is:** End-to-end email encryption using OpenPGP or S/MIME certificates. Encrypt/sign outgoing, decrypt/verify incoming.

**Current state:** No crypto libraries beyond OS keychain (safeStorage). No key management.

**Effort:** 8-12 days
- Add `openpgp` dependency (~200KB)
- DB migration for key storage (public/private per account)
- Key management UI (import/export/generate)
- Compose toggle (encrypt/sign per email)
- ReadingPane decrypt/verify on display
- SMTP envelope wrapping
- Security audit required

**Risk:** HIGH
- GPG key management is notoriously poor UX (users lose keys, forget passphrases)
- S/MIME requires certificate authority certificates (cost)
- Key exchange problem (need recipient's public key)
- Security audit mandatory before shipping

**User impact:** Medium — important for privacy-conscious users, enterprise, journalists. Niche audience.

**Recommendation:** Phase 10+. Implement after E2E tests are in place to ensure crypto correctness. Consider starting with decrypt/verify-only (read PGP emails) before full send-side encryption.

---

### 2. Read Receipts

**What it is:** Know when a recipient opened your email.

**Effort:** 3-5 days
- MDN header approach (RFC 8098): inject `Disposition-Notification-To` header
- Tracking pixel approach: embed invisible image, host receipt server
- DB table for receipt tracking
- Compose toggle + ThreadList badge

**Risk:** MEDIUM
- Privacy-invasive (GDPR, CCPA implications)
- Most email clients block tracking pixels
- MDN headers: recipients can decline, most clients ignore
- Requires external server for pixel tracking

**User impact:** Low — unreliable due to blocking. Creates false sense of certainty.

**Recommendation:** Skip. The MDN header approach is trivially blocked and the tracking pixel approach requires hosting infrastructure + raises serious privacy concerns. Not worth the reputation risk.

---

### 3. Link Tracking

**What it is:** Track which links recipients click in your emails.

**Effort:** 4-6 days
- Redirect server (rewrite links to `tracking-server.com/click?id=X&url=original`)
- DB table for click tracking
- Compose-time URL rewriting
- Analytics dashboard

**Risk:** HIGH
- Major privacy concern (rewrites all URLs to pass through your server)
- Requires hosted redirect proxy (ongoing infrastructure cost)
- GDPR/CCPA violation without explicit consent
- Breaks trust with recipients

**User impact:** Low — primarily useful for marketers, not personal/business email.

**Recommendation:** Skip entirely. This is a marketing email feature, not a personal email client feature. It conflicts with ExpressDelivery's privacy-forward positioning.

---

### 4. Calendar Integration (RSVP)

**What it is:** Parse iCal invites in emails, show event details, respond with Accept/Decline/Tentative.

**Effort:** 5-7 days
- Add `ical.js` dependency for parsing
- Extract `text/calendar` MIME parts in IMAP sync
- Event display card in ReadingPane (time, location, attendees)
- RSVP buttons that generate iCal response email
- Local event storage (optional)

**Risk:** MEDIUM
- iCal spec is complex (timezones, recurrence rules, multi-attendee)
- Many calendar invite formats (Google, Microsoft, Apple all differ slightly)
- No full calendar view needed — just inline RSVP

**User impact:** HIGH — calendar invites are one of the most common email interactions. Not being able to RSVP forces users to open another app.

**Recommendation:** Phase 10. High user impact, reasonable effort. Start with read-only invite display + basic RSVP (Accept/Decline/Tentative via reply email). Skip full calendar sync initially.

---

### 5. POP3 Protocol

**What it is:** Support for the older POP3 email retrieval protocol (in addition to IMAP).

**Effort:** 4-6 days
- Add POP3 client library
- New `electron/pop3.ts` engine mirroring IMAP interface
- Account protocol selector in Settings
- POP3 has no folders — flatten to Inbox only
- No push notifications (requires polling)

**Risk:** LOW-MEDIUM

**User impact:** Low — POP3 usage is declining (<5% of email users). IMAP is universal for modern providers. POP3 users typically already have IMAP available.

**Recommendation:** Skip. POP3 is legacy. The effort-to-impact ratio is poor. If a specific user requests it, reconsider.

---

### 6. CardDAV Contact Sync

**What it is:** Sync contacts with a remote server (Google, iCloud, Fastmail, Nextcloud) using the CardDAV protocol.

**Effort:** 4-5 days
- Add WebDAV client library
- Settings UI for CardDAV server URL + credentials
- Bidirectional sync with local contacts table
- Conflict resolution (local wins or remote wins)
- Periodic sync via scheduler

**Risk:** MEDIUM — WebDAV servers vary widely in implementation. OAuth for Google/iCloud adds complexity.

**User impact:** Medium — useful for users with contacts in Google/iCloud who want them in the email client.

**Recommendation:** Phase 11. Implement after contact profiles are polished. Pairs well with CalDAV.

---

### 7. CalDAV Calendar Sync

**What it is:** Sync calendars with remote servers using CalDAV protocol.

**Effort:** 4-5 days (after CardDAV infrastructure exists)
- Reuse WebDAV client from CardDAV
- Calendar event storage
- Sidebar calendar view
- Create/edit events

**Risk:** MEDIUM — requires calendar UI which is a significant feature surface.

**User impact:** Medium — only useful if calendar integration (RSVP) is already done.

**Recommendation:** Phase 11, paired with CardDAV. Only after Calendar RSVP (Phase 10) proves demand.

---

### 8. NNTP/RSS Feeds

**What it is:** Read Usenet newsgroups (NNTP) and RSS/Atom feeds within the email client.

**Effort:** 5-8 days
- RSS parser library
- NNTP client library
- Separate data model (feeds don't map to email threads)
- Sidebar section for subscriptions
- Feed article viewer

**Risk:** MEDIUM-HIGH — architectural mismatch with email paradigm. RSS readers are a separate product category.

**User impact:** Very Low — Thunderbird users rarely use this feature. Dedicated RSS readers (Feedly, NetNewsWire) are better.

**Recommendation:** Skip. This is feature creep. Email clients and feed readers are different products. Users who want RSS already have dedicated apps.

---

### 9. Touch/Gesture Support

**What it is:** Swipe gestures for email actions (swipe to archive/delete/read), long-press for context menu.

**Effort:** 2-3 days
- Touch event handlers on ThreadList items
- Swipe-to-action patterns (left = archive, right = delete)
- Long-press context menu
- CSS `touch-action` properties
- Animation feedback

**Risk:** LOW — well-understood patterns, no external dependencies needed.

**User impact:** Medium — important for touch-screen laptops (Surface, convertibles). Low priority for traditional desktop.

**Recommendation:** Phase 10. Quick win with low risk. Enhances the modern feel of the app.

---

### 10. RTL Layout Support

**What it is:** Right-to-left text direction for Arabic, Hebrew, Farsi, Urdu locales.

**Effort:** 3-4 days
- CSS audit: replace `left`/`right` with logical properties (`inline-start`/`inline-end`)
- Add `dir="rtl"` attribute to root element
- RTL locale detection (ar, he, fa, ur)
- Settings toggle for manual override
- Test with RTL text rendering

**Risk:** LOW-MEDIUM — CSS Flexbox/Grid handles RTL well. Main work is auditing existing CSS for hardcoded directions.

**User impact:** Medium — blocks the entire Arabic/Hebrew/Farsi user base. Required for true internationalization.

**Recommendation:** Phase 10. Necessary for i18n completeness. Quick to implement if CSS is already using logical properties.

---

### 11. Company Information (Enrichment)

**What it is:** Display company logo, name, and details next to sender information.

**Effort:** 3-4 days
- External API integration (Clearbit, Hunter.io, or similar)
- API key management + rate limiting
- Company data cache
- UI: logo + info in ReadingPane header

**Risk:** HIGH
- Privacy: sends email addresses to third-party API
- Cost: enrichment APIs charge per lookup ($50-200/mo for reasonable volume)
- Rate limits: may fail silently at scale
- GDPR: requires disclosure of data sharing

**User impact:** Low — nice-to-have visual enhancement. No functional benefit.

**Recommendation:** Skip. Poor cost-to-benefit ratio. Privacy implications outweigh the cosmetic benefit.

---

### 12. Code Signing

**What it is:** Digitally sign the application binary so OS trusts it (no "unknown developer" warnings).

**Effort:** 1-2 days (infrastructure, not code)
- Windows: Purchase EV code signing certificate (~$200-400/year), configure CSC_LINK in CI
- macOS: Apple Developer account ($99/year), configure notarization
- CI/CD: Add secrets to GitHub Actions

**Risk:** LOW — configuration only, no code changes needed. electron-builder.json5 already configured.

**User impact:** HIGH — without signing, Windows SmartScreen blocks installation. macOS Gatekeeper refuses to open. This is a distribution blocker.

**Recommendation:** Phase 10 (high priority). Required before any public distribution. Budget ~$500/year for certificates.

---

### 13. SQLCipher At-Rest Encryption

**What it is:** Encrypt the local SQLite database so email data is protected if the device is stolen.

**Effort:** 3-5 days
- Replace `better-sqlite3` with `@journeyapps/sqlcipher`
- Migration: export plaintext → encrypted copy
- Key derived from OS keychain
- Update clean-build.mjs for OpenSSL dependency
- Cross-platform testing (Windows/Linux/macOS build variations)

**Risk:** MEDIUM
- Build complexity (SQLCipher needs OpenSSL)
- Cross-platform compilation differences
- 5-15% query performance overhead
- Key management (lost key = lost data)

**User impact:** Low for most users — modern OS already provides full-disk encryption (BitLocker, FileVault, LUKS). SQLCipher adds defense-in-depth but is redundant for most setups.

**Recommendation:** Phase 11. Implement only if compliance requirements demand it (HIPAA, SOC2). For most users, OS-level encryption is sufficient.

---

### 14. E2E Tests (Playwright)

**What it is:** Full end-to-end tests that launch the Electron app and simulate real user interactions.

**Effort:** 10-14 days
- Add Playwright + Electron adapter
- Mock IMAP server (or test fixtures)
- Test critical paths: add account, send email, search, reply/forward
- CI integration (headless mode)

**Risk:** MEDIUM — IMAP mocking is complex; test environment setup is fragile.

**User impact:** N/A (quality) — prevents regressions, enables confident refactoring.

**Recommendation:** Phase 10. Critical for long-term maintainability. The IMAP client is currently untested (P1 risk). Start with Playwright UI-only tests, add IMAP mock later.

---

### 15. Integration Tests

**What it is:** Multi-component tests that verify IPC communication and state management flows.

**Effort:** 5-8 days
- Test compose → send → appear in list flows
- Test archive/delete → folder update flows
- Test search → filter → display flows
- Expand existing Vitest infrastructure

**Risk:** LOW — builds on existing test patterns. No new dependencies needed.

**User impact:** N/A (quality) — catches bugs at component boundaries.

**Recommendation:** Phase 10. High value, low risk. Should be done alongside E2E tests.

---

## Recommended Phase 10 (v1.8.0) Roadmap

Based on this analysis, the highest-value next phase would be:

1. **Code Signing** (1-2 days) — distribution blocker
2. **Touch/Gesture Support** (2-3 days) — quick win, modern feel
3. **RTL Layout** (3-4 days) — i18n completeness
4. **Calendar RSVP** (5-7 days) — highest user impact
5. **E2E Tests** (10-14 days) — quality foundation
6. **Integration Tests** (5-8 days) — quality expansion

**Total estimated effort:** ~30-40 days

## Features to Skip Permanently

- **Read Receipts** — privacy-invasive, unreliable
- **Link Tracking** — privacy-invasive, requires infrastructure
- **POP3** — legacy protocol, negligible user base
- **NNTP/RSS** — architectural mismatch, separate product category
- **Company Information** — privacy + cost concerns, low impact
