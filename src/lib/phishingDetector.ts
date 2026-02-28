// Phishing detection heuristics for email URLs

export interface PhishingResult {
    isPhishing: boolean;
    score: number; // 0–100
    reasons: string[];
}

// Suspicious TLDs commonly used in phishing campaigns
const SUSPICIOUS_TLDS = new Set([
    '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.win', '.loan',
    '.click', '.link', '.buzz', '.info', '.work', '.party',
]);

// Well-known brand names mapped to their official domains.
// A URL that contains the brand name in a hostname other than the official
// domain is a strong spoofing indicator.
const BRAND_DOMAINS = new Map([
    ['paypal',          'paypal.com'],
    ['apple',           'apple.com'],
    ['microsoft',       'microsoft.com'],
    ['google',          'google.com'],
    ['amazon',          'amazon.com'],
    ['netflix',         'netflix.com'],
    ['facebook',        'facebook.com'],
    ['instagram',       'instagram.com'],
    ['linkedin',        'linkedin.com'],
    ['twitter',         'twitter.com'],
    ['chase',           'chase.com'],
    ['wellsfargo',      'wellsfargo.com'],
    ['bankofamerica',   'bankofamerica.com'],
]);

/** Extract all href URLs that use http/https from raw HTML. */
function extractUrls(html: string): string[] {
    const urls: string[] = [];
    const regex = /href=["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        urls.push(match[1]);
    }
    return urls;
}

/** Score a single URL against all phishing heuristics. */
function analyzeUrl(url: string): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { score: 0, reasons: [] };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Rule 1: IP address used instead of domain name
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
        score += 30;
        reasons.push('IP address used instead of domain name');
    }

    // Rule 2: Suspicious free-hosting or disposable TLD
    for (const tld of SUSPICIOUS_TLDS) {
        if (hostname.endsWith(tld)) {
            score += 15;
            reasons.push(`Suspicious TLD: ${tld}`);
            break;
        }
    }

    // Rule 3: Excessive subdomains (more than 3 dots in hostname)
    if ((hostname.match(/\./g) ?? []).length > 3) {
        score += 20;
        reasons.push('Excessive subdomains');
    }

    // Rule 4: Brand name in hostname but not the official brand domain.
    // Allow exact match (paypal.com) and legitimate subdomains (secure.paypal.com).
    // Flag mypaypal.com or paypal.com.evil.com as spoofing attempts.
    for (const [brand, officialDomain] of BRAND_DOMAINS) {
        if (hostname.includes(brand) && hostname !== officialDomain && !hostname.endsWith('.' + officialDomain)) {
            score += 35;
            reasons.push(`Brand "${brand}" in URL but not the official domain`);
            break;
        }
    }

    // Rule 5: HTTP used for a path that looks sensitive (login, verify, etc.)
    if (
        parsed.protocol === 'http:' &&
        /\/(login|signin|account|password|verify|secure|banking)/i.test(parsed.pathname)
    ) {
        score += 25;
        reasons.push('HTTP used for sensitive page');
    }

    // Rule 6: Unusually long URL (often used to hide the real domain in plain sight)
    if (url.length > 200) {
        score += 10;
        reasons.push('Unusually long URL');
    }

    // Rule 7: @ sign before the first path separator (user-info URL obfuscation trick)
    // e.g. http://paypal.com@evil.com/login
    const schemeEnd = url.indexOf('/', 8); // skip past "https://"
    const atPos     = url.indexOf('@');
    if (atPos !== -1 && (schemeEnd === -1 || atPos < schemeEnd)) {
        score += 40;
        reasons.push('URL contains @ sign (possible URL obfuscation)');
    }

    return { score, reasons };
}

/**
 * Analyse all URLs found in the email HTML and return the worst-case
 * phishing assessment.
 *
 * @param html - Raw (unsanitized) or sanitized email HTML, or null.
 * @returns A PhishingResult with isPhishing=true when score >= 40.
 */
export function detectPhishing(html: string | null): PhishingResult {
    if (!html) return { isPhishing: false, score: 0, reasons: [] };

    const urls = extractUrls(html);
    if (urls.length === 0) return { isPhishing: false, score: 0, reasons: [] };

    let maxScore = 0;
    const allReasons: string[] = [];

    for (const url of urls) {
        const { score, reasons } = analyzeUrl(url);
        if (score > maxScore) maxScore = score;
        allReasons.push(...reasons);
    }

    const uniqueReasons = [...new Set(allReasons)];

    return {
        isPhishing: maxScore >= 40,
        score: Math.min(maxScore, 100),
        reasons: uniqueReasons,
    };
}
