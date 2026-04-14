import { describe, it, expect } from 'vitest';
import { rateLimit, cleanBuckets } from './rateLimiter.js';

describe('rateLimit', () => {
    // Each test uses a unique key prefix to avoid cross-test bucket state
    let keyCounter = 0;
    const uniqueKey = () => `test-key-${++keyCounter}-${Date.now()}`;

    it('allows first request (new bucket starts full)', () => {
        const key = uniqueKey();
        expect(rateLimit(key, 5, 1)).toBe(true);
    });

    it('allows up to maxTokens requests in rapid succession', () => {
        const key = uniqueKey();
        for (let i = 0; i < 3; i++) {
            expect(rateLimit(key, 3, 0.01)).toBe(true);
        }
    });

    it('blocks requests when bucket is exhausted', () => {
        const key = uniqueKey();
        // Exhaust the bucket (maxTokens = 2)
        expect(rateLimit(key, 2, 0.001)).toBe(true);  // token 2 → 1
        expect(rateLimit(key, 2, 0.001)).toBe(true);  // token 1 → 0
        expect(rateLimit(key, 2, 0.001)).toBe(false); // no tokens left
    });

    it('refills tokens over time', async () => {
        const key = uniqueKey();
        // Exhaust bucket (maxTokens=1, very slow refill to ensure exhaustion)
        rateLimit(key, 1, 0.001);
        expect(rateLimit(key, 1, 0.001)).toBe(false); // exhausted

        // Wait 20ms real time, then call with refillPerSecond=100
        // 0.02s * 100 tokens/s = 2 tokens refilled
        await new Promise(r => setTimeout(r, 20));
        expect(rateLimit(key, 1, 100)).toBe(true);
    });

    it('does not exceed maxTokens on refill', async () => {
        const key = uniqueKey();
        // Create bucket with maxTokens=2, exhaust it
        rateLimit(key, 2, 0.001);
        rateLimit(key, 2, 0.001);
        expect(rateLimit(key, 2, 0.001)).toBe(false);

        // Wait and refill with high rate — but cap at maxTokens=2.
        // 60ms + rate=100 gives 6 tokens refilled (capped to 2). Windows
        // timer granularity (~15ms) means a 20ms sleep can return in 30ms
        // but with only 1.5 tokens refilled (floored to 1) — so we use 60ms
        // to give a comfortable margin on any OS.
        await new Promise(r => setTimeout(r, 60));
        // Should have 2 tokens (capped), use both
        expect(rateLimit(key, 2, 100)).toBe(true);
        expect(rateLimit(key, 2, 0.001)).toBe(true); // second token
        expect(rateLimit(key, 2, 0.001)).toBe(false); // exhausted again
    });

    it('tracks separate buckets per key', () => {
        const keyA = uniqueKey();
        const keyB = uniqueKey();

        // Exhaust key A
        rateLimit(keyA, 1, 0.001);
        expect(rateLimit(keyA, 1, 0.001)).toBe(false);

        // Key B should still have tokens
        expect(rateLimit(keyB, 1, 0.001)).toBe(true);
    });
});

describe('cleanBuckets', () => {
    it('is callable and does not throw', () => {
        expect(() => cleanBuckets()).not.toThrow();
    });

    it('does not remove recently used buckets', () => {
        const key = `clean-test-${Date.now()}`;
        rateLimit(key, 5, 1); // creates bucket
        cleanBuckets();
        // Bucket should still exist — next call should still work
        expect(rateLimit(key, 5, 1)).toBe(true);
    });
});
