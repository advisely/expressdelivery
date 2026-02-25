import { getDatabase } from './db.js';
import { smtpEngine } from './smtp.js';
import type { SendAttachment } from './smtp.js';
import { logDebug } from './logger.js';

export interface SchedulerCallbacks {
  onSnoozeRestore: (emailId: string, accountId: string, folderId: string) => void;
  onReminderDue: (emailId: string, accountId: string, subject: string, fromEmail: string) => void;
  onScheduledSendResult: (scheduledId: string, success: boolean, error?: string) => void;
}

interface SnoozedRow {
  id: string;
  email_id: string;
  account_id: string;
  original_folder_id: string;
}

interface ScheduledSendRow {
  id: string;
  account_id: string;
  to_email: string;
  cc: string | null;
  bcc: string | null;
  subject: string;
  body_html: string;
  attachments_json: string | null;
  draft_id: string | null;
  retry_count: number;
}

interface ReminderRow {
  id: string;
  email_id: string;
  account_id: string;
  subject: string;
  from_email: string;
}

const POLL_INTERVAL_MS = 30_000;
const MAX_RETRIES = 3;

export class SchedulerEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: SchedulerCallbacks | null = null;

  setCallbacks(cb: SchedulerCallbacks): void {
    this.callbacks = cb;
  }

  start(): void {
    if (this.intervalId) return;
    logDebug('Scheduler engine starting...');
    this.intervalId = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    // Defer first tick to avoid blocking startup
    setTimeout(() => this.tick(), 2000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logDebug('Scheduler engine stopped.');
  }

  private async tick(): Promise<void> {
    try { this.processSnoozedEmails(); } catch (e) {
      logDebug(`Scheduler snooze error: ${e instanceof Error ? e.message : String(e)}`);
    }
    try { await this.processScheduledSends(); } catch (e) {
      logDebug(`Scheduler send error: ${e instanceof Error ? e.message : String(e)}`);
    }
    try { this.processReminders(); } catch (e) {
      logDebug(`Scheduler reminder error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private processSnoozedEmails(): void {
    const db = getDatabase();
    const due = db.prepare(
      "SELECT id, email_id, account_id, original_folder_id FROM snoozed_emails WHERE snooze_until <= datetime('now') AND restored = 0"
    ).all() as SnoozedRow[];

    for (const snoozed of due) {
      db.transaction(() => {
        db.prepare('UPDATE emails SET is_snoozed = 0, folder_id = ? WHERE id = ?')
          .run(snoozed.original_folder_id, snoozed.email_id);
        db.prepare('UPDATE snoozed_emails SET restored = 1 WHERE id = ?')
          .run(snoozed.id);
      })();
      logDebug(`Snooze restored: email=${snoozed.email_id}`);
      this.callbacks?.onSnoozeRestore(snoozed.email_id, snoozed.account_id, snoozed.original_folder_id);
    }
  }

  private async processScheduledSends(): Promise<void> {
    const db = getDatabase();
    const due = db.prepare(
      "SELECT id, account_id, to_email, cc, bcc, subject, body_html, attachments_json, draft_id, retry_count FROM scheduled_sends WHERE send_at <= datetime('now') AND status = 'pending'"
    ).all() as ScheduledSendRow[];

    for (const scheduled of due) {
      // Mark in-progress to prevent re-processing on next tick
      db.prepare("UPDATE scheduled_sends SET status = 'sending' WHERE id = ?").run(scheduled.id);

      const toList = scheduled.to_email.split(',').map(s => s.trim()).filter(Boolean);
      const ccList = scheduled.cc ? scheduled.cc.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const bccList = scheduled.bcc ? scheduled.bcc.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      let attachments: SendAttachment[] | undefined;
      if (scheduled.attachments_json) {
        try { attachments = JSON.parse(scheduled.attachments_json) as SendAttachment[]; } catch {
          logDebug(`Scheduler: malformed attachments_json for id=${scheduled.id}`);
        }
      }

      try {
        const success = await smtpEngine.sendEmail(
          scheduled.account_id, toList, scheduled.subject, scheduled.body_html,
          ccList, bccList, attachments
        );
        if (success) {
          db.transaction(() => {
            db.prepare("UPDATE scheduled_sends SET status = 'sent' WHERE id = ?").run(scheduled.id);
            if (scheduled.draft_id) {
              db.prepare('DELETE FROM drafts WHERE id = ?').run(scheduled.draft_id);
            }
          })();
          logDebug(`Scheduled send completed: id=${scheduled.id}`);
          this.callbacks?.onScheduledSendResult(scheduled.id, true);
        } else {
          this.handleSendFailure(db, scheduled, 'SMTP send returned false');
        }
      } catch (err) {
        this.handleSendFailure(db, scheduled, err instanceof Error ? err.message : String(err));
      }
    }
  }

  private handleSendFailure(
    db: ReturnType<typeof getDatabase>,
    scheduled: ScheduledSendRow,
    errorMsg: string
  ): void {
    const retryCount = scheduled.retry_count + 1;
    if (retryCount >= MAX_RETRIES) {
      db.prepare("UPDATE scheduled_sends SET status = 'failed', retry_count = ?, error_message = ? WHERE id = ?")
        .run(retryCount, errorMsg, scheduled.id);
      logDebug(`Scheduled send failed permanently: id=${scheduled.id} error=${errorMsg}`);
      this.callbacks?.onScheduledSendResult(scheduled.id, false, errorMsg);
    } else {
      // Reset to pending with incremented retry count for next poll cycle
      db.prepare("UPDATE scheduled_sends SET status = 'pending', retry_count = ? WHERE id = ?")
        .run(retryCount, scheduled.id);
      logDebug(`Scheduled send retry ${retryCount}/${MAX_RETRIES}: id=${scheduled.id}`);
    }
  }

  private processReminders(): void {
    const db = getDatabase();
    const due = db.prepare(
      "SELECT r.id, r.email_id, r.account_id, e.subject, e.from_email " +
      "FROM reminders r JOIN emails e ON r.email_id = e.id " +
      "WHERE r.remind_at <= datetime('now') AND r.is_triggered = 0"
    ).all() as ReminderRow[];

    for (const reminder of due) {
      db.transaction(() => {
        db.prepare('UPDATE reminders SET is_triggered = 1 WHERE id = ?').run(reminder.id);
      })();
      logDebug(`Reminder triggered: email=${reminder.email_id}`);
      this.callbacks?.onReminderDue(
        reminder.email_id, reminder.account_id,
        reminder.subject || '(no subject)', reminder.from_email || 'Unknown'
      );
    }
  }
}

export const schedulerEngine = new SchedulerEngine();
