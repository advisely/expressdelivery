import { getDatabase } from './db.js';
import { logDebug } from './logger.js';

interface MailRule {
  id: string;
  account_id: string;
  name: string;
  priority: number;
  is_active: number;
  match_field: string;
  match_operator: string;
  match_value: string;
  action_type: string;
  action_value: string | null;
}

interface EmailRow {
  id: string;
  account_id: string;
  from_email: string | null;
  subject: string | null;
  body_text: string | null;
  has_attachments: number;
}

function matchesRule(email: EmailRow, rule: MailRule): boolean {
  let fieldValue: string;
  switch (rule.match_field) {
    case 'from': fieldValue = email.from_email ?? ''; break;
    case 'subject': fieldValue = email.subject ?? ''; break;
    case 'body': fieldValue = (email.body_text ?? '').slice(0, 5000); break;
    case 'has_attachment': fieldValue = email.has_attachments ? 'true' : 'false'; break;
    default: return false;
  }

  const value = fieldValue.toLowerCase();
  const matchVal = rule.match_value.toLowerCase();

  switch (rule.match_operator) {
    case 'contains': return value.includes(matchVal);
    case 'equals': return value === matchVal;
    case 'starts_with': return value.startsWith(matchVal);
    case 'ends_with': return value.endsWith(matchVal);
    default: return false;
  }
}

function applyAction(db: ReturnType<typeof getDatabase>, emailId: string, rule: MailRule): void {

  switch (rule.action_type) {
    case 'mark_read':
      db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(emailId);
      break;
    case 'flag':
      db.prepare('UPDATE emails SET is_flagged = 1 WHERE id = ?').run(emailId);
      break;
    case 'delete':
      db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
      break;
    case 'label':
      if (rule.action_value) {
        const current = db.prepare('SELECT ai_labels FROM emails WHERE id = ?').get(emailId) as { ai_labels: string | null } | undefined;
        let labels: string[] = [];
        try { labels = current?.ai_labels ? JSON.parse(current.ai_labels) : []; } catch { /* malformed JSON */ }
        if (!labels.includes(rule.action_value)) {
          labels.push(rule.action_value);
          db.prepare('UPDATE emails SET ai_labels = ? WHERE id = ?').run(JSON.stringify(labels), emailId);
        }
      }
      break;
    case 'categorize':
      if (rule.action_value) {
        db.prepare('UPDATE emails SET ai_category = ? WHERE id = ?').run(rule.action_value, emailId);
      }
      break;
    case 'move':
      if (rule.action_value) {
        const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND account_id = ?').get(rule.action_value, rule.account_id) as { id: string } | undefined;
        if (folder) {
          db.prepare('UPDATE emails SET folder_id = ? WHERE id = ?').run(folder.id, emailId);
        }
      }
      break;
  }
}

export function applyRulesToEmail(emailId: string, accountId: string): void {
  try {
    const db = getDatabase();
    const rules = db.prepare(
      'SELECT id, account_id, name, priority, is_active, match_field, match_operator, match_value, action_type, action_value FROM mail_rules WHERE account_id = ? AND is_active = 1 ORDER BY priority ASC'
    ).all(accountId) as MailRule[];

    if (rules.length === 0) return;

    const email = db.prepare(
      'SELECT id, account_id, from_email, subject, body_text, has_attachments FROM emails WHERE id = ? AND account_id = ?'
    ).get(emailId, accountId) as EmailRow | undefined;

    if (!email) return;

    db.transaction(() => {
      for (const rule of rules) {
        if (matchesRule(email, rule)) {
          logDebug(`[RULES] Rule "${rule.name}" matched email ${emailId}, applying action: ${rule.action_type}`);
          applyAction(db, emailId, rule);
          // If the action was delete, stop processing further rules
          if (rule.action_type === 'delete') break;
        }
      }
    })();
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    logDebug(`[RULES] Error applying rules to email ${emailId}: ${e.message}`);
  }
}
