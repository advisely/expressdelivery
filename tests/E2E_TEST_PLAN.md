# ExpressDelivery E2E Test Plan

Comprehensive end-to-end test plan for the ExpressDelivery Electron email client. These tests validate user-facing workflows across the full stack: UI (React/Radix) -> IPC -> Electron main process (SQLite, IMAP, SMTP, MCP).

**Test Framework:** Playwright for Electron (not yet implemented)
**Current Unit Coverage:** ~76% (646 tests, 27 files, Vitest + jsdom)

---

## Prerequisites

### Test Environment

| Component | Setup |
|-----------|-------|
| IMAP/SMTP server | GreenMail (Java) or docker-mailserver with known test accounts |
| SQLite DB | Fresh per-spec; seeded via `electron/db.ts` migration runner |
| MCP server | Enabled on default port 3000 with known test token |
| OpenRouter API | Mock HTTP server returning canned responses (no real LLM calls) |
| OS keychain | safeStorage may not be available in CI; use `--disable-features=Encryption` or mock |
| User data | Isolated `userData` directory per spec via Electron `--user-data-dir` |

### Test Account Fixtures

| Account | Provider | IMAP Host | SMTP Host | Purpose |
|---------|----------|-----------|-----------|---------|
| test1@example.com | Custom | localhost:993 | localhost:587 | Primary test account |
| test2@example.com | Custom | localhost:993 | localhost:587 | Multi-account scenarios |

### Test Data

- 50 pre-seeded emails in INBOX (varied subjects, senders, dates, HTML/plain text mix)
- 5 emails with attachments (PDF, PNG, TXT)
- 3 email threads (3-5 messages each)
- 10 contacts in contacts table
- 2 drafts in drafts table

---

## Test Scenarios

### 1. Onboarding and Account Management

#### E2E-ACCT-001: First-run onboarding wizard (P0)
**Prerequisites:** Fresh app install, no accounts configured
**Steps:**
1. Launch app
2. Verify onboarding screen displays with welcome animation
3. Click "Get Started"
4. Select Gmail provider preset
5. Verify IMAP/SMTP fields auto-populate (imap.gmail.com:993, smtp.gmail.com:587)
6. Enter email and password
7. Click "Test Connection"
8. Verify connection test shows pass/fail indicator within 10s
9. Click "Save Account"
10. Verify redirect to main email view with INBOX selected
**Expected Result:** Account created, IMAP sync begins, emails appear in ThreadList

#### E2E-ACCT-002: Add second account (P0)
**Prerequisites:** One account configured
**Steps:**
1. Open Settings (gear icon)
2. Navigate to Accounts tab
3. Click "Add Account"
4. Fill in test2@example.com with Custom provider
5. Enter IMAP/SMTP host, port, credentials
6. Click "Test Connection" -- verify success
7. Click "Save"
8. Close Settings
9. Verify second account appears in Sidebar
**Expected Result:** Both accounts visible in Sidebar with provider icons

#### E2E-ACCT-003: Edit existing account (P1)
**Prerequisites:** Account configured
**Steps:**
1. Open Settings > Accounts
2. Click edit on existing account
3. Change display name
4. Click "Test Connection" -- verify success
5. Save changes
6. Verify display name updated in Sidebar
**Expected Result:** Account updated without re-adding

#### E2E-ACCT-004: Delete account with confirmation (P1)
**Prerequisites:** Two accounts configured
**Steps:**
1. Open Settings > Accounts
2. Click delete on second account
3. Verify ConfirmDialog appears with warning text
4. Click "Confirm"
5. Verify account removed from Sidebar
6. Verify emails for that account no longer appear
**Expected Result:** Account and all associated data removed

#### E2E-ACCT-005: Connection test failure (P1)
**Prerequisites:** Settings open
**Steps:**
1. Enter invalid IMAP host (nonexistent.example.com)
2. Click "Test Connection"
3. Wait for 10s timeout
4. Verify failure indicator with error message
**Expected Result:** Clear failure feedback, Save button still accessible

#### E2E-ACCT-006: Switch between accounts in Sidebar (P0)
**Prerequisites:** Two accounts configured with emails
**Steps:**
1. Click first account in Sidebar
2. Verify ThreadList shows first account's emails
3. Click second account in Sidebar
4. Verify ThreadList updates to second account's emails
5. Verify unread badges are per-account
**Expected Result:** Smooth account switching with correct email lists

---

### 2. Email Operations

#### E2E-EMAIL-001: View email in ReadingPane (P0)
**Prerequisites:** Emails in INBOX
**Steps:**
1. Click an email in ThreadList
2. Verify ReadingPane displays subject, sender, date
3. Verify HTML body renders in sandboxed iframe
4. Verify email marked as read (visual indicator changes)
**Expected Result:** Email content displayed, read state updated

#### E2E-EMAIL-002: Star/unstar email (P0)
**Prerequisites:** Email visible in ThreadList
**Steps:**
1. Click star icon on an email in ThreadList
2. Verify star fills/highlights
3. Click star again
4. Verify star unfills
**Expected Result:** Star state toggles in both ThreadList and ReadingPane

#### E2E-EMAIL-003: Delete email to Trash (P0)
**Prerequisites:** Email selected in ReadingPane
**Steps:**
1. Click Delete button in ReadingPane toolbar
2. Verify confirmation toast appears
3. Verify email removed from current folder
4. Navigate to Trash folder
5. Verify email appears in Trash
**Expected Result:** Email moved to Trash, not permanently deleted

#### E2E-EMAIL-004: Archive email (P1)
**Prerequisites:** Email selected in ReadingPane
**Steps:**
1. Click Archive button (or press E)
2. Verify email removed from INBOX
3. Navigate to Archive folder
4. Verify email present
**Expected Result:** Email moved to Archive via IMAP MOVE

#### E2E-EMAIL-005: Move email between folders (P1)
**Prerequisites:** Email selected, multiple folders exist
**Steps:**
1. Click Move dropdown in ReadingPane
2. Select target folder from list
3. Verify email removed from current folder
4. Navigate to target folder
5. Verify email present
**Expected Result:** Email moved, toast confirmation shown

#### E2E-EMAIL-006: Multi-select with Ctrl+click (P0)
**Prerequisites:** Multiple emails in ThreadList
**Steps:**
1. Click first email
2. Ctrl+click second and third emails
3. Verify bulk action toolbar appears
4. Verify selected count shows "3 selected"
5. Click "Mark Read" bulk action
6. Verify all 3 emails marked as read
**Expected Result:** Multi-select works, bulk actions apply to all selected

#### E2E-EMAIL-007: Shift+click range select (P1)
**Prerequisites:** 10+ emails in ThreadList
**Steps:**
1. Click email at position 2
2. Shift+click email at position 7
3. Verify 6 emails selected (positions 2-7)
4. Verify bulk toolbar shows "6 selected"
**Expected Result:** Range selection works correctly

#### E2E-EMAIL-008: Right-click context menu (P1)
**Prerequisites:** Email in ThreadList
**Steps:**
1. Right-click an email
2. Verify context menu appears (Reply, Forward, Star, Toggle Read, Move To, Delete)
3. Click "Reply"
4. Verify ComposeModal opens with reply prefill
**Expected Result:** Context menu functional with all options

#### E2E-EMAIL-009: Empty Trash (P1)
**Prerequisites:** Emails in Trash folder
**Steps:**
1. Navigate to Trash folder
2. Right-click Trash folder or use context menu
3. Click "Empty Trash"
4. Verify ConfirmDialog appears
5. Confirm
6. Verify Trash folder is empty
**Expected Result:** All Trash emails permanently deleted

#### E2E-EMAIL-010: Drag-and-drop email to folder (P2)
**Prerequisites:** Email in INBOX, Drafts folder in Sidebar
**Steps:**
1. Click and hold an email in ThreadList
2. Drag to a folder in Sidebar
3. Verify drop indicator appears on target folder
4. Release
5. Verify email moved to target folder
**Expected Result:** Drag-and-drop moves email

#### E2E-EMAIL-011: Thread conversation view (P1)
**Prerequisites:** Email thread with 3+ messages
**Steps:**
1. Click a threaded email
2. Verify ReadingPane shows thread count
3. Verify older messages are collapsed (showing avatar + snippet)
4. Click collapsed message header to expand
5. Verify message body appears
6. Click again to collapse
**Expected Result:** Thread collapse/expand works, latest message always expanded

---

### 3. Compose and Send

#### E2E-COMPOSE-001: Compose new email (P0)
**Prerequisites:** Account configured
**Steps:**
1. Press Mod+N (or click Compose button)
2. Verify ComposeModal opens with TipTap editor
3. Enter recipient in To field
4. Enter subject
5. Type body text with bold formatting
6. Click Send
7. Verify email sent (check SMTP server received it)
8. Verify ComposeModal closes
**Expected Result:** Email delivered via SMTP

#### E2E-COMPOSE-002: Reply to email (P0)
**Prerequisites:** Email selected in ReadingPane
**Steps:**
1. Click Reply button (or press R)
2. Verify ComposeModal opens with To pre-filled (original sender)
3. Verify Subject pre-filled with "Re: " prefix
4. Verify quoted original body present
5. Type reply text
6. Click Send
**Expected Result:** Reply sent to original sender with quoted body

#### E2E-COMPOSE-003: Forward email (P0)
**Prerequisites:** Email selected in ReadingPane
**Steps:**
1. Click Forward button (or press F)
2. Verify Subject pre-filled with "Fwd: " prefix
3. Verify forwarded body present
4. Enter new recipient
5. Click Send
**Expected Result:** Forwarded email sent to new recipient

#### E2E-COMPOSE-004: CC/BCC fields (P1)
**Prerequisites:** ComposeModal open
**Steps:**
1. Click CC/BCC toggle to expand
2. Enter CC recipient
3. Enter BCC recipient
4. Send email
5. Verify SMTP envelope includes CC and BCC
**Expected Result:** CC visible in sent email headers, BCC hidden

#### E2E-COMPOSE-005: Contact autocomplete (P0)
**Prerequisites:** Contacts in database, ComposeModal open
**Steps:**
1. Start typing a known contact name in To field
2. Verify dropdown appears with matching contacts
3. Use keyboard arrow down to highlight
4. Press Enter to select
5. Verify contact added as recipient chip
**Expected Result:** ARIA combobox autocomplete works with keyboard navigation

#### E2E-COMPOSE-006: File attachment (P1)
**Prerequisites:** ComposeModal open
**Steps:**
1. Click attachment button (paperclip icon)
2. Select a file under 25MB
3. Verify attachment chip appears in compose area
4. Send email
5. Verify recipient receives email with attachment
**Expected Result:** Attachment delivered via SMTP

#### E2E-COMPOSE-007: Draft auto-save (P1)
**Prerequisites:** ComposeModal open
**Steps:**
1. Enter To, Subject, Body text
2. Wait 3 seconds (2s debounce + buffer)
3. Close ComposeModal without sending
4. Navigate to Drafts folder
5. Click the draft
6. Verify all fields preserved (To, Subject, Body, CC/BCC)
**Expected Result:** Draft saved and fully resumable

#### E2E-COMPOSE-008: Undo send (P1)
**Prerequisites:** Undo send delay configured (e.g., 5s)
**Steps:**
1. Compose and send an email
2. Verify countdown toast appears with cancel button
3. Click "Cancel" before countdown expires
4. Verify ComposeModal re-opens with email content
5. Verify email was NOT delivered
**Expected Result:** Send cancelled, email returned to compose state

#### E2E-COMPOSE-009: Scheduled send (P2)
**Prerequisites:** ComposeModal open
**Steps:**
1. Click Send Later (split button dropdown)
2. Select "Tomorrow 9am" quick preset
3. Verify scheduled confirmation
4. Navigate to Scheduled virtual folder in Sidebar
5. Verify email appears with scheduled time
**Expected Result:** Email queued for future delivery

#### E2E-COMPOSE-010: Per-account signature (P1)
**Prerequisites:** Account has signature configured
**Steps:**
1. Open ComposeModal
2. Verify signature preview appears at bottom of compose area
3. Send email
4. Verify sent email includes signature HTML
**Expected Result:** Signature appended to outgoing email

#### E2E-COMPOSE-011: AI compose assistant (P2)
**Prerequisites:** OpenRouter API key configured, mock server running
**Steps:**
1. Reply to an email
2. Click Sparkles button in TipTap toolbar
3. Select "Professional" tone from dropdown
4. Verify loading spinner appears
5. Verify AI-generated reply text inserted into editor
6. Edit the generated text
7. Send
**Expected Result:** AI reply generated, editable, and sendable

---

### 4. Search

#### E2E-SEARCH-001: Full-text search (P0)
**Prerequisites:** Emails with known content in database
**Steps:**
1. Click search bar in ThreadList header
2. Type a known keyword from an email subject
3. Wait 300ms (debounce)
4. Verify search results appear in ThreadList
5. Verify matching emails highlighted/displayed
**Expected Result:** FTS5 search returns relevant results

#### E2E-SEARCH-002: Clear search (P0)
**Prerequisites:** Active search results displayed
**Steps:**
1. Click clear/X button in search bar
2. Verify full email list restored
**Expected Result:** Search cleared, original folder contents shown

#### E2E-SEARCH-003: Save search as virtual folder (P2)
**Prerequisites:** Active search with results
**Steps:**
1. Click "Save Search" button
2. Enter name for saved search
3. Verify saved search appears in Sidebar under Saved Searches section
4. Click saved search folder
5. Verify results match original query
**Expected Result:** Saved search persisted and executable

---

### 5. Folders and Navigation

#### E2E-FOLDER-001: Create subfolder (P1)
**Prerequisites:** Account with INBOX
**Steps:**
1. Right-click INBOX in Sidebar (or click three-dot menu)
2. Select "Create Subfolder"
3. Enter folder name "Test Subfolder"
4. Verify new folder appears nested under INBOX
**Expected Result:** Folder created in IMAP and displayed in Sidebar

#### E2E-FOLDER-002: Rename folder (P1)
**Prerequisites:** User-created folder exists
**Steps:**
1. Right-click folder in Sidebar
2. Select "Rename"
3. Enter new name
4. Verify folder renamed in Sidebar
5. Verify emails preserved in renamed folder
**Expected Result:** Folder renamed, emails intact (transactional rename)

#### E2E-FOLDER-003: Delete folder (P1)
**Prerequisites:** Empty user-created folder
**Steps:**
1. Right-click folder
2. Select "Delete"
3. Verify ConfirmDialog appears
4. Confirm deletion
5. Verify folder removed from Sidebar
**Expected Result:** Folder deleted from IMAP and local DB

#### E2E-FOLDER-004: Folder color (P2)
**Prerequisites:** Folder in Sidebar
**Steps:**
1. Right-click folder
2. Select color from color picker
3. Verify folder left-border shows chosen color
**Expected Result:** Color persisted and displayed

#### E2E-FOLDER-005: Unified inbox (P0)
**Prerequisites:** Two accounts configured with emails
**Steps:**
1. Click "All Inboxes" (unified inbox) in Sidebar
2. Verify ThreadList shows emails from both accounts
3. Verify provider badge appears on each email
4. Click an email and verify reply uses correct account
**Expected Result:** Unified view with correct per-email account routing

#### E2E-FOLDER-006: Mark all as read (P1)
**Prerequisites:** Folder with unread emails
**Steps:**
1. Right-click folder in Sidebar
2. Select "Mark All as Read"
3. Verify all emails in folder show as read
4. Verify unread badge updates to 0
**Expected Result:** All emails marked read in batch

---

### 6. Keyboard Shortcuts

#### E2E-KB-001: Compose shortcut Mod+N (P0)
**Prerequisites:** Main view focused
**Steps:**
1. Press Cmd+N (Mac) or Ctrl+N (Windows)
2. Verify ComposeModal opens
**Expected Result:** Compose opens via keyboard

#### E2E-KB-002: Navigate with J/K (P1)
**Prerequisites:** Multiple emails in ThreadList
**Steps:**
1. Press J to move down one email
2. Verify next email selected and displayed in ReadingPane
3. Press K to move up
4. Verify previous email selected
**Expected Result:** J/K navigation works through email list

#### E2E-KB-003: Delete shortcut (P1)
**Prerequisites:** Email selected
**Steps:**
1. Press Delete key
2. Verify email moved to Trash
3. Verify next email auto-selected
**Expected Result:** Delete key works as expected

#### E2E-KB-004: Shortcut help overlay (P2)
**Prerequisites:** Main view focused
**Steps:**
1. Press ? key
2. Verify keyboard shortcut help overlay appears
3. Verify all shortcuts listed (Mod+N, R, F, E, J, K, Delete, Escape, Ctrl+A)
4. Press Escape to close
**Expected Result:** Help overlay displays and dismisses

---

### 7. Settings

#### E2E-SETTINGS-001: Theme switching (P1)
**Prerequisites:** App running with default Light theme
**Steps:**
1. Open Settings > Appearance
2. Select "Midnight" theme
3. Verify app immediately applies dark theme
4. Close and reopen app
5. Verify theme persisted
**Expected Result:** Theme applied and persisted via Zustand/localStorage

#### E2E-SETTINGS-002: Layout toggle (P1)
**Prerequisites:** Default vertical layout
**Steps:**
1. Open Settings > Appearance
2. Switch to "Horizontal" layout
3. Verify ReadingPane moves below ThreadList
4. Switch back to "Vertical"
5. Verify 3-pane layout restored
**Expected Result:** Layout toggles between vertical and horizontal

#### E2E-SETTINGS-003: Language switching (P2)
**Prerequisites:** Default English locale
**Steps:**
1. Open Settings > Appearance
2. Switch language to French
3. Verify UI labels update to French translations
4. Switch back to English
**Expected Result:** i18n locale applied across all components

#### E2E-SETTINGS-004: Density mode (P2)
**Prerequisites:** Default comfortable density
**Steps:**
1. Open Settings > Appearance
2. Switch to "Compact" density
3. Verify ThreadList rows are shorter
4. Switch to "Relaxed"
5. Verify rows are taller
**Expected Result:** CSS variables update row height/padding

---

### 8. MCP Integration

#### E2E-MCP-001: MCP server starts on launch (P0)
**Prerequisites:** MCP enabled in settings
**Steps:**
1. Launch app
2. Verify MCP server listening on configured port (default 3000)
3. Verify Sidebar shows MCP status indicator
**Expected Result:** Server running, status visible

#### E2E-MCP-002: Agent connects via SSE (P0)
**Prerequisites:** MCP server running, known auth token
**Steps:**
1. Connect MCP client to http://127.0.0.1:3000/sse with Bearer token
2. Verify SSE connection established (receive endpoint event)
3. Verify Sidebar agent count increments to 1
4. Disconnect client
5. Verify agent count decrements to 0
**Expected Result:** Agent lifecycle tracked in UI

#### E2E-MCP-003: search_emails tool (P0)
**Prerequisites:** Agent connected, emails in database
**Steps:**
1. Call search_emails with query matching known email
2. Verify response contains matching emails with AI metadata fields
3. Verify max 20 results
**Expected Result:** FTS5 search works via MCP

#### E2E-MCP-004: categorize_email tool (P1)
**Prerequisites:** Agent connected, email exists
**Steps:**
1. Call categorize_email with category "work", priority 3, labels ["urgent"]
2. Verify response confirms categorization
3. In the UI, verify the email shows priority badge and category pill
**Expected Result:** AI metadata written to DB, reflected in UI

#### E2E-MCP-005: create_draft tool (P1)
**Prerequisites:** Agent connected, account exists
**Steps:**
1. Call create_draft with account_id, to, subject, html
2. Verify response returns draft UUID
3. In the UI, navigate to Drafts folder
4. Verify new draft appears with correct content
**Expected Result:** Draft created via MCP, visible in UI

#### E2E-MCP-006: Token regeneration disconnects agents (P1)
**Prerequisites:** Agent connected
**Steps:**
1. Open Settings > Agentic
2. Click "Regenerate Token"
3. Confirm in dialog
4. Verify agent connection drops
5. Verify new token shown in Settings
6. Verify old token no longer accepted
**Expected Result:** Token rotation invalidates existing connections

#### E2E-MCP-007: Cross-account ownership rejection (P0)
**Prerequisites:** Two accounts, agent connected
**Steps:**
1. Call categorize_email with account_id of account A but email_id belonging to account B
2. Verify error response: "Email does not belong to the specified account"
**Expected Result:** Cross-account access blocked

---

### 9. Security Features

#### E2E-SEC-001: Remote image blocking (P0)
**Prerequisites:** Email with remote images
**Steps:**
1. Open email with external image references
2. Verify images NOT loaded (blocked by default)
3. Verify privacy banner "Remote images blocked" displayed
4. Click "Load Images"
5. Verify images load
**Expected Result:** Images blocked by default, user opt-in required

#### E2E-SEC-002: Phishing detection banner (P1)
**Prerequisites:** Email with suspicious URLs (IP-based, long subdomain chains)
**Steps:**
1. Open email containing phishing-pattern URLs
2. Verify red warning banner appears in ReadingPane
3. Verify warning text identifies the threat type
**Expected Result:** Phishing heuristics trigger visual warning

#### E2E-SEC-003: Spam report (P2)
**Prerequisites:** Email in INBOX
**Steps:**
1. Click "Report Spam" button on email
2. Verify email moved to Spam/Junk
3. Verify spam filter trained on this message
**Expected Result:** Bayesian filter updated, email classified

---

### 10. Data Portability

#### E2E-PORT-001: Export email as EML (P1)
**Prerequisites:** Email selected
**Steps:**
1. Click "Save as EML" in ReadingPane
2. Choose save location
3. Verify .eml file created with correct RFC 2822 content
**Expected Result:** Valid EML file exported

#### E2E-PORT-002: Export folder as MBOX (P2)
**Prerequisites:** Folder with emails
**Steps:**
1. Right-click folder in Sidebar
2. Select "Export as MBOX"
3. Choose save location
4. Verify .mbox file contains all folder emails
**Expected Result:** Valid MBOX file exported

#### E2E-PORT-003: Import EML file (P1)
**Prerequisites:** Valid .eml file available
**Steps:**
1. Click "Import emails" in Sidebar
2. Select .eml file
3. Verify email imported and appears in INBOX
**Expected Result:** Email imported to database

#### E2E-PORT-004: Import MBOX file (P2)
**Prerequisites:** Valid .mbox file with multiple emails
**Steps:**
1. Click "Import emails" in Sidebar
2. Select .mbox file
3. Verify emails imported (up to 1000 cap)
4. Verify import count shown in confirmation
**Expected Result:** Batch import with progress feedback

#### E2E-PORT-005: Contact export as vCard (P2)
**Prerequisites:** Contacts in database
**Steps:**
1. Open Settings > Contacts
2. Click "Export vCard"
3. Verify .vcf file created with all contacts
**Expected Result:** Valid vCard 3.0 file

#### E2E-PORT-006: Contact import from CSV (P2)
**Prerequisites:** Valid CSV file with name,email columns
**Steps:**
1. Open Settings > Contacts
2. Click "Import"
3. Select CSV file
4. Verify contacts added to database
5. Verify autocomplete finds imported contacts
**Expected Result:** Contacts imported and searchable

---

## Summary

| Priority | Count | Description |
|----------|-------|-------------|
| P0 | 16 | Critical path -- release blocking |
| P1 | 27 | Important -- regression blocking |
| P2 | 17 | Advisory -- quality improvement |
| **Total** | **60** | |

## Traceability Matrix

| Feature Area | Test IDs | CLAUDE.md Coverage |
|---|---|---|
| Account management | ACCT-001 to 006 | Phase 1 |
| Email operations | EMAIL-001 to 011 | Phase 1, 6, 8 |
| Compose and send | COMPOSE-001 to 011 | Phase 2, 4, 8 |
| Search | SEARCH-001 to 003 | Phase 1, 7 |
| Folders | FOLDER-001 to 006 | Phase 6, 7 |
| Keyboard shortcuts | KB-001 to 004 | Phase 2, 6 |
| Settings | SETTINGS-001 to 004 | Phase 4, 5, 7 |
| MCP integration | MCP-001 to 007 | Phase 3, 8 |
| Security | SEC-001 to 003 | Phase 2, 7 |
| Data portability | PORT-001 to 006 | Phase 7 |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| IMAP client untested (P1 per CLAUDE.md) | E2E tests with GreenMail provide first real IMAP coverage |
| safeStorage unavailable in CI | Mock encryption or use `--disable-features=Encryption` flag |
| Scheduler polling (30s) causes slow tests | Mock timers or reduce poll interval for E2E |
| Draft auto-save debounce (2s) causes flaky tests | Wait for save confirmation rather than fixed delays |
| MCP SSE connection races | Explicit wait for SSE endpoint event before tool calls |
