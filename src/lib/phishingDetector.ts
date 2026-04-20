// Phishing detection heuristics for email URLs

import { parse as parseTldts } from 'tldts';

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

// Bare-suffix lookup (without the leading dot) for comparisons against
// tldts.parse(...).publicSuffix which never includes the leading dot.
const SUSPICIOUS_TLDS_BARE = new Set(
    [...SUSPICIOUS_TLDS].map(s => s.startsWith('.') ? s.slice(1) : s)
);

// Well-known brand names mapped to their LIST of official domains. A URL
// whose hostname contains the brand name but does NOT match (exact or
// subdomain of) any official domain is flagged as a spoofing indicator.
//
// Why a list per brand: Amazon, Google, Microsoft, Apple, etc. all run
// per-country domains (amazon.ca, amazon.co.uk, google.de, microsoft.fr).
// A naive `brand → 'brand.com'` map false-positives every regional storefront.
// v1.18.3 expands the schema; new regional variants belong here.
/**
 * Per-brand acceptance config. v1.18.4 (Path B): replaces the hard-coded
 * regional-domain enumeration with a Public Suffix List (tldts) algorithmic
 * check. Each brand declares:
 *
 *   - `aliases`: always-allowed domains, used for non-pattern-matching
 *     officially-owned aliases (Twitter's x.com) AND for single-domain
 *     brands (US banks: chase.com, wellsfargo.com).
 *   - `allowAlgorithmic`: when true, any hostname whose registrable
 *     domain is `<brand>.<safe-tld>` is accepted. This covers every
 *     regional storefront automatically (amazon.ca, google.de,
 *     apple.co.uk, microsoft.fr, paypal.me, ...) without enumerating.
 *     Suspicious TLDs (`.tk`, `.ml`, `.gq`, etc. — see SUSPICIOUS_TLDS)
 *     are excluded so `amazon.tk` is still flagged.
 *
 * For US-only brands (Chase, Wells Fargo, Bank of America) the algorithmic
 * mode is disabled because `chase.de` etc. are NOT legitimate — the brand
 * does not operate regional country sites, so any non-`.com` is suspicious.
 */
interface BrandConfig {
    readonly aliases: readonly string[];
    readonly allowAlgorithmic: boolean;
}

const BRAND_CONFIGS = new Map<string, BrandConfig>([
    ['paypal',          { aliases: [],                       allowAlgorithmic: true  }],
    ['apple',           { aliases: [],                       allowAlgorithmic: true  }],
    ['microsoft',       { aliases: [],                       allowAlgorithmic: true  }],
    ['google',          { aliases: [],                       allowAlgorithmic: true  }],
    ['amazon',          { aliases: [],                       allowAlgorithmic: true  }],
    ['netflix',         { aliases: [],                       allowAlgorithmic: true  }],
    ['facebook',        { aliases: [],                       allowAlgorithmic: true  }],
    ['instagram',       { aliases: [],                       allowAlgorithmic: true  }],
    ['linkedin',        { aliases: [],                       allowAlgorithmic: true  }],
    ['twitter',         { aliases: ['x.com'],                allowAlgorithmic: true  }],
    ['chase',           { aliases: ['chase.com'],            allowAlgorithmic: false }],
    ['wellsfargo',      { aliases: ['wellsfargo.com'],       allowAlgorithmic: false }],
    ['bankofamerica',   { aliases: ['bankofamerica.com'],    allowAlgorithmic: false }],
]);

/**
 * Returns true if `hostname` is a legitimate official domain for `brand`.
 *
 * Two acceptance paths:
 *   1. Hostname exact-matches or is a subdomain of any brand alias.
 *   2. (Algorithmic mode only) Hostname's registrable domain has the brand
 *      name as its SLD (e.g., `amazon` in `amazon.ca`) and the public
 *      suffix is not in our suspicious-TLD denylist.
 *
 * Used by both Rule 4 (URL spoofing) and Check 1 (display-name spoofing).
 */
function isLegitimateBrandDomain(hostname: string, brand: string): boolean {
    const config = BRAND_CONFIGS.get(brand);
    if (!config) return false;

    for (const alias of config.aliases) {
        if (hostname === alias || hostname.endsWith('.' + alias)) return true;
    }

    if (!config.allowAlgorithmic) return false;

    const parsed = parseTldts(hostname);
    if (!parsed.domainWithoutSuffix || !parsed.publicSuffix) return false;
    if (parsed.domainWithoutSuffix !== brand) return false;
    if (SUSPICIOUS_TLDS_BARE.has(parsed.publicSuffix)) return false;

    return true;
}

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
    // PSL-aware: amazon.ca, google.de, apple.co.uk auto-accepted via tldts;
    // amazon.com.evil.com, amazon.tk, my-paypal-account.tk still flagged.
    for (const brand of BRAND_CONFIGS.keys()) {
        if (hostname.includes(brand) && !isLegitimateBrandDomain(hostname, brand)) {
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

// ── Display-name spoofing detection ─────────────────────────────────────────

export interface SpoofResult {
    isSpoofed: boolean;
    reason: string | null;
}

/**
 * Detect display-name spoofing: the from_name looks like a trusted brand
 * but the from_email domain doesn't match the brand's official domain.
 * Also detects when display name contains an email address that differs
 * from the actual sending address.
 */
export function detectDisplayNameSpoofing(fromName: string, fromEmail: string): SpoofResult {
    if (!fromName || !fromEmail) return { isSpoofed: false, reason: null };

    const nameLower = fromName.toLowerCase().replace(/\s+/g, '');
    const emailLower = fromEmail.toLowerCase();
    const emailDomain = emailLower.split('@')[1] ?? '';

    // Check 1: Display name contains a known brand but email domain doesn't
    // match any of the brand's official regional domains (PSL-aware).
    for (const brand of BRAND_CONFIGS.keys()) {
        if (nameLower.includes(brand) && !isLegitimateBrandDomain(emailDomain, brand)) {
            return {
                isSpoofed: true,
                reason: `Display name contains "${brand}" but email is from ${emailDomain}`,
            };
        }
    }

    // Check 2: Display name contains an email address different from actual sender
    const embeddedEmail = fromName.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
    if (embeddedEmail) {
        const embedded = embeddedEmail[0].toLowerCase();
        if (embedded !== emailLower) {
            return {
                isSpoofed: true,
                reason: `Display name shows "${embedded}" but actual sender is ${emailLower}`,
            };
        }
    }

    // Check 3: Display name mimics a domain (e.g., "support.paypal.com" as display name)
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(fromName.trim()) && fromName.trim().toLowerCase() !== emailDomain) {
        return {
            isSpoofed: true,
            reason: `Display name looks like a domain (${fromName.trim()}) but sender is ${emailLower}`,
        };
    }

    return { isSpoofed: false, reason: null };
}

// ── Invoice/payment fraud detection ─────────────────────────────────────────

export interface FraudResult {
    isSuspicious: boolean;
    score: number;
    reasons: string[];
}

const URGENCY_PATTERNS = [
    /\bimmediate(?:ly)?\s+(?:action|payment|response)\b/i,
    /\byour\s+account\s+(?:has been|will be|is)\s+(?:suspended|locked|closed|terminated)\b/i,
    /\bverify\s+your\s+(?:identity|account|payment)\b/i,
    /\b(?:wire|transfer|send)\s+(?:\$|USD|EUR|GBP)\s*[\d,]+/i,
    /\bupdate(?:d)?\s+(?:bank|payment|billing)\s+(?:details|information|info)\b/i,
    /\bfailure\s+to\s+(?:respond|comply|verify)\b/i,
    /\b(?:act|respond)\s+(?:now|immediately|within\s+\d+\s+hours?)\b/i,
];

const PAYMENT_PATTERNS = [
    /\binvoice\s*#?\s*\d+/i,
    /\bpurchase\s+order\b/i,
    /\bpayment\s+(?:of|due|overdue|pending)\b/i,
    /\bwire\s+transfer\b/i,
    /\bbitcoin|cryptocurrency|crypto\s+wallet\b/i,
    /\bgift\s+card/i,
];

/**
 * Detect invoice/payment fraud patterns in email text.
 * Scores urgency language + payment requests.
 */
export function detectFraud(text: string | null, subject: string | null): FraudResult {
    if (!text && !subject) return { isSuspicious: false, score: 0, reasons: [] };

    const combined = `${subject ?? ''} ${text ?? ''}`;
    let score = 0;
    const reasons: string[] = [];

    for (const pattern of URGENCY_PATTERNS) {
        if (pattern.test(combined)) {
            score += 15;
            reasons.push(`Urgency language: ${pattern.source.slice(0, 50)}`);
        }
    }

    for (const pattern of PAYMENT_PATTERNS) {
        if (pattern.test(combined)) {
            score += 10;
            reasons.push(`Payment reference detected`);
            break; // only count once
        }
    }

    return {
        isSuspicious: score >= 25,
        score: Math.min(score, 100),
        reasons: [...new Set(reasons)],
    };
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
