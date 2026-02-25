import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these are available inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockDbAll, mockDbGet, mockDbRun, mockTransaction, mockSendEmail } = vi.hoisted(() => ({
    mockDbAll: vi.fn().mockReturnValue([]),
    mockDbGet: vi.fn().mockReturnValue(null),
    mockDbRun: vi.fn().mockReturnValue({ changes: 1 }),
    mockTransaction: vi.fn((fn: () => void) => {
        const wrapper = () => fn();
        return wrapper;
    }),
    mockSendEmail: vi.fn().mockResolvedValue(true),
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

vi.mock('./smtp.js', () => ({
    smtpEngine: { sendEmail: mockSendEmail },
}));

vi.mock('./logger.js', () => ({
    logDebug: vi.fn(),
}));

// Import after mocks
import { SchedulerEngine } from './scheduler';
import type { SchedulerCallbacks } from './scheduler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCallbacks(): SchedulerCallbacks {
    return {
        onSnoozeRestore: vi.fn(),
        onReminderDue: vi.fn(),
        onScheduledSendResult: vi.fn(),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SchedulerEngine', () => {
    let scheduler: SchedulerEngine;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mockDbAll.mockReturnValue([]);
        mockDbGet.mockReturnValue(null);
        mockDbRun.mockReturnValue({ changes: 1 });
        mockSendEmail.mockResolvedValue(true);
        scheduler = new SchedulerEngine();
    });

    afterEach(() => {
        scheduler.stop();
        vi.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    describe('lifecycle', () => {
        it('start() begins polling and ticks immediately', () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            scheduler.start();

            // tick() was called immediately (queries ran)
            expect(mockDbAll).toHaveBeenCalled();
        });

        it('start() is idempotent — calling twice does not create duplicate intervals', () => {
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            scheduler.start();
            scheduler.start();
            // Only one setInterval call
            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
            setIntervalSpy.mockRestore();
        });

        it('stop() clears the interval', () => {
            const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
            scheduler.start();
            scheduler.stop();
            expect(clearIntervalSpy).toHaveBeenCalled();
            clearIntervalSpy.mockRestore();
        });

        it('setCallbacks() stores callbacks for use in tick', () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            // Set up a snoozed email to verify callback is called
            mockDbAll.mockReturnValueOnce([
                { id: 's1', email_id: 'e1', account_id: 'a1', original_folder_id: 'f1' },
            ]);
            scheduler.start();
            expect(cbs.onSnoozeRestore).toHaveBeenCalledWith('e1', 'a1', 'f1');
        });
    });

    // -----------------------------------------------------------------------
    // processSnoozedEmails
    // -----------------------------------------------------------------------

    describe('processSnoozedEmails', () => {
        it('restores due snoozed emails and calls onSnoozeRestore', () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            mockDbAll
                .mockReturnValueOnce([
                    { id: 's1', email_id: 'e1', account_id: 'a1', original_folder_id: 'f1' },
                    { id: 's2', email_id: 'e2', account_id: 'a1', original_folder_id: 'f2' },
                ])
                .mockReturnValue([]); // scheduled sends + reminders return empty

            scheduler.start();

            // transaction called for each snoozed email
            expect(mockTransaction).toHaveBeenCalledTimes(2);
            expect(cbs.onSnoozeRestore).toHaveBeenCalledTimes(2);
            expect(cbs.onSnoozeRestore).toHaveBeenCalledWith('e1', 'a1', 'f1');
            expect(cbs.onSnoozeRestore).toHaveBeenCalledWith('e2', 'a1', 'f2');
        });

        it('updates email is_snoozed and snoozed_emails restored flag via DB', () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            mockDbAll
                .mockReturnValueOnce([
                    { id: 's1', email_id: 'e1', account_id: 'a1', original_folder_id: 'f1' },
                ])
                .mockReturnValue([]);

            scheduler.start();

            // db.prepare().run() called inside the transaction
            expect(mockDbRun).toHaveBeenCalled();
        });

        it('is a no-op when no snoozed emails are due', () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockDbAll.mockReturnValue([]);
            scheduler.start();
            expect(cbs.onSnoozeRestore).not.toHaveBeenCalled();
        });

        it('works without callbacks set (no crash)', () => {
            mockDbAll
                .mockReturnValueOnce([
                    { id: 's1', email_id: 'e1', account_id: 'a1', original_folder_id: 'f1' },
                ])
                .mockReturnValue([]);

            // No callbacks set — should not throw
            expect(() => scheduler.start()).not.toThrow();
        });

        it('continues processing even if snooze throws', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            // First call (snoozed) throws, second (scheduled) returns empty, third (reminders) returns reminder
            mockDbAll
                .mockImplementationOnce(() => { throw new Error('DB locked'); })
                .mockReturnValueOnce([]) // scheduled sends
                .mockReturnValueOnce([{ id: 'r1', email_id: 'e1', account_id: 'a1', subject: 'Test', from_email: 'x@y.com' }]);

            scheduler.start();
            // tick() is async — let scheduled sends complete before checking reminders
            await vi.advanceTimersByTimeAsync(0);

            // Reminder still processed despite snooze error
            expect(cbs.onReminderDue).toHaveBeenCalledWith('e1', 'a1', 'Test', 'x@y.com');
        });
    });

    // -----------------------------------------------------------------------
    // processScheduledSends
    // -----------------------------------------------------------------------

    describe('processScheduledSends', () => {
        const scheduledRow = {
            id: 'sch1',
            account_id: 'a1',
            to_email: 'to@test.com',
            cc: null,
            bcc: null,
            subject: 'Test Subject',
            body_html: '<p>Hello</p>',
            attachments_json: null,
            draft_id: null,
            retry_count: 0,
        };

        it('sends due email via smtpEngine and marks as sent', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            mockDbAll
                .mockReturnValueOnce([]) // snoozed
                .mockReturnValueOnce([scheduledRow]) // scheduled
                .mockReturnValue([]); // reminders

            scheduler.start();
            // Let async scheduled sends complete
            await vi.advanceTimersByTimeAsync(0);

            expect(mockSendEmail).toHaveBeenCalledWith(
                'a1', ['to@test.com'], 'Test Subject', '<p>Hello</p>',
                undefined, undefined, undefined
            );
            expect(cbs.onScheduledSendResult).toHaveBeenCalledWith('sch1', true);
        });

        it('splits CC and BCC lists correctly', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            const rowWithCcBcc = { ...scheduledRow, cc: 'cc1@t.com, cc2@t.com', bcc: 'bcc@t.com' };
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([rowWithCcBcc])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(mockSendEmail).toHaveBeenCalledWith(
                'a1', ['to@test.com'], 'Test Subject', '<p>Hello</p>',
                ['cc1@t.com', 'cc2@t.com'], ['bcc@t.com'], undefined
            );
        });

        it('parses attachments_json correctly', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            const att = [{ filename: 'f.pdf', content: 'base64data' }];
            const rowWithAtt = { ...scheduledRow, attachments_json: JSON.stringify(att) };
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([rowWithAtt])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(mockSendEmail).toHaveBeenCalledWith(
                'a1', ['to@test.com'], 'Test Subject', '<p>Hello</p>',
                undefined, undefined, att
            );
        });

        it('handles malformed attachments_json gracefully', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            const rowBadJson = { ...scheduledRow, attachments_json: '{bad json' };
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([rowBadJson])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Still sends (attachments = undefined)
            expect(mockSendEmail).toHaveBeenCalledWith(
                'a1', ['to@test.com'], 'Test Subject', '<p>Hello</p>',
                undefined, undefined, undefined
            );
        });

        it('deletes associated draft on success', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            const rowWithDraft = { ...scheduledRow, draft_id: 'd1' };
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([rowWithDraft])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // Transaction was called for the success path
            expect(mockTransaction).toHaveBeenCalled();
            expect(cbs.onScheduledSendResult).toHaveBeenCalledWith('sch1', true);
        });

        it('calls handleSendFailure when SMTP returns false', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockSendEmail.mockResolvedValue(false);

            const rowHighRetry = { ...scheduledRow, retry_count: 2 }; // MAX_RETRIES = 3, so retry_count+1 = 3 >= 3
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([rowHighRetry])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(cbs.onScheduledSendResult).toHaveBeenCalledWith('sch1', false, 'SMTP send returned false');
        });

        it('calls handleSendFailure when SMTP throws', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockSendEmail.mockRejectedValue(new Error('Connection refused'));

            const rowHighRetry = { ...scheduledRow, retry_count: 2 };
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([rowHighRetry])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(cbs.onScheduledSendResult).toHaveBeenCalledWith('sch1', false, 'Connection refused');
        });

        it('processes multiple scheduled sends sequentially', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            const order: string[] = [];
            mockSendEmail.mockImplementation(async (_a: string, to: string[]) => {
                order.push(to[0]);
                return true;
            });

            const row1 = { ...scheduledRow, id: 'sch1', to_email: 'first@test.com' };
            const row2 = { ...scheduledRow, id: 'sch2', to_email: 'second@test.com' };
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([row1, row2])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(order).toEqual(['first@test.com', 'second@test.com']);
        });

        it('is a no-op when no scheduled sends are due', async () => {
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(mockSendEmail).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // handleSendFailure
    // -----------------------------------------------------------------------

    describe('handleSendFailure', () => {
        const scheduledRow = {
            id: 'sch1', account_id: 'a1', to_email: 'to@t.com', cc: null, bcc: null,
            subject: 'Test', body_html: '<p>Hi</p>', attachments_json: null, draft_id: null,
            retry_count: 0,
        };

        it('resets to pending with incremented retry when under MAX_RETRIES', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockSendEmail.mockResolvedValue(false);

            // retry_count = 0, so retry_count + 1 = 1 < 3 → stays pending
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([{ ...scheduledRow, retry_count: 0 }])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            // No failure callback when retrying
            expect(cbs.onScheduledSendResult).not.toHaveBeenCalled();
        });

        it('marks as failed at MAX_RETRIES and calls callback', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockSendEmail.mockResolvedValue(false);

            // retry_count = 2, so retry_count + 1 = 3 >= 3 → permanent failure
            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([{ ...scheduledRow, retry_count: 2 }])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(cbs.onScheduledSendResult).toHaveBeenCalledWith('sch1', false, 'SMTP send returned false');
        });

        it('stores error message on permanent failure', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockSendEmail.mockRejectedValue(new Error('Auth failed'));

            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([{ ...scheduledRow, retry_count: 2 }])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(cbs.onScheduledSendResult).toHaveBeenCalledWith('sch1', false, 'Auth failed');
        });

        it('increments retry count for non-Error throws', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockSendEmail.mockRejectedValue('string error');

            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([{ ...scheduledRow, retry_count: 2 }])
                .mockReturnValue([]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(cbs.onScheduledSendResult).toHaveBeenCalledWith('sch1', false, 'string error');
        });
    });

    // -----------------------------------------------------------------------
    // processReminders
    // -----------------------------------------------------------------------

    describe('processReminders', () => {
        it('triggers due reminders and calls onReminderDue', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            mockDbAll
                .mockReturnValueOnce([]) // snoozed
                .mockReturnValueOnce([]) // scheduled
                .mockReturnValueOnce([
                    { id: 'r1', email_id: 'e1', account_id: 'a1', subject: 'Meeting', from_email: 'boss@co.com' },
                ]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(mockTransaction).toHaveBeenCalled();
            expect(cbs.onReminderDue).toHaveBeenCalledWith('e1', 'a1', 'Meeting', 'boss@co.com');
        });

        it('falls back to "(no subject)" and "Unknown" for null fields', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);

            mockDbAll
                .mockReturnValueOnce([])
                .mockReturnValueOnce([])
                .mockReturnValueOnce([
                    { id: 'r1', email_id: 'e1', account_id: 'a1', subject: null, from_email: null },
                ]);

            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);

            expect(cbs.onReminderDue).toHaveBeenCalledWith('e1', 'a1', '(no subject)', 'Unknown');
        });

        it('is a no-op when no reminders are due', async () => {
            const cbs = createCallbacks();
            scheduler.setCallbacks(cbs);
            mockDbAll.mockReturnValue([]);
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(cbs.onReminderDue).not.toHaveBeenCalled();
        });
    });
});
