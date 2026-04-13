import { shell } from 'electron';
import { HELP_URLS } from '../src/lib/providerPresets.js';
import { logDebug } from './logger.js';

const ALLOWED_HELP_URLS: ReadonlySet<string> = new Set(HELP_URLS);

export interface ShellOpenResult {
    success: boolean;
    error?: string;
}

// Strip CR/LF/NUL so an attacker-controlled URL can't forge log lines, then
// cap length so a huge URL can't flood the log file. Matches the pattern
// already used by the log:error IPC handler in main.ts.
function sanitizeForLog(value: unknown): string {
    return String(value).replace(/[\r\n\x00]/g, '?').slice(0, 500);
}

/**
 * Pure handler for the 'shell:open-external' IPC channel. Opens a URL in the
 * user's default browser only if the URL matches an exact-match entry in the
 * provider help allowlist. Extracted from main.ts so it can be unit-tested
 * without standing up Electron.
 */
export async function handleShellOpenExternal(
    args: { url?: unknown },
): Promise<ShellOpenResult> {
    const url = args?.url;
    if (typeof url !== 'string' || !ALLOWED_HELP_URLS.has(url)) {
        logDebug(`[shell:open-external] rejected url=${sanitizeForLog(url)}`);
        return { success: false, error: 'URL not allowlisted' };
    }
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (err) {
        logDebug(`[shell:open-external] failed url=${url} err=${sanitizeForLog(err)}`);
        return { success: false, error: 'Failed to open URL' };
    }
}
