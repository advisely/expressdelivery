import { describe, it, expect } from 'vitest';
import { formatFileSize } from './formatFileSize';

describe('formatFileSize', () => {
    // -------------------------------------------------------------------------
    // Guard: non-finite / edge inputs
    // -------------------------------------------------------------------------

    it('returns "0 B" for 0 bytes', () => {
        expect(formatFileSize(0)).toBe('0 B');
    });

    it('returns "0 B" for negative values', () => {
        expect(formatFileSize(-1)).toBe('0 B');
        expect(formatFileSize(-1024)).toBe('0 B');
    });

    it('returns "0 B" for NaN', () => {
        expect(formatFileSize(NaN)).toBe('0 B');
    });

    it('returns "0 B" for positive Infinity', () => {
        expect(formatFileSize(Infinity)).toBe('0 B');
    });

    it('returns "0 B" for negative Infinity', () => {
        expect(formatFileSize(-Infinity)).toBe('0 B');
    });

    // -------------------------------------------------------------------------
    // Bytes (< 1024)
    // -------------------------------------------------------------------------

    it('formats 1 byte as "1 B" (no decimal for bytes)', () => {
        expect(formatFileSize(1)).toBe('1 B');
    });

    it('formats 512 bytes as "512 B"', () => {
        expect(formatFileSize(512)).toBe('512 B');
    });

    it('formats 1023 bytes as "1023 B" (just below 1 KB boundary)', () => {
        expect(formatFileSize(1023)).toBe('1023 B');
    });

    // -------------------------------------------------------------------------
    // Kilobytes (1 KB – 1023.9 KB)
    // -------------------------------------------------------------------------

    it('formats exactly 1024 bytes as "1.0 KB"', () => {
        expect(formatFileSize(1024)).toBe('1.0 KB');
    });

    it('formats 1536 bytes (1.5 KB) with one decimal place', () => {
        expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats 10 KB correctly', () => {
        expect(formatFileSize(10 * 1024)).toBe('10.0 KB');
    });

    it('formats 102400 bytes (100 KB) correctly', () => {
        expect(formatFileSize(100 * 1024)).toBe('100.0 KB');
    });

    it('formats 1023 * 1024 bytes (just below 1 MB boundary) as KB', () => {
        const justBelowMb = 1023 * 1024;
        const result = formatFileSize(justBelowMb);
        expect(result).toMatch(/KB$/);
    });

    // -------------------------------------------------------------------------
    // Megabytes (1 MB – 1023.9 MB)
    // -------------------------------------------------------------------------

    it('formats exactly 1 MB (1048576 bytes) as "1.0 MB"', () => {
        expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    });

    it('formats 2.5 MB correctly', () => {
        expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('formats 50 MB correctly', () => {
        expect(formatFileSize(50 * 1024 * 1024)).toBe('50.0 MB');
    });

    it('formats a typical email attachment (2048000 bytes ≈ 2.0 MB)', () => {
        // 2048000 / 1048576 ≈ 1.953 → rounds to 2.0 in toFixed(1)
        const result = formatFileSize(2048000);
        expect(result).toMatch(/MB$/);
        expect(parseFloat(result)).toBeCloseTo(1.953, 1);
    });

    // -------------------------------------------------------------------------
    // Gigabytes (≥ 1 GB)
    // -------------------------------------------------------------------------

    it('formats exactly 1 GB (1073741824 bytes) as "1.0 GB"', () => {
        expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('formats 1.5 GB correctly', () => {
        expect(formatFileSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    });

    it('formats a large 4.7 GB value (DVD image) correctly', () => {
        const result = formatFileSize(4.7 * 1024 * 1024 * 1024);
        expect(result).toMatch(/GB$/);
        expect(parseFloat(result)).toBeCloseTo(4.7, 0);
    });

    // -------------------------------------------------------------------------
    // Unit boundary: result always has exactly one unit suffix token
    // -------------------------------------------------------------------------

    it('always returns a string ending with a known unit', () => {
        const validUnits = ['B', 'KB', 'MB', 'GB'];
        const testValues = [0, 1, 512, 1024, 1048576, 1073741824, 5 * 1024 * 1024 * 1024];
        for (const bytes of testValues) {
            const result = formatFileSize(bytes);
            const unit = result.split(' ').pop();
            expect(validUnits).toContain(unit);
        }
    });

    it('returns no decimal places for byte values', () => {
        // Byte-range values must not include a dot (e.g. "512 B", not "512.0 B")
        expect(formatFileSize(1)).not.toContain('.');
        expect(formatFileSize(999)).not.toContain('.');
    });

    it('returns one decimal place for KB/MB/GB values', () => {
        const kbResult = formatFileSize(2048);     // 2.0 KB
        const mbResult = formatFileSize(2097152);  // 2.0 MB
        expect(kbResult.split(' ')[0]).toMatch(/^\d+\.\d$/);
        expect(mbResult.split(' ')[0]).toMatch(/^\d+\.\d$/);
    });
});
