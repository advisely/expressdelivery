import { logDebug } from '../logger.js';
import type { LLMRouter } from '../llm/router.js';
import type { ParsedIntent, IntentAction, IntentContext } from './types.js';

/** Prevent prompt injection by stripping delimiter-like patterns from user content */
function sanitizeForPrompt(text: string): string {
  return text.replace(/---+/g, '\u2014').replace(/```/g, "'''");
}

const SYSTEM_PROMPT = `You are an intent parser for ExpressDelivery, a communication platform that handles email, Telegram, WhatsApp, LinkedIn, and Twitter.

Given a user message, extract the intent as a JSON object with these fields:
- action: one of: send_email, reply_email, search_emails, summarize_emails, categorize_email, post_linkedin, post_twitter, send_telegram, send_whatsapp, create_draft, unknown
- targetChannel: the channel type if applicable (email, telegram, whatsapp, linkedin, twitter)
- params: an object with relevant parameters extracted from the message:
  - For send actions: { to, subject, body }
  - For search: { query }
  - For post actions: { content }
  - For categorize: { category, priority }
  - For summarize: { timeframe }
- confidence: a number between 0 and 1 indicating how confident you are
- requiresConfirmation: true for any action that sends content externally

Respond ONLY with valid JSON. No markdown, no explanation.`;

function buildUserPrompt(message: string, context: IntentContext): string {
  let prompt = `User message: "${sanitizeForPrompt(message.slice(0, 1000))}"`;

  if (context.availableChannels.length > 0) {
    prompt += `\nAvailable channels: ${context.availableChannels.join(', ')}`;
  }
  if (context.userAccountEmail) {
    prompt += `\nUser email: ${context.userAccountEmail}`;
  }

  return prompt;
}

const VALID_ACTIONS = new Set<IntentAction>([
  'send_email', 'reply_email', 'search_emails', 'summarize_emails',
  'categorize_email', 'post_linkedin', 'post_twitter', 'send_telegram',
  'send_whatsapp', 'create_draft', 'unknown',
]);

function validateAction(action: unknown): IntentAction {
  if (typeof action === 'string' && VALID_ACTIONS.has(action as IntentAction)) {
    return action as IntentAction;
  }
  return 'unknown';
}

function isSendAction(action: string): boolean {
  return action.startsWith('send_') || action.startsWith('post_') || action === 'reply_email';
}

export class IntentParser {
  private llmRouter: LLMRouter;

  constructor(llmRouter: LLMRouter) {
    this.llmRouter = llmRouter;
  }

  async parse(message: string, context: IntentContext): Promise<ParsedIntent> {
    const userPrompt = buildUserPrompt(message, context);

    try {
      const { text, provider } = await this.llmRouter.generate(SYSTEM_PROMPT, userPrompt, {
        maxTokens: 300,
        temperature: 0.1,
      });

      logDebug(`[IntentParser] Raw LLM response (${provider}): ${text.slice(0, 200)}`);

      // Extract JSON from response (handle possible markdown wrapping)
      const jsonStr = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

      const action = validateAction(parsed.action);
      const intent: ParsedIntent = {
        action,
        targetChannel: typeof parsed.targetChannel === 'string' ? parsed.targetChannel : undefined,
        params: typeof parsed.params === 'object' && parsed.params !== null
          ? parsed.params as Record<string, unknown> : {},
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        requiresConfirmation: parsed.requiresConfirmation === true || isSendAction(action),
        rawText: message,
      };

      logDebug(`[IntentParser] Parsed: action=${intent.action}, confidence=${intent.confidence}, confirm=${intent.requiresConfirmation}`);
      return intent;
    } catch (err) {
      logDebug(`[IntentParser] Parse failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        action: 'unknown',
        params: {},
        confidence: 0,
        requiresConfirmation: false,
        rawText: message,
      };
    }
  }
}
