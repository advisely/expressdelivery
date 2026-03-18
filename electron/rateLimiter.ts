/**
 * Simple in-memory token bucket rate limiter for IPC handlers.
 * Prevents abuse of sensitive endpoints (spam train, send, rules, etc.)
 */

interface Bucket {
    tokens: number;
    lastRefill: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Check if an action is allowed under the rate limit.
 * @param key   - Unique key (e.g., IPC channel name or channel:accountId)
 * @param maxTokens - Maximum burst size (default: 10)
 * @param refillPerSecond - Tokens added per second (default: 2)
 * @returns true if allowed, false if rate-limited
 */
export function rateLimit(key: string, maxTokens = 10, refillPerSecond = 2): boolean {
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket) {
        bucket = { tokens: maxTokens, lastRefill: now };
        buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillPerSecond);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
    }

    return false;
}

/**
 * Clean up stale buckets (call periodically to prevent memory leaks).
 * Removes buckets that haven't been touched in the last 5 minutes.
 */
export function cleanBuckets(): void {
    const staleThreshold = Date.now() - 5 * 60 * 1000;
    for (const [key, bucket] of buckets) {
        if (bucket.lastRefill < staleThreshold) buckets.delete(key);
    }
}
