/**
 * Renderer-side mirror of `electron/authResults.ts` `getSenderVerification`.
 * Computes the SPF + DKIM + DMARC verification status from the per-email
 * fields persisted in the SQLite `emails` table. Used by the auth-result
 * badge in ReadingPane to give the user explicit, visible feedback about
 * sender authenticity (v1.18.4).
 *
 * Logic must stay in lockstep with `electron/authResults.ts`. The renderer
 * re-implements the trivial enum check rather than cross-importing from
 * `electron/` (Electron main code shouldn't be a renderer dependency).
 */

export type AuthValue = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror';

export interface AuthResults {
    spf: AuthValue;
    dkim: AuthValue;
    dmarc: AuthValue;
}

export type VerificationStatus = 'verified' | 'partial' | 'unverified' | 'unknown';

const VALID_AUTH = new Set<AuthValue>(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror']);

function normalize(v: string | null | undefined): AuthValue {
    if (!v) return 'none';
    const lower = v.toLowerCase();
    return VALID_AUTH.has(lower as AuthValue) ? (lower as AuthValue) : 'none';
}

/** Pull the three auth values from an email row, defaulting to `none`. */
export function readAuthResults(email: {
    auth_spf?: string | null;
    auth_dkim?: string | null;
    auth_dmarc?: string | null;
}): AuthResults {
    return {
        spf: normalize(email.auth_spf),
        dkim: normalize(email.auth_dkim),
        dmarc: normalize(email.auth_dmarc),
    };
}

/**
 * verified   = all three pass
 * partial    = at least one passes (the others fail/none/etc.)
 * unverified = none pass and at least one explicitly fails
 * unknown    = all three are 'none' (sender doesn't publish any records)
 */
export function getSenderVerification(auth: AuthResults): VerificationStatus {
    const passes = [auth.spf === 'pass', auth.dkim === 'pass', auth.dmarc === 'pass'];
    const passCount = passes.filter(Boolean).length;
    const allNone = auth.spf === 'none' && auth.dkim === 'none' && auth.dmarc === 'none';

    if (allNone) return 'unknown';
    if (passCount === 3) return 'verified';
    if (passCount > 0) return 'partial';
    return 'unverified';
}
