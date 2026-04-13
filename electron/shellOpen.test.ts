import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HELP_URLS } from '../src/lib/providerPresets';

// Hoisted mocks so they are ready before we import the handler factory
const { mockOpenExternal, mockLogDebug } = vi.hoisted(() => ({
    mockOpenExternal: vi.fn().mockResolvedValue(undefined),
    mockLogDebug: vi.fn(),
}));

vi.mock('electron', () => ({
    shell: { openExternal: mockOpenExternal },
}));

vi.mock('./logger.js', () => ({
    logDebug: mockLogDebug,
}));

// The handler is exported as a pure function for testability
import { handleShellOpenExternal } from './shellOpen';

describe('shell:open-external handler', () => {
    beforeEach(() => {
        mockOpenExternal.mockClear();
        mockLogDebug.mockClear();
    });

    it('accepts every URL in HELP_URLS', async () => {
        for (const url of HELP_URLS) {
            mockOpenExternal.mockClear();
            const result = await handleShellOpenExternal({ url });
            expect(result).toEqual({ success: true });
            expect(mockOpenExternal).toHaveBeenCalledWith(url);
        }
    });

    it('rejects a URL that is not in the allowlist', async () => {
        const result = await handleShellOpenExternal({ url: 'https://evil.example.com/' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('URL not allowlisted');
        expect(mockOpenExternal).not.toHaveBeenCalled();
        expect(mockLogDebug).toHaveBeenCalled();
    });

    it('rejects a missing url argument', async () => {
        const result = await handleShellOpenExternal({});
        expect(result.success).toBe(false);
        expect(mockOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects a non-string url argument', async () => {
        const result = await handleShellOpenExternal({ url: 123 });
        expect(result.success).toBe(false);
        expect(mockOpenExternal).not.toHaveBeenCalled();
    });

    it('returns success:false on openExternal rejection', async () => {
        mockOpenExternal.mockRejectedValueOnce(new Error('boom'));
        const result = await handleShellOpenExternal({ url: HELP_URLS[0] });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to open URL');
        expect(mockLogDebug).toHaveBeenCalled();
    });

    it('rejects a URL with trailing whitespace (exact match semantics)', async () => {
        const result = await handleShellOpenExternal({ url: HELP_URLS[0] + ' ' });
        expect(result.success).toBe(false);
    });
});
