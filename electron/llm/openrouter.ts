import { logDebug } from '../logger.js';
import type { LLMProvider, LLMOptions } from './types.js';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const MAX_RESPONSE_LENGTH = 10000;

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async generate(systemPrompt: string, userMessage: string, options?: LLMOptions): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://expressdelivery.app',
          'X-Title': 'ExpressDelivery',
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          max_tokens: options?.maxTokens ?? 500,
          temperature: options?.temperature ?? 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'unknown');
        throw new Error(`OpenRouter API error ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content ?? '';
      if (!content) {
        throw new Error('OpenRouter returned empty response');
      }

      const trimmed = content.slice(0, MAX_RESPONSE_LENGTH);
      logDebug(`[OpenRouter] Generated ${trimmed.length} chars`);
      return trimmed;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }
}
