import type { Database as DatabaseType } from 'better-sqlite3';

/**
 * Pure logic for the `emails:delete` IPC handler.
 *
 * Extracted so the rule "do not silently fall back to local-only delete when
 * the IMAP move fails" can be regression-tested without spinning up Electron.
 *
 * Contract:
 * - If the email is already in Trash, attempt a permanent IMAP delete.
 *   - On success or absence of UID/folder: delete the local row and return
 *     `{ success: true, permanent: true }`.
 *   - On IMAP failure: return `{ success: false, error }` and DO NOT delete
 *     the local row, so the user can retry.
 * - If the email is not in Trash, attempt to move it to Trash on the IMAP
 *   server.
 *   - On success: update the local row's `folder_id` and return
 *     `{ success: true }`.
 *   - On IMAP failure (returned `false` or threw): return
 *     `{ success: false, error }` and DO NOT touch the local row. Previous
 *     behavior silently fell back to a local-only update + returned
 *     `{ success: true }`, which caused the email to "reappear" on the next
 *     sync because the server still had it in INBOX.
 * - If the email is local-only (no UID, e.g., draft) or has no source folder
 *   path, the local-only update is the correct path — return `success: true`.
 *
 * `imap.moveMessage` and `imap.deleteMessage` may throw or return false;
 * callers must treat both as failure.
 */

export type ImapMoveFn = (
    accountId: string,
    uid: number,
    sourceMailbox: string,
    destMailbox: string,
) => Promise<boolean>;

export type ImapDeleteFn = (
    accountId: string,
    uid: number,
    mailbox: string,
) => Promise<boolean>;

export interface DeleteEmailResult {
    success: boolean;
    permanent?: boolean;
    error?: string;
}

export function extractUidFromEmailId(emailId: string): number {
    const uidStr = emailId.includes('_') ? emailId.split('_').pop() : emailId;
    return parseInt(uidStr ?? '0', 10);
}

export async function deleteEmailLogic(
    db: DatabaseType,
    emailId: string,
    imap: { moveMessage: ImapMoveFn; deleteMessage: ImapDeleteFn },
): Promise<DeleteEmailResult> {
    const email = db.prepare(
        'SELECT id, account_id, folder_id FROM emails WHERE id = ?',
    ).get(emailId) as { id: string; account_id: string; folder_id: string } | undefined;
    if (!email) return { success: false, error: 'Email not found' };

    const currentFolder = db.prepare(
        'SELECT type, path FROM folders WHERE id = ?',
    ).get(email.folder_id) as { type: string; path: string } | undefined;

    const uid = extractUidFromEmailId(email.id);

    // ── Permanent delete from Trash ─────────────────────────────────────────
    if (currentFolder?.type === 'trash') {
        if (uid > 0) {
            let deleted = false;
            try {
                deleted = await imap.deleteMessage(
                    email.account_id, uid, currentFolder.path.replace(/^\//, ''),
                );
            } catch (err) {
                return {
                    success: false,
                    error: err instanceof Error ? err.message : 'Failed to delete email from server',
                };
            }
            if (!deleted) {
                return {
                    success: false,
                    error: 'The server rejected the permanent delete. Please try again.',
                };
            }
        }
        db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
        return { success: true, permanent: true };
    }

    // ── Move to Trash ───────────────────────────────────────────────────────
    const trashFolder = db.prepare(
        "SELECT id, path FROM folders WHERE account_id = ? AND type = 'trash'",
    ).get(email.account_id) as { id: string; path: string } | undefined;

    if (!trashFolder) {
        // No trash folder configured at all (rare; usually means folder discovery
        // hasn't run yet). Local-only delete is the only option.
        db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
        return { success: true };
    }

    const sourceFolder = db.prepare(
        'SELECT path FROM folders WHERE id = ?',
    ).get(email.folder_id) as { path: string } | undefined;

    // Local-only path: no UID (draft) or no source folder mapping.
    if (!(uid > 0 && sourceFolder)) {
        db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(trashFolder.id, emailId);
        return { success: true };
    }

    // IMAP move path. NEVER silently fall back to local-only on failure.
    let moved = false;
    try {
        moved = await imap.moveMessage(
            email.account_id, uid,
            sourceFolder.path.replace(/^\//, ''),
            trashFolder.path.replace(/^\//, ''),
        );
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Failed to move email to Trash',
        };
    }
    if (!moved) {
        return {
            success: false,
            error: 'The server rejected the delete. Please try again.',
        };
    }

    db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(trashFolder.id, emailId);
    return { success: true };
}
