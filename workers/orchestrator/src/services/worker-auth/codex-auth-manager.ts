import * as fs from 'node:fs';
import type { Logger } from '@intexuraos/common-core';
import type { WorkerAuthManager, WorkerAuthState } from './types.js';
import type { CodexAuthRefresher } from './codex-auth-refresher.js';

export interface CodexAuthManagerConfig {
  authPath: string;
  reloadIntervalMs: number;
  refresher?: CodexAuthRefresher;
}

interface ParsedChatGptAuth {
  status: 'active' | 'expired';
  expiresAt: string;
  expiresInMinutes: number;
  lastRefreshAt?: string;
}

function buildState(state: WorkerAuthState): WorkerAuthState {
  return state;
}

function parseJwtExpiry(token: string): string | null {
  const segments = token.split('.');
  const payloadSegment = segments[1];
  if (payloadSegment === undefined) {
    return null;
  }

  try {
    const payloadRaw = Buffer.from(payloadSegment, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadRaw) as { exp?: unknown };
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

export class CodexAuthManager implements WorkerAuthManager {
  readonly provider = 'codex' as const;
  private readonly config: CodexAuthManagerConfig;
  private readonly logger: Logger;
  private state: WorkerAuthState = buildState({
    status: 'not_configured',
    authMode: null,
    refreshSupported: false,
    message: 'Codex auth file not found',
  });
  private reloadHandle?: NodeJS.Timeout | undefined;

  constructor(config: CodexAuthManagerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  loadCredentials(): boolean {
    if (!fs.existsSync(this.config.authPath)) {
      this.state = buildState({
        status: 'not_configured',
        authMode: null,
        refreshSupported: false,
        message: 'Codex auth file not found',
      });
      this.logger.warn({ path: this.config.authPath }, 'Codex auth file not found');
      return false;
    }

    try {
      const raw = fs.readFileSync(this.config.authPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const authMode = parsed['auth_mode'];

      if (authMode === 'chatgpt') {
        return this.loadChatGptAuth(parsed);
      }

      if (authMode === 'api_key') {
        this.state = buildState({
          status: 'invalid',
          authMode: null,
          refreshSupported: false,
          message: 'Codex shared auth must use ChatGPT device auth — rerun codex-login.sh',
        });
        this.logger.error(
          { path: this.config.authPath, authMode },
          'Codex auth file uses unsupported api_key auth_mode'
        );
        return false;
      }

      this.state = buildState({
        status: 'invalid',
        authMode: null,
        refreshSupported: false,
        message: `Unsupported Codex auth_mode: ${String(authMode)}`,
      });
      this.logger.error(
        { path: this.config.authPath, authMode },
        'Codex auth file has unsupported auth_mode'
      );
      return false;
    } catch (error) {
      this.state = buildState({
        status: 'invalid',
        authMode: null,
        refreshSupported: false,
        message: 'Failed to parse Codex auth file',
      });
      this.logger.error(
        {
          error: error instanceof Error ? error : new Error(String(error)),
          path: this.config.authPath,
        },
        'Failed to parse Codex auth file'
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

  getState(): WorkerAuthState {
    return this.state;
  }

  isExpiringSoon(bufferMs: number): boolean {
    if (!this.state.refreshSupported) {
      return false;
    }

    if (this.state.status === 'expired') {
      return true;
    }

    if (this.state.status !== 'active' || this.state.expiresAt === undefined) {
      return false;
    }

    return Date.now() >= Date.parse(this.state.expiresAt) - bufferMs;
  }

  async refresh(): Promise<boolean> {
    const before = this.state;
    if (!before.refreshSupported || this.config.refresher === undefined) {
      return false;
    }

    const refreshed = await this.config.refresher.refresh();
    if (!refreshed) {
      this.state = buildState({
        status: 'refresh_failed',
        authMode: before.authMode,
        refreshSupported: before.refreshSupported,
        message: 'Codex auth refresh failed — rerun codex-login.sh',
        ...(before.expiresAt !== undefined ? { expiresAt: before.expiresAt } : {}),
        ...(before.expiresInMinutes !== undefined
          ? { expiresInMinutes: before.expiresInMinutes }
          : {}),
        ...(before.lastRefreshAt !== undefined ? { lastRefreshAt: before.lastRefreshAt } : {}),
      });
      return false;
    }

    const reloaded = this.loadCredentials();
    const after = this.state;

    if (
      !reloaded ||
      after.status !== 'active' ||
      (before.authMode === 'chatgpt' && !this.hasRefreshProgressed(before, after))
    ) {
      this.state = buildState({
        status: 'refresh_failed',
        authMode: before.authMode,
        refreshSupported: before.refreshSupported,
        message: 'Codex auth refresh did not advance the stored auth state — rerun codex-login.sh',
        ...(after.expiresAt !== undefined ? { expiresAt: after.expiresAt } : {}),
        ...(after.expiresInMinutes !== undefined
          ? { expiresInMinutes: after.expiresInMinutes }
          : {}),
        ...(after.lastRefreshAt !== undefined ? { lastRefreshAt: after.lastRefreshAt } : {}),
      });
      return false;
    }

    return true;
  }

  getCurrentAccessToken(): string | null {
    return null;
  }

  private loadChatGptAuth(parsed: Record<string, unknown>): boolean {
    const tokens = parsed['tokens'];
    const accessToken =
      tokens !== null &&
      typeof tokens === 'object' &&
      typeof (tokens as Record<string, unknown>)['access_token'] === 'string'
        ? ((tokens as Record<string, unknown>)['access_token'] as string)
        : null;

    if (accessToken === null) {
      this.state = buildState({
        status: 'invalid',
        authMode: 'chatgpt',
        refreshSupported: true,
        message: 'Codex ChatGPT auth is missing an access token',
      });
      return false;
    }

    const expiresAt = parseJwtExpiry(accessToken);
    if (expiresAt === null) {
      this.state = buildState({
        status: 'invalid',
        authMode: 'chatgpt',
        refreshSupported: true,
        message: 'Codex ChatGPT access token could not be decoded',
      });
      return false;
    }

    const parsedAuth = this.parseChatGptState(expiresAt, parsed['last_refresh']);
    this.state = buildState({
      status: parsedAuth.status,
      authMode: 'chatgpt',
      refreshSupported: true,
      expiresAt: parsedAuth.expiresAt,
      expiresInMinutes: parsedAuth.expiresInMinutes,
      ...(parsedAuth.lastRefreshAt !== undefined
        ? { lastRefreshAt: parsedAuth.lastRefreshAt }
        : {}),
      ...(parsedAuth.status === 'expired' ? { message: 'Codex ChatGPT access token expired' } : {}),
    });
    return true;
  }
  private parseChatGptState(expiresAt: string, lastRefreshRaw: unknown): ParsedChatGptAuth {
    const expiresInMinutes = Math.round((Date.parse(expiresAt) - Date.now()) / 60_000);
    const lastRefreshAt = typeof lastRefreshRaw === 'string' ? lastRefreshRaw : undefined;

    return {
      status: expiresInMinutes < 0 ? 'expired' : 'active',
      expiresAt,
      expiresInMinutes,
      ...(lastRefreshAt !== undefined ? { lastRefreshAt } : {}),
    };
  }

  private hasRefreshProgressed(before: WorkerAuthState, after: WorkerAuthState): boolean {
    if (before.lastRefreshAt === undefined && after.lastRefreshAt !== undefined) {
      return true;
    }

    if (
      before.lastRefreshAt !== undefined &&
      after.lastRefreshAt !== undefined &&
      Date.parse(after.lastRefreshAt) > Date.parse(before.lastRefreshAt)
    ) {
      return true;
    }

    if (
      before.expiresAt !== undefined &&
      after.expiresAt !== undefined &&
      Date.parse(after.expiresAt) > Date.parse(before.expiresAt)
    ) {
      return true;
    }

    return false;
  }
}
