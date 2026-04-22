import { shell } from 'electron';
import { logDebug } from './logger.js';

/**
 * Pure handler for the 'shell:open-email-link' IPC channel. Opens user-clicked
 * anchor links from inside a sandboxed email-rendering iframe in the user's
 * default browser, after validating the URL scheme.
 *
 * SECURITY:
 * - Scheme allowlist: https, http, mailto. Blocks javascript:, data:, file:,
 *   vbscript:, and any other scheme that could bypass the sandbox.
 * - Length cap (2000 chars) bounds log file growth and parser work.
 * - URL parsing via the WHATWG URL constructor — rejects malformed inputs.
 * - Log lines are CR/LF/NUL-stripped so an attacker-crafted URL can't forge
 *   log entries (same pattern as the log:error IPC handler in main.ts).
 *
 * Distinct from handleShellOpenExternal (provider help allowlist) — kept
 * separate so relaxing the email-link trust model doesn't weaken the
 * strict exact-URL allowlist used for provider help links.
 */
export interface ShellOpenEmailLinkResult {
    success: boolean;
    error?: string;
}

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:', 'mailto:']);
const MAX_URL_LENGTH = 2000;

function sanitizeForLog(value: unknown): string {
    return String(value).replace(/[\r\n\x00]/g, '?').slice(0, 500);
}

export async function handleShellOpenEmailLink(
    args: { url?: unknown },
): Promise<ShellOpenEmailLinkResult> {
    const url = args?.url;
    if (typeof url !== 'string') {
        logDebug(`[shell:open-email-link] rejected non-string url=${sanitizeForLog(url)}`);
        return { success: false, error: 'URL must be a string' };
    }
    if (url.length > MAX_URL_LENGTH) {
        logDebug(`[shell:open-email-link] rejected oversized url length=${url.length}`);
        return { success: false, error: 'URL too long' };
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        logDebug(`[shell:open-email-link] rejected unparseable url=${sanitizeForLog(url)}`);
        return { success: false, error: 'Invalid URL' };
    }

    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
        logDebug(`[shell:open-email-link] rejected scheme=${sanitizeForLog(parsed.protocol)} url=${sanitizeForLog(url)}`);
        return { success: false, error: 'URL scheme not allowed' };
    }

    try {
        // Pass the WHATWG-normalized URL, not the raw input, so any edge-case
        // normalization done during parse (whitespace trim, case fold on
        // scheme, CR/LF stripped) is what actually reaches the OS URL handler.
        await shell.openExternal(parsed.href);
        return { success: true };
    } catch (err) {
        logDebug(`[shell:open-email-link] openExternal failed url=${sanitizeForLog(url)} err=${sanitizeForLog(err)}`);
        return { success: false, error: 'Failed to open URL' };
    }
}
