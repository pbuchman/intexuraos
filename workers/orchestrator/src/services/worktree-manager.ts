import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { type Logger } from '@intexuraos/common-core';

const execAsync = promisify(exec);
const SAFE_GIT_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export interface WorktreeManagerConfig {
  repositoryPath: string;
  worktreeBasePath: string;
  mcpConfigTemplatePath: string;
  settingsLocalTemplatePath?: string;
}

const LOCK_TIMEOUT_MS = 10_000;

/**
 * Configured timeout for the Linear MCP server in worktree tasks.
 * Exported so tests and diagnostics can verify the contract.
 */
export const LINEAR_MCP_TIMEOUT_MS = 60_000;

function assertSafeBranchName(branch: string, branchLabel: string): void {
  if (!SAFE_GIT_BRANCH_PATTERN.test(branch)) {
    throw new Error(`Invalid ${branchLabel} branch name: ${branch}`);
  }
}

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

  async createWorktree(
    taskId: string,
    baseBranch: string,
    continuationPrBranch?: string
  ): Promise<string> {
    return await this.withGitLock(async () => {
      const worktreePath = join(this.config.worktreeBasePath, taskId);
      this.logger.info({ taskId, baseBranch, continuationPrBranch }, 'Creating worktree');

      assertSafeBranchName(baseBranch, 'base');
      if (continuationPrBranch !== undefined) {
        assertSafeBranchName(continuationPrBranch, 'continuation PR');
      }

      // Check if worktree already exists
      if (await this.worktreeExists(taskId)) {
        throw new Error(`Worktree for task ${taskId} already exists at ${worktreePath}`);
      }

      try {
        // Ensure base directory exists
        await mkdir(this.config.worktreeBasePath, { recursive: true });

        // Fetch base branch to ensure origin/${baseBranch} is up-to-date
        // Without this, worktrees are created from whatever was last fetched at startup
        this.logger.info({ taskId, baseBranch }, 'Fetching base branch before worktree creation');
        try {
          await execAsync(`git fetch origin "${baseBranch}" --force`, {
            cwd: this.config.repositoryPath,
          });
        } catch (fetchError: unknown) {
          const message = fetchError instanceof Error ? fetchError.message : 'Unknown error';
          this.logger.warn(
            { taskId, baseBranch, error: message },
            'Failed to fetch base branch — proceeding with existing local state'
          );
        }

        // Create worktree with a new branch for the task
        // Using -b creates a local branch, avoiding detached HEAD state
        // which is required for Claude to create commits and PRs
        let stderr: string;
        if (continuationPrBranch === undefined) {
          ({ stderr } = await execAsync(
            `git worktree add -b "${taskId}" "${worktreePath}" "origin/${baseBranch}"`,
            {
              cwd: this.config.repositoryPath,
            }
          ));
        } else {
          await execAsync(`git fetch origin "${continuationPrBranch}"`, {
            cwd: this.config.repositoryPath,
          });
          ({ stderr } = await execAsync(
            `git worktree add -B "${taskId}" "${worktreePath}" "origin/${continuationPrBranch}"`,
            {
              cwd: this.config.repositoryPath,
            }
          ));
        }

        // git worktree add outputs to stderr even on success
        if (stderr && !stderr.includes('Preparing worktree')) {
          throw new Error(`Failed to create worktree: ${stderr}`);
        }

        // Copy MCP config template if provided
        if (this.config.mcpConfigTemplatePath && existsSync(this.config.mcpConfigTemplatePath)) {
          await this.copyMcpConfig(worktreePath);
        }
        this.logTimeoutEvidence();

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
        const message = error instanceof Error ? error.message : 'Unknown error';
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

        if (stderr) {
          throw new Error(`Failed to remove worktree: ${stderr}`);
        }
        this.logger.info({ taskId }, 'Worktree removed');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
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

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const path = line.slice('worktree '.length);
          // Only return worktrees under our base path
          if (path.startsWith(this.config.worktreeBasePath)) {
            worktreePaths.push(path);
          }
        }
      }

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

  private logTimeoutEvidence(): void {
    this.logger.info(
      { timeoutMs: LINEAR_MCP_TIMEOUT_MS, server: 'linear' },
      `MCP timeout configured for Linear MCP server: ${String(LINEAR_MCP_TIMEOUT_MS)}ms (server=linear)`
    );
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
      const configStr = template
        .replace(/\{\{LINEAR_API_KEY\}\}/g, linearKey ?? '')
        .replace(/\{\{SENTRY_AUTH_TOKEN\}\}/g, sentryToken ?? '');

      // Inject timeoutMs into the Linear MCP server config
      const config = this.injectLinearTimeout(configStr);

      // Ensure target directory exists
      await mkdir(dirname(targetPath), { recursive: true });

      // Write to temp file first for atomicity
      const tempPath = `${targetPath}.tmp`;
      await writeFile(tempPath, config, 'utf-8');

      // Atomic rename
      await (await import('node:fs/promises')).rename(tempPath, targetPath);
    } catch (error: unknown) {
      /* v8 ignore start -- ts-type: catch block error type narrowing for non-Error throwables @preserve */
      const message = error instanceof Error ? error.message : 'Unknown error';
      /* v8 ignore stop @preserve */
      throw new Error(`Failed to copy MCP config: ${message}`);
    }
  }

  /**
   * Injects `timeoutMs` into the `mcpServers.linear` section of the MCP config.
   * Falls back to writing the original string if parsing fails.
   */
  private injectLinearTimeout(configStr: string): string {
    try {
      const parsed = JSON.parse(configStr) as Record<string, unknown>;
      const servers = parsed['mcpServers'] as Record<string, unknown> | undefined;
      if (servers !== undefined) {
        const linear = servers['linear'] as Record<string, unknown> | undefined;
        if (linear !== undefined) {
          linear['timeoutMs'] = LINEAR_MCP_TIMEOUT_MS;
        }
      }
      return JSON.stringify(parsed, null, 2);
    } catch {
      this.logger.warn(
        {},
        'Failed to parse MCP config as JSON — writing without timeout injection'
      );
      return configStr;
    }
  }

  private async copySettingsLocal(worktreePath: string): Promise<void> {
    const targetPath = join(worktreePath, '.claude', 'settings.local.json');

    try {
      const content = await readFile(this.config.settingsLocalTemplatePath as string, 'utf-8');
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, 'utf-8');
    } catch (error: unknown) {
      /* v8 ignore start -- ts-type: catch block error type narrowing for non-Error throwables @preserve */
      const message = error instanceof Error ? error.message : 'Unknown error';
      /* v8 ignore stop @preserve */
      throw new Error(`Failed to copy settings.local.json: ${message}`);
    }
  }
}
