import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogDebug, mockShellOpenExternal } = vi.hoisted(() => ({
    mockLogDebug: vi.fn(),
    mockShellOpenExternal: vi.fn(async () => { /* no-op */ }),
}));

vi.mock('./logger.js', () => ({ logDebug: mockLogDebug }));
vi.mock('electron', () => ({ shell: { openExternal: mockShellOpenExternal } }));

import { handleShellOpenEmailLink } from './shellOpenEmailLink.js';

describe('handleShellOpenEmailLink', () => {
    beforeEach(() => {
        mockLogDebug.mockReset();
        mockShellOpenExternal.mockReset();
        mockShellOpenExternal.mockResolvedValue(undefined);
    });

    it('opens https: URLs via shell.openExternal', async () => {
        const result = await handleShellOpenEmailLink({ url: 'https://unsubscribe.example.com/?t=abc' });
        expect(result.success).toBe(true);
        expect(mockShellOpenExternal).toHaveBeenCalledWith('https://unsubscribe.example.com/?t=abc');
    });

    it('opens http: URLs via shell.openExternal', async () => {
        const result = await handleShellOpenEmailLink({ url: 'http://example.com/' });
        expect(result.success).toBe(true);
        expect(mockShellOpenExternal).toHaveBeenCalledWith('http://example.com/');
    });

    it('opens mailto: URLs via shell.openExternal', async () => {
        const result = await handleShellOpenEmailLink({ url: 'mailto:unsubscribe@example.com?subject=unsubscribe' });
        expect(result.success).toBe(true);
        expect(mockShellOpenExternal).toHaveBeenCalledWith('mailto:unsubscribe@example.com?subject=unsubscribe');
    });

    it('rejects javascript: URLs', async () => {
        const result = await handleShellOpenEmailLink({ url: 'javascript:alert(1)' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('URL scheme not allowed');
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects data: URLs', async () => {
        const result = await handleShellOpenEmailLink({ url: 'data:text/html,<script>alert(1)</script>' });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects file: URLs', async () => {
        const result = await handleShellOpenEmailLink({ url: 'file:///C:/Windows/System32/cmd.exe' });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects non-string inputs', async () => {
        const result = await handleShellOpenEmailLink({ url: 42 as unknown as string });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects URLs longer than 2000 chars (defense against log flood)', async () => {
        const huge = 'https://example.com/' + 'a'.repeat(2050);
        const result = await handleShellOpenEmailLink({ url: huge });
        expect(result.success).toBe(false);
        expect(mockShellOpenExternal).not.toHaveBeenCalled();
    });

    it('strips CR/LF/NUL from rejected URL in log line', async () => {
        await handleShellOpenEmailLink({ url: 'javascript:\r\nalert(1)\x00' });
        const logged = mockLogDebug.mock.calls.map(c => String(c[0])).join('\n');
        expect(logged).not.toMatch(/[\r\n\x00]/);
    });

    it('returns structured error when shell.openExternal throws', async () => {
        mockShellOpenExternal.mockRejectedValue(new Error('boom'));
        const result = await handleShellOpenEmailLink({ url: 'https://example.com/' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to open URL');
    });
});
