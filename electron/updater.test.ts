import { describe, it, expect, vi } from 'vitest';

// Mock Electron before importing updater
vi.mock('electron', () => ({
    app: {
        getVersion: vi.fn().mockReturnValue('1.13.3'),
        getPath: vi.fn().mockReturnValue('/tmp'),
        isPackaged: false,
    },
    dialog: { showOpenDialog: vi.fn() },
}));

vi.mock('electron-updater', () => ({
    autoUpdater: {
        on: vi.fn(),
        setFeedURL: vi.fn(),
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn(),
        autoDownload: false,
    },
}));

vi.mock('./logger.js', () => ({
    logDebug: vi.fn(),
}));

import {
    validateSafePath,
    sanitizePayloadFileName,
    compareVersions,
    formatSize,
    normalizeThumbprint,
} from './updater.js';

// ─────────────────────────────────────────────────────────────────────────────
// validateSafePath — CWE-22 (Path Traversal) prevention
// ─────────────────────────────────────────────────────────────────────────────
describe('validateSafePath', () => {
    it('throws on empty string', () => {
        expect(() => validateSafePath('')).toThrow('non-empty string');
    });

    it('throws on non-string input', () => {
        expect(() => validateSafePath(null as unknown as string)).toThrow('non-empty string');
        expect(() => validateSafePath(undefined as unknown as string)).toThrow('non-empty string');
        expect(() => validateSafePath(123 as unknown as string)).toThrow('non-empty string');
    });

    it('throws on path with .. traversal', () => {
        expect(() => validateSafePath('C:\\Users\\..\\..\\etc\\passwd')).toThrow('Path traversal');
        expect(() => validateSafePath('/home/../../../etc/shadow')).toThrow('Path traversal');
        expect(() => validateSafePath('C:\\normal\\..hidden\\file')).toThrow('Path traversal');
    });

    it('throws on path with null byte (CWE-158)', () => {
        expect(() => validateSafePath('C:\\Users\\test\0.exe')).toThrow('Null byte');
        expect(() => validateSafePath('/tmp/file\x00.expressdelivery')).toThrow('Null byte');
    });

    it('throws on relative path', () => {
        expect(() => validateSafePath('relative/path/file.pkg')).toThrow('absolute');
        expect(() => validateSafePath('file.expressdelivery')).toThrow('absolute');
        expect(() => validateSafePath('.\\relative')).toThrow('absolute');
    });

    it('accepts valid Windows absolute path with drive letter', () => {
        const result = validateSafePath('C:\\Users\\test\\package.expressdelivery');
        expect(result).toBe('C:\\Users\\test\\package.expressdelivery');
    });

    it('accepts valid Windows path with forward slashes', () => {
        const result = validateSafePath('D:/Downloads/update.expressdelivery');
        expect(result).toBe('D:/Downloads/update.expressdelivery');
    });

    it('accepts valid Unix absolute path', () => {
        const result = validateSafePath('/home/user/package.expressdelivery');
        expect(result).toBe('/home/user/package.expressdelivery');
    });

    it('accepts paths with spaces', () => {
        const result = validateSafePath('C:\\Program Files\\Express Delivery\\update.pkg');
        expect(result).toBe('C:\\Program Files\\Express Delivery\\update.pkg');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizePayloadFileName — CWE-22 / CWE-78 prevention
// ─────────────────────────────────────────────────────────────────────────────
describe('sanitizePayloadFileName', () => {
    it('throws on empty string', () => {
        expect(() => sanitizePayloadFileName('')).toThrow('non-empty string');
    });

    it('throws on non-string input', () => {
        expect(() => sanitizePayloadFileName(null as unknown as string)).toThrow('non-empty string');
    });

    it('throws on path with directory separator (CWE-22)', () => {
        expect(() => sanitizePayloadFileName('../../../evil.exe')).toThrow('path traversal');
        expect(() => sanitizePayloadFileName('subdir/installer.exe')).toThrow('path traversal');
        expect(() => sanitizePayloadFileName('subdir\\installer.exe')).toThrow('path traversal');
    });

    it('throws on filename with invalid characters (semicolon, pipe, backtick)', () => {
        expect(() => sanitizePayloadFileName('file;rm -rf.exe')).toThrow('invalid characters');
        expect(() => sanitizePayloadFileName('file|evil.exe')).toThrow('invalid characters');
        expect(() => sanitizePayloadFileName('file`cmd`.exe')).toThrow('invalid characters');
        expect(() => sanitizePayloadFileName('file$var.exe')).toThrow('invalid characters');
    });

    it('accepts clean installer filename', () => {
        const result = sanitizePayloadFileName('ExpressDelivery-Setup-1.14.0.exe');
        expect(result).toBe('ExpressDelivery-Setup-1.14.0.exe');
    });

    it('accepts filename with spaces, hyphens, underscores, parens', () => {
        const result = sanitizePayloadFileName('Express Delivery (Setup) v1.14.0.exe');
        expect(result).toBe('Express Delivery (Setup) v1.14.0.exe');
    });

    it('accepts simple dotted filename', () => {
        const result = sanitizePayloadFileName('installer.nsis.exe');
        expect(result).toBe('installer.nsis.exe');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// compareVersions — semver-style comparison
// ─────────────────────────────────────────────────────────────────────────────
describe('compareVersions', () => {
    it('returns negative when a < b', () => {
        expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
        expect(compareVersions('1.12.9', '1.13.0')).toBeLessThan(0);
        expect(compareVersions('0.9.99', '1.0.0')).toBeLessThan(0);
    });

    it('returns 0 for identical versions', () => {
        expect(compareVersions('1.13.0', '1.13.0')).toBe(0);
        expect(compareVersions('0.0.0', '0.0.0')).toBe(0);
    });

    it('returns positive when a > b', () => {
        expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
        expect(compareVersions('1.14.0', '1.13.3')).toBeGreaterThan(0);
    });

    it('handles unequal segment counts (1.0 vs 1.0.0)', () => {
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('1.0.0', '1.0')).toBe(0);
        expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
    });

    it('handles single-segment versions', () => {
        expect(compareVersions('2', '1')).toBeGreaterThan(0);
        expect(compareVersions('1', '1')).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatSize — human-readable file sizes
// ─────────────────────────────────────────────────────────────────────────────
describe('formatSize', () => {
    it('formats bytes for small values', () => {
        expect(formatSize(0)).toBe('0 B');
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(1023)).toBe('1023 B');
    });

    it('formats KB for kilobyte-range values', () => {
        expect(formatSize(1024)).toBe('1.0 KB');
        expect(formatSize(1536)).toBe('1.5 KB');
        expect(formatSize(1024 * 1023)).toBe('1023.0 KB');
    });

    it('formats MB for megabyte-range values', () => {
        expect(formatSize(1024 * 1024)).toBe('1.0 MB');
        expect(formatSize(1024 * 1024 * 150)).toBe('150.0 MB');
        expect(formatSize(1024 * 1024 * 600)).toBe('600.0 MB');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeThumbprint — certificate thumbprint normalization
// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeThumbprint', () => {
    it('strips spaces, dashes, colons and lowercases', () => {
        expect(normalizeThumbprint('AB:CD:EF:12')).toBe('abcdef12');
        expect(normalizeThumbprint('AB CD EF 12')).toBe('abcdef12');
        expect(normalizeThumbprint('AB-CD-EF-12')).toBe('abcdef12');
    });

    it('returns null for non-hex characters', () => {
        expect(normalizeThumbprint('ZZZZ')).toBeNull();
        expect(normalizeThumbprint('not-a-thumbprint!')).toBeNull();
        expect(normalizeThumbprint('ghij')).toBeNull();
    });

    it('returns cleaned hex for valid thumbprints', () => {
        expect(normalizeThumbprint('aabbccdd')).toBe('aabbccdd');
        expect(normalizeThumbprint('0123456789abcdef')).toBe('0123456789abcdef');
    });

    it('handles empty string after cleanup', () => {
        // After removing spaces/dashes/colons from '   ', result is '' which fails hex test
        expect(normalizeThumbprint('   ')).toBeNull();
    });
});
