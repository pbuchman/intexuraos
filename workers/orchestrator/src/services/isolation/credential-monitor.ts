import * as fs from 'node:fs';
import type { Logger } from '@intexuraos/common-core';
import type { AnthropicOAuthCredentials, OAuthState } from './types.js';

export interface CredentialMonitorConfig {
  credentialsPath: string;
  reloadIntervalMs: number;
}

export class CredentialMonitor {
  private readonly config: CredentialMonitorConfig;
  private readonly logger: Logger;
  private credentials: AnthropicOAuthCredentials | null = null;
  private reloadHandle?: NodeJS.Timeout | undefined;

  constructor(config: CredentialMonitorConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  loadCredentials(): boolean {
    if (!fs.existsSync(this.config.credentialsPath)) {
      this.logger.error(
        { path: this.config.credentialsPath },
        'Orchestrator credentials file not found'
      );
      return false;
    }

    try {
      const raw = fs.readFileSync(this.config.credentialsPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (parsed['claudeAiOauth'] === undefined || parsed['claudeAiOauth'] === null) {
        this.logger.error(
          { path: this.config.credentialsPath },
          'Credentials file missing claudeAiOauth field — run claude-login.sh first'
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
        {
          error: error instanceof Error ? error : new Error(String(error)),
          path: this.config.credentialsPath,
        },
        'Failed to parse credentials file'
      );
      return false;
    }
  }

  startMonitoring(): void {
    this.reloadHandle = setInterval(() => {
      this.loadCredentials();
    }, this.config.reloadIntervalMs);
  }

  stopMonitoring(): void {
    if (this.reloadHandle !== undefined) {
      clearInterval(this.reloadHandle);
      this.reloadHandle = undefined;
    }
  }

  getCurrentAccessToken(): string | null {
    return this.credentials?.accessToken ?? null;
  }

  getState(): OAuthState {
    if (this.credentials === null) {
      return { status: 'not_configured', message: 'Orchestrator credentials not found' };
    }

    const now = Date.now();
    if (now >= this.credentials.expiresAt) {
      return { status: 'expired', message: 'Access token expired — workers will refresh on use' };
    }

    return {
      status: 'active',
      expiresAt: new Date(this.credentials.expiresAt).toISOString(),
      expiresInMinutes: Math.round((this.credentials.expiresAt - now) / 60_000),
      subscriptionType: this.credentials.subscriptionType,
    };
  }

  isExpiringSoon(bufferMs: number): boolean {
    if (this.credentials === null) {
      return true;
    }
    return Date.now() >= this.credentials.expiresAt - bufferMs;
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
        `Orchestrator credentials: active, subscription: ${state.subscriptionType}`
      );
    } else if (state.status === 'expired') {
      this.logger.warn(
        { message: state.message },
        'Orchestrator credentials: token expired — workers will refresh on use'
      );
    } else {
      this.logger.warn({ message: state.message }, 'Orchestrator credentials: not configured');
    }
  }
}
