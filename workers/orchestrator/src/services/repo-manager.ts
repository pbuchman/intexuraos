import { existsSync, statSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from '@intexuraos/common-core';

const execAsync = promisify(exec);

/**
 * Normalize a Git repository URL for comparison.
 * Handles:
 * - Trailing .git suffix
 * - SSH (git@github.com:user/repo) vs HTTPS (https://github.com/user/repo)
 * - Case-insensitive comparison
 */
export function normalizeUrl(url: string): string {
  return url
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .toLowerCase();
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
  const stat = statSync(gitPath);
  if (!stat.isDirectory()) {
    throw new Error(`REPOSITORY_PATH ${path} appears to be a worktree, not a main clone`);
  }

  // Verify remote origin matches expected URL
  logger.info({ path }, 'Verifying repository remote origin');
  const { stdout } = await execAsync('git remote get-url origin', { cwd: path });
  const actualUrl = stdout.trim();

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
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
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
    mkdirSync(parentDir, { recursive: true });
  }

  try {
    await execAsync(`git clone ${url} ${path}`);
    logger.info({ path }, 'Repository cloned successfully');
  } catch (error: unknown) {
    /* v8 ignore start -- ts-type: ternary for non-Error objects never reached in tests @preserve */
    const message = error instanceof Error ? error.message : 'Unknown error';
    /* v8 ignore stop @preserve */
    throw new Error(`Failed to clone repository: ${message}`);
  }
}

/**
 * Fetch latest changes from remote origin.
 */
export async function fetchRemote(path: string, logger: Logger): Promise<void> {
  logger.info({ path }, 'Fetching latest from remote');

  try {
    await execAsync('git fetch origin', { cwd: path });
    logger.info({ path }, 'Fetch completed successfully');
  } catch (error: unknown) {
    /* v8 ignore start -- ts-type: ternary for non-Error objects never reached in tests @preserve */
    const message = error instanceof Error ? error.message : 'Unknown error';
    /* v8 ignore stop @preserve */
    throw new Error(`Failed to fetch from remote: ${message}`);
  }
}

/**
 * Ensure the repository exists and is valid.
 *
 * If path doesn't exist: clone the repository
 * If path exists: validate it's the correct repo and fetch latest
 */
export async function ensureRepository(url: string, path: string, logger: Logger): Promise<void> {
  if (existsSync(path)) {
    logger.info({ path }, 'Repository path exists, validating...');
    await validateRepository(path, url, logger);
    await fetchRemote(path, logger);
  } else {
    logger.info({ path }, 'Repository path does not exist, cloning...');
    await cloneRepository(url, path, logger);
  }
}
