export type ChannelType = 'email' | 'telegram' | 'whatsapp' | 'linkedin' | 'twitter';

export interface ChannelMessage {
  id: string;
  channelType: ChannelType;
  channelAccountId: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string[];
  subject?: string;
  body: string;
  bodyHtml?: string;
  timestamp: Date;
  threadId?: string;
  attachments?: ChannelAttachment[];
  metadata: Record<string, unknown>;
}

export interface ChannelAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
  size: number;
}

export interface ChannelConfig {
  type: ChannelType;
  accountId: string;
  credentials: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface OutboundMessage {
  to: string | string[];
  body: string;
  bodyHtml?: string;
  subject?: string;
  attachments?: ChannelAttachment[];
  metadata?: Record<string, unknown>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ChannelConnector {
  readonly type: ChannelType;
  connect(config: ChannelConfig): Promise<boolean>;
  disconnect(): Promise<void>;
  send(message: OutboundMessage): Promise<SendResult>;
  onMessage(callback: (msg: ChannelMessage) => void): void;
  isConnected(): boolean;
}

export interface ChannelAccountRow {
  id: string;
  channel_type: string;
  account_name: string;
  config_encrypted: string | null;
  enabled: number;
  created_at: string;
}
