import { describe, it, expect } from 'vitest';
import { parseAuthResults, getSenderVerification } from './authResults.js';

// ─────────────────────────────────────────────────────────────────────────────
// parseAuthResults — Authentication-Results header parser
// ─────────────────────────────────────────────────────────────────────────────
describe('parseAuthResults', () => {
    it('returns all "none" for null input', () => {
        const result = parseAuthResults(null);
        expect(result).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
    });

    it('returns all "none" for undefined input', () => {
        const result = parseAuthResults(undefined);
        expect(result).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
    });

    it('returns all "none" for empty string', () => {
        const result = parseAuthResults('');
        expect(result).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
    });

    it('parses Google-style Authentication-Results header', () => {
        const header = 'mx.google.com; dkim=pass header.d=example.com; spf=pass; dmarc=pass';
        const result = parseAuthResults(header);
        expect(result.spf).toBe('pass');
        expect(result.dkim).toBe('pass');
        expect(result.dmarc).toBe('pass');
    });

    it('parses SPF fail with additional params', () => {
        const header = 'server; spf=fail (sender IP is 1.2.3.4) smtp.mailfrom=evil.com; dkim=none; dmarc=fail';
        const result = parseAuthResults(header);
        expect(result.spf).toBe('fail');
        expect(result.dkim).toBe('none');
        expect(result.dmarc).toBe('fail');
    });

    it('parses softfail SPF result', () => {
        const header = 'server; spf=softfail';
        const result = parseAuthResults(header);
        expect(result.spf).toBe('softfail');
    });

    it('parses temperror and permerror results', () => {
        const header = 'server; spf=temperror; dkim=permerror; dmarc=temperror';
        const result = parseAuthResults(header);
        expect(result.spf).toBe('temperror');
        expect(result.dkim).toBe('permerror');
        expect(result.dmarc).toBe('temperror');
    });

    it('ignores unknown status values', () => {
        const header = 'server; spf=unknown123; dkim=bogus; dmarc=invalid';
        const result = parseAuthResults(header);
        expect(result.spf).toBe('none');
        expect(result.dkim).toBe('none');
        expect(result.dmarc).toBe('none');
    });

    it('handles case-insensitive header parsing', () => {
        const header = 'server; SPF=Pass; DKIM=PASS; DMARC=Pass';
        const result = parseAuthResults(header);
        expect(result.spf).toBe('pass');
        expect(result.dkim).toBe('pass');
        expect(result.dmarc).toBe('pass');
    });

    it('parses all three results from single header', () => {
        const header = 'mx.test.com; spf=neutral; dkim=fail; dmarc=none';
        const result = parseAuthResults(header);
        expect(result.spf).toBe('neutral');
        expect(result.dkim).toBe('fail');
        expect(result.dmarc).toBe('none');
    });

    it('handles non-string input gracefully', () => {
        const result = parseAuthResults(42 as unknown as string);
        expect(result).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSenderVerification — trust level determination
// ─────────────────────────────────────────────────────────────────────────────
describe('getSenderVerification', () => {
    it('returns "verified" when all three pass', () => {
        expect(getSenderVerification({ spf: 'pass', dkim: 'pass', dmarc: 'pass' })).toBe('verified');
    });

    it('returns "unknown" when all are "none"', () => {
        expect(getSenderVerification({ spf: 'none', dkim: 'none', dmarc: 'none' })).toBe('unknown');
    });

    it('returns "partial" when only one passes', () => {
        expect(getSenderVerification({ spf: 'pass', dkim: 'fail', dmarc: 'fail' })).toBe('partial');
        expect(getSenderVerification({ spf: 'fail', dkim: 'pass', dmarc: 'none' })).toBe('partial');
    });

    it('returns "partial" when two pass', () => {
        expect(getSenderVerification({ spf: 'pass', dkim: 'pass', dmarc: 'fail' })).toBe('partial');
    });

    it('returns "unverified" when all fail', () => {
        expect(getSenderVerification({ spf: 'fail', dkim: 'fail', dmarc: 'fail' })).toBe('unverified');
    });

    it('returns "unverified" when mix of fail and temperror (no pass, not all none)', () => {
        expect(getSenderVerification({ spf: 'fail', dkim: 'temperror', dmarc: 'permerror' })).toBe('unverified');
    });

    it('returns "unverified" when some are none and rest are fail', () => {
        expect(getSenderVerification({ spf: 'fail', dkim: 'none', dmarc: 'fail' })).toBe('unverified');
    });
});
