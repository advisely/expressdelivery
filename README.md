# ExpressDelivery

AI-powered desktop email client with MCP (Model Context Protocol) integration.

Built with Electron 40, React 19, TypeScript 5.9, and SQLite (FTS5). Connects to any IMAP/SMTP email provider.

## Features

- **Multi-account email** — IMAP connect + IDLE + folder sync + reconnect, SMTP send with CC/BCC
- **Rich compose** — TipTap editor (bold/italic/underline/lists/links), file attachments (25MB/file, max 10), per-account HTML signatures, draft auto-save
- **Full-text search** — SQLite FTS5 with 300ms debounce
- **AI integration** — 8 MCP tools (search, read, send, draft, summary, categorize, analytics, suggest reply), multi-client SSE transport, OpenRouter API key management
- **Security** — Sandboxed iframe email rendering, DOMPurify, CSP, OS keychain encryption, cross-account ownership guards, Bayesian spam filter, phishing URL detection
- **Productivity** — Snooze, schedule send, reminders, mail rules, keyboard shortcuts, drag-and-drop, user-defined tags, saved searches
- **Data portability** — EML/MBOX email export/import, vCard/CSV contact export/import
- **UI** — 4 themes, 2 layouts, 3 density modes, glassmorphism, CSS Modules, i18n (en/fr/es/de), premium onboarding wizard
- **Desktop** — System tray, OS notifications, auto-update (electron-updater), print/PDF export

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
npm run test             # Run all tests (522 tests, 25 files)
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
- [UI Design System](docs/UI.md) — themes, animations, glassmorphism, typography, accessibility
- [Package Registry](docs/PACKAGES.md) — dependency versions and upgrade history
- [CLAUDE.md](CLAUDE.md) — project instructions for AI-assisted development

## License

Private — All rights reserved.
