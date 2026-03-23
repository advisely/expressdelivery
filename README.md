<p align="center">
  <img src="build/icon.png" alt="ExpressDelivery" width="128" height="128" />
</p>

<h1 align="center">ExpressDelivery</h1>

<p align="center">
  <strong>The AI-powered email client that works for you.</strong><br />
  Fast, private, intelligent. Built with Electron, React, and Model Context Protocol.
</p>

<p align="center">
  <a href="https://github.com/advisely/expressdelivery/releases/latest"><img src="https://img.shields.io/github/v/release/advisely/expressdelivery?style=flat-square&color=blue" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/tests-779%20passed-brightgreen?style=flat-square" alt="Tests" />
  <a href="https://github.com/advisely/expressdelivery/actions"><img src="https://img.shields.io/github/actions/workflow/status/advisely/expressdelivery/ci.yml?style=flat-square&label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey?style=flat-square" alt="Platforms" />
</p>

---

## Why ExpressDelivery?

Most email clients are either bloated, cloud-locked, or stuck in 2010. ExpressDelivery is different:

- **Your data stays local.** SQLite database on your machine. No cloud sync. No tracking.
- **AI that actually helps.** Categorize, prioritize, draft replies, and analyze your inbox — powered by MCP and local/remote LLMs.
- **Works with everything.** Gmail, Outlook, Yahoo, iCloud, or any IMAP server.
- **Cross-platform.** Windows, Linux (including Raspberry Pi), and macOS.

---

## Features

### Core Email
| | |
|---|---|
| **Multi-account** | Manage all your email accounts in one place with provider auto-detection |
| **Full IMAP sync** | Per-account sync engine, envelope + body fetch, folder sync, IDLE push, NOOP heartbeat, timeout protection, infinite reconnect with backoff |
| **Rich compose** | Bold, italic, underline, lists, links — powered by TipTap editor |
| **HTML rendering** | Sandboxed iframe with DOMPurify, inline CID images, remote image blocking |
| **Attachments** | Send (25MB/file, max 10) and receive with on-demand IMAP download |
| **Full-text search** | SQLite FTS5 — instant search across all messages |
| **Keyboard shortcuts** | Compose, reply, forward, archive, navigate, delete — all from the keyboard |
| **Drag and drop** | Move emails between folders by dragging |
| **Tags & labels** | Custom color-coded tags with sidebar filtering |
| **Mail rules** | Auto-organize: match from/subject/body → star, move, label, delete |
| **Snooze & schedule** | Snooze emails until later, schedule sends for the perfect time |
| **Spam filter** | Bayesian classifier with per-account training |
| **Phishing detection** | 7-rule heuristic scanner warns about suspicious URLs |

### AI & Automation

ExpressDelivery integrates the **Model Context Protocol (MCP)** — the open standard for connecting AI to tools.

| MCP Tool | What it does |
|---|---|
| `search_emails` | Full-text search with AI metadata |
| `read_thread` | Fetch entire email thread with context |
| `send_email` | Compose and send via SMTP |
| `create_draft` | Draft an email for your review |
| `get_smart_summary` | Inbox overview: unread, flagged, priorities, folders |
| `categorize_email` | AI-assigned category, priority (1-4), labels |
| `get_email_analytics` | Volume trends, top senders, busiest hours |
| `suggest_reply` | Structured reply context for LLM drafting |

**AI Compose** — Generate reply drafts with 5 tone presets via OpenRouter LLMs.

### Security & Protection

| | |
|---|---|
| **SPF/DKIM/DMARC verification** | Authentication-Results parsed on sync; sender verification badge (green/red shield) |
| **Bayesian spam filter** | Per-account classifier with auto-scoring during IMAP sync |
| **Phishing detection** | 7-rule URL heuristic engine + display name spoofing detection |
| **Invoice fraud detection** | Urgency language + payment request pattern matching |
| **Sender whitelist/blacklist** | Per-account email and domain pattern lists |
| **Sandboxed rendering** | Email HTML in sandboxed iframe with CSP + DOMPurify |
| **Encrypted credentials** | OS keychain (Electron safeStorage) for passwords and API keys |
| **IPC rate limiting** | Token bucket algorithm on sensitive handlers (send, train, lists) |
| **Cross-account isolation** | Ownership enforced on every IPC and MCP handler |
| **Remote image blocking** | Blocked by default with privacy banner |
| **Context isolation** | Preload sandbox, scoped IPC with 160+ channel allowlist |

See [SECURITY.md](SECURITY.md) for the full security posture.

### Personalization

- **4 themes** — Light, Cream (solarized), Midnight (dark navy), Forest (dark green)
- **2 layouts** — Vertical 3-pane or horizontal split
- **3 density modes** — Compact, comfortable, relaxed
- **Reading pane zoom** — 80% to 150%
- **Folder colors** — 8 preset colors via context menu
- **Per-account signatures** — HTML signatures with live preview
- **4 languages** — English, French, Spanish, German

---

## Installation

### Download

Grab the latest release for your platform:

| Platform | Download |
|---|---|
| **Windows** | [ExpressDelivery Setup .exe](https://github.com/advisely/expressdelivery/releases/latest) |
| **Linux x64** | [.deb](https://github.com/advisely/expressdelivery/releases/latest) / [.AppImage](https://github.com/advisely/expressdelivery/releases/latest) / [.rpm](https://github.com/advisely/expressdelivery/releases/latest) |
| **Linux ARM64** (Raspberry Pi) | [.deb](https://github.com/advisely/expressdelivery/releases/latest) |
| **macOS** | [.dmg](https://github.com/advisely/expressdelivery/releases/latest) |

### Auto-Update

Once installed, ExpressDelivery checks for updates automatically via GitHub Releases. When a new version is available, a banner appears — click to download and install in-place. Offline? Drop a `.expressdelivery` update package into Settings > Updates.

---

## Getting Started

1. **Launch the app** — the onboarding wizard guides you through setup
2. **Add an account** — select your provider (Gmail, Outlook, Yahoo, iCloud) or configure custom IMAP/SMTP
3. **Connection test** — the wizard tests IMAP and SMTP before saving
4. **Start reading** — your inbox syncs immediately with full-text search ready

> **Gmail users:** You'll need an [App Password](https://myaccount.google.com/apppasswords) (2FA must be enabled). Regular passwords won't work with IMAP.

---

## Development

### Prerequisites

- Node.js 24+
- npm 10+
- Windows, Linux, or macOS

### Setup

```bash
git clone https://github.com/advisely/expressdelivery.git
cd expressdelivery
npm install --legacy-peer-deps
npm run dev
```

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server + Electron |
| `npm run test` | Run 779 tests (Vitest) |
| `npm run test:coverage` | Tests with coverage report |
| `npm run lint` | ESLint (strict, 0 warnings) |
| `npm run build:win` | Clean Windows build (unpacked) |
| `npm run build:win:nsis` | Windows NSIS installer |
| `npm run build:linux` | Linux build (AppImage + deb + rpm) |
| `npm run build:all` | Linux + Windows |

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript 5.9 (strict), Zustand, Radix UI, TipTap, Tailwind CSS v4, Lucide |
| **Backend** | Electron 41, better-sqlite3 (WAL + FTS5), IMAPFlow, Nodemailer, Express 5 |
| **AI** | MCP SDK (multi-client SSE), OpenRouter, 8 tool handlers |
| **Build** | Vite 7, electron-builder (NSIS, AppImage, deb, rpm, DMG) |
| **Test** | Vitest 4, Testing Library, 779 tests across 32 files |

### Project Structure

```
electron/          Main process — DB, IMAP, SMTP, MCP server, updater
src/               Renderer — React SPA (19 components, 2 stores)
  components/      UI components + co-located CSS modules
  stores/          Zustand stores (theme + email)
  lib/             Utilities, IPC wrapper, keyboard shortcuts, i18n
  locales/         Translation files (en, fr, es, de)
build/             electron-builder assets (icons)
scripts/           Build tooling (clean-build, generate-icons)
.github/workflows/ CI (lint + test) and Release (build + publish)
```

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes with tests
4. Ensure `npm run lint && npm run test` pass
5. Open a Pull Request

---

## License

[MIT](LICENSE) — use it, modify it, ship it.

---

<p align="center">
  <sub>Built with care by the ExpressDelivery team — <a href="mailto:yassine@boumiza.com">yassine@boumiza.com</a></sub>
</p>
