# ExpressDelivery

AI-powered desktop email client with MCP (Model Context Protocol) integration.

Built with Electron 40, React 19, TypeScript 5.9, and SQLite (FTS5). Connects to any IMAP/SMTP email provider.

## Download

Get the latest release from [GitHub Releases](https://github.com/advisely/expressdelivery/releases/latest).

| Platform | Package | File |
|----------|---------|------|
| Windows | NSIS Installer | [`ExpressDelivery-Windows-Setup.exe`](https://github.com/advisely/expressdelivery/releases/latest/download/ExpressDelivery-Windows-1.8.0-Setup.exe) |
| Linux | AppImage | [`ExpressDelivery-Linux.AppImage`](https://github.com/advisely/expressdelivery/releases/latest/download/ExpressDelivery-Linux-1.8.0.AppImage) |
| Linux | Debian (.deb) | [`ExpressDelivery-Linux.deb`](https://github.com/advisely/expressdelivery/releases/latest/download/ExpressDelivery-Linux-1.8.0.deb) |
| Linux | RPM (.rpm) | [`ExpressDelivery-Linux.rpm`](https://github.com/advisely/expressdelivery/releases/latest/download/ExpressDelivery-Linux-1.8.0.rpm) |
| macOS | DMG | [`ExpressDelivery-Mac-Installer.dmg`](https://github.com/advisely/expressdelivery/releases/latest/download/ExpressDelivery-Mac-1.8.0-Installer.dmg) |

> **Note:** Builds are not yet code-signed. Windows SmartScreen may show a warning — click "More info" then "Run anyway". macOS users may need to right-click and select "Open".

## Features

- **Multi-account email** — IMAP connect + IDLE + folder sync + reconnect, SMTP send with CC/BCC
- **Rich compose** — TipTap editor (bold/italic/underline/lists/links), file attachments (25MB/file, max 10), per-account HTML signatures, draft auto-save
- **Full-text search** — SQLite FTS5 with 300ms debounce
- **AI & Agentic** — MCP server with 8 tools, AI compose assistant (5 tones), email categorization/priority, smart reply suggestions, mailbox analytics (see [AI & Agentic Capabilities](#ai--agentic-capabilities) below)
- **Security** — Sandboxed iframe email rendering, DOMPurify, CSP, OS keychain encryption, cross-account ownership guards, Bayesian spam filter, phishing URL detection
- **Productivity** — Snooze, schedule send, reminders, mail rules, keyboard shortcuts, drag-and-drop, user-defined tags, saved searches
- **Data portability** — EML/MBOX email export/import, vCard/CSV contact export/import
- **UI** — 4 themes, 2 layouts, 3 density modes, glassmorphism, CSS Modules, i18n (en/fr/es/de), premium onboarding wizard
- **Desktop** — System tray, OS notifications, auto-update (electron-updater), print/PDF export

## AI & Agentic Capabilities

ExpressDelivery includes a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that lets AI agents interact with your email programmatically. Any MCP-compatible AI client (Claude Desktop, custom agents, etc.) can connect and use these tools:

| MCP Tool | What it does |
|----------|-------------|
| `search_emails` | Full-text search across all accounts (FTS5) |
| `read_thread` | Fetch a complete email thread by thread ID |
| `send_email` | Send an email via SMTP (with attachments) |
| `create_draft` | Create a draft for user review before sending |
| `get_smart_summary` | Mailbox summary: unread count, high-priority, recent emails, folders |
| `categorize_email` | AI-assign category, priority (1-4), and labels to an email |
| `get_email_analytics` | Volume trends, top senders, busiest hours, category distribution |
| `suggest_reply` | Structured reply context: email + thread + sender history |

**How it works:**

1. **MCP Server** — ExpressDelivery runs an MCP server on `localhost:3000` (configurable) using SSE (Server-Sent Events) transport. Multiple AI clients can connect simultaneously.
2. **Authentication** — Bearer token auth (auto-generated, stored encrypted via OS keychain). Manage tokens in Settings > Agentic.
3. **AI Compose** — Built-in AI compose assistant powered by OpenRouter. Click the sparkles button in the compose window, choose a tone (Professional, Friendly, Concise, Detailed, Casual), and get an AI-drafted reply. Requires an OpenRouter API key (Settings > AI / API Keys).
4. **Email Intelligence** — AI categorizes emails by type (newsletter, personal, transactional, etc.), assigns priority levels, and labels them automatically. Priority badges appear in the email list.
5. **Security** — Cross-account ownership enforced on all tools, timing-safe auth, prompt injection sanitization, DOMPurify on all AI-generated HTML, MCP server bound to 127.0.0.1 only.

## Quick Start

```bash
npm install --legacy-peer-deps
npm run dev
```

## Build

```bash
npm run build:win        # Windows (portable)
npm run build:win:nsis   # Windows (NSIS installer)
npm run build:linux      # Linux (AppImage + deb + rpm)
npm run build:all        # Linux + Windows
```

All build scripts use `scripts/clean-build.mjs` which handles native module rebuilding for Electron's ABI automatically.

## Test

```bash
npm run test             # Run all tests (646 tests, 27 files)
npm run test:coverage    # With coverage report
npm run lint             # ESLint (strict, 0 warnings)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript 5.9, Zustand, Radix UI, TipTap, Lucide, Tailwind CSS v4, CSS Modules |
| Backend | Electron 40, better-sqlite3 (WAL + FTS5), IMAPFlow, Nodemailer, Express 5 |
| AI/MCP | @modelcontextprotocol/sdk, 8 tools, multi-client SSE on port 3000 |
| Build | Vite 7, electron-builder, GitHub Actions CI/CD |
| Testing | Vitest 4, @testing-library/react, @vitest/coverage-v8 |

## Documentation

- [Feature Roadmap](docs/ROADMAP.md) — feature matrix vs Mailspring/Thunderbird, phased implementation status
- [Deferred Features Report](docs/DEFERRED_FEATURES_REPORT.md) — risk/reward analysis for planned features
- [UI Design System](docs/UI.md) — themes, animations, glassmorphism, typography, accessibility
- [Package Registry](docs/PACKAGES.md) — dependency versions and upgrade history
- [CLAUDE.md](CLAUDE.md) — project instructions for AI-assisted development

## License

Private — All rights reserved.
