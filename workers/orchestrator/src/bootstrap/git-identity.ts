/**
 * Git identity resolution for worker containers.
 *
 * Precedence (highest wins):
 *   1. Env var override (`INTEXURAOS_GIT_USER_NAME`, `INTEXURAOS_GIT_USER_EMAIL`)
 *   2. Host global git config (`git config user.name`, etc.)
 *   3. Undefined (workers inherit nothing)
 *
 * Repo-level (`--local`) config takes precedence over everything in a
 * worktree — {@link readRepoGitConfig} surfaces it so callers can warn.
 */

import { execSync } from 'node:child_process';

const GIT_CONFIG_TIMEOUT_MS = 5000;

/**
 * Reads a key from the host's *global* git config. Returns `undefined`
 * when unset or git is unavailable. Swallows errors — git config is a
 * best-effort lookup, not a hard dependency.
 */
/* v8 ignore start -- module-init: shells out to `git config` at startup; not mockable without broad module mocking @preserve */
export function readHostGitConfig(key: string): string | undefined {
  try {
    const value = execSync(`git config ${key}`, {
      encoding: 'utf-8',
      timeout: GIT_CONFIG_TIMEOUT_MS,
    }).trim();
    return value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a key from a specific repository's *local* git config.
 * Used to detect repo-level overrides that would override the identity
 * passed to worker containers.
 */
export function readRepoGitConfig(repoPath: string, key: string): string | undefined {
  try {
    const value = execSync(`git -C ${repoPath} config --local ${key}`, {
      encoding: 'utf-8',
      timeout: GIT_CONFIG_TIMEOUT_MS,
    }).trim();
    return value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}
/* v8 ignore stop @preserve */
