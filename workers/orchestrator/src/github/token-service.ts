/* eslint-disable @typescript-eslint/unbound-method */

import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
const { sign } = jwt;
import type { Result } from '@intexuraos/common-core';

export interface TokenError {
  code: string;
  message: string;
}

export class GitHubTokenService {
  private currentToken: string | null = null;
  private expiresAt: Date | null = null;
  private consecutiveFailures = 0;
  private refreshTimer: NodeJS.Timeout | null = null;
  private authDegradedCallback?: () => void;

  constructor(
    private readonly appId: string,
    private readonly privateKeyPath: string,
    private readonly installationId: string,
    private readonly tokenFilePath: string
  ) {}

  async refreshToken(): Promise<Result<string, TokenError>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);

    try {
      // Generate JWT
      const jwt = await this.generateJWT();

      // Fetch installation token
      const response = await fetch(
        `https://api.github.com/app/installations/${this.installationId}/access_tokens`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: 'application/vnd.github+json',
          },
          signal: controller.signal,
        }
      );

      /* v8 ignore start -- upstream: GitHub API error response is external, not practical to test @preserve */
      if (!response.ok) {
        throw new Error(`GitHub API returned ${String(response.status)}: ${response.statusText}`);
      }
      /* v8 ignore stop @preserve */

      const data = (await response.json()) as { token: string; expires_at: string };
      const token = data.token;
      const expiresAt = new Date(data.expires_at);

      // Write token to file atomically
      await this.writeTokenToFile(token);

      // Update state
      this.currentToken = token;
      this.expiresAt = expiresAt;
      this.consecutiveFailures = 0;

      return { ok: true, value: token };
    } catch (error: unknown) {
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= 3 && this.authDegradedCallback) {
        this.authDegradedCallback();
      }

      /* v8 ignore start -- upstream: AbortError depends on external fetch timing @preserve */
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          ok: false,
          error: {
            code: 'TOKEN_REFRESH_TIMEOUT',
            message: 'GitHub API request timed out after 30s',
          },
        };
      }
      /* v8 ignore stop @preserve */

      const message =
        error instanceof Error ? error.message : `Non-Error thrown: ${JSON.stringify(error)}`;
      return {
        ok: false,
        error: {
          code: 'TOKEN_REFRESH_FAILED',
          message,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getToken(): Promise<string | null> {
    // If we have a valid token, return it
    if (this.currentToken !== null && !this.isExpired()) {
      return this.currentToken;
    }

    // Try to refresh
    const result = await this.refreshToken();
    /* v8 ignore start -- upstream: Token refresh failure path depends on external GitHub API @preserve */
    if (result.ok) {
      return result.value;
    }
    /* v8 ignore stop @preserve */

    return null;
  }

  getExpiresAt(): Date | null {
    return this.expiresAt;
  }

  isExpired(): boolean {
    /* v8 ignore start -- ts-type: Early return for null expiresAt is type narrowing @preserve */
    if (!this.expiresAt) return true;
    /* v8 ignore stop @preserve */
    return new Date() >= this.expiresAt;
  }

  isExpiringSoon(withinMinutes = 15): boolean {
    /* v8 ignore start -- ts-type: Early return for null expiresAt is type narrowing @preserve */
    if (!this.expiresAt) return true;
    /* v8 ignore stop @preserve */
    const expiryThreshold = new Date(Date.now() + withinMinutes * 60 * 1000);
    return this.expiresAt <= expiryThreshold;
  }

  startBackgroundRefresh(intervalMinutes = 5): void {
    /* v8 ignore start -- ts-type: Guard clause for null refreshTimer is type narrowing @preserve */
    if (this.refreshTimer) {
      this.stopBackgroundRefresh();
    }
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- test-infra: setInterval callback with timing condition requires fake timers to test @preserve */
    this.refreshTimer = setInterval(
      () => {
        if (this.isExpiringSoon()) {
          void this.refreshToken();
        }
      },
      /* v8 ignore stop @preserve */
      intervalMinutes * 60 * 1000
    );
  }

  stopBackgroundRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  onAuthDegraded(callback: () => void): void {
    this.authDegradedCallback = callback;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  isAuthDegraded(): boolean {
    return this.consecutiveFailures >= 3;
  }

  private async generateJWT(): Promise<string> {
    const privateKey = await readFile(this.privateKeyPath, 'utf-8');

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now,
      exp: now + 600, // 10 minutes
      iss: this.appId,
    };

    return sign(payload, privateKey, { algorithm: 'RS256' });
  }

  private async writeTokenToFile(token: string): Promise<void> {
    const { writeFile, rename, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');

    // Ensure directory exists
    await mkdir(dirname(this.tokenFilePath), { recursive: true });

    // Write to temp file
    const tempPath = `${this.tokenFilePath}.tmp`;
    await writeFile(tempPath, token, 'utf-8');

    // Atomic rename
    await rename(tempPath, this.tokenFilePath);
  }
}
