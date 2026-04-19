import type { EmailFull } from '../stores/emailStore';
import type { PhishingResult } from './phishingDetector';
import { detectDisplayNameSpoofing } from './phishingDetector';

export interface SenderRiskAssessment {
    /**
     * True when ANY of the constituent signals indicate this email may be
     * untrustworthy. This is the gate the UI uses to decide whether to render
     * the "Load remote images" / link-click banners with a danger variant.
     */
    isHighRisk: boolean;
    /**
     * Human-readable reasons in priority order (most severe first). The UI
     * shows the first 2-3 in the danger banner.
     */
    reasons: string[];
}

/** SPF/DKIM/DMARC values that indicate an authentication FAILURE (vs unknown/none). */
const FAIL_AUTH_VALUES: ReadonlySet<string> = new Set(['fail', 'softfail', 'permerror']);

function isAuthFail(value: string | null | undefined): boolean {
    if (!value) return false;
    return FAIL_AUTH_VALUES.has(value.toLowerCase());
}

/**
 * Combine all sender-trust signals into a single risk assessment.
 *
 * Signals (any one is enough to raise isHighRisk):
 * 1. Phishing URL detector flagged at least one suspicious link.
 * 2. SPF, DKIM, or DMARC authentication explicitly failed (not "none" — many
 *    legitimate small senders have no auth records at all, which we don't
 *    treat as risk; we only act on actively-failing auth).
 * 3. Display-name spoofing — sender name claims a brand the email domain
 *    does not match (e.g., "PayPal Support" from @evil.tk).
 *
 * Spec invariant: this function NEVER throws. Missing/undefined fields are
 * treated as "no signal" — the absence of evidence is not evidence of risk.
 */
export function assessSenderRisk(
    email: Pick<EmailFull, 'from_name' | 'from_email' | 'auth_spf' | 'auth_dkim' | 'auth_dmarc'>,
    phishingResult: PhishingResult,
): SenderRiskAssessment {
    const reasons: string[] = [];

    if (phishingResult.isPhishing) {
        const lead = phishingResult.reasons[0];
        reasons.push(lead ? `Phishing indicators detected: ${lead}` : 'Phishing indicators detected in this email');
    }

    if (isAuthFail(email.auth_dmarc)) {
        reasons.push('DMARC authentication failed — sender domain cannot be verified');
    }
    if (isAuthFail(email.auth_dkim)) {
        reasons.push('DKIM signature failed — message contents may have been tampered with');
    }
    if (isAuthFail(email.auth_spf)) {
        reasons.push('SPF check failed — the sending server is not authorized for this domain');
    }

    const spoof = detectDisplayNameSpoofing(email.from_name ?? '', email.from_email ?? '');
    if (spoof.isSpoofed) {
        reasons.push(`Display name appears spoofed: ${spoof.reason}`);
    }

    return {
        isHighRisk: reasons.length > 0,
        reasons,
    };
}
