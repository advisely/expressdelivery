export type IntentAction =
  | 'send_email'
  | 'reply_email'
  | 'search_emails'
  | 'summarize_emails'
  | 'categorize_email'
  | 'post_linkedin'
  | 'post_twitter'
  | 'send_telegram'
  | 'send_whatsapp'
  | 'create_draft'
  | 'unknown';

export interface ParsedIntent {
  action: IntentAction;
  targetChannel?: string;
  params: Record<string, unknown>;
  confidence: number;
  requiresConfirmation: boolean;
  rawText: string;
}

export interface IntentContext {
  availableChannels: string[];
  recentEmails?: Array<{ subject: string; from: string; snippet: string }>;
  userAccountEmail?: string;
}

export interface LLMProvider {
  generate(systemPrompt: string, userMessage: string, options?: LLMOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
  readonly name: string;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}
