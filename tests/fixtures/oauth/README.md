# OAuth Test Fixtures

Scrubbed JSON snapshots of real OAuth token endpoint responses for Google and
Microsoft (personal + business). Committed for documentation and future
integration-style tests.

## Files

| File | Purpose | Source endpoint |
|------|---------|----------------|
| `google-token-response.json` | Successful Google authorization-code exchange — Gmail IMAP/SMTP scope + offline_access | `POST https://oauth2.googleapis.com/token` |
| `microsoft-token-response-personal.json` | Successful MSAL flow for an Outlook.com personal account — `tid` is the public Microsoft personal-account magic GUID `9188040d-…` | `POST https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| `microsoft-token-response-business.json` | Successful MSAL flow for a Microsoft 365 work/school account — `tid` is a fake organizational tenant GUID | `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` |
| `google-error-invalid-grant.json` | Refresh-token failure (revoked / expired) returned by Google's token endpoint | `POST https://oauth2.googleapis.com/token` |
| `microsoft-error-invalid-grant.json` | Refresh-token failure (`AADSTS50173`) returned by Microsoft's token endpoint | `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` |

## Scrubbing rules

All fixtures committed to this repository are SCRUBBED. The originals were
captured against real OAuth tenants and then sanitized as follows:

- `access_token`, `refresh_token`, `id_token` → replaced with
  `"scrubbed_access_token_xxx_<purpose>"` placeholder strings. **Never**
  commit a real bearer token here.
- `id_token` (Google) → replaced with the literal string
  `"scrubbed_id_token_placeholder_NOT_a_real_jwt"` rather than a
  base64-encoded fake JWT, because Semgrep flags fake JWTs as CWE-321
  ("hard-coded cryptographic key"). The MSAL fixtures use parsed
  `id_token_claims` objects for the same reason — they expose the same
  information without tripping the SAST rule.
- Microsoft `tid` (tenant GUID):
  - Personal fixture uses `9188040d-6c67-4c5b-b112-36a304b66dad` — this is
    the **real public** magic GUID Microsoft assigns to all personal
    Outlook.com / Hotmail / Live accounts. It is documented at
    https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-protocols-oidc#fetch-the-openid-connect-metadata-document
    and is not a secret.
  - Business fixture uses a fake placeholder GUID
    `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` to avoid leaking real tenant IDs.
- `email` and `preferred_username` claims → replaced with
  `scrubbed-personal@outlook.com` / `scrubbed-business@contoso.example.com`.
- `oid`, `aud`, `correlation_id`, `trace_id` → all-zeros placeholder GUIDs.
- `iat`, `exp`, `nbf` → fixed to `1700000000` / `1700003600` so timestamps
  do not drift between regeneration runs.

## Regenerating

These fixtures are point-in-time snapshots and were not produced by an
automated tool. To regenerate:

1. Configure a real OAuth client in Google Cloud Console / Microsoft Entra ID
2. Run a manual end-to-end OAuth flow against `oauth2.googleapis.com` /
   `login.microsoftonline.com` using a throwaway test account
3. Capture the raw token response JSON from network traces or from the
   `electron/oauth/google.ts` / `electron/oauth/microsoft.ts` adapters in
   debug mode
4. Apply the scrubbing rules above before committing — every replacement
   value is documented so the resulting file remains structurally identical
   to the original

## Current consumers (Phase 2 OAuth2)

**No production tests load these fixtures directly yet.** They are committed
for two reasons:

1. **Documentation** — the file shapes show what real Google/Microsoft token
   endpoint responses look like, complementing the inline `nock` mocks that
   the Phase 2 adapter tests use (`electron/oauth/google.test.ts`,
   `electron/oauth/microsoft.test.ts`).
2. **Future integration tests** — when integration-style tests land that
   exercise the full token-fetch → token-store → IMAP-XOAUTH2 path against
   a mock HTTP server, these fixtures will be the canonical request bodies.

If you are writing a new test that needs a realistic OAuth response,
prefer loading the fixture via `JSON.parse(fs.readFileSync(...))` over
hand-crafting one inline — the fixtures already include all the scope
strings, tenant magic GUIDs, and timing fields the adapter code reads.

## Security notes

- These fixtures are committed to the public repository. Reviewers must
  confirm during PR that no real secrets have been added.
- Semgrep SAST rules `generic.secrets.*` and `generic.tokens.*` are
  configured to allow the `scrubbed_*` prefix.
- The `tests/fixtures/oauth/` path is included in `.gitignore`-equivalent
  secret-scanning allowlists if/when those are added.
