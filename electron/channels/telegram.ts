import { Bot, type Context } from 'grammy';
import { logDebug } from '../logger.js';
import type { ChannelConnector, ChannelConfig, ChannelMessage, OutboundMessage, SendResult, ChannelType } from './types.js';
import { randomUUID } from 'node:crypto';

/**
 * Telegram channel connector using grammy (Telegram Bot API).
 * Uses long polling (not webhooks) since this is a desktop app
 * that cannot expose a public endpoint.
 *
 * Security: Only responds to messages from chat IDs in the allowlist.
 * Bot token is stored encrypted via safeStorage.
 */
export class TelegramConnector implements ChannelConnector {
  readonly type: ChannelType = 'telegram';
  private bot: Bot | null = null;
  private connected = false;
  private messageCallback: ((msg: ChannelMessage) => void) | null = null;
  private accountId: string | null = null;
  private allowedChatIds: Set<number> = new Set();

  async connect(config: ChannelConfig): Promise<boolean> {
    const token = config.credentials.botToken;
    if (!token) {
      logDebug('[Telegram] No bot token provided');
      return false;
    }

    this.accountId = config.accountId;

    // Parse allowed chat IDs from config
    const chatIds = config.options?.allowedChatIds;
    if (Array.isArray(chatIds)) {
      for (const id of chatIds) {
        if (typeof id === 'number') this.allowedChatIds.add(id);
      }
    }

    try {
      this.bot = new Bot(token);

      // Register message handler
      this.bot.on('message:text', (ctx: Context) => {
        if (!ctx.message || !ctx.from || !ctx.chat) return;

        const chatId = ctx.chat.id;

        // Security: default-deny — reject all messages unless chat ID is explicitly allowed
        if (!this.allowedChatIds.has(chatId)) {
          logDebug(`[Telegram] Denied message from chat ${chatId} (not in allowlist of ${this.allowedChatIds.size} IDs)`);
          return;
        }

        const channelMsg: ChannelMessage = {
          id: randomUUID(),
          channelType: 'telegram',
          channelAccountId: this.accountId ?? '',
          direction: 'inbound',
          from: ctx.from.username ?? String(ctx.from.id),
          to: [this.bot?.botInfo?.username ?? 'bot'],
          body: ctx.message.text ?? '',
          timestamp: new Date(ctx.message.date * 1000),
          threadId: String(chatId),
          metadata: {
            chatId,
            fromId: ctx.from.id,
            messageId: ctx.message.message_id,
            chatType: ctx.chat.type,
          },
        };

        logDebug(`[Telegram] Inbound from ${channelMsg.from}: ${channelMsg.body.slice(0, 50)}`);
        if (this.messageCallback) {
          this.messageCallback(channelMsg);
        }
      });

      // Start long polling (non-blocking)
      this.bot.start({
        onStart: () => {
          logDebug(`[Telegram] Bot started: @${this.bot?.botInfo?.username}`);
          this.connected = true;
        },
      });

      // Wait briefly for initial connection
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));

      if (!this.connected) {
        // Try to get bot info to verify token is valid
        await this.bot.api.getMe();
        this.connected = true;
      }

      logDebug(`[Telegram] Connected as @${this.bot.botInfo?.username}`);
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug(`[Telegram] Connect failed: ${errMsg}`);
      this.connected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop();
      } catch (err) {
        logDebug(`[Telegram] Stop error: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.bot = null;
    }
    this.connected = false;
    this.accountId = null;
    this.allowedChatIds.clear();
    logDebug('[Telegram] Disconnected');
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.bot || !this.connected) {
      return { success: false, error: 'Telegram bot not connected' };
    }

    const chatId = typeof message.to === 'string' ? message.to : message.to[0];
    if (!chatId) {
      return { success: false, error: 'No chat ID specified' };
    }

    try {
      const numericChatId = Number(chatId);
      if (isNaN(numericChatId)) {
        return { success: false, error: 'Invalid chat ID (must be numeric)' };
      }

      const sent = await this.bot.api.sendMessage(numericChatId, message.body, {
        parse_mode: message.bodyHtml ? 'HTML' : undefined,
      });

      logDebug(`[Telegram] Sent message ${sent.message_id} to chat ${chatId}`);
      return { success: true, messageId: String(sent.message_id) };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug(`[Telegram] Send error: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  onMessage(callback: (msg: ChannelMessage) => void): void {
    this.messageCallback = callback;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Add a chat ID to the allowlist at runtime */
  allowChatId(chatId: number): void {
    this.allowedChatIds.add(chatId);
    logDebug(`[Telegram] Allowed chat ID: ${chatId}`);
  }

  /** Get the bot username for display */
  getBotUsername(): string | undefined {
    return this.bot?.botInfo?.username;
  }
}
