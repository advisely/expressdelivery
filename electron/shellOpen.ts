import { shell } from 'electron';
import { HELP_URLS } from '../src/lib/providerPresets.js';
import { logDebug } from './logger.js';

const ALLOWED_HELP_URLS: ReadonlySet<string> = new Set(HELP_URLS);

export interface ShellOpenResult {
    success: boolean;
    error?: string;
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
        logDebug(`[shell:open-external] rejected url=${String(url)}`);
        return { success: false, error: 'URL not allowlisted' };
    }
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (err) {
        logDebug(`[shell:open-external] failed url=${url} err=${String(err)}`);
        return { success: false, error: 'Failed to open URL' };
    }
}
