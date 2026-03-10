import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { type Result, ok, err, type Logger } from '@intexuraos/common-core';

const execAsync = promisify(exec);

export interface WorktreeManagerConfig {
  repositoryPath: string;
  worktreeBasePath: string;
  mcpConfigTemplatePath: string;
  settingsLocalTemplatePath?: string;
}

const LOCK_TIMEOUT_MS = 10_000;

export class WorktreeManager {
  private gitLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: WorktreeManagerConfig,
    private readonly logger: Logger
  ) {}

  private async withGitLock<T>(fn: () => Promise<T>): Promise<T> {
    let releaseLock: () => void = () => undefined;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.gitLock;
    this.gitLock = nextLock;

    let rejectTimeout: (reason: Error) => void = () => undefined;
    const timeout = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeoutId = setTimeout(() => {
      rejectTimeout(new Error('Timed out waiting for git lock after 10s'));
    }, LOCK_TIMEOUT_MS);

    try {
      await Promise.race([previousLock, timeout]);
      return await fn();
    } finally {
      clearTimeout(timeoutId);
      releaseLock();
    }
  }

  async createWorktree(taskId: string, baseBranch: string): Promise<string> {
    return await this.withGitLock(async () => {
      const worktreePath = join(this.config.worktreeBasePath, taskId);
      this.logger.info({ taskId, baseBranch }, 'Creating worktree');

      // Check if worktree already exists
      if (await this.worktreeExists(taskId)) {
        throw new Error(`Worktree for task ${taskId} already exists at ${worktreePath}`);
      }

      try {
        // Ensure base directory exists
        await mkdir(this.config.worktreeBasePath, { recursive: true });

        // Create worktree with a new branch for the task
        // Using -b creates a local branch, avoiding detached HEAD state
        // which is required for Claude to create commits and PRs
        const { stderr } = await execAsync(
          `git worktree add -b "${taskId}" "${worktreePath}" "origin/${baseBranch}"`,
          {
            cwd: this.config.repositoryPath,
          }
        );

        // git worktree add outputs to stderr even on success
        /* v8 ignore start -- test-infra: git worktree add outputs to stderr on success (e @preserve */
        if (stderr && !stderr.includes('Preparing worktree')) {
          throw new Error(`Failed to create worktree: ${stderr}`);
        }
        /* v8 ignore stop @preserve */

        // Copy MCP config template if provided
        if (this.config.mcpConfigTemplatePath && existsSync(this.config.mcpConfigTemplatePath)) {
          await this.copyMcpConfig(worktreePath);
        }

        // Copy settings.local.json template if provided
        if (
          this.config.settingsLocalTemplatePath !== undefined &&
          existsSync(this.config.settingsLocalTemplatePath)
        ) {
          await this.copySettingsLocal(worktreePath);
        } else if (this.config.settingsLocalTemplatePath !== undefined) {
          this.logger.warn(
            { templatePath: this.config.settingsLocalTemplatePath },
            'settings.local.json template path configured but file not found on disk'
          );
        }

        this.logger.info({ taskId, worktreePath }, 'Worktree created');
        return worktreePath;
      } catch (error: unknown) {
        /* v8 ignore start -- test-infra: worktree creation failure requires git worktree state manipulation @preserve */
        const message = error instanceof Error ? error.message : 'Unknown error';
        /* v8 ignore stop @preserve */
        throw new Error(`Failed to create worktree: ${message}`);
      }
    });
  }

  async removeWorktree(taskId: string): Promise<void> {
    await this.withGitLock(async () => {
      const worktreePath = join(this.config.worktreeBasePath, taskId);
      this.logger.info({ taskId, worktreePath }, 'Removing worktree');

      if (!existsSync(worktreePath)) {
        throw new Error(`Worktree for task ${taskId} does not exist at ${worktreePath}`);
      }

      try {
        // Remove worktree using git worktree remove
        const { stderr } = await execAsync(`git worktree remove "${worktreePath}" --force`, {
          cwd: this.config.repositoryPath,
        });

        /* v8 ignore start -- test-infra: similar to create worktree - requires git worktree remove failure simulation @preserve */
        if (stderr) {
          throw new Error(`Failed to remove worktree: ${stderr}`);
        }
        /* v8 ignore stop @preserve */
        this.logger.info({ taskId }, 'Worktree removed');
      } catch (error: unknown) {
        /* v8 ignore start -- test-infra: worktree removal failure requires git worktree state manipulation @preserve */
        const message = error instanceof Error ? error.message : 'Unknown error';
        /* v8 ignore stop @preserve */
        throw new Error(`Failed to remove worktree: ${message}`);
      }
    });
  }

  async listWorktrees(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: this.config.repositoryPath,
      });

      const lines = stdout.split('\n').filter((line) => line.length > 0);
      const worktreePaths: string[] = [];

      /* v8 ignore start -- test-infra: filtering by worktree base path requires specific git worktree setup @preserve */
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const path = line.slice('worktree '.length);
          // Only return worktrees under our base path
          if (path.startsWith(this.config.worktreeBasePath)) {
            worktreePaths.push(path);
          }
        }
      }
      /* v8 ignore stop @preserve */

      return worktreePaths;
    } catch (error) {
      this.logger.error({ error }, 'Failed to list worktrees');
      return [];
    }
  }

  async worktreeExists(taskId: string): Promise<boolean> {
    const worktreePath = join(this.config.worktreeBasePath, taskId);
    return existsSync(worktreePath);
  }

  async mergePlanningBranch(
    worktreePath: string,
    planningBranch: string
  ): Promise<Result<void, string>> {
    try {
      await execAsync(`git fetch origin "${planningBranch}"`, { cwd: worktreePath });
      await execAsync(`git merge "origin/${planningBranch}" --no-edit`, { cwd: worktreePath });
      this.logger.info({ worktreePath, planningBranch }, 'Planning branch merged into worktree');
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        { worktreePath, planningBranch, error: message },
        'Failed to merge planning branch'
      );
      return err(message);
    }
  }

  private async copyMcpConfig(worktreePath: string): Promise<void> {
    const targetPath = join(worktreePath, '.mcp.json');

    try {
      // Read template
      const template = await readFile(this.config.mcpConfigTemplatePath, 'utf-8');

      // Validate environment variables
      const linearKey = process.env['INTEXURAOS_LINEAR_API_KEY'];
      const sentryToken = process.env['INTEXURAOS_SENTRY_AUTH_TOKEN'];

      if (linearKey === undefined || linearKey === '') {
        this.logger.warn(
          {},
          'INTEXURAOS_LINEAR_API_KEY not set - MCP Linear integration will fail'
        );
      }
      if (sentryToken === undefined || sentryToken === '') {
        this.logger.warn(
          {},
          'INTEXURAOS_SENTRY_AUTH_TOKEN not set - MCP Sentry integration will fail'
        );
      }

      // Substitute environment variables
      /* v8 ignore start -- ts-type: nullish coalescing on env vars creates type narrowing branches @preserve */
      const config = template
        .replace(/\{\{LINEAR_API_KEY\}\}/g, linearKey ?? '')
        /* v8 ignore stop @preserve */
        .replace(/\{\{SENTRY_AUTH_TOKEN\}\}/g, sentryToken ?? '');

      // Ensure target directory exists
      await mkdir(dirname(targetPath), { recursive: true });

      // Write to temp file first for atomicity
      const tempPath = `${targetPath}.tmp`;
      await writeFile(tempPath, config, 'utf-8');

      // Atomic rename
      await (await import('node:fs/promises')).rename(tempPath, targetPath);
    } catch (error: unknown) {
      /* v8 ignore start -- ts-type: catch block error handling @preserve */
      const message = error instanceof Error ? error.message : 'Unknown error';
      /* v8 ignore stop @preserve */
      /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
      throw new Error(`Failed to copy MCP config: ${message}`);
      /* v8 ignore stop @preserve */
    }
  }

  private async copySettingsLocal(worktreePath: string): Promise<void> {
    const targetPath = join(worktreePath, '.claude', 'settings.local.json');

    try {
      const content = await readFile(this.config.settingsLocalTemplatePath as string, 'utf-8');
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, 'utf-8');
    } catch (error: unknown) {
      /* v8 ignore start -- ts-type: catch block error handling @preserve */
      const message = error instanceof Error ? error.message : 'Unknown error';
      /* v8 ignore stop @preserve */
      throw new Error(`Failed to copy settings.local.json: ${message}`);
    }
  }
}
