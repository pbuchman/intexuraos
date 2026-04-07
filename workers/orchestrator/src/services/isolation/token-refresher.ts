import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Logger } from '@intexuraos/common-core';
import { createRetryOctokit } from '../../github/octokit-client.js';

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

    try {
      const octokit = createRetryOctokit(jwt);
      const { data } = await octokit.request(
        'POST /app/installations/{installation_id}/access_tokens',
        { installation_id: Number(this.config.githubInstallationId) }
      );
      return data.token;
    } catch (error) {
      const cause =
        error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
      this.logger.error(
        {
          errorMessage: error instanceof Error ? error.message : String(error),
          causeMessage: cause?.message,
          causeCode: (cause as NodeJS.ErrnoException | undefined)?.code,
          causeSyscall: (cause as NodeJS.ErrnoException | undefined)?.syscall,
          status: (error as { status?: number }).status,
        },
        'GitHub token mint failed after retries'
      );
      throw error;
    }
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

    await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });
    const token = await this.mintGitHubToken();
    await fs.promises.writeFile(tokenPath, token, { mode: 0o600 });
    this.logger.info({ taskId }, 'GitHub token refreshed');
  }

  private async refreshAllTokens(): Promise<void> {
    for (const taskId of this.activeTaskIds) {
      try {
        await this.refreshTokenForTask(taskId);
      } catch (error) {
        this.logger.error({ taskId, error }, 'Failed to refresh GitHub token');
      }
    }
  }
}
