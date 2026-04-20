import { describe, it, expect } from 'vitest';
import { canDropEmailsOnFolder } from './canDropOnFolder';
import type { EmailSummary } from '../stores/emailStore';

const makeEmail = (id: string, account_id: string): EmailSummary => ({
    id, account_id, thread_id: id, subject: '', from_name: null, from_email: '',
    to_email: '', date: '', snippet: null, is_read: 0, is_flagged: 0,
    has_attachments: 0, ai_category: null, ai_priority: null, ai_labels: null,
    thread_count: 1,
});

describe('canDropEmailsOnFolder', () => {
    const emails: EmailSummary[] = [
        makeEmail('acc-A_1', 'acc-A'),
        makeEmail('acc-A_2', 'acc-A'),
        makeEmail('acc-B_3', 'acc-B'),
    ];

    it('returns "allow" when all dragged emails belong to the destination folder account', () => {
        expect(canDropEmailsOnFolder('acc-A', ['acc-A_1', 'acc-A_2'], emails)).toBe('allow');
    });

    it('returns "cross-account" when the dragged email belongs to a different account', () => {
        expect(canDropEmailsOnFolder('acc-A', ['acc-B_3'], emails)).toBe('cross-account');
    });

    it('returns "cross-account" when dragged emails span multiple accounts', () => {
        expect(canDropEmailsOnFolder('acc-A', ['acc-A_1', 'acc-B_3'], emails)).toBe('cross-account');
    });

    it('returns "unknown" when no IDs are supplied', () => {
        expect(canDropEmailsOnFolder('acc-A', [], emails)).toBe('unknown');
    });

    it('returns "unknown" when destination accountId is missing', () => {
        expect(canDropEmailsOnFolder(null, ['acc-A_1'], emails)).toBe('unknown');
        expect(canDropEmailsOnFolder(undefined, ['acc-A_1'], emails)).toBe('unknown');
        expect(canDropEmailsOnFolder('', ['acc-A_1'], emails)).toBe('unknown');
    });

    it('returns "unknown" when none of the dragged IDs can be matched to an email', () => {
        expect(canDropEmailsOnFolder('acc-A', ['nonexistent-id'], emails)).toBe('unknown');
    });

    it('handles a single-email same-account drag (the most common case)', () => {
        expect(canDropEmailsOnFolder('acc-A', ['acc-A_1'], emails)).toBe('allow');
    });
});
