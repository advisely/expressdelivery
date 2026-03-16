import { logDebug } from '../logger.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import type { LLMProvider, LLMOptions } from './types.js';

export type LLMPreference = 'local' | 'cloud' | 'auto';

export class LLMRouter {
  private ollama: OllamaProvider;
  private openrouter: OpenRouterProvider | null = null;
  private preference: LLMPreference;

  constructor(preference: LLMPreference = 'auto', ollamaHost?: string, ollamaModel?: string) {
    this.preference = preference;
    this.ollama = new OllamaProvider(ollamaHost, ollamaModel);
  }

  setOpenRouterKey(apiKey: string): void {
    this.openrouter = new OpenRouterProvider(apiKey);
  }

  setPreference(pref: LLMPreference): void {
    this.preference = pref;
    logDebug(`[LLMRouter] Preference set to: ${pref}`);
  }

  async generate(systemPrompt: string, userMessage: string, options?: LLMOptions): Promise<{ text: string; provider: string }> {
    const provider = await this.resolveProvider();
    if (!provider) {
      throw new Error('No LLM provider available. Install Ollama or configure an OpenRouter API key.');
    }

    const text = await provider.generate(systemPrompt, userMessage, options);
    return { text, provider: provider.name };
  }

  private async resolveProvider(): Promise<LLMProvider | null> {
    if (this.preference === 'local') {
      if (await this.ollama.isAvailable()) return this.ollama;
      logDebug('[LLMRouter] Local preferred but Ollama unavailable');
      return null;
    }

    if (this.preference === 'cloud') {
      if (this.openrouter && await this.openrouter.isAvailable()) return this.openrouter;
      logDebug('[LLMRouter] Cloud preferred but OpenRouter unavailable');
      return null;
    }

    // Auto: prefer local, fall back to cloud
    if (await this.ollama.isAvailable()) {
      logDebug('[LLMRouter] Auto: using Ollama (local)');
      return this.ollama;
    }
    if (this.openrouter && await this.openrouter.isAvailable()) {
      logDebug('[LLMRouter] Auto: falling back to OpenRouter (cloud)');
      return this.openrouter;
    }

    logDebug('[LLMRouter] Auto: no provider available');
    return null;
  }

  async getAvailableProviders(): Promise<Array<{ name: string; available: boolean }>> {
    const ollamaAvail = await this.ollama.isAvailable();
    const orAvail = this.openrouter ? await this.openrouter.isAvailable() : false;
    return [
      { name: 'ollama', available: ollamaAvail },
      { name: 'openrouter', available: orAvail },
    ];
  }
}
