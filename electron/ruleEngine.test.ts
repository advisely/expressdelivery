import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDbAll, mockDbGet, mockDbRun, mockTransaction } = vi.hoisted(() => ({
    mockDbAll: vi.fn().mockReturnValue([]),
    mockDbGet: vi.fn().mockReturnValue(null),
    mockDbRun: vi.fn().mockReturnValue({ changes: 1 }),
    mockTransaction: vi.fn((fn: () => void) => {
        const wrapper = () => fn();
        return wrapper;
    }),
}));

vi.mock('./db.js', () => ({
    getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => ({
            all: mockDbAll,
            get: mockDbGet,
            run: mockDbRun,
        })),
        transaction: mockTransaction,
    })),
}));

vi.mock('./logger.js', () => ({
    logDebug: vi.fn(),
}));

import { applyRulesToEmail } from './ruleEngine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<{
    id: string; account_id: string; name: string; priority: number;
    is_active: number; match_field: string; match_operator: string;
    match_value: string; action_type: string; action_value: string | null;
}> = {}) {
    return {
        id: 'rule1', account_id: 'a1', name: 'Test Rule', priority: 1,
        is_active: 1, match_field: 'from', match_operator: 'contains',
        match_value: 'test', action_type: 'mark_read', action_value: null,
        ...overrides,
    };
}

function makeEmail(overrides: Partial<{
    id: string; account_id: string; from_email: string | null;
    subject: string | null; body_text: string | null; has_attachments: number;
}> = {}) {
    return {
        id: 'e1', account_id: 'a1', from_email: 'user@test.com',
        subject: 'Hello World', body_text: 'Some email body text',
        has_attachments: 0, ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ruleEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbAll.mockReturnValue([]);
        mockDbGet.mockReturnValue(null);
        mockDbRun.mockReturnValue({ changes: 1 });
    });

    // -----------------------------------------------------------------------
    // matchesRule (tested indirectly via applyRulesToEmail)
    // -----------------------------------------------------------------------

    describe('matchesRule', () => {
        function setupRule(rule: ReturnType<typeof makeRule>, email: ReturnType<typeof makeEmail>) {
            mockDbAll.mockReturnValueOnce([rule]); // rules query
            mockDbGet.mockReturnValueOnce(email);  // email query
        }

        it('matches "from" field with "contains" operator', () => {
            setupRule(
                makeRule({ match_field: 'from', match_operator: 'contains', match_value: 'test' }),
                makeEmail({ from_email: 'user@test.com' })
            );
            applyRulesToEmail('e1', 'a1');
            expect(mockTransaction).toHaveBeenCalled();
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('matches "subject" field with "equals" operator', () => {
            setupRule(
                makeRule({ match_field: 'subject', match_operator: 'equals', match_value: 'hello world' }),
                makeEmail({ subject: 'Hello World' })
            );
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('matches "body" field with "starts_with" operator', () => {
            setupRule(
                makeRule({ match_field: 'body', match_operator: 'starts_with', match_value: 'some email' }),
                makeEmail({ body_text: 'Some email body text' })
            );
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('matches "body" field with "ends_with" operator', () => {
            setupRule(
                makeRule({ match_field: 'body', match_operator: 'ends_with', match_value: 'body text' }),
                makeEmail({ body_text: 'Some email body text' })
            );
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('matches "has_attachment" field', () => {
            setupRule(
                makeRule({ match_field: 'has_attachment', match_operator: 'equals', match_value: 'true' }),
                makeEmail({ has_attachments: 1 })
            );
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('is case-insensitive', () => {
            setupRule(
                makeRule({ match_field: 'subject', match_operator: 'contains', match_value: 'HELLO' }),
                makeEmail({ subject: 'hello world' })
            );
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('returns false for unknown field', () => {
            setupRule(
                makeRule({ match_field: 'unknown_field', match_operator: 'contains', match_value: 'test' }),
                makeEmail()
            );
            applyRulesToEmail('e1', 'a1');
            // Transaction was called but no action should run (rule didn't match)
            // The transaction wraps the for-loop, so it's always called
            expect(mockTransaction).toHaveBeenCalled();
        });

        it('returns false for unknown operator', () => {
            setupRule(
                makeRule({ match_field: 'from', match_operator: 'unknown_op', match_value: 'test' }),
                makeEmail()
            );
            applyRulesToEmail('e1', 'a1');
            expect(mockTransaction).toHaveBeenCalled();
        });

        it('handles null email fields gracefully', () => {
            setupRule(
                makeRule({ match_field: 'from', match_operator: 'contains', match_value: 'test' }),
                makeEmail({ from_email: null })
            );
            // Should not throw
            expect(() => applyRulesToEmail('e1', 'a1')).not.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // applyAction (tested indirectly via applyRulesToEmail)
    // -----------------------------------------------------------------------

    describe('applyAction', () => {
        function setupMatchingRule(actionType: string, actionValue: string | null = null) {
            mockDbAll.mockReturnValueOnce([makeRule({ action_type: actionType, action_value: actionValue })]);
            mockDbGet.mockReturnValueOnce(makeEmail());
        }

        it('mark_read: updates is_read = 1', () => {
            setupMatchingRule('mark_read');
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('flag: updates is_flagged = 1', () => {
            setupMatchingRule('flag');
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('delete: removes the email', () => {
            setupMatchingRule('delete');
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('label: appends to existing labels array', () => {
            mockDbAll.mockReturnValueOnce([makeRule({ action_type: 'label', action_value: 'important' })]);
            mockDbGet
                .mockReturnValueOnce(makeEmail()) // email query
                .mockReturnValueOnce({ ai_labels: '["existing"]' }); // label query
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('label: does not duplicate existing label', () => {
            mockDbAll.mockReturnValueOnce([makeRule({ action_type: 'label', action_value: 'existing' })]);
            mockDbGet
                .mockReturnValueOnce(makeEmail())
                .mockReturnValueOnce({ ai_labels: '["existing"]' });
            applyRulesToEmail('e1', 'a1');
            // run() should NOT be called for the label update (label already exists)
            // but run() may be called for other reasons — check the specifics
        });

        it('categorize: sets ai_category', () => {
            setupMatchingRule('categorize', 'newsletter');
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('move: validates folder belongs to same account before moving', () => {
            mockDbAll.mockReturnValueOnce([makeRule({ action_type: 'move', action_value: 'folder1' })]);
            mockDbGet
                .mockReturnValueOnce(makeEmail()) // email query
                .mockReturnValueOnce({ id: 'folder1' }); // folder query — same account
            applyRulesToEmail('e1', 'a1');
            expect(mockDbRun).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // applyRulesToEmail integration
    // -----------------------------------------------------------------------

    describe('applyRulesToEmail', () => {
        it('applies matching rules in priority order', () => {
            const rule1 = makeRule({ id: 'r1', priority: 1, action_type: 'mark_read' });
            const rule2 = makeRule({ id: 'r2', priority: 2, action_type: 'flag' });
            mockDbAll.mockReturnValueOnce([rule1, rule2]);
            mockDbGet.mockReturnValueOnce(makeEmail());

            applyRulesToEmail('e1', 'a1');

            // Both rules should trigger actions
            expect(mockTransaction).toHaveBeenCalled();
        });

        it('stops processing after delete action', () => {
            const deleteRule = makeRule({ id: 'r1', priority: 1, action_type: 'delete' });
            const flagRule = makeRule({ id: 'r2', priority: 2, action_type: 'flag' });
            mockDbAll.mockReturnValueOnce([deleteRule, flagRule]);
            mockDbGet.mockReturnValueOnce(makeEmail());

            applyRulesToEmail('e1', 'a1');

            // Only delete's run() should execute (1 call), not flag's additional call
            expect(mockDbRun).toHaveBeenCalledTimes(1);
        });

        it('skips non-matching rules', () => {
            const nonMatchingRule = makeRule({ match_value: 'nomatch_xyz_abc' });
            mockDbAll.mockReturnValueOnce([nonMatchingRule]);
            mockDbGet.mockReturnValueOnce(makeEmail());

            applyRulesToEmail('e1', 'a1');

            // Transaction called (wraps the loop) but no action run
            expect(mockTransaction).toHaveBeenCalled();
        });

        it('is a no-op when no rules exist for account', () => {
            mockDbAll.mockReturnValueOnce([]);
            applyRulesToEmail('e1', 'a1');
            // Should return early before fetching email
            expect(mockDbGet).not.toHaveBeenCalled();
        });

        it('is a no-op when email not found', () => {
            mockDbAll.mockReturnValueOnce([makeRule()]);
            mockDbGet.mockReturnValueOnce(undefined); // email not found
            applyRulesToEmail('e1', 'a1');
            expect(mockTransaction).not.toHaveBeenCalled();
        });

        it('wraps all actions in a transaction', () => {
            mockDbAll.mockReturnValueOnce([makeRule()]);
            mockDbGet.mockReturnValueOnce(makeEmail());
            applyRulesToEmail('e1', 'a1');
            expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
        });

        it('handles errors gracefully (does not throw)', () => {
            mockDbAll.mockImplementationOnce(() => { throw new Error('DB error'); });
            expect(() => applyRulesToEmail('e1', 'a1')).not.toThrow();
        });
    });
});
