import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Logger } from '@intexuraos/common-core';

const defaultExecFileAsync = promisify(execFile);

/**
 * Argv-form spawn helper signature. Untrusted inputs (branch names, paths)
 * are passed as literal argv elements, never re-parsed by `/bin/sh`.
 */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number }
) => Promise<{ stdout: string; stderr: string }>;

const SAFE_GIT_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export interface WorktreeManagerConfig {
  repositoryPath: string;
  worktreeBasePath: string;
  settingsLocalTemplatePath?: string;
}

const LOCK_TIMEOUT_MS = 10_000;

function assertSafeBranchName(branch: string, branchLabel: string): void {
  if (!SAFE_GIT_BRANCH_PATTERN.test(branch)) {
    throw new Error(`Invalid ${branchLabel} branch name: ${branch}`);
  }
}

export class WorktreeManager {
  private gitLock: Promise<void> = Promise.resolve();
  private readonly execFileFn: ExecFileFn;

  constructor(
    private readonly config: WorktreeManagerConfig,
    private readonly logger: Logger,
    execFileFn?: ExecFileFn
  ) {
    // TODO(INT-1483 follow-up): drop the `as unknown as` once a typed wrapper
    // around `promisify(execFile)` lands. The cast is necessary today because
    // node's `promisify` overload set is wider than our argv-only `ExecFileFn`
    // contract; introducing a thin typed adapter is the right fix but is out
    // of scope for the shell-injection hardening change.
    this.execFileFn = execFileFn ?? (defaultExecFileAsync as unknown as ExecFileFn);
  }

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
          await this.execFileFn('git', ['fetch', 'origin', baseBranch, '--force'], {
            cwd: this.config.repositoryPath,
          });
          // Sync local branch ref so agents that run `git checkout -b <branch> development`
          // pick up the latest commit instead of a stale local ref
          await this.execFileFn('git', ['branch', '-f', baseBranch, `origin/${baseBranch}`], {
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
        let useContinuation = false;
        if (continuationPrBranch !== undefined) {
          try {
            await this.execFileFn('git', ['fetch', 'origin', continuationPrBranch], {
              cwd: this.config.repositoryPath,
            });
            useContinuation = true;
          } catch (fetchError: unknown) {
            // PR merged + branch auto-deleted between submission and dispatch:
            // fall back to base branch instead of failing the task. Network/auth
            // failures still re-throw so the dispatcher can retry.
            const message = fetchError instanceof Error ? fetchError.message : 'Unknown error';
            if (!message.includes("couldn't find remote ref")) {
              throw fetchError;
            }
            this.logger.warn(
              { taskId, continuationPrBranch, baseBranch },
              'Continuation PR branch no longer exists on origin (likely merged + deleted) — falling back to base branch'
            );
          }
        }

        const addArgs: readonly string[] =
          useContinuation && continuationPrBranch !== undefined
            ? ['worktree', 'add', '-B', taskId, worktreePath, `origin/${continuationPrBranch}`]
            : ['worktree', 'add', '-b', taskId, worktreePath, `origin/${baseBranch}`];
        const { stderr } = await this.execFileFn('git', addArgs, {
          cwd: this.config.repositoryPath,
        });

        // git worktree add outputs to stderr even on success
        if (stderr && !stderr.includes('Preparing worktree')) {
          throw new Error(`Failed to create worktree: ${stderr}`);
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
        const { stderr } = await this.execFileFn(
          'git',
          ['worktree', 'remove', worktreePath, '--force'],
          { cwd: this.config.repositoryPath }
        );

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
      const { stdout } = await this.execFileFn('git', ['worktree', 'list', '--porcelain'], {
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

  /**
   * Check if the worktree for a given taskId is registered in the main repo's
   * worktree metadata (`<repo>/.git/worktrees/<name>/`).
   *
   * Returns true when `git worktree list --porcelain` includes the expected
   * worktree path. Returns false when the metadata directory is missing, which
   * happens if the orchestrator restarts and something (git maintenance,
   * external cleanup, systemd tmpfs) drops the `.git/worktrees/<taskId>/`
   * directory while the worktree itself at `<base>/<taskId>/` survives.
   *
   * Design reference: INT-1454.
   */
  async isWorktreeRegistered(taskId: string): Promise<boolean> {
    const worktreePath = join(this.config.worktreeBasePath, taskId);
    try {
      const { stdout } = await this.execFileFn('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.config.repositoryPath,
      });
      // Strict equality (not startsWith) so a sibling path like
      // `${worktreePath}-sibling` cannot false-positive as the same entry.
      // Trim trailing whitespace defensively in case git ever emits any.
      for (const line of stdout.split('\n')) {
        if (line.trimEnd() === `worktree ${worktreePath}`) {
          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.error(
        { taskId, error },
        'Failed to query git worktree list while checking registration'
      );
      return false;
    }
  }

  /**
   * Repair a worktree whose on-disk path exists but whose metadata in
   * `<repo>/.git/worktrees/<name>/` is missing. Delegates to
   * `git worktree repair <path>`, which regenerates the metadata from the
   * worktree's `.git` file (canonical git recovery for this situation).
   *
   * Throws if the worktree path does not exist on disk (nothing to repair —
   * the task's work is genuinely lost) or if `git worktree repair` fails.
   *
   * Design reference: INT-1454.
   */
  async repairWorktree(taskId: string): Promise<void> {
    await this.withGitLock(async () => {
      const worktreePath = join(this.config.worktreeBasePath, taskId);

      if (!existsSync(worktreePath)) {
        throw new Error(
          `Cannot repair worktree for task ${taskId}: path ${worktreePath} does not exist on disk`
        );
      }

      this.logger.info(
        { taskId, worktreePath },
        'Worktree metadata missing on adoption, repairing'
      );

      try {
        const { stderr } = await this.execFileFn('git', ['worktree', 'repair', worktreePath], {
          cwd: this.config.repositoryPath,
        });
        // `git worktree repair` prints advisory messages to stderr on success
        // (e.g. "repair: ..."); treat non-empty stderr as informational unless
        // it contains a fatal marker.
        if (stderr.includes('fatal:')) {
          throw new Error(`git worktree repair reported fatal error: ${stderr.trim()}`);
        }
        this.logger.info({ taskId, worktreePath }, 'Worktree metadata repaired successfully');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to repair worktree for task ${taskId}: ${message}`);
      }

      // Diagnostic: log the post-repair HEAD state. `git worktree repair`
      // regenerates the metadata from the worktree's `.git` file, but if
      // the local branch ref was also lost, the worktree ends up
      // HEAD-detached and subsequent commits/pushes by the agent fail
      // silently. Surface the state so these cases are visible in logs.
      try {
        const { stdout } = await this.execFileFn(
          'git',
          ['-C', worktreePath, 'symbolic-ref', '--quiet', 'HEAD'],
          { cwd: this.config.repositoryPath }
        );
        const branchRef = stdout.trim();
        this.logger.info(
          { taskId, worktreePath, branchRef },
          'Post-repair HEAD state (attached branch)'
        );
      } catch {
        // symbolic-ref exits non-zero on detached HEAD — this is informational.
        this.logger.warn(
          { taskId, worktreePath },
          'Post-repair worktree is HEAD-detached; commits from the agent may fail until a branch is checked out'
        );
      }
    });
  }

  private async copySettingsLocal(worktreePath: string): Promise<void> {
    const targetPath = join(worktreePath, '.claude', 'settings.local.json');

    try {
      const content = await readFile(this.config.settingsLocalTemplatePath as string, 'utf-8');
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to copy settings.local.json: ${message}`);
    }
  }
}
