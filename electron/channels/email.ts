import type {
  ChannelConnector,
  ChannelConfig,
  ChannelMessage,
  OutboundMessage,
  SendResult,
  ChannelType,
} from './types.js';
import { logDebug } from '../logger.js';

/**
 * Email channel adapter -- wraps the existing ImapEngine and SmtpEngine
 * to conform to the unified ChannelConnector interface.
 *
 * This is a thin adapter; the actual IMAP/SMTP logic remains in
 * electron/imap.ts and electron/smtp.ts.
 */
export class EmailChannelConnector implements ChannelConnector {
  readonly type: ChannelType = 'email';
  private connected = false;
  private messageCallback: ((msg: ChannelMessage) => void) | null = null;
  private accountId: string | null = null;

  // These will be injected from main.ts where the engines are already initialized
  private imapEngine: {
    isConnected: (id: string) => boolean;
    connectAccount: (id: string) => Promise<boolean>;
  } | null = null;

  private smtpEngine: {
    sendEmail: (
      accountId: string,
      to: string[],
      subject: string,
      html: string,
      cc?: string[],
      bcc?: string[],
      attachments?: Array<{ filename: string; content: string; contentType: string }>,
    ) => Promise<{ success: boolean; messageId?: string }>;
  } | null = null;

  setEngines(imap: typeof this.imapEngine, smtp: typeof this.smtpEngine): void {
    this.imapEngine = imap;
    this.smtpEngine = smtp;
  }

  async connect(config: ChannelConfig): Promise<boolean> {
    this.accountId = config.accountId;
    if (!this.imapEngine) {
      logDebug('[EmailChannel] No IMAP engine set');
      return false;
    }
    this.connected = this.imapEngine.isConnected(config.accountId);
    if (!this.connected) {
      this.connected = await this.imapEngine.connectAccount(config.accountId);
    }
    logDebug('[EmailChannel] Connect for ' + config.accountId + ': ' + String(this.connected));
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accountId = null;
    logDebug('[EmailChannel] Disconnected');
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.smtpEngine || !this.accountId) {
      return { success: false, error: 'SMTP engine not configured' };
    }
    const toArray = Array.isArray(message.to) ? message.to : [message.to];
    try {
      const result = await this.smtpEngine.sendEmail(
        this.accountId,
        toArray,
        message.subject ?? '(no subject)',
        message.bodyHtml ?? message.body,
      );
      return { success: result.success, messageId: result.messageId };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('[EmailChannel] Send error: ' + errMsg);
      return { success: false, error: errMsg };
    }
  }

  onMessage(callback: (msg: ChannelMessage) => void): void {
    this.messageCallback = callback;
  }

  /** Called by IMAP new-email callback to bridge into the channel system */
  notifyNewEmail(msg: ChannelMessage): void {
    if (this.messageCallback) {
      this.messageCallback(msg);
    }
  }

  isConnected(): boolean {
    if (this.accountId && this.imapEngine) {
      return this.imapEngine.isConnected(this.accountId);
    }
    return this.connected;
  }
}
