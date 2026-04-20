# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ExpressDelivery, **please do not
open a public issue**. Instead, report it privately:

1. **Preferred**: open a private security advisory at
   <https://github.com/advisely/expressdelivery/security/advisories/new>
   (GitHub's built-in private reporting — only repository maintainers will see it).
2. **Alternative**: email the maintainer at the address listed on the
   maintainer's GitHub profile, with subject line beginning `[SECURITY]`.

Please include:
- A clear description of the issue and the affected component
  (e.g., `electron/imap.ts`, IMAP credential handling, etc.).
- Reproduction steps or a proof-of-concept where possible.
- The version of ExpressDelivery you tested against.
- Any suggested mitigation if you have one.

## What to Expect

- Acknowledgement within **72 hours** of receipt.
- An initial assessment (severity, scope) within **7 days**.
- Coordinated disclosure timeline — we aim to ship a fix within **30 days**
  for High/Critical issues, longer for Low/Medium that require wider
  refactoring.
- Credit in the changelog and release notes (unless you prefer to remain
  anonymous).

## Supported Versions

Only the latest released version on the `main` branch receives security
fixes. Older releases are not patched. Users should keep ExpressDelivery
up to date via the in-app update mechanism (Settings → Update).

## Scope

In scope:
- The Electron desktop application source code.
- The IMAP/SMTP/OAuth integration paths.
- The MCP server (`electron/mcpServer.ts`) and tool handlers.
- The `.expressdelivery` update package format and verification.
- All bundled dependencies (please report upstream first if the issue is
  in a dependency, then file with us if it affects ExpressDelivery
  specifically).

Out of scope:
- Issues in unmodified third-party services (Gmail OAuth, Microsoft Graph,
  Yahoo IMAP, OpenRouter, etc.).
- Phishing emails or malware that the application correctly identifies and
  warns about.
- Self-XSS or other attacks requiring physical access to an unlocked
  device.
- Vulnerabilities in unmaintained Node.js versions or operating systems.

## Security Posture

The current security posture is documented in `CLAUDE.md` (Security
Posture section). Highlights:
- Sandboxed iframe (`allow-scripts` only) for email HTML.
- DOMPurify on all HTML before rendering.
- CRLF injection guards on all SMTP recipient/subject paths.
- AES-encrypted credential storage via `electron.safeStorage`.
- Bearer token auth + 127.0.0.1 binding on the MCP server.
- Per-account `operationQueue` for IMAP user actions.
- Magic-byte sniffing + extension denylist on attachment downloads.
- Phishing URL detector + SPF/DKIM/DMARC visibility on every email.
- Trusted-sender allowlist for user-managed false-positive suppression.

CodeQL static analysis runs on every push to `main` and every PR
(`.github/workflows/codeql.yml`). Dependabot watches for vulnerable
dependencies and opens patches automatically.

Thank you for helping keep ExpressDelivery secure.
