/**
 * Authentication-Results header parser.
 * Extracts SPF, DKIM, and DMARC verification results from email headers.
 */

export interface AuthResults {
    spf: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror';
    dkim: 'pass' | 'fail' | 'none' | 'temperror' | 'permerror';
    dmarc: 'pass' | 'fail' | 'none' | 'temperror' | 'permerror';
}

const VALID_SPF = new Set(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror']);
const VALID_DKIM = new Set(['pass', 'fail', 'none', 'temperror', 'permerror']);
const VALID_DMARC = new Set(['pass', 'fail', 'none', 'temperror', 'permerror']);

/**
 * Parse an Authentication-Results header value.
 * Handles formats like:
 *   mx.google.com; dkim=pass header.d=example.com; spf=pass; dmarc=pass
 *   server; spf=fail (sender IP is 1.2.3.4) smtp.mailfrom=evil.com
 */
export function parseAuthResults(headerValue: string | undefined | null): AuthResults {
    const defaults: AuthResults = { spf: 'none', dkim: 'none', dmarc: 'none' };
    if (!headerValue || typeof headerValue !== 'string') return defaults;

    const lower = headerValue.toLowerCase();

    // Extract spf=VALUE
    const spfMatch = lower.match(/\bspf\s*=\s*(\w+)/);
    if (spfMatch && VALID_SPF.has(spfMatch[1])) {
        defaults.spf = spfMatch[1] as AuthResults['spf'];
    }

    // Extract dkim=VALUE
    const dkimMatch = lower.match(/\bdkim\s*=\s*(\w+)/);
    if (dkimMatch && VALID_DKIM.has(dkimMatch[1])) {
        defaults.dkim = dkimMatch[1] as AuthResults['dkim'];
    }

    // Extract dmarc=VALUE
    const dmarcMatch = lower.match(/\bdmarc\s*=\s*(\w+)/);
    if (dmarcMatch && VALID_DMARC.has(dmarcMatch[1])) {
        defaults.dmarc = dmarcMatch[1] as AuthResults['dmarc'];
    }

    return defaults;
}

/**
 * Determine if an email sender is verified based on auth results.
 * Verified = SPF pass + DKIM pass + DMARC pass
 * Partial = at least one passes
 * Unverified = all fail or none
 */
export function getSenderVerification(auth: AuthResults): 'verified' | 'partial' | 'unverified' | 'unknown' {
    const passes = [auth.spf === 'pass', auth.dkim === 'pass', auth.dmarc === 'pass'];
    const passCount = passes.filter(Boolean).length;
    const allNone = auth.spf === 'none' && auth.dkim === 'none' && auth.dmarc === 'none';

    if (allNone) return 'unknown';
    if (passCount === 3) return 'verified';
    if (passCount > 0) return 'partial';
    return 'unverified';
}
