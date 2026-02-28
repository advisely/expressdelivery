/**
 * OpenRouter API client for AI-powered reply generation.
 * Used by the ai:suggest-reply IPC handler.
 */

import { logDebug } from './logger.js';

export interface OpenRouterReplyOptions {
    apiKey: string;
    emailSubject: string;
    emailBody: string;
    fromName: string | null;
    fromEmail: string | null;
    senderHistory: Array<{ subject: string | null; snippet: string | null }>;
    threadContext: Array<{ fromName: string | null; fromEmail: string | null; bodyText: string | null }>;
    tone: 'professional' | 'casual' | 'friendly' | 'formal' | 'concise';
    accountEmail: string;
    accountDisplayName: string | null;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';
const MAX_TOKENS = 500;
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_LENGTH = 10_000;

function buildSystemPrompt(options: OpenRouterReplyOptions): string {
    const senderName = options.accountDisplayName || options.accountEmail;
    return `You are an email assistant composing a reply on behalf of ${senderName} <${options.accountEmail}>.
Tone: ${options.tone}.
Return ONLY the reply body as HTML (use <p> tags for paragraphs, no <html>/<head>/<body> wrappers).
Do not include a signature block. Keep the reply focused and concise.`;
}

/** Strip sequences that could be interpreted as prompt delimiters. */
function sanitizeForPrompt(text: string): string {
    return text.replace(/---+/g, '—').replace(/```/g, "'''");
}

function buildUserMessage(options: OpenRouterReplyOptions): string {
    const parts: string[] = [];

    // Original email
    const from = options.fromName ? `${sanitizeForPrompt(options.fromName)} <${options.fromEmail}>` : (options.fromEmail || 'Unknown');
    parts.push(`--- Original Email ---`);
    parts.push(`From: ${from}`);
    parts.push(`Subject: ${sanitizeForPrompt(options.emailSubject || '(no subject)')}`);
    parts.push(`Body:\n${sanitizeForPrompt((options.emailBody || '').slice(0, 2000))}`);

    // Thread context (last 3)
    if (options.threadContext.length > 0) {
        parts.push(`\n--- Thread Context (${options.threadContext.length} prior messages) ---`);
        for (const msg of options.threadContext.slice(-3)) {
            const msgFrom = msg.fromName ? `${sanitizeForPrompt(msg.fromName)} <${msg.fromEmail}>` : (msg.fromEmail || 'Unknown');
            parts.push(`From: ${msgFrom}`);
            parts.push(`${sanitizeForPrompt((msg.bodyText || '').slice(0, 500))}`);
            parts.push('---');
        }
    }

    // Sender history (last 3)
    if (options.senderHistory.length > 0) {
        parts.push(`\n--- Recent emails from this sender ---`);
        for (const h of options.senderHistory.slice(0, 3)) {
            parts.push(`Subject: ${sanitizeForPrompt((h.subject || '').slice(0, 100))} — ${sanitizeForPrompt((h.snippet || '').slice(0, 100))}`);
        }
    }

    parts.push(`\nPlease compose a reply.`);
    return parts.join('\n');
}

/**
 * Call the OpenRouter API to generate a reply.
 * @returns HTML string for the reply body
 * @throws on HTTP error, timeout, or invalid response
 */
export async function generateReply(options: OpenRouterReplyOptions): Promise<string> {
    // Input validation
    if (!options.apiKey || typeof options.apiKey !== 'string' || options.apiKey.length > 512) {
        throw new Error('Invalid API key');
    }

    const systemPrompt = buildSystemPrompt(options);
    const userMessage = buildUserMessage(options);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${options.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://expressdelivery.app',
                'X-Title': 'ExpressDelivery',
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            // Log details server-side but expose only generic status to renderer
            let detail = '';
            try {
                const errorBody = await response.json() as { error?: { message?: string } };
                if (errorBody?.error?.message) {
                    detail = errorBody.error.message.slice(0, 200);
                }
            } catch { /* ignore parse errors */ }
            if (detail) logDebug(`[openRouterClient] API error detail: ${detail.replace(/[\r\n\0]/g, ' ')}`);
            throw new Error(`[OpenRouter] HTTP ${response.status}`);
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };

        const content = data?.choices?.[0]?.message?.content;
        if (!content || typeof content !== 'string') {
            throw new Error('[OpenRouter] Empty response from model');
        }

        // Cap length and wrap plain text in <p> tags if no HTML detected
        let html = content.slice(0, MAX_RESPONSE_LENGTH);
        if (!/<(?:p|div|br|ul|ol|li|h[1-6]|span|a|strong|em|table)\b/i.test(html)) {
            html = html.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br />')}</p>`).join('');
        }

        logDebug(`[openRouterClient] Generated reply: ${html.length} chars`);
        return html;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error('[OpenRouter] Request timed out after 15s');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}
