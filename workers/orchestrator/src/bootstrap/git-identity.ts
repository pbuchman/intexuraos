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
 *
 * SECURITY: Both helpers shell out via `execFileSync` (argv form, no `/bin/sh`)
 * so callers cannot accidentally inject shell metacharacters via `key` or
 * `repoPath`. `repoPath` is additionally constrained to absolute paths.
 */

import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

const GIT_CONFIG_TIMEOUT_MS = 5000;

/**
 * Reads a key from the host's *global* git config. Returns `undefined`
 * when unset or git is unavailable. Swallows errors — git config is a
 * best-effort lookup, not a hard dependency.
 */
export function readHostGitConfig(key: string): string | undefined {
  try {
    const value = execFileSync('git', ['config', key], {
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
  // Defense-in-depth: silently reject relative paths so we never run
  // `git -C <relative>` and read config from an unintended cwd. In practice,
  // every caller passes an absolute path; this guard exists so a future
  // caller cannot accidentally widen the surface. There is no logger here
  // (this module is used during bootstrap before logger wiring), so the
  // rejection is intentionally silent.
  if (!isAbsolute(repoPath)) {
    return undefined;
  }
  try {
    const value = execFileSync('git', ['-C', repoPath, 'config', '--local', key], {
      encoding: 'utf-8',
      timeout: GIT_CONFIG_TIMEOUT_MS,
    }).trim();
    return value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes a key to a specific repository's *local* git config.
 * Returns false for invalid paths or git failures so bootstrap can keep
 * running and surface the effective identity in logs.
 */
export function setRepoGitConfig(repoPath: string, key: string, value: string): boolean {
  if (!isAbsolute(repoPath)) {
    return false;
  }
  try {
    execFileSync('git', ['-C', repoPath, 'config', '--local', key, value], {
      encoding: 'utf-8',
      timeout: GIT_CONFIG_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

export interface RepoGitIdentityReconcileResult {
  repoUserName: string | undefined;
  repoUserEmail: string | undefined;
  appliedName: boolean;
  appliedEmail: boolean;
  effectiveName: string | undefined;
  effectiveEmail: string | undefined;
}

/**
 * Aligns repo-local git identity with the identity passed to worker containers.
 * Repo config has highest precedence inside worktrees, so writing the resolved
 * identity removes stale local overrides instead of only warning about them.
 */
export function reconcileRepoGitIdentity(
  repoPath: string,
  identity: { gitUserName: string | undefined; gitUserEmail: string | undefined }
): RepoGitIdentityReconcileResult {
  const repoUserName = readRepoGitConfig(repoPath, 'user.name');
  const repoUserEmail = readRepoGitConfig(repoPath, 'user.email');
  const appliedName =
    identity.gitUserName !== undefined
      ? setRepoGitConfig(repoPath, 'user.name', identity.gitUserName)
      : false;
  const appliedEmail =
    identity.gitUserEmail !== undefined
      ? setRepoGitConfig(repoPath, 'user.email', identity.gitUserEmail)
      : false;
  const effectiveName =
    identity.gitUserName === undefined || (repoUserName !== undefined && !appliedName)
      ? repoUserName
      : identity.gitUserName;
  const effectiveEmail =
    identity.gitUserEmail === undefined || (repoUserEmail !== undefined && !appliedEmail)
      ? repoUserEmail
      : identity.gitUserEmail;

  return {
    repoUserName,
    repoUserEmail,
    appliedName,
    appliedEmail,
    effectiveName,
    effectiveEmail,
  };
}
