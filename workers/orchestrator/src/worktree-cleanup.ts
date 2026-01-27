import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execAsync = promisify(exec);

export interface WorktreeCleanupConfig {
  repositoryPath: string;
  worktreeBasePath: string;
  /**
   * Age threshold in hours after which a worktree is considered stale.
   * Default: 24 hours
   */
  staleAgeHours?: number;
}

export interface CleanupResult {
  total: number;
  removed: number;
  errors: { path: string; error: string }[];
}

/**
 * Cleans up stale git worktrees that are no longer needed.
 * A worktree is considered stale if it's older than the threshold age.
 *
 * Design reference: INT-373
 */
export async function cleanupStaleWorktrees(
  config: WorktreeCleanupConfig,
  logger: Logger
): Promise<CleanupResult> {
  const result: CleanupResult = {
    total: 0,
    removed: 0,
    errors: [],
  };

  const staleAgeMs = (config.staleAgeHours ?? 24) * 60 * 60 * 1000;
  const now = Date.now();

  logger.info(
    { worktreeBasePath: config.worktreeBasePath, staleAgeHours: config.staleAgeHours },
    'Starting worktree cleanup'
  );

  // Check if worktree base path exists
  if (!existsSync(config.worktreeBasePath)) {
    logger.info(
      { worktreeBasePath: config.worktreeBasePath },
      'Worktree base path does not exist, nothing to clean'
    );
    return result;
  }

  let worktreeDirs: string[] = [];

  try {
    worktreeDirs = await readdir(config.worktreeBasePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: message, worktreeBasePath: config.worktreeBasePath },
      'Failed to read worktree base path'
    );
    return result;
  }

  result.total = worktreeDirs.length;

  if (worktreeDirs.length === 0) {
    logger.info('No worktrees to check');
    return result;
  }

  logger.info({ count: worktreeDirs.length }, 'Checking worktrees for staleness');

  for (const dirName of worktreeDirs) {
    const worktreePath = join(config.worktreeBasePath, dirName);

    try {
      // Get the modification time of the worktree directory
      const stats = await stat(worktreePath);
      const age = now - stats.mtime.getTime();

      if (age < staleAgeMs) {
        logger.debug(
          { worktree: dirName, ageHours: age / (60 * 60 * 1000) },
          'Worktree is still fresh'
        );
        continue;
      }

      logger.info(
        { worktree: dirName, ageHours: age / (60 * 60 * 1000) },
        'Removing stale worktree'
      );

      // Remove worktree using git worktree remove
      const { stderr } = await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: config.repositoryPath,
      });

      if (stderr && !stderr.includes('not a valid worktree')) {
        // Git worktree remove may fail for corrupted worktrees, try manual removal
        logger.warn(
          { worktree: dirName, stderr },
          'Git worktree remove failed, attempting manual removal'
        );
        await execAsync(`rm -rf "${worktreePath}"`);
      }

      result.removed++;
      logger.info({ worktree: dirName }, 'Successfully removed stale worktree');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ worktree: dirName, error: message }, 'Failed to remove worktree');
      result.errors.push({ path: worktreePath, error: message });
    }
  }

  logger.info(
    {
      total: result.total,
      removed: result.removed,
      errors: result.errors.length,
    },
    'Worktree cleanup completed'
  );

  return result;
}
