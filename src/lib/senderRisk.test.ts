import { describe, it, expect } from 'vitest';
import { assessSenderRisk } from './senderRisk';
import type { EmailFull } from '../stores/emailStore';
import type { PhishingResult } from './phishingDetector';

const noPhishing: PhishingResult = { isPhishing: false, score: 0, reasons: [] };
const yesPhishing: PhishingResult = {
    isPhishing: true,
    score: 65,
    reasons: ['Brand "paypal" in URL but not the official domain'],
};

function makeEmail(overrides: Partial<EmailFull> = {}): EmailFull {
    return {
        id: 'email-1',
        thread_id: 'thread-1',
        account_id: 'acc-1',
        folder_id: 'folder-inbox',
        subject: 'Hello',
        from_name: 'Alice',
        from_email: 'alice@example.com',
        to_email: 'me@example.com',
        date: '2026-04-19T12:00:00Z',
        snippet: null,
        is_read: 0,
        is_flagged: 0,
        has_attachments: 0,
        ai_category: null,
        ai_priority: null,
        ai_labels: null,
        thread_count: 1,
        body_text: null,
        body_html: null,
        bodyFetchStatus: 'ok',
        ...overrides,
    };
}

describe('assessSenderRisk', () => {
    it('returns isHighRisk=false for a clean email with passing auth', () => {
        const email = makeEmail({ auth_spf: 'pass', auth_dkim: 'pass', auth_dmarc: 'pass' });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(false);
        expect(result.reasons).toEqual([]);
    });

    it('returns isHighRisk=true when phishing detector flags the email', () => {
        const email = makeEmail({ auth_spf: 'pass', auth_dkim: 'pass', auth_dmarc: 'pass' });
        const result = assessSenderRisk(email, yesPhishing);
        expect(result.isHighRisk).toBe(true);
        expect(result.reasons.some(r => r.toLowerCase().includes('phishing'))).toBe(true);
    });

    it('returns isHighRisk=true on DMARC fail', () => {
        const email = makeEmail({ auth_spf: 'pass', auth_dkim: 'pass', auth_dmarc: 'fail' });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(true);
        expect(result.reasons.some(r => r.toLowerCase().includes('dmarc'))).toBe(true);
    });

    it('returns isHighRisk=true on DKIM fail', () => {
        const email = makeEmail({ auth_spf: 'pass', auth_dkim: 'fail', auth_dmarc: 'pass' });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(true);
        expect(result.reasons.some(r => r.toLowerCase().includes('dkim'))).toBe(true);
    });

    it('returns isHighRisk=true on SPF fail', () => {
        const email = makeEmail({ auth_spf: 'fail', auth_dkim: 'pass', auth_dmarc: 'pass' });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(true);
        expect(result.reasons.some(r => r.toLowerCase().includes('spf'))).toBe(true);
    });

    it('returns isHighRisk=true when display name spoofs a brand', () => {
        const email = makeEmail({ from_name: 'PayPal Support', from_email: 'support@randomsite.com', auth_spf: 'pass', auth_dkim: 'pass', auth_dmarc: 'pass' });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(true);
        expect(result.reasons.some(r => r.toLowerCase().includes('display name') || r.toLowerCase().includes('spoof'))).toBe(true);
    });

    it('does NOT raise risk for SPF/DKIM/DMARC values "none" (e.g., legacy senders without proper auth setup)', () => {
        const email = makeEmail({ auth_spf: 'none', auth_dkim: 'none', auth_dmarc: 'none' });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(false);
    });

    it('does NOT raise risk for missing auth fields (undefined/null)', () => {
        const email = makeEmail({ auth_spf: undefined, auth_dkim: undefined, auth_dmarc: undefined });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(false);
    });

    it('combines multiple risk signals into a single reasons list', () => {
        const email = makeEmail({ from_name: 'Apple Security', from_email: 'evil@phisher.tk', auth_dmarc: 'fail' });
        const result = assessSenderRisk(email, yesPhishing);
        expect(result.isHighRisk).toBe(true);
        expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it('treats softfail as a warning equivalent to fail (mailers commonly downgrade for retry)', () => {
        const email = makeEmail({ auth_spf: 'softfail' });
        const result = assessSenderRisk(email, noPhishing);
        expect(result.isHighRisk).toBe(true);
    });

    // ── REGRESSION: trusted-sender bypass (v1.18.3) ─────────────────────────
    // When the user marks a sender as trusted (electron/trustedSenders.ts),
    // assessSenderRisk must short-circuit and return isHighRisk=false even if
    // the constituent signals would otherwise raise the flag. The user has
    // explicitly accepted the risk and does not want to see the danger banner
    // for this sender again.
    it('returns isHighRisk=false when options.isTrusted is true, even with phishing flagged', () => {
        const email = makeEmail({ auth_dmarc: 'fail' });
        const result = assessSenderRisk(email, yesPhishing, { isTrusted: true });
        expect(result.isHighRisk).toBe(false);
        expect(result.reasons).toEqual([]);
    });

    it('returns isHighRisk=false when options.isTrusted is true, even with display-name spoof', () => {
        const email = makeEmail({ from_name: 'PayPal Support', from_email: 'support@randomsite.com' });
        const result = assessSenderRisk(email, noPhishing, { isTrusted: true });
        expect(result.isHighRisk).toBe(false);
    });

    it('still flags risk when options.isTrusted is false (explicit) or omitted', () => {
        const email = makeEmail({ auth_dmarc: 'fail' });
        expect(assessSenderRisk(email, noPhishing, { isTrusted: false }).isHighRisk).toBe(true);
        expect(assessSenderRisk(email, noPhishing).isHighRisk).toBe(true);
    });
});
