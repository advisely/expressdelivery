import { describe, it, expect } from 'vitest';
import { detectPhishing } from './phishingDetector';

// Helper — wrap URLs in simple anchor tags
function makeHtml(urls: string[]): string {
    return urls.map(u => `<a href="${u}">link</a>`).join(' ');
}

describe('detectPhishing', () => {
    it('returns isPhishing=false for null HTML', () => {
        const result = detectPhishing(null);
        expect(result.isPhishing).toBe(false);
        expect(result.score).toBe(0);
        expect(result.reasons).toHaveLength(0);
    });

    it('returns isPhishing=false for HTML with no URLs', () => {
        const result = detectPhishing('<p>No links here</p>');
        expect(result.isPhishing).toBe(false);
        expect(result.score).toBe(0);
    });

    it('returns isPhishing=false for clean, reputable URLs', () => {
        const html = makeHtml([
            'https://www.google.com/search?q=test',
            'https://github.com/user/repo',
        ]);
        const result = detectPhishing(html);
        expect(result.isPhishing).toBe(false);
    });

    it('detects IP address in URL (score +30)', () => {
        const html = makeHtml(['http://192.168.1.1/login']);
        const result = detectPhishing(html);
        expect(result.score).toBeGreaterThanOrEqual(30);
        expect(result.reasons.some(r => r.includes('IP address'))).toBe(true);
    });

    it('detects brand spoofing — paypal in non-paypal domain (score +35)', () => {
        // 4 subdomains (4 dots) gives +20, combined with brand spoof +35 = 55 >= 40
        const html = makeHtml(['https://secure.paypal.account-verify.evil.com/signin']);
        const result = detectPhishing(html);
        expect(result.score).toBeGreaterThanOrEqual(35);
        expect(result.reasons.some(r => r.includes('paypal'))).toBe(true);
    });

    it('detects microsoft brand spoofing combined with HTTP sensitive path (score >= 40)', () => {
        // Brand spoof +35, HTTP sensitive path +25 = 60 >= 40
        const html = makeHtml(['http://microsoft-login.phishing.net/login']);
        const result = detectPhishing(html);
        expect(result.isPhishing).toBe(true);
        expect(result.reasons.some(r => r.includes('microsoft'))).toBe(true);
    });

    it('detects suspicious TLD (.tk)', () => {
        const html = makeHtml(['https://some-site.tk/promo']);
        const result = detectPhishing(html);
        expect(result.score).toBeGreaterThanOrEqual(15);
        expect(result.reasons.some(r => r.includes('.tk'))).toBe(true);
    });

    it('detects suspicious TLD (.xyz)', () => {
        const html = makeHtml(['https://deals.xyz/offer']);
        const result = detectPhishing(html);
        expect(result.reasons.some(r => r.includes('.xyz'))).toBe(true);
    });

    it('detects @ sign in URL (score +40 → isPhishing=true)', () => {
        // Classic phishing trick: http://paypal.com@evil.com/login
        // The browser resolves the domain AFTER @, so this goes to evil.com
        const html = makeHtml(['http://paypal.com@evil.com/steal']);
        const result = detectPhishing(html);
        expect(result.isPhishing).toBe(true);
        expect(result.reasons.some(r => r.toLowerCase().includes('@'))).toBe(true);
    });

    it('detects excessive subdomains (> 3 dots in hostname)', () => {
        const html = makeHtml(['https://a.b.c.d.e.evil.com/page']);
        const result = detectPhishing(html);
        expect(result.score).toBeGreaterThanOrEqual(20);
        expect(result.reasons.some(r => r.includes('subdomain'))).toBe(true);
    });

    it('detects HTTP used for a login path (score +25)', () => {
        const html = makeHtml(['http://example.com/login']);
        const result = detectPhishing(html);
        expect(result.score).toBeGreaterThanOrEqual(25);
        expect(result.reasons.some(r => r.includes('HTTP'))).toBe(true);
    });

    it('detects unusually long URL (score +10)', () => {
        const longPath = 'a'.repeat(200);
        const html = makeHtml([`https://example.com/${longPath}`]);
        const result = detectPhishing(html);
        expect(result.score).toBeGreaterThanOrEqual(10);
        expect(result.reasons.some(r => r.includes('long URL'))).toBe(true);
    });

    it('caps the score at 100', () => {
        // Combine multiple high-scoring indicators
        // - @ sign (+40), brand spoof (+35), IP address (+30), suspicious TLD (+15)
        // Together that would be 120 — should be capped at 100
        const html = makeHtml(['http://192.168.1.1@paypal.evil.tk/login']);
        const result = detectPhishing(html);
        expect(result.score).toBeLessThanOrEqual(100);
    });

    it('deduplicates reasons across multiple URLs', () => {
        const html = makeHtml([
            'https://paypal.evil.com/verify',
            'https://paypal.phish.net/account',
        ]);
        const result = detectPhishing(html);
        const paypalReasons = result.reasons.filter(r => r.includes('paypal'));
        // Both URLs trigger the same reason text — should appear only once
        expect(paypalReasons.length).toBe(1);
    });

    it('reports the maximum score across multiple URLs', () => {
        const html = makeHtml([
            'https://benign.com/page',                  // score 0
            'http://192.168.0.1/login',                 // score 30 + 25 = 55
        ]);
        const result = detectPhishing(html);
        expect(result.score).toBeGreaterThanOrEqual(55);
    });

    it('does not flag https links to official brand domains', () => {
        const html = makeHtml([
            'https://paypal.com/checkout',
            'https://microsoft.com/login',
        ]);
        const result = detectPhishing(html);
        // Official domains should not trigger brand spoofing
        expect(result.reasons.filter(r => r.includes('paypal') || r.includes('microsoft'))).toHaveLength(0);
    });

    // ── REGRESSION: regional brand domains (v1.18.3) ────────────────────────
    // User report: amazon.ca was being flagged as a phishing/spoof attempt.
    // Root cause: BRAND_DOMAINS only knew amazon.com. Every regional
    // storefront (amazon.ca, amazon.co.uk, amazon.de, ...) tripped Rule 4.
    // Fix: BRAND_DOMAINS now maps brand → list of official domains. These
    // tests pin that the regional storefronts are no longer flagged.
    it('does NOT flag amazon.ca — Canadian Amazon regional storefront', () => {
        const html = makeHtml(['https://www.amazon.ca/dp/B07XYZ']);
        const result = detectPhishing(html);
        expect(result.reasons.filter(r => r.includes('amazon'))).toHaveLength(0);
    });

    it('does NOT flag other Amazon regional domains (.co.uk, .de, .fr, .co.jp, .com.au, .com.mx)', () => {
        const regional = [
            'https://www.amazon.co.uk/orders',
            'https://www.amazon.de/account',
            'https://www.amazon.fr/help',
            'https://www.amazon.co.jp/gp/browse',
            'https://www.amazon.com.au/your-orders',
            'https://www.amazon.com.mx/category',
        ];
        for (const url of regional) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.filter(r => r.includes('amazon'))).toHaveLength(0);
        }
    });

    it('STILL flags amazon-spoofing domains (regression must not weaken security)', () => {
        const spoofs = [
            'https://amazon.com.evil.com/login',
            'https://my-amazon-account.tk/verify',
            'https://amaz0n.com/fake',  // typo squat with 0 (no brand match — score might be 0 from this rule, OK)
        ];
        // amazon.com.evil.com and my-amazon-account.tk should still trip Rule 4
        for (const url of spoofs.slice(0, 2)) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.some(r => r.includes('amazon'))).toBe(true);
        }
    });

    it('treats x.com as a Twitter regional alias (does not flag twitter+x.com cross-mention)', () => {
        const result = detectPhishing(makeHtml(['https://x.com/elonmusk']));
        expect(result.reasons.filter(r => r.includes('twitter'))).toHaveLength(0);
    });

    // ── REGRESSION: regional brand domains, full coverage (v1.18.4) ─────────
    // v1.18.3 fixed amazon.* and twitter+x.com. v1.18.4 extends to Apple,
    // Google, Microsoft, PayPal regional storefronts. Pinned here so future
    // contributors who shrink the lists break tests named after the regions.

    it('does NOT flag Apple regional domains (.de, .co.uk, .fr, .com.au, .com.br, .cn, .co.jp)', () => {
        const regional = [
            'https://www.apple.de/iphone', 'https://www.apple.co.uk/store',
            'https://www.apple.fr/support', 'https://www.apple.com.au/shop',
            'https://www.apple.com.br/iphone', 'https://www.apple.cn/macbook',
            'https://www.apple.co.jp/iphone',
        ];
        for (const url of regional) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.filter(r => r.includes('apple'))).toHaveLength(0);
        }
    });

    it('does NOT flag Google regional domains (.ca, .co.uk, .de, .fr, .com.au, .co.jp, .com.br)', () => {
        const regional = [
            'https://www.google.ca/search', 'https://www.google.co.uk/maps',
            'https://www.google.de/maps', 'https://www.google.fr/photos',
            'https://www.google.com.au/drive', 'https://www.google.co.jp/calendar',
            'https://www.google.com.br/translate',
        ];
        for (const url of regional) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.filter(r => r.includes('google'))).toHaveLength(0);
        }
    });

    it('does NOT flag Microsoft regional domains (.de, .co.uk, .fr, .com.au, .co.jp)', () => {
        const regional = [
            'https://www.microsoft.de/office', 'https://www.microsoft.co.uk/azure',
            'https://www.microsoft.fr/teams', 'https://www.microsoft.com.au/azure',
            'https://www.microsoft.co.jp/office',
        ];
        for (const url of regional) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.filter(r => r.includes('microsoft'))).toHaveLength(0);
        }
    });

    it('does NOT flag PayPal regional + paypal.me short-link domain', () => {
        const regional = [
            'https://paypal.me/jdoe', 'https://www.paypal.de/welcome',
            'https://www.paypal.co.uk/account', 'https://www.paypal.fr/help',
            'https://www.paypal.com.au/login', 'https://www.paypal.ca/checkout',
        ];
        for (const url of regional) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.filter(r => r.includes('paypal'))).toHaveLength(0);
        }
    });

    it('STILL flags fake regional spoofs (e.g., apple-secure.tk, paypal.com.evil.com)', () => {
        const spoofs = [
            'https://apple-secure.tk/login',
            'https://google-account-verify.tk/check',
            'https://paypal.com.evil.com/payment',
            'https://microsoft-365-renewal.ml/billing',
        ];
        for (const url of spoofs) {
            const result = detectPhishing(makeHtml([url]));
            // Each spoof should trigger SOME reason (brand spoof OR suspicious TLD).
            expect(result.reasons.length).toBeGreaterThan(0);
        }
    });

    // ── PSL-aware Path B (v1.18.4) ──────────────────────────────────────────
    // Replaces the hard-coded regional-domain enumeration with a Public Suffix
    // List (tldts) check. These tests prove the algorithmic mode catches
    // regional storefronts NOT enumerated in any explicit list AND still
    // rejects spoofs.

    it('PSL accepts Amazon storefronts NOT in any explicit list (auto-future-proof)', () => {
        // amazon.lu (Luxembourg), amazon.cl (Chile-style), amazon.co.za (S. Africa)
        // — none enumerated in v1.18.3 or v1.18.4. PSL recognizes them as
        // <brand>.<safe-tld> patterns automatically.
        const futureRegional = [
            'https://www.amazon.lu/account',
            'https://www.amazon.co.za/orders',
            'https://www.google.lt/maps',          // Google Lithuania
            'https://www.microsoft.gr/azure',      // Microsoft Greece
        ];
        for (const url of futureRegional) {
            const result = detectPhishing(makeHtml([url]));
            // No brand-spoof reason should appear for these.
            expect(result.reasons.filter(r => /Brand "/.test(r))).toHaveLength(0);
        }
    });

    it('PSL rejects brand on suspicious TLD (amazon.tk, paypal.ml)', () => {
        const suspicious = [
            'https://amazon.tk/deals',
            'https://paypal.ml/login',
            'https://google.gq/search',
        ];
        for (const url of suspicious) {
            const result = detectPhishing(makeHtml([url]));
            // Should flag — either brand spoof, suspicious TLD, or both.
            expect(result.reasons.length).toBeGreaterThan(0);
        }
    });

    it('PSL rejects subdomain trick (amazon.com.evil.com) — registrable domain is evil.com', () => {
        const result = detectPhishing(makeHtml(['https://amazon.com.evil.com/checkout']));
        expect(result.reasons.some(r => r.includes('amazon'))).toBe(true);
    });

    it('PSL accepts subdomains of regional storefronts (orders.amazon.de, secure.amazon.co.uk)', () => {
        const subdomained = [
            'https://orders.amazon.de/track',
            'https://secure.amazon.co.uk/payment',
            'https://accounts.google.fr/signin',
        ];
        for (const url of subdomained) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.filter(r => /Brand "/.test(r))).toHaveLength(0);
        }
    });

    it('US-only brands (chase, wellsfargo, bankofamerica) STAY restricted (allowAlgorithmic=false)', () => {
        // chase.de is NOT a legitimate Chase domain — Chase is US-only.
        // The PSL check would naively accept "chase.de" as <brand>.<safe-tld>;
        // our config marks chase as allowAlgorithmic=false to prevent this.
        const fakes = [
            'https://chase.de/login',
            'https://wellsfargo.co.uk/account',
            'https://bankofamerica.fr/payment',
        ];
        for (const url of fakes) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.some(r => /chase|wells|bankof/i.test(r))).toBe(true);
        }
    });

    it('US-only brands still accept their official .com (chase.com, wellsfargo.com)', () => {
        const officials = [
            'https://www.chase.com/personal',
            'https://wellsfargo.com/online-banking',
            'https://www.bankofamerica.com/login',
        ];
        for (const url of officials) {
            const result = detectPhishing(makeHtml([url]));
            expect(result.reasons.filter(r => /chase|wells|bankof/i.test(r))).toHaveLength(0);
        }
    });
});
