import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── DB mock setup ────────────────────────────────────────────────────────────

const mockRunToken     = vi.fn();
const mockRunStats     = vi.fn();
const mockRunScore     = vi.fn();
const mockGetEmail     = vi.fn();
const mockGetStats     = vi.fn();
const mockAllTokens    = vi.fn();
const mockTransaction  = vi.fn((fn: () => void) => {
    // Execute the transaction body immediately and return a callable
    return () => fn();
});

// Factory that returns the right mock for each prepare() call based on the SQL
const mockPrepare = vi.fn((sql: string) => {
    if (sql.includes('INSERT INTO spam_tokens')) {
        return { run: mockRunToken };
    }
    if (sql.includes('INSERT INTO spam_stats')) {
        return { run: mockRunStats };
    }
    if (sql.includes('UPDATE emails SET spam_score')) {
        return { run: mockRunScore };
    }
    if (sql.includes('SELECT subject') && sql.includes('FROM emails')) {
        return { get: mockGetEmail };
    }
    if (sql.includes('FROM spam_stats')) {
        return { get: mockGetStats };
    }
    if (sql.includes('FROM spam_tokens')) {
        return { all: mockAllTokens };
    }
    // Fallback
    return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
});

const mockDb = {
    prepare:     mockPrepare,
    transaction: mockTransaction,
};

vi.mock('./db.js', () => ({
    getDatabase: () => mockDb,
}));

// ─── Import after mocking ─────────────────────────────────────────────────────

import { tokenize, trainSpam, classifySpam } from './spamFilter.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('tokenize', () => {
    it('lowercases words and deduplicates', () => {
        const tokens = tokenize('Hello HELLO world');
        expect(tokens).toContain('hello');
        expect(tokens).toContain('world');
        // "hello" should only appear once (deduplicated)
        expect(tokens.filter(t => t === 'hello')).toHaveLength(1);
    });

    it('skips tokens shorter than 3 characters', () => {
        const tokens = tokenize('Hi go do run');
        // "hi", "go", "do" are 2 chars — only "run" passes the [a-z][a-z0-9]{2,49} pattern
        expect(tokens).toContain('run');
        expect(tokens).not.toContain('hi');
        expect(tokens).not.toContain('go');
        expect(tokens).not.toContain('do');
    });

    it('skips purely numeric tokens', () => {
        // Purely numeric strings like "123" do not start with [a-z]
        const tokens = tokenize('offer 12345 free');
        expect(tokens).toContain('offer');
        expect(tokens).toContain('free');
        expect(tokens).not.toContain('12345');
    });

    it('returns an empty array for an empty string', () => {
        expect(tokenize('')).toEqual([]);
    });

    it('handles alphanumeric tokens (letters followed by digits)', () => {
        const tokens = tokenize('win500 prize now');
        expect(tokens).toContain('win500');
        expect(tokens).toContain('prize');
        expect(tokens).toContain('now');
    });

    it('ignores tokens longer than 50 characters', () => {
        const longWord = 'a' + 'b'.repeat(50); // 51 chars
        const tokens = tokenize(longWord);
        expect(tokens).not.toContain(longWord);
    });
});

describe('trainSpam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Re-attach transaction mock after clearAllMocks
        mockDb.transaction = vi.fn((fn: () => void) => () => fn());
    });

    it('does nothing when the email is not found', () => {
        mockGetEmail.mockReturnValueOnce(undefined);
        trainSpam('acct1', 'email1', true);
        expect(mockRunToken).not.toHaveBeenCalled();
    });

    it('does nothing when the email has no tokenizable text', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: null,
            from_email: null,
            body_text: null,
            snippet: null,
        });
        trainSpam('acct1', 'email1', true);
        expect(mockRunToken).not.toHaveBeenCalled();
    });

    it('increments spam counts when isSpam=true', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: 'Buy now cheap',
            from_email: 'spam@spammer.com',
            body_text: null,
            snippet: 'Click here for free',
        });
        // classifySpam call inside trainSpam needs these mocks too
        mockGetStats.mockReturnValue({ total_spam: 5, total_ham: 5 });
        mockAllTokens.mockReturnValue([]);

        trainSpam('acct1', 'email1', true);

        // token upsert should be called with spamInc=1, hamInc=0
        expect(mockRunToken).toHaveBeenCalled();
        const firstCall = mockRunToken.mock.calls[0];
        // run(token, accountId, spamInc, hamInc, spamInc, hamInc)
        expect(firstCall[2]).toBe(1); // spamInc
        expect(firstCall[3]).toBe(0); // hamInc
    });

    it('increments ham counts when isSpam=false', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: 'Meeting tomorrow',
            from_email: 'colleague@work.com',
            body_text: 'See you then',
            snippet: null,
        });
        mockGetStats.mockReturnValue({ total_spam: 5, total_ham: 5 });
        mockAllTokens.mockReturnValue([]);

        trainSpam('acct1', 'email2', false);

        expect(mockRunToken).toHaveBeenCalled();
        const firstCall = mockRunToken.mock.calls[0];
        expect(firstCall[2]).toBe(0); // spamInc
        expect(firstCall[3]).toBe(1); // hamInc
    });

    it('updates the spam_score on the email row after training', () => {
        mockGetEmail.mockReturnValue({
            subject: 'Win a prize',
            from_email: 'promo@offers.com',
            body_text: 'Click to claim',
            snippet: null,
        });
        mockGetStats.mockReturnValue({ total_spam: 5, total_ham: 5 });
        mockAllTokens.mockReturnValue([]);

        trainSpam('acct1', 'email3', true);

        expect(mockRunScore).toHaveBeenCalled();
    });
});

describe('classifySpam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 0.5 when the email is not found', () => {
        mockGetEmail.mockReturnValueOnce(undefined);
        const score = classifySpam('acct1', 'missing');
        expect(score).toBe(0.5);
    });

    it('returns 0.5 when there is insufficient training data (< 10 examples)', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: 'Hello',
            from_email: 'a@b.com',
            body_text: 'Test',
            snippet: null,
        });
        mockGetStats.mockReturnValueOnce({ total_spam: 2, total_ham: 3 });
        const score = classifySpam('acct1', 'email1');
        expect(score).toBe(0.5);
    });

    it('returns 0.5 when stats row is missing', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: 'Hello',
            from_email: 'a@b.com',
            body_text: 'Test',
            snippet: null,
        });
        mockGetStats.mockReturnValueOnce(undefined);
        const score = classifySpam('acct1', 'email1');
        expect(score).toBe(0.5);
    });

    it('returns 0.5 for an email with no tokenizable text', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: null,
            from_email: null,
            body_text: null,
            snippet: null,
        });
        mockGetStats.mockReturnValueOnce({ total_spam: 50, total_ham: 50 });
        const score = classifySpam('acct1', 'email1');
        expect(score).toBe(0.5);
    });

    it('returns a high score for tokens seen predominantly as spam', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: 'free money offer',
            from_email: 'promo@spam.com',
            body_text: 'click here win prize',
            snippet: null,
        });
        mockGetStats.mockReturnValueOnce({ total_spam: 100, total_ham: 10 });
        // Return high spam counts for all tokens
        mockAllTokens.mockReturnValueOnce([
            { token: 'free',   spam_count: 80, ham_count: 1 },
            { token: 'money',  spam_count: 70, ham_count: 2 },
            { token: 'offer',  spam_count: 60, ham_count: 1 },
            { token: 'click',  spam_count: 90, ham_count: 1 },
            { token: 'here',   spam_count: 75, ham_count: 2 },
            { token: 'win',    spam_count: 85, ham_count: 0 },
            { token: 'prize',  spam_count: 95, ham_count: 0 },
        ]);

        const score = classifySpam('acct1', 'spam_email');
        expect(score).toBeGreaterThan(0.5);
    });

    it('returns a low score for tokens seen predominantly as ham', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: 'meeting tomorrow agenda',
            from_email: 'boss@company.com',
            body_text: 'please review attached document',
            snippet: null,
        });
        mockGetStats.mockReturnValueOnce({ total_spam: 10, total_ham: 100 });
        mockAllTokens.mockReturnValueOnce([
            { token: 'meeting',   spam_count: 0, ham_count: 90 },
            { token: 'tomorrow',  spam_count: 1, ham_count: 85 },
            { token: 'agenda',    spam_count: 0, ham_count: 70 },
            { token: 'please',    spam_count: 1, ham_count: 80 },
            { token: 'review',    spam_count: 0, ham_count: 75 },
            { token: 'attached',  spam_count: 2, ham_count: 88 },
            { token: 'document',  spam_count: 0, ham_count: 65 },
        ]);

        const score = classifySpam('acct1', 'ham_email');
        expect(score).toBeLessThan(0.5);
    });

    it('rounds the score to 3 decimal places', () => {
        mockGetEmail.mockReturnValueOnce({
            subject: 'hello world test',
            from_email: 'a@b.com',
            body_text: null,
            snippet: null,
        });
        mockGetStats.mockReturnValueOnce({ total_spam: 50, total_ham: 50 });
        mockAllTokens.mockReturnValueOnce([]);

        const score = classifySpam('acct1', 'email1');
        const decimalPlaces = (score.toString().split('.')[1] ?? '').length;
        expect(decimalPlaces).toBeLessThanOrEqual(3);
    });
});
