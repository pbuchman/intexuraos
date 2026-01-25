/* eslint-disable @typescript-eslint/unbound-method */

import { readFile } from 'node:fs/promises';
import { sign } from 'jsonwebtoken';
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
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API returned ${String(response.status)}: ${response.statusText}`);
      }

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

      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        ok: false,
        error: {
          code: 'TOKEN_REFRESH_FAILED',
          message,
        },
      };
    }
  }

  async getToken(): Promise<string | null> {
    // If we have a valid token, return it
    if (this.currentToken !== null && !this.isExpired()) {
      return this.currentToken;
    }

    // Try to refresh
    const result = await this.refreshToken();
    if (result.ok) {
      return result.value;
    }

    return null;
  }

  getExpiresAt(): Date | null {
    return this.expiresAt;
  }

  isExpired(): boolean {
    if (!this.expiresAt) return true;
    return new Date() >= this.expiresAt;
  }

  isExpiringSoon(withinMinutes = 15): boolean {
    if (!this.expiresAt) return true;
    const expiryThreshold = new Date(Date.now() + withinMinutes * 60 * 1000);
    return this.expiresAt <= expiryThreshold;
  }

  startBackgroundRefresh(intervalMinutes = 5): void {
    if (this.refreshTimer) {
      this.stopBackgroundRefresh();
    }

    this.refreshTimer = setInterval(
      () => {
        if (this.isExpiringSoon()) {
          void this.refreshToken();
        }
      },
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
