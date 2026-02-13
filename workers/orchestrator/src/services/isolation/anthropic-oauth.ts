import * as fs from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@intexuraos/common-core';
import type { AnthropicOAuthCredentials, OAuthState } from './types.js';

const REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 minutes before expiry
const REFRESH_TIMEOUT_MS = 15_000;
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';

export interface AnthropicOAuthManagerConfig {
  credentialsPath: string;
  codeAgentUrl: string;
  internalAuthToken: string;
}

export class AnthropicOAuthManager {
  private readonly config: AnthropicOAuthManagerConfig;
  private readonly logger: Logger;
  private credentials: AnthropicOAuthCredentials | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(config: AnthropicOAuthManagerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Synchronously load credentials from the global file.
   * Returns true if credentials were loaded successfully.
   */
  loadCredentials(): boolean {
    if (!fs.existsSync(this.config.credentialsPath)) {
      this.logger.error(
        { path: this.config.credentialsPath },
        'Anthropic OAuth credentials file not found'
      );
      return false;
    }

    try {
      const raw = fs.readFileSync(this.config.credentialsPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (parsed['claudeAiOauth'] === undefined || parsed['claudeAiOauth'] === null) {
        this.logger.error(
          { path: this.config.credentialsPath },
          'Credentials file missing claudeAiOauth field — run `claude login` first'
        );
        return false;
      }

      const oauth = parsed['claudeAiOauth'] as AnthropicOAuthCredentials;
      this.credentials = {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt,
        scopes: oauth.scopes,
        subscriptionType: oauth.subscriptionType,
        rateLimitTier: oauth.rateLimitTier,
      };

      return true;
    } catch (error) {
      this.logger.error(
        /* v8 ignore start -- ts-type: catch always receives Error instances @preserve */
        {
          error: error instanceof Error ? error : new Error(String(error)),
          path: this.config.credentialsPath,
        },
        /* v8 ignore stop @preserve */
        'Failed to parse credentials file'
      );
      return false;
    }
  }

  /**
   * Get a valid access token, refreshing if near expiry.
   * Returns null if credentials are unavailable or refresh failed.
   */
  async getAccessToken(): Promise<string | null> {
    if (this.credentials === null) {
      return null;
    }

    const now = Date.now();
    if (now < this.credentials.expiresAt - REFRESH_BUFFER_MS) {
      return this.credentials.accessToken;
    }

    // Deduplicate concurrent refresh calls
    if (this.refreshPromise !== null) {
      return await this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  getCurrentAccessToken(): string | null {
    return this.credentials?.accessToken ?? null;
  }

  getState(): OAuthState {
    if (this.credentials === null) {
      return { status: 'not_configured', message: 'Anthropic OAuth credentials not found' };
    }

    const now = Date.now();
    if (now >= this.credentials.expiresAt) {
      return { status: 'expired', message: 'Access token expired — awaiting refresh' };
    }

    return {
      status: 'active',
      expiresAt: new Date(this.credentials.expiresAt).toISOString(),
      expiresInMinutes: Math.round((this.credentials.expiresAt - now) / 60_000),
      subscriptionType: this.credentials.subscriptionType,
    };
  }

  logStartupStatus(): void {
    const state = this.getState();

    if (state.status === 'active') {
      this.logger.info(
        {
          expiresAt: state.expiresAt,
          expiresInMinutes: state.expiresInMinutes,
          subscriptionType: state.subscriptionType,
        },
        `Anthropic OAuth: active, subscription: ${state.subscriptionType}`
      );
    } else if (state.status === 'expired') {
      this.logger.warn(
        { message: state.message },
        'Anthropic OAuth: token expired — will refresh on first use'
      );
    } else {
      this.logger.warn({ message: state.message }, 'Anthropic OAuth: not configured');
    }
  }

  /**
   * Write current credentials to a task session directory
   * so the container can read them via the bind mount.
   */
  async writeTaskCredentials(taskSessionPath: string): Promise<void> {
    if (this.credentials === null) {
      return;
    }

    const filePath = join(taskSessionPath, '.credentials.json');
    try {
      const content = JSON.stringify({ claudeAiOauth: this.credentials }, null, 2);
      await fs.promises.writeFile(filePath, content, { mode: 0o600 });
    } catch (error) {
      this.logger.error(
        /* v8 ignore start -- ts-type: catch always receives Error instances @preserve */
        { error: error instanceof Error ? error : new Error(String(error)), taskSessionPath },
        /* v8 ignore stop @preserve */
        'Failed to write task credentials'
      );
      throw error;
    }
  }

  private async doRefresh(): Promise<string | null> {
    /* v8 ignore start -- module-init: null guard after loadCredentials check @preserve */
    if (this.credentials === null) {
      return null;
    }
    /* v8 ignore stop @preserve */

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken,
      });

      const resp = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });

      if (!resp.ok) {
        let errorBody: { error?: string } = {};
        try {
          errorBody = (await resp.json()) as { error?: string };
        } catch {
          /* v8 ignore start -- upstream: non-JSON error response from Anthropic OAuth endpoint @preserve */
          /* v8 ignore stop @preserve */
        }

        if (errorBody.error === 'invalid_grant') {
          this.logger.error(
            { status: resp.status },
            'Anthropic OAuth refresh token revoked — run `claude login` on VM'
          );
          await this.alertCodeAgent(
            'Anthropic OAuth refresh token revoked. Re-authentication required.'
          );
          return null;
        }

        this.logger.error(
          { status: resp.status, error: errorBody },
          'Anthropic OAuth token refresh failed'
        );
        return null;
      }

      const data = (await resp.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      this.credentials.accessToken = data.access_token;
      if (data.refresh_token !== undefined) {
        this.credentials.refreshToken = data.refresh_token;
      }
      this.credentials.expiresAt = Date.now() + data.expires_in * 1000;

      try {
        await this.persistCredentials();
      } catch (error) {
        this.logger.error(
          /* v8 ignore start -- ts-type: catch always receives Error instances @preserve */
          { error: error instanceof Error ? error : new Error(String(error)) },
          /* v8 ignore stop @preserve */
          'Failed to persist refreshed credentials — in-memory token still valid'
        );
      }

      this.logger.info(
        { expiresInMinutes: Math.round(data.expires_in / 60) },
        'Anthropic OAuth token refreshed'
      );

      return data.access_token;
    } catch (error) {
      this.logger.error(
        /* v8 ignore start -- ts-type: catch always receives Error instances @preserve */
        { error: error instanceof Error ? error : new Error(String(error)) },
        /* v8 ignore stop @preserve */
        'Anthropic OAuth token refresh failed'
      );
      return null;
    }
  }

  private async persistCredentials(): Promise<void> {
    /* v8 ignore start -- ts-type: null guard after doRefresh caller already checks @preserve */
    if (this.credentials === null) {
      return;
    }
    /* v8 ignore stop @preserve */

    let existing: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(this.config.credentialsPath, 'utf-8');
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File may not exist or be corrupted — write fresh
    }

    existing['claudeAiOauth'] = this.credentials;
    await fs.promises.writeFile(this.config.credentialsPath, JSON.stringify(existing, null, 2), {
      mode: 0o600,
    });
  }

  private async alertCodeAgent(message: string): Promise<void> {
    try {
      await fetch(`${this.config.codeAgentUrl}/internal/orchestrator/alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': this.config.internalAuthToken,
        },
        body: JSON.stringify({
          type: 'oauth_revoked',
          message,
          lastRefreshedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.error(
        /* v8 ignore start -- ts-type: catch always receives Error instances @preserve */
        { error: error instanceof Error ? error : new Error(String(error)) },
        /* v8 ignore stop @preserve */
        'Failed to alert code-agent about OAuth revocation'
      );
    }
  }
}
