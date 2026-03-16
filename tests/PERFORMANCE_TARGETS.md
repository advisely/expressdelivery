# ExpressDelivery Performance Targets

Measurable performance budgets, latency targets, and profiling guidelines for the ExpressDelivery Electron email client. All targets assume a modern machine (8GB RAM, SSD, broadband connection).

**Application Profile:** Electron 40, React 19, SQLite (WAL + FTS5), IMAPFlow, Express 5 MCP server
**Target Workload:** Daily-driver email client handling 1,000-50,000 emails per account

---

## 1. Startup Performance

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Window visible (first paint) | < 3s | Electron `ready-to-show` event timestamp minus app launch |
| UI interactive (React hydrated) | < 4s | First Contentful Paint via DevTools Performance tab |
| IMAP connected + INBOX synced | < 10s | Time from app launch to first IDLE state |
| MCP server listening | < 1s | Port open after `getMcpServer().start()` |
| SQLite DB open + migrations | < 500ms | `db.ts` initialization timing (12 migrations short-circuit) |
| Full startup (all accounts connected) | < 15s | All IMAP clients in IDLE state |

### Startup Optimization Notes

- Migration runner short-circuits at `CURRENT_SCHEMA_VERSION` (no-op when DB is current)
- MCP server lazy-initialized via `getMcpServer()` -- no startup cost when disabled
- IMAP body fetch deferred to on-demand (only envelopes + bodyStructure at startup)
- Preload CJS bundle should be < 50KB

---

## 2. Runtime Performance -- Email Operations

| Metric | Target | Conditions |
|--------|--------|-----------|
| Email list render (100 items) | < 100ms | ThreadList with 100 EmailSummary rows |
| Email list render (1000 items) | < 500ms | Large folder scenario |
| Click email -> ReadingPane displayed | < 200ms | Cached body (SQLite hit) |
| Click email -> ReadingPane (IMAP fetch) | < 2s | On-demand body fetch from IMAP server (network-dependent) |
| FTS5 search query (simple) | < 100ms | 10,000 email corpus, single-term query |
| FTS5 search query (complex) | < 300ms | Boolean operators, large corpus |
| Folder switch | < 150ms | Change folder, reload email list from SQLite |
| Multi-select 50 emails | < 50ms | Shift+click range selection in ThreadList |
| Bulk action (mark read 50 emails) | < 500ms | SQLite batch UPDATE in transaction |
| Contact autocomplete | < 100ms | 500 contacts, after 200ms debounce |
| Thread expand/collapse | < 50ms | Toggle single thread message in ReadingPane |

---

## 3. Runtime Performance -- Compose and Send

| Metric | Target | Conditions |
|--------|--------|-----------|
| ComposeModal open | < 200ms | Including TipTap editor initialization |
| Draft auto-save | < 100ms | SQLite upsert (2s debounce before trigger) |
| Send email (no attachments) | < 3s | SMTP delivery (network-dependent) |
| Send email (5MB attachments) | < 10s | SMTP with base64 encoding (network-dependent) |
| AI compose reply (OpenRouter) | < 20s | Network-dependent, 15s AbortController timeout |
| Signature append | < 10ms | HTML string concatenation + DOMPurify |

---

## 4. IMAP Sync Performance

| Metric | Target | Conditions |
|--------|--------|-----------|
| Initial sync (100 emails) | < 5s | Envelope + bodyStructure only |
| Initial sync (1000 emails) | < 30s | Envelope + bodyStructure only |
| Initial sync (5000 emails) | < 120s | Envelope + bodyStructure only |
| Incremental sync (IDLE notify) | < 1s | New email arrives via IDLE |
| Folder list sync | < 2s | `listAndSyncFolders()` with RFC 6154 |
| Reconnect after disconnect | < 5s | Exponential backoff, first retry (1s base) |
| Body fetch (single email) | < 1s | On-demand IMAP FETCH (network-dependent) |
| Attachment download (5MB) | < 10s | IMAP FETCH + SQLite BLOB cache write (network-dependent) |
| CID image resolution | < 500ms | `attachments:by-cid` IPC + IMAP fetch if not cached |

---

## 5. MCP Server Performance

| Metric | Target | Conditions |
|--------|--------|-----------|
| SSE connection established | < 500ms | Agent connect + session creation + tool discovery |
| Tool call: `search_emails` | < 200ms | FTS5 query, 20 result limit |
| Tool call: `read_thread` | < 100ms | Thread lookup by thread_id |
| Tool call: `get_smart_summary` | < 300ms | 6 aggregation SQL queries |
| Tool call: `categorize_email` | < 50ms | Single UPDATE statement |
| Tool call: `create_draft` | < 50ms | Single INSERT statement |
| Tool call: `send_email` | < 5s | SMTP delivery (network-dependent) |
| Tool call: `get_email_analytics` | < 500ms | Aggregation over 30-day window |
| Tool call: `suggest_reply` | < 200ms | Context assembly (5 SQL queries, body truncation) |
| Concurrent agents (5 clients) | Stable | No degradation, no session crosstalk, Map lookup O(1) |
| Concurrent agents (10 clients) | Stable | Upper bound for local use |

---

## 6. Memory Budgets

| Component | Budget | Notes |
|-----------|--------|-------|
| Total Electron (main + renderer) | < 500MB | At rest, 1 account, 1000 emails loaded |
| Renderer process heap | < 300MB | React 19 + Zustand + DOM + TipTap |
| Main process heap | < 150MB | SQLite + IMAPFlow + MCP Express server |
| SQLite WAL file | < 50MB | Auto-checkpoint at 1000 pages |
| Per additional account | < 50MB | Additional IMAPFlow client + cached data |
| Large mailbox (50K emails) | < 800MB | Total memory, email list virtualized |
| Attachment BLOB cache (total) | < 200MB | SQLite BLOB storage, eviction policy TBD |

### Memory Red Flags

- Main process heap > 200MB at rest: investigate SQLite statement caching or IMAPFlow buffer leak
- Renderer heap > 400MB: check for Zustand subscription cascade or TipTap editor leak
- WAL file > 100MB: force checkpoint via `PRAGMA wal_checkpoint(TRUNCATE)`
- Memory growth > 50MB/hour during IDLE: likely IMAP event buffer accumulation

---

## 7. SQLite Performance

| Operation | Target | Index Used |
|-----------|--------|-----------|
| Email lookup by ID | < 1ms | PRIMARY KEY |
| Email list by folder | < 10ms | `idx_emails_folder_date` |
| FTS5 MATCH query | < 100ms | FTS5 virtual table |
| Unread count by folder | < 5ms | `idx_emails_folder_date` + `is_read` filter |
| Contact autocomplete | < 10ms | `idx_contacts_name_email` |
| Tag lookup by email | < 5ms | `email_tags` junction + FK index |
| Analytics aggregation (30 days) | < 200ms | Date-range scan with `strftime` |

### SQLite Optimization Checklist

- [ ] All frequent queries have covering indexes
- [ ] `EXPLAIN QUERY PLAN` shows no full table scans on email/folder queries
- [ ] WAL mode enabled (verified on DB open)
- [ ] FTS5 rebuild scheduled after bulk import (`INSERT INTO emails_fts(emails_fts) VALUES('rebuild')`)
- [ ] Prepared statements cached (better-sqlite3 does this automatically)
- [ ] Large transactions batched (e.g., bulk mark-read uses single transaction)

---

## 8. Build Performance

| Metric | Target |
|--------|--------|
| TypeScript compilation (`tsc --noEmit`) | < 30s |
| Vite dev server start | < 5s |
| Vite production build | < 60s |
| electron-builder package (--dir) | < 120s |
| Full clean-build (`scripts/clean-build.mjs`) | < 180s |
| Vitest full suite (646+ tests) | < 60s |
| Vitest single file | < 5s |
| ESLint full project | < 30s |
| Native dep rebuild (`@electron/rebuild`) | < 60s |

---

## 9. Network Performance

| Metric | Target | Notes |
|--------|--------|-------|
| IMAP STARTTLS handshake | < 2s | Port 587, STARTTLS upgrade |
| IMAP TLS handshake | < 1s | Port 993, direct TLS |
| SMTP TLS handshake | < 1s | Port 465/587 |
| OpenRouter API round-trip | < 15s | AbortController timeout enforced |
| MCP SSE keepalive | 30s interval | Prevents proxy/firewall timeout |

---

## 10. Profiling Checklist

Step-by-step guide for diagnosing performance issues:

### Startup Profiling
1. Open Electron with `--inspect` flag: `electron . --inspect=9229`
2. Connect Chrome DevTools to `chrome://inspect`
3. Record Performance trace from app launch to IDLE state
4. Check marks: FCP < 4s, IMAP connected < 10s, total startup < 15s

### Renderer Profiling
1. Open DevTools (Help > Toggle Developer Tools or Ctrl+Shift+I)
2. Performance tab: record folder switch or email click
3. React Profiler: identify unnecessary re-renders in ThreadList, ReadingPane
4. Check Zustand selectors: verify scoped selectors prevent cascade renders
5. Memory tab: take heap snapshot, compare before/after email list load

### Main Process Profiling
1. Launch with `--inspect` and connect Chrome DevTools
2. Profile CPU during IMAP sync (heavy SQLite writes)
3. Check prepared statement cache hits in better-sqlite3
4. Monitor memory during IDLE (should be flat, not growing)

### SQLite Query Profiling
1. Enable query timing: `db.pragma('compile_options')` to verify FTS5
2. Run `EXPLAIN QUERY PLAN` on slow queries
3. Check index usage: no `SCAN TABLE` on emails or folders
4. Profile WAL checkpoint duration: `PRAGMA wal_checkpoint(PASSIVE)`

### IPC Profiling
1. Add `console.time`/`console.timeEnd` to critical IPC handlers
2. Measure round-trip: renderer invoke -> main handler -> response
3. Critical paths: `emails:list`, `emails:read`, `folders:list`, `search`
4. Flag any IPC call > 100ms for optimization

### IMAP Profiling
1. Log IMAPFlow events: connect, authenticated, mailboxOpen, fetch, idle
2. Measure envelope sync throughput (emails/second)
3. Monitor reconnect behavior: backoff timing, retry count
4. Check body fetch latency distribution (P50, P95, P99)

---

## 11. Performance Regression Prevention

| Practice | Frequency | Trigger |
|----------|-----------|---------|
| Monitor Vitest suite duration in CI | Every push | Alert if > 90s |
| React Profiler before/after large component changes | Per PR | Component restructuring |
| SQLite EXPLAIN QUERY PLAN on new queries | Per PR | New SQL in db.ts or mcpTools.ts |
| Memory snapshot comparison | Monthly | Routine or after major feature |
| Startup timing log review | Per release | Version bump |
| FTS5 index rebuild after schema migration | Per migration | New DB migration |

### CI Performance Gates (Future)

When E2E tests are implemented, add these Playwright performance assertions:

```typescript
// Startup gate
test('app starts within budget', async () => {
  const start = Date.now();
  await electronApp.firstWindow();
  expect(Date.now() - start).toBeLessThan(4000);
});

// Search gate
test('FTS5 search completes within budget', async () => {
  const start = Date.now();
  await page.fill('[data-testid="search-input"]', 'invoice');
  await page.waitForSelector('[data-testid="thread-item"]');
  expect(Date.now() - start).toBeLessThan(500); // 300ms debounce + 200ms query
});
```
