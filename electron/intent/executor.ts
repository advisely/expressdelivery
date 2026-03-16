import { logDebug } from '../logger.js';
import { getChannelRegistry } from '../channels/registry.js';
import type { ParsedIntent } from './types.js';
import type { ChannelType, SendResult } from '../channels/types.js';

/** Strip CRLF and null bytes from LLM-extracted strings to prevent injection */
const sanitize = (s: string) => s.replace(/[\r\n\0]/g, '').slice(0, 4000);

export interface ExecutionResult {
  success: boolean;
  action: string;
  channel?: string;
  result?: SendResult;
  error?: string;
}

export class IntentExecutor {
  async execute(intent: ParsedIntent): Promise<ExecutionResult> {
    logDebug(`[IntentExecutor] Executing: ${intent.action} (confidence=${intent.confidence})`);

    if (intent.confidence < 0.3) {
      return { success: false, action: intent.action, error: 'Confidence too low to execute' };
    }

    try {
      switch (intent.action) {
        case 'send_email':
        case 'reply_email':
          return await this.executeSendEmail(intent);
        case 'send_telegram':
          return await this.executeChannelSend(intent, 'telegram');
        case 'send_whatsapp':
          return await this.executeChannelSend(intent, 'whatsapp');
        case 'post_linkedin':
          return await this.executeChannelSend(intent, 'linkedin');
        case 'post_twitter':
          return await this.executeChannelSend(intent, 'twitter');
        case 'search_emails':
        case 'summarize_emails':
        case 'categorize_email':
        case 'create_draft':
          return { success: true, action: intent.action, error: 'Action delegated to MCP tools' };
        default:
          return { success: false, action: intent.action, error: 'Unknown action' };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug(`[IntentExecutor] Execution error: ${errMsg}`);
      return { success: false, action: intent.action, error: errMsg };
    }
  }

  private async executeSendEmail(intent: ParsedIntent): Promise<ExecutionResult> {
    const registry = getChannelRegistry();
    const emailConnectors = registry.getByType('email');
    if (emailConnectors.length === 0) {
      return { success: false, action: intent.action, error: 'No email account connected' };
    }

    const connector = emailConnectors[0];
    const params = intent.params;
    const to = sanitize(typeof params.to === 'string' ? params.to : '');
    const subject = sanitize(typeof params.subject === 'string' ? params.subject : '(no subject)');
    const body = sanitize(typeof params.body === 'string' ? params.body : '');

    if (!to) {
      return { success: false, action: intent.action, error: 'No recipient specified' };
    }

    const result = await connector.send({ to: [to], subject, body, bodyHtml: `<p>${body}</p>` });
    return { success: result.success, action: intent.action, channel: 'email', result };
  }

  private async executeChannelSend(intent: ParsedIntent, channelType: ChannelType): Promise<ExecutionResult> {
    const registry = getChannelRegistry();
    const connectors = registry.getByType(channelType);
    if (connectors.length === 0) {
      return { success: false, action: intent.action, error: `No ${channelType} account connected` };
    }

    const connector = connectors[0];
    const params = intent.params;
    const to = sanitize(typeof params.to === 'string' ? params.to : '');
    const body = sanitize(typeof params.body === 'string'
      ? params.body
      : typeof params.content === 'string'
        ? params.content
        : '');

    if (!body) {
      return { success: false, action: intent.action, error: 'No content specified' };
    }

    const result = await connector.send({ to: to || 'broadcast', body });
    return { success: result.success, action: intent.action, channel: channelType, result };
  }
}
