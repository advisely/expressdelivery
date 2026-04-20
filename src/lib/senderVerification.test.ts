import { describe, it, expect } from 'vitest';
import { readAuthResults, getSenderVerification } from './senderVerification';

describe('readAuthResults', () => {
    it('normalizes lower/upper case', () => {
        expect(readAuthResults({ auth_spf: 'PASS' })).toEqual({ spf: 'pass', dkim: 'none', dmarc: 'none' });
    });
    it('defaults missing fields to "none"', () => {
        expect(readAuthResults({})).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
        expect(readAuthResults({ auth_spf: null, auth_dkim: undefined })).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
    });
    it('treats unrecognized values as "none" (defensive)', () => {
        expect(readAuthResults({ auth_spf: 'garbage' })).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
    });
});

describe('getSenderVerification', () => {
    it('returns "verified" only when all three pass', () => {
        expect(getSenderVerification({ spf: 'pass', dkim: 'pass', dmarc: 'pass' })).toBe('verified');
    });
    it('returns "partial" when at least one passes and at least one does not', () => {
        expect(getSenderVerification({ spf: 'pass', dkim: 'fail', dmarc: 'none' })).toBe('partial');
        expect(getSenderVerification({ spf: 'none', dkim: 'pass', dmarc: 'fail' })).toBe('partial');
    });
    it('returns "unverified" when none pass and at least one explicitly fails', () => {
        expect(getSenderVerification({ spf: 'fail', dkim: 'fail', dmarc: 'fail' })).toBe('unverified');
        expect(getSenderVerification({ spf: 'fail', dkim: 'none', dmarc: 'none' })).toBe('unverified');
    });
    it('returns "unknown" when all three are "none" (sender publishes no records)', () => {
        expect(getSenderVerification({ spf: 'none', dkim: 'none', dmarc: 'none' })).toBe('unknown');
    });
    it('softfail does NOT count as pass', () => {
        expect(getSenderVerification({ spf: 'softfail', dkim: 'softfail', dmarc: 'softfail' })).toBe('unverified');
    });
});
