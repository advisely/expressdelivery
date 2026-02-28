import { getDatabase } from './db.js';

// Tokenize text into lowercase words (3–50 chars, not purely numeric).
// Exported for unit-test use only.
export function tokenize(text: string): string[] {
    const tokens = text.toLowerCase().match(/[a-z][a-z0-9]{2,49}/g) ?? [];
    return [...new Set(tokens)]; // deduplicate
}

/**
 * Train the Bayesian classifier on a single email.
 * Marks all tokens extracted from the email's text as spam or ham and
 * updates the per-account totals + the stored spam_score on the email row.
 */
export function trainSpam(accountId: string, emailId: string, isSpam: boolean): void {
    const db = getDatabase();

    const email = db.prepare(
        'SELECT subject, from_email, body_text, snippet FROM emails WHERE id = ? AND account_id = ?'
    ).get(emailId, accountId) as {
        subject: string | null;
        from_email: string | null;
        body_text: string | null;
        snippet: string | null;
    } | undefined;

    if (!email) return;

    const text = [email.subject, email.from_email, email.body_text ?? email.snippet]
        .filter(Boolean)
        .join(' ');
    const tokens = tokenize(text);

    if (tokens.length === 0) return;

    db.transaction(() => {
        const upsertToken = db.prepare(`
            INSERT INTO spam_tokens (token, account_id, spam_count, ham_count)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(token, account_id) DO UPDATE SET
                spam_count = spam_count + ?,
                ham_count  = ham_count  + ?
        `);

        const spamInc = isSpam ? 1 : 0;
        const hamInc  = isSpam ? 0 : 1;

        for (const token of tokens) {
            upsertToken.run(token, accountId, spamInc, hamInc, spamInc, hamInc);
        }

        // Update total spam / ham message counts
        db.prepare(`
            INSERT INTO spam_stats (account_id, total_spam, total_ham)
            VALUES (?, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                total_spam = total_spam + ?,
                total_ham  = total_ham  + ?
        `).run(accountId, spamInc, hamInc, spamInc, hamInc);

        // Persist the updated spam_score on the email row
        const score = classifySpam(accountId, emailId);
        db.prepare('UPDATE emails SET spam_score = ? WHERE id = ?').run(score, emailId);
    })();
}

/**
 * Classify an email using Naive Bayes with Laplace smoothing.
 * Returns a probability in [0, 1] — 0 = definitely ham, 1 = definitely spam.
 * Returns 0.5 (uncertain) when there is insufficient training data.
 */
export function classifySpam(accountId: string, emailId: string): number {
    const db = getDatabase();

    const email = db.prepare(
        'SELECT subject, from_email, body_text, snippet FROM emails WHERE id = ? AND account_id = ?'
    ).get(emailId, accountId) as {
        subject: string | null;
        from_email: string | null;
        body_text: string | null;
        snippet: string | null;
    } | undefined;

    if (!email) return 0.5;

    const stats = db.prepare(
        'SELECT total_spam, total_ham FROM spam_stats WHERE account_id = ?'
    ).get(accountId) as { total_spam: number; total_ham: number } | undefined;

    // Require at least 10 training examples before making a prediction
    if (!stats || (stats.total_spam + stats.total_ham) < 10) return 0.5;

    const text = [email.subject, email.from_email, email.body_text ?? email.snippet]
        .filter(Boolean)
        .join(' ');
    const tokens = tokenize(text);

    if (tokens.length === 0) return 0.5;

    // Cap tokens to avoid hitting SQLite's 999 bound variable limit
    const cappedTokens = tokens.slice(0, 999);

    // Fetch stored counts for every token present in this email
    const placeholders = cappedTokens.map(() => '?').join(',');
    const rows = db.prepare(
        `SELECT token, spam_count, ham_count FROM spam_tokens
         WHERE account_id = ? AND token IN (${placeholders})`
    ).all(accountId, ...cappedTokens) as Array<{ token: string; spam_count: number; ham_count: number }>;

    const tokenMap = new Map(rows.map(r => [r.token, r]));

    // Log-space Naive Bayes with Laplace smoothing (avoids floating-point underflow)
    let logSpam = Math.log(stats.total_spam / (stats.total_spam + stats.total_ham));
    let logHam  = Math.log(stats.total_ham  / (stats.total_spam + stats.total_ham));

    for (const token of cappedTokens) {
        const counts  = tokenMap.get(token);
        // +1 / +2  Laplace smoothing
        const spamProb = ((counts?.spam_count ?? 0) + 1) / (stats.total_spam + 2);
        const hamProb  = ((counts?.ham_count  ?? 0) + 1) / (stats.total_ham  + 2);

        logSpam += Math.log(spamProb);
        logHam  += Math.log(hamProb);
    }

    // Convert log-probs back to probability using the log-sum-exp trick for stability
    const maxLog = Math.max(logSpam, logHam);
    const score  =
        Math.exp(logSpam - maxLog) /
        (Math.exp(logSpam - maxLog) + Math.exp(logHam - maxLog));

    return Math.round(score * 1000) / 1000; // round to 3 decimal places
}
