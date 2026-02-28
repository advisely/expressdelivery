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
});
