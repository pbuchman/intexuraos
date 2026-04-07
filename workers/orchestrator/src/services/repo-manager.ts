import { existsSync, statSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from '@intexuraos/common-core';

const execFileAsync = promisify(execFile);

/**
 * Normalize a Git repository URL for comparison.
 * Handles:
 * - Trailing .git suffix
 * - SSH (git@github.com:user/repo) vs HTTPS (https://github.com/user/repo)
 * - Case-insensitive comparison
 */
export function normalizeUrl(url: string): string {
  const httpsUrl = url.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  try {
    const parsed = new URL(httpsUrl);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().toLowerCase();
  } catch {
    return httpsUrl.toLowerCase();
  }
}

/**
 * Compare two Git URLs to see if they point to the same repository.
 */
export function urlsMatch(actual: string, expected: string): boolean {
  return normalizeUrl(actual) === normalizeUrl(expected);
}

/**
 * Validate that a directory is the correct IntexuraOS repository.
 *
 * Checks:
 * 1. Directory has a .git folder (not a file, which would indicate a worktree)
 * 2. Remote origin matches the expected URL
 * 3. (Optional) package.json name matches 'intexuraos'
 */
export async function validateRepository(
  path: string,
  expectedUrl: string,
  logger: Logger
): Promise<void> {
  const gitPath = join(path, '.git');

  // Check .git exists
  if (!existsSync(gitPath)) {
    throw new Error(`REPOSITORY_PATH ${path} is not a git repository`);
  }

  // Check .git is a directory (not a file - worktrees have .git as a file)
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(gitPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to stat .git directory at ${gitPath}: ${message}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`REPOSITORY_PATH ${path} appears to be a worktree, not a main clone`);
  }

  // Verify remote origin matches expected URL
  logger.info({ path }, 'Verifying repository remote origin');
  let actualUrl: string;
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: path });
    actualUrl = stdout.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Failed to get remote origin URL for repository at ${path}: ${message}\n` +
        `Ensure the repository has an 'origin' remote configured.`
    );
  }

  if (!urlsMatch(actualUrl, expectedUrl)) {
    throw new Error(
      `REPOSITORY_PATH ${path} has wrong remote origin.\n` +
        `Expected: ${expectedUrl}\n` +
        `Actual: ${actualUrl}\n` +
        `This may be a different repository. Please verify or use a different path.`
    );
  }

  // Optional: Verify package.json name
  const packageJsonPath = join(path, 'package.json');
  if (existsSync(packageJsonPath)) {
    let pkg: { name?: string };
    try {
      const content = readFileSync(packageJsonPath, 'utf-8');
      pkg = JSON.parse(content) as { name?: string };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to read or parse package.json at ${packageJsonPath}: ${message}`);
    }
    if (pkg.name !== 'intexuraos') {
      throw new Error(
        `REPOSITORY_PATH ${path} does not appear to be IntexuraOS (package.json name mismatch)`
      );
    }
  }

  logger.info({ path }, 'Repository validation passed');
}

/**
 * Clone a repository to a specified path.
 */
export async function cloneRepository(url: string, path: string, logger: Logger): Promise<void> {
  logger.info({ url, path }, 'Cloning repository');

  // Ensure parent directory exists
  const parentDir = dirname(path);
  if (!existsSync(parentDir)) {
    try {
      mkdirSync(parentDir, { recursive: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to create parent directory ${parentDir} for repository clone: ${message}`
      );
    }
  }

  try {
    await execFileAsync('git', ['clone', url, path]);
    logger.info({ path }, 'Repository cloned successfully');
  } catch (error: unknown) {
    const execError = error as { message?: string; stderr?: string; code?: number };
    logger.error(
      {
        error,
        stderr: execError.stderr,
        exitCode: execError.code,
        url,
        path,
      },
      'Failed to clone repository'
    );
    const message = execError.message ?? 'Unknown error';
    const stderrInfo = execError.stderr ? `\nGit output: ${execError.stderr.trim()}` : '';
    throw new Error(`Failed to clone repository: ${message}${stderrInfo}`);
  }
}

/**
 * Fetch latest changes from remote origin.
 */
export async function fetchRemote(path: string, logger: Logger): Promise<void> {
  logger.info({ path }, 'Fetching latest from remote');

  try {
    await execFileAsync('git', ['fetch', 'origin'], { cwd: path });
    logger.info({ path }, 'Fetch completed successfully');
  } catch (error: unknown) {
    const execError = error as { message?: string; stderr?: string; code?: number };
    logger.error(
      {
        error,
        stderr: execError.stderr,
        exitCode: execError.code,
        path,
      },
      'Failed to fetch from remote'
    );
    const message = execError.message ?? 'Unknown error';
    const stderrInfo = execError.stderr ? `\nGit output: ${execError.stderr.trim()}` : '';
    throw new Error(`Failed to fetch from remote: ${message}${stderrInfo}`);
  }
}

/**
 * Reset repository to a clean state by discarding all local changes.
 * Runs: git reset --hard origin/development && git clean -df
 */
export async function cleanWorktree(path: string, logger: Logger): Promise<void> {
  logger.info({ path }, 'Cleaning worktree: git reset --hard origin/development && git clean -df');

  try {
    await execFileAsync('git', ['reset', '--hard', 'origin/development'], { cwd: path });
    await execFileAsync('git', ['clean', '-df'], { cwd: path });
    await execFileAsync('git', ['branch', '-f', 'development', 'origin/development'], {
      cwd: path,
    });
    logger.info({ path }, 'Worktree cleaned successfully');
  } catch (error: unknown) {
    const execError = error as { message?: string; stderr?: string; code?: number };
    logger.error(
      {
        error,
        stderr: execError.stderr,
        exitCode: execError.code,
        path,
      },
      'Failed to clean worktree'
    );
    const message = execError.message ?? 'Unknown error';
    const stderrInfo = execError.stderr ? `\nGit output: ${execError.stderr.trim()}` : '';
    throw new Error(`Failed to clean worktree: ${message}${stderrInfo}`);
  }
}

/**
 * Sanitize the repository's git config by removing stale credentials.
 *
 * Checks:
 * 1. Remote origin URL — if it contains embedded credentials (e.g. ghs_ tokens),
 *    reset it to the expected clean URL
 * 2. http.extraheader — if present (e.g. expired Authorization tokens), remove it
 *
 * This function never throws. All errors are caught and logged as warnings.
 */
export async function sanitizeRepoConfig(
  path: string,
  expectedUrl: string,
  logger: Logger
): Promise<void> {
  // 1. Check remote.origin.url for embedded credentials
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: path,
    });
    const currentUrl = stdout.trim();
    // Same repo but different text = embedded credentials or format difference.
    // Wrong-repo URLs are already caught by validateRepository() before this runs.
    if (normalizeUrl(currentUrl) === normalizeUrl(expectedUrl) && currentUrl !== expectedUrl) {
      logger.warn(
        { currentUrl, expectedUrl, path },
        'Remote origin URL differs from expected, resetting'
      );
      await execFileAsync('git', ['remote', 'set-url', 'origin', expectedUrl], { cwd: path });
    }
  } catch {
    logger.warn({ path }, 'Failed to check or sanitize remote.origin.url');
  }

  // 2. Remove http.extraheader if present
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'http.extraheader'], {
      cwd: path,
    });
    if (stdout.trim() !== '') {
      logger.warn({ path }, 'Found http.extraheader in repo git config, removing');
      try {
        await execFileAsync('git', ['config', '--unset', 'http.extraheader'], { cwd: path });
      } catch {
        logger.warn({ path }, 'Failed to unset http.extraheader');
      }
    }
  } catch {
    // git config --get exits 1 when key doesn't exist — normal, no action needed
  }
}

/**
 * Ensure the repository exists and is valid.
 *
 * If path doesn't exist: clone the repository
 * If path exists: validate it's the correct repo, sanitize config, fetch latest, and clean worktree
 */
export async function ensureRepository(url: string, path: string, logger: Logger): Promise<void> {
  if (existsSync(path)) {
    logger.info({ path }, 'Repository path exists, validating...');
    try {
      await validateRepository(path, url, logger);
    } catch (error) {
      logger.error({ error, path, url }, 'Repository validation failed');
      throw error;
    }

    await sanitizeRepoConfig(path, url, logger);

    let fetchSucceeded = true;
    try {
      await fetchRemote(path, logger);
    } catch (error) {
      fetchSucceeded = false;
      logger.warn({ error, path, url }, 'Fetch failed, continuing with existing local state');
    }

    try {
      await cleanWorktree(path, logger);
    } catch (error) {
      if (fetchSucceeded) {
        logger.error({ error, path, url }, 'Clean worktree failed after successful fetch');
      } else {
        logger.error({ error, path, url }, 'Both fetch and clean failed — repository is unusable');
      }
      throw error;
    }
  } else {
    logger.info({ path }, 'Repository path does not exist, cloning...');
    try {
      await cloneRepository(url, path, logger);
    } catch (error) {
      logger.error({ error, path, url }, 'Repository clone failed');
      throw error;
    }
  }
}
