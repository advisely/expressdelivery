import { randomBytes, createHash } from 'node:crypto';
import { logDebug } from '../logger.js';
import type { ChannelConnector, ChannelConfig, ChannelMessage, OutboundMessage, SendResult, ChannelType } from './types.js';

const TWITTER_API_BASE = 'https://api.twitter.com/2';

/**
 * Twitter/X channel connector for posting tweets.
 * Uses OAuth 2.0 PKCE flow (required for public clients).
 * Rate limit: 50 tweets per 24h on Essential tier (enforced locally).
 */
export class TwitterConnector implements ChannelConnector {
  readonly type: ChannelType = 'twitter';
  private connected = false;
  private accountId: string | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private userId: string | null = null;
  private username: string | null = null;
  private dailyTweetCount = 0;
  private lastTweetDate: string | null = null;

  async connect(config: ChannelConfig): Promise<boolean> {
    this.accountId = config.accountId;
    this.accessToken = config.credentials.accessToken;
    this.refreshToken = config.credentials.refreshToken ?? null;

    if (!this.accessToken) {
      logDebug('[Twitter] No access token provided');
      return false;
    }

    try {
      // Verify token by fetching authenticated user
      const resp = await fetch(`${TWITTER_API_BASE}/users/me`, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });

      if (!resp.ok) {
        // Try token refresh if we have a refresh token
        if (resp.status === 401 && this.refreshToken) {
          logDebug('[Twitter] Token expired, refresh not yet implemented');
        }
        const errText = await resp.text().catch(() => 'unknown');
        logDebug(`[Twitter] Auth failed: ${resp.status} ${errText.slice(0, 200)}`);
        return false;
      }

      const data = await resp.json() as { data?: { id?: string; username?: string } };
      this.userId = data.data?.id ?? null;
      this.username = data.data?.username ?? null;
      this.connected = true;
      logDebug(`[Twitter] Connected ${this.accountId} as @${this.username} (${this.userId})`);
      return true;
    } catch (err) {
      logDebug(`[Twitter] Connect error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
    this.username = null;
    this.accountId = null;
    logDebug('[Twitter] Disconnected');
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.connected || !this.accessToken) {
      return { success: false, error: 'Twitter not connected' };
    }

    // Rate limit: 50 tweets per 24h (Essential tier)
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastTweetDate !== today) {
      this.dailyTweetCount = 0;
      this.lastTweetDate = today;
    }
    if (this.dailyTweetCount >= 50) {
      return { success: false, error: 'Daily tweet limit reached (50/day)' };
    }

    const tweetText = message.body.slice(0, 280); // Twitter max 280 chars

    try {
      const resp = await fetch(`${TWITTER_API_BASE}/tweets`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: tweetText }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'unknown');
        logDebug(`[Twitter] Tweet failed: ${resp.status} ${errText.slice(0, 200)}`);
        return { success: false, error: `Twitter API error: ${resp.status}` };
      }

      this.dailyTweetCount++;
      const data = await resp.json() as { data?: { id?: string } };
      logDebug(`[Twitter] Tweeted: ${data.data?.id}`);
      return { success: true, messageId: data.data?.id };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug(`[Twitter] Tweet error: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  onMessage(cb: (msg: ChannelMessage) => void): void {
    // Twitter streaming requires Elevated access; not implemented in v1.
    void cb;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getUsername(): string | null {
    return this.username;
  }
}

/**
 * Build the Twitter OAuth 2.0 PKCE authorization URL.
 * Twitter requires PKCE for public clients (desktop apps).
 */
export function buildTwitterAuthUrl(
  clientId: string, redirectUri: string, state: string, codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'tweet.read tweet.write users.read offline.access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens using PKCE.
 */
export async function exchangeTwitterCode(
  code: string, clientId: string, redirectUri: string, codeVerifier: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | { error: string }> {
  try {
    const resp = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      return { error: `Token exchange failed: ${resp.status} ${errText.slice(0, 200)}` };
    }

    const data = await resp.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token) {
      return { error: 'No access token in response' };
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresIn: data.expires_in ?? 7200,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Generate a PKCE code verifier and challenge pair.
 */
export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
