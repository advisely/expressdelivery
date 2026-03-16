import { logDebug } from '../logger.js';
import type { LLMProvider, LLMOptions } from './types.js';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'gemma2:2b';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Validate Ollama host is loopback-only to prevent SSRF */
function validateHost(host: string): string {
  try {
    const url = new URL(host);
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      logDebug(`[Ollama] Rejected non-loopback host: ${url.hostname}`);
      return DEFAULT_HOST;
    }
    return host;
  } catch {
    return DEFAULT_HOST;
  }
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private host: string;
  private model: string;

  constructor(host?: string, model?: string) {
    this.host = validateHost(host ?? DEFAULT_HOST);
    this.model = model ?? DEFAULT_MODEL;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${this.host}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      return resp.ok;
    } catch {
      return false;
    }
  }

  async generate(systemPrompt: string, userMessage: string, options?: LLMOptions): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: userMessage,
          system: systemPrompt,
          stream: false,
          options: {
            num_predict: options?.maxTokens ?? 500,
            temperature: options?.temperature ?? 0.3,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'unknown');
        throw new Error(`Ollama API error ${resp.status}: ${errText}`);
      }

      const data = await resp.json() as { response?: string };
      if (!data.response) {
        throw new Error('Ollama returned empty response');
      }

      logDebug(`[Ollama] Generated ${data.response.length} chars via ${this.model}`);
      return data.response;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }
}
