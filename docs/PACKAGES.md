# ExpressDelivery - Package Registry

Last updated: 2026-04-13 (v1.17.1, Phase 17.1 — OAuth2 for Gmail + Microsoft)

## Production Dependencies

| Package | Version | Status | Purpose |
|---------|---------|--------|---------|
| `react` | ^19.2.4 | Current | UI framework (React 19) |
| `react-dom` | ^19.2.4 | Current | React DOM renderer |
| `zustand` | ^5.0.11 | Current | State management (theme + email stores) |
| `lucide-react` | ^0.575.0 | Current | Icon library (tree-shakeable) |
| `better-sqlite3` | ^12.6.2 | Current | SQLite with WAL + FTS5 (native module, ABI-specific) |
| `@modelcontextprotocol/sdk` | ^1.27.0 | Current | MCP server SDK (SSE transport) |
| `express` | ^5.2.1 | Current | MCP SSE transport host (localhost:3000) |
| `cors` | ^2.8.6 | Current | MCP server lockdown (`origin: false`) |
| `imapflow` | ^1.2.10 | Current | IMAP client with IDLE support |
| `nodemailer` | ^8.0.1 | Current | SMTP sender |
| `dompurify` | ^3.3.1 | Current | HTML email sanitization |
| `@radix-ui/react-dialog` | ^1.1.15 | Current | Accessible modal dialogs (Settings, Compose, Confirm) |
| `@radix-ui/react-tabs` | ^1.1.13 | Current | Accessible tabs (Settings sections) |
| `@radix-ui/react-dropdown-menu` | ^2.1.16 | Current | Accessible dropdown menus |
| `@radix-ui/react-select` | ^2.2.6 | Current | Accessible select/combobox |
| `@radix-ui/react-tooltip` | ^1.2.8 | Current | Accessible tooltips |
| `@radix-ui/react-popover` | ^1.1.15 | Current | Accessible popovers (snooze, reminder) |
| `@tiptap/react` | ^3.20.0 | Current | Rich text editor (compose) |
| `@tiptap/starter-kit` | ^3.20.0 | Current | TipTap base extensions |
| `@tiptap/extension-link` | ^3.20.0 | Current | TipTap link support |
| `@tiptap/extension-underline` | ^3.20.0 | Current | TipTap underline support |
| `@tiptap/pm` | ^3.20.0 | Current | TipTap ProseMirror core |
| `react-i18next` | ^16.5.4 | Current | i18n framework (4 locales) |
| `i18next` | ^25.8.13 | Current | i18n core |
| `mailparser` | ^3.9.3 | Current | MIME email parsing |
| `electron-updater` | ^6.8.3 | Current | Auto-update from GitHub Releases |
| `grammy` | ^1.41.1 | Current | Telegram Bot API client (agentic channel) |
| `@azure/msal-node` | ^5.1.2 | **New (v1.17.0)** | Microsoft OAuth2 — `PublicClientApplication` + `acquireTokenInteractive` / `acquireTokenByRefreshToken`. Used for Outlook.com Personal and Microsoft 365 Work/School sign-in. Handles loopback redirect internally. |

## Dev Dependencies

| Package | Version | Status | Purpose |
|---------|---------|--------|---------|
| `electron` | ^41.0.3 | Current | Desktop runtime (Chromium 146 / Node 24) |
| `electron-builder` | ^26.8.1 | Current | App packaging (NSIS, AppImage, DMG) |
| `typescript` | ^5.9.3 | Current | TypeScript compiler (strict mode) |
| `vite` | ^7.3.1 | Current | Build tool + dev server |
| `@vitejs/plugin-react` | ^5.1.4 | Current | React Fast Refresh for Vite |
| `vite-plugin-electron` | ^0.29.0 | Current | Electron integration for Vite |
| `vite-plugin-electron-renderer` | ^0.14.6 | Current | Node.js polyfills for renderer |
| `vitest` | ^4.0.18 | Current | Unit test runner |
| `@vitest/coverage-v8` | ^4.0.18 | Current | Code coverage reporting |
| `@playwright/test` | ^1.58.2 | Current | E2E test runner (Electron integration) — 8 Console Health tests + reauth badge seed hook |
| `nock` | ^14.0.12 | **New (v1.17.0)** | HTTP mocking for OAuth protocol tests — Google refresh/revoke + Graph sendMail. Intercepts native `fetch` via Node 18+ undici hook. |
| `jsdom` | ^28.1.0 | Current | DOM environment for vitest |
| `@testing-library/react` | ^16.3.2 | Current | React component testing |
| `@testing-library/jest-dom` | ^6.9.1 | Current | DOM assertion matchers |
| `@testing-library/dom` | ^10.4.1 | Current | DOM testing utilities |
| `@testing-library/user-event` | ^14.6.1 | Current | User interaction simulation |
| `eslint` | ^10.0.2 | Current | Linter (flat config) |
| `@typescript-eslint/eslint-plugin` | ^8.56.1 | Current | TypeScript ESLint rules |
| `@typescript-eslint/parser` | ^8.56.1 | Current | TypeScript ESLint parser |
| `eslint-plugin-react-hooks` | ^7.0.1 | Current | React hooks lint rules |
| `eslint-plugin-react-refresh` | ^0.5.2 | Current | React Fast Refresh lint |
| `globals` | ^17.3.0 | Current | Global variable definitions for ESLint |
| `tailwindcss` | ^4.2.0 | Current | Utility-first CSS (v4, CSS-first config) |
| `@tailwindcss/vite` | ^4.2.1 | Current | Tailwind Vite plugin |
| `postcss` | ^8.5.6 | Current | CSS processing pipeline |
| `autoprefixer` | ^10.4.24 | Current | Vendor prefix injection |
| `sharp` | ^0.34.5 | Current | Icon generation (SVG -> PNG) |
| `png-to-ico` | ^3.0.1 | Current | Icon generation (PNG -> ICO) |
| `@types/better-sqlite3` | ^7.6.13 | Current | Type definitions |
| `@types/cors` | ^2.8.19 | Current | Type definitions |
| `@types/dompurify` | ^3.2.0 | Current | Type definitions |
| `@types/express` | ^5.0.6 | Current | Type definitions |
| `@types/mailparser` | ^3.4.6 | Current | Type definitions |
| `@types/nodemailer` | ^7.0.11 | Current | Type definitions |
| `@types/react` | ^19.2.14 | Current | Type definitions |
| `@types/react-dom` | ^19.2.3 | Current | Type definitions |

## New Packages Added (2026-03-16)

| Package | Version | Purpose | License | Security Notes |
|---------|---------|---------|---------|----------------|
| `grammy` | ^1.41.1 | Telegram Bot API client for agentic channel integration | MIT | No native code, pure TypeScript, actively maintained. Bot token encrypted via safeStorage. |
| `@playwright/test` | ^1.58.2 | E2E test framework with Electron integration | Apache-2.0 | Dev-only, not shipped in production builds. |

## Packages Used via Raw fetch() (No npm dependency)

These external APIs are accessed directly without dedicated npm packages:

| Service | API Version | Auth Method | Purpose |
|---------|-------------|-------------|---------|
| LinkedIn | v2 (UGC Posts) | OAuth 2.0 Bearer token | Social media posting |
| Twitter/X | v2 (Tweets) | OAuth 2.0 PKCE | Social media posting |
| Ollama | /api/generate | None (localhost only) | Local LLM inference (Gemma 2) |
| OpenRouter | /v1/chat/completions | API key Bearer | Cloud LLM inference |

## Version Updates Since Last Audit

| Package | Previous | Current | Notes |
|---------|----------|---------|-------|
| `@tiptap/*` | ^2.12.5 | ^3.20.0 | Major version bump (TipTap v3) |
| `react-i18next` | ^15.5.3 | ^16.5.4 | Major version bump |
| `i18next` | ^25.1.3 | ^25.8.13 | Minor version bump |
| `mailparser` | ^3.7.2 | ^3.9.3 | Minor version bump |
| `electron-updater` | ^6.6.2 | ^6.8.3 | Minor version bump |
| `@radix-ui/react-popover` | ^1.1.14 | ^1.1.15 | Patch bump |

## Build Notes

- **better-sqlite3** is NAN-based (ABI-specific). Node.js v24 = ABI 137, Electron 41 = ABI 145. Use `scripts/clean-build.mjs` which purges stale `.forge-meta` and rebuilds for the correct ABI.
- All `build:*` npm scripts use the clean build hydration script.
- After packaging, `npm rebuild better-sqlite3` restores the host binary for vitest.
- **grammy** is pure TypeScript with no native modules -- no ABI concerns.
- **@playwright/test** is dev-only and excluded from production builds by electron-builder.

## Planned Dependencies

| Package | Purpose | Phase |
|---------|---------|-------|
| `@journeyapps/sqlcipher` | At-rest DB encryption | Future |
| `@whiskeysockets/baileys` | WhatsApp client (unofficial API) | Future (P4c) |
| `qrcode` | QR code generation for WhatsApp auth | Future (P4c) |
