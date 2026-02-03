import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Logger } from '@intexuraos/common-core';

export interface TokenRefresherConfig {
  secretsBasePath: string;
  githubAppId: string;
  githubAppPrivateKeyPath: string;
  githubInstallationId: string;
  refreshIntervalMs: number;
}

export class TokenRefresher {
  private readonly config: TokenRefresherConfig;
  private readonly logger: Logger;
  private readonly activeTaskIds: Set<string>;
  private intervalHandle?: NodeJS.Timeout | undefined;

  constructor(config: TokenRefresherConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.activeTaskIds = new Set();
  }

  /**
   * Start refreshing tokens for a task.
   */
  async registerTask(taskId: string): Promise<void> {
    this.activeTaskIds.add(taskId);
    await this.refreshTokenForTask(taskId);

    // Start refresh loop if not running
    this.intervalHandle ??= setInterval(
      () => void this.refreshAllTokens(),
      this.config.refreshIntervalMs
    );
  }

  /**
   * Stop refreshing tokens for a task.
   */
  unregisterTask(taskId: string): void {
    this.activeTaskIds.delete(taskId);

    // Stop refresh loop if no active tasks
    if (this.activeTaskIds.size === 0 && this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Stop the refresh loop entirely.
   */
  stop(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.activeTaskIds.clear();
  }

  /**
   * Mint a new GitHub installation token.
   */
  private async mintGitHubToken(): Promise<string> {
    const jwt = await this.createGitHubAppJWT();

    const response = await fetch(
      `https://api.github.com/app/installations/${this.config.githubInstallationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub token mint failed: ${String(response.status)}`);
    }

    const data = (await response.json()) as { token: string };
    return data.token;
  }

  private async createGitHubAppJWT(): Promise<string> {
    const privateKeyPem = await fs.promises.readFile(this.config.githubAppPrivateKeyPath, 'utf-8');

    // JWT creation with RS256 using jose library
    const { SignJWT } = await import('jose');
    const privateKey = crypto.createPrivateKey(privateKeyPem);

    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.config.githubAppId)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    return jwt;
  }

  private async refreshTokenForTask(taskId: string): Promise<void> {
    const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
    const tokenPath = path.join(taskSecretsPath, 'github-token');

    try {
      const token = await this.mintGitHubToken();
      await fs.promises.writeFile(tokenPath, token, { mode: 0o600 });
      this.logger.info({ taskId }, 'GitHub token refreshed');
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to refresh GitHub token');
    }
  }

  private async refreshAllTokens(): Promise<void> {
    for (const taskId of this.activeTaskIds) {
      await this.refreshTokenForTask(taskId);
    }
  }
}
