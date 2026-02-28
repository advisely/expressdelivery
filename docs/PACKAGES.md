# ExpressDelivery - Package Registry

Last updated: 2026-02-27

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
| `@radix-ui/react-dialog` | ^1.1.15 | Current | Accessible modal dialogs (Settings, Compose) |
| `@radix-ui/react-tabs` | ^1.1.13 | Current | Accessible tabs (Settings sections) |
| `@radix-ui/react-dropdown-menu` | ^2.1.16 | Current | Accessible dropdown menus |
| `@radix-ui/react-select` | ^2.2.6 | Current | Accessible select/combobox |
| `@radix-ui/react-tooltip` | ^1.2.8 | Current | Accessible tooltips |
| `@radix-ui/react-popover` | ^1.1.14 | Current | Accessible popovers (snooze, reminder) |
| `@tiptap/react` | ^2.12.5 | Current | Rich text editor (compose) |
| `@tiptap/starter-kit` | ^2.12.5 | Current | TipTap base extensions |
| `@tiptap/extension-link` | ^2.12.5 | Current | TipTap link support |
| `@tiptap/extension-underline` | ^2.12.5 | Current | TipTap underline support |
| `react-i18next` | ^15.5.3 | Current | i18n framework (4 locales) |
| `i18next` | ^25.1.3 | Current | i18n core |
| `mailparser` | ^3.7.2 | Current | MIME email parsing |
| `electron-updater` | ^6.6.2 | Current | Auto-update from GitHub Releases |

## Dev Dependencies

| Package | Version | Status | Purpose |
|---------|---------|--------|---------|
| `electron` | ^40.6.0 | Current | Desktop runtime (Chromium 132 / Node 22) |
| `electron-builder` | ^26.8.1 | Current | App packaging (NSIS, AppImage, DMG) |
| `@electron/rebuild` | ^4.0.1 | Current | Native module rebuild for Electron ABI |
| `typescript` | ^5.9.3 | Current | TypeScript compiler (strict mode) |
| `vite` | ^7.3.1 | Current | Build tool + dev server |
| `@vitejs/plugin-react` | ^5.1.4 | Current | React Fast Refresh for Vite |
| `vite-plugin-electron` | ^0.29.0 | Current | Electron integration for Vite |
| `vite-plugin-electron-renderer` | ^0.14.6 | Current | Node.js polyfills for renderer |
| `vitest` | ^4.0.18 | Current | Test runner |
| `@vitest/coverage-v8` | ^4.0.18 | Current | Code coverage reporting |
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
| `@types/nodemailer` | ^7.0.11 | Current | Type definitions |
| `@types/react` | ^19.2.14 | Current | Type definitions |
| `@types/react-dom` | ^19.2.3 | Current | Type definitions |

## Major Upgrades Completed (2026-02-23)

All packages upgraded to latest in a single coordinated pass:

| Package | From | To | Notes |
|---------|------|----|-------|
| `electron` | 30.5.1 | 40.6.0 | ABI 128 -> 143, required `@electron/rebuild` |
| `react` + `react-dom` | 18.2.0 | 19.2.4 | `useRef<T>(undefined)` required (zero-arg removed) |
| `vite` | 5.1.6 | 7.3.1 | Breaking config changes handled |
| `typescript` | 5.2.2 | 5.9.3 | Minor upgrade, backwards compatible |
| `eslint` | 8.57.0 | 10.0.2 | Flat config migration (`.eslintrc.cjs` -> `eslint.config.js`) |
| `electron-builder` | 24.13.3 | 26.8.1 | NSIS + asar improvements |

## Build Notes

- **better-sqlite3** is NAN-based (ABI-specific). Node.js v24 = ABI 137, Electron 40 = ABI 143. Use `scripts/clean-build.mjs` which purges stale `.forge-meta` and rebuilds for the correct ABI.
- All `build:*` npm scripts use the clean build hydration script.
- After packaging, `npm rebuild better-sqlite3` restores the host binary for vitest.

## Installed (No Longer Planned)

| Package | Purpose | Installed In |
|---------|---------|-------------|
| `@vitest/coverage-v8` | Coverage thresholds | Phase 5 |
| `electron-updater` | Auto-update | Phase 4 |

## Planned Dependencies

| Package | Purpose | Phase |
|---------|---------|-------|
| Playwright or Spectron | E2E testing | Future |
| `@journeyapps/sqlcipher` | At-rest DB encryption | Future |
