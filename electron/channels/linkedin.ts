import { logDebug } from '../logger.js';
import type { ChannelConnector, ChannelConfig, ChannelMessage, OutboundMessage, SendResult, ChannelType } from './types.js';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

/**
 * LinkedIn channel connector for posting content.
 * Uses OAuth 2.0 for authentication (token obtained via Electron BrowserWindow flow).
 * Scope required: w_member_social (posting), r_liteprofile (identity).
 * Rate limit: 100 requests/day for posting (enforced locally).
 */
export class LinkedInConnector implements ChannelConnector {
  readonly type: ChannelType = 'linkedin';
  private connected = false;
  private accountId: string | null = null;
  private accessToken: string | null = null;
  private personUrn: string | null = null;
  private dailyPostCount = 0;
  private lastPostDate: string | null = null;

  async connect(config: ChannelConfig): Promise<boolean> {
    this.accountId = config.accountId;
    this.accessToken = config.credentials.accessToken;

    if (!this.accessToken) {
      logDebug('[LinkedIn] No access token provided');
      return false;
    }

    try {
      // Verify token by fetching user profile
      const resp = await fetch(`${LINKEDIN_API_BASE}/me`, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'unknown');
        logDebug(`[LinkedIn] Auth failed: ${resp.status} ${errText.slice(0, 200)}`);
        return false;
      }

      const profile = await resp.json() as { id?: string; localizedFirstName?: string; localizedLastName?: string };
      this.personUrn = `urn:li:person:${profile.id}`;
      this.connected = true;
      logDebug(`[LinkedIn] Connected ${this.accountId} as ${profile.localizedFirstName} ${profile.localizedLastName} (${this.personUrn})`);
      return true;
    } catch (err) {
      logDebug(`[LinkedIn] Connect error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = null;
    this.personUrn = null;
    this.accountId = null;
    logDebug('[LinkedIn] Disconnected');
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.connected || !this.accessToken || !this.personUrn) {
      return { success: false, error: 'LinkedIn not connected' };
    }

    // Rate limit: 100 posts per day
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastPostDate !== today) {
      this.dailyPostCount = 0;
      this.lastPostDate = today;
    }
    if (this.dailyPostCount >= 100) {
      return { success: false, error: 'Daily post limit reached (100/day)' };
    }

    try {
      const postBody = {
        author: this.personUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: message.body.slice(0, 3000), // LinkedIn max 3000 chars
            },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      const resp = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postBody),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'unknown');
        logDebug(`[LinkedIn] Post failed: ${resp.status} ${errText.slice(0, 200)}`);
        return { success: false, error: `LinkedIn API error: ${resp.status}` };
      }

      this.dailyPostCount++;
      const data = await resp.json() as { id?: string };
      logDebug(`[LinkedIn] Posted successfully: ${data.id}`);
      return { success: true, messageId: data.id };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug(`[LinkedIn] Post error: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  onMessage(cb: (msg: ChannelMessage) => void): void {
    // LinkedIn does not support inbound message polling via API.
    // This is a post-only connector; callback stored for future use.
    void cb;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getPersonUrn(): string | null {
    return this.personUrn;
  }
}

/**
 * Build the LinkedIn OAuth 2.0 authorization URL.
 * The user must visit this URL in a browser to grant access.
 * After approval, LinkedIn redirects to the redirect_uri with an auth code.
 */
export function buildLinkedInAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'r_liteprofile w_member_social',
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeLinkedInCode(
  code: string, clientId: string, clientSecret: string, redirectUri: string
): Promise<{ accessToken: string; expiresIn: number } | { error: string }> {
  try {
    const resp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      return { error: `Token exchange failed: ${resp.status} ${errText.slice(0, 200)}` };
    }

    const data = await resp.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      return { error: 'No access token in response' };
    }

    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 5184000 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
