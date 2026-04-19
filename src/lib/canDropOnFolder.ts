import type { EmailSummary } from '../stores/emailStore';

/**
 * Decide whether a set of dragged email IDs can be dropped onto a destination
 * folder owned by `destAccountId`.
 *
 * Returns:
 * - 'allow'         — every dragged email belongs to `destAccountId`. UI should
 *                      set `dataTransfer.dropEffect = 'move'`.
 * - 'cross-account' — at least one dragged email is from a different account
 *                      than the destination folder. IMAP cannot atomically
 *                      move messages between accounts, so the UI should set
 *                      `dataTransfer.dropEffect = 'none'` and (on drop)
 *                      surface a "cross-account moves not supported" toast
 *                      instead of calling `emails:move`.
 * - 'unknown'       — no dragged IDs supplied or the IDs cannot be matched to
 *                      any email in the in-memory list. Caller should treat as
 *                      cross-account (safer default).
 *
 * Pure helper — no side effects, no DOM access. Drives the regression test
 * that prevents the unified-inbox forbidden-cursor bug from coming back.
 */
export type DropAssessment = 'allow' | 'cross-account' | 'unknown';

export function canDropEmailsOnFolder(
    destAccountId: string | null | undefined,
    draggedEmailIds: readonly string[],
    emails: readonly EmailSummary[],
): DropAssessment {
    if (!destAccountId || draggedEmailIds.length === 0) return 'unknown';

    const draggedAccountIds = new Set<string>();
    for (const id of draggedEmailIds) {
        const email = emails.find(e => e.id === id);
        if (!email?.account_id) continue;
        draggedAccountIds.add(email.account_id);
    }

    if (draggedAccountIds.size === 0) return 'unknown';
    if (draggedAccountIds.size > 1) return 'cross-account';
    return draggedAccountIds.has(destAccountId) ? 'allow' : 'cross-account';
}
