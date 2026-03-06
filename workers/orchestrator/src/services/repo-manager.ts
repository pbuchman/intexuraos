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
    /* v8 ignore start -- upstream: URL parsing fails only for truly malformed non-git input @preserve */
    return httpsUrl.toLowerCase();
  }
  /* v8 ignore stop @preserve */
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
  /* v8 ignore start -- test-infra: statSync race condition after existsSync is not testable @preserve */
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(gitPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to stat .git directory at ${gitPath}: ${message}`);
  }
  /* v8 ignore stop @preserve */
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
    /* v8 ignore start -- ts-type: ternary for non-Error objects never reached in tests @preserve */
    const message = error instanceof Error ? error.message : 'Unknown error';
    /* v8 ignore stop @preserve */
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
      /* v8 ignore start -- ts-type: ternary for non-Error objects never reached in tests @preserve */
      const message = error instanceof Error ? error.message : 'Unknown error';
      /* v8 ignore stop @preserve */
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
    /* v8 ignore start -- test-infra: mkdirSync failure requires disk-full or permission-denied conditions @preserve */
    try {
      mkdirSync(parentDir, { recursive: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to create parent directory ${parentDir} for repository clone: ${message}`
      );
    }
    /* v8 ignore stop @preserve */
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
    /* v8 ignore start -- ts-type: ternary for non-Error objects never reached in tests @preserve */
    const message = execError.message ?? 'Unknown error';
    /* v8 ignore stop @preserve */
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
    /* v8 ignore start -- ts-type: ternary for non-Error objects never reached in tests @preserve */
    const message = execError.message ?? 'Unknown error';
    /* v8 ignore stop @preserve */
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
    /* v8 ignore start -- ts-type: ternary for non-Error objects never reached in tests @preserve */
    const message = execError.message ?? 'Unknown error';
    /* v8 ignore stop @preserve */
    const stderrInfo = execError.stderr ? `\nGit output: ${execError.stderr.trim()}` : '';
    throw new Error(`Failed to clean worktree: ${message}${stderrInfo}`);
  }
}

/**
 * Ensure the repository exists and is valid.
 *
 * If path doesn't exist: clone the repository
 * If path exists: validate it's the correct repo, clean, and fetch latest
 */
export async function ensureRepository(url: string, path: string, logger: Logger): Promise<void> {
  if (existsSync(path)) {
    logger.info({ path }, 'Repository path exists, validating...');
    try {
      await validateRepository(path, url, logger);
      await fetchRemote(path, logger);
      await cleanWorktree(path, logger);
    } catch (error) {
      logger.error({ error, path, url }, 'Repository validation or fetch failed');
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
