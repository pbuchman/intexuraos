/**
 * GitHub App private key fetching from GCP Secret Manager.
 *
 * The key is PEM-encoded and multi-line, so it cannot be distributed via
 * plain `.envrc` exports. We cache it on disk for an hour to reduce cold-
 * start latency. Tests inject fakes via the `deps` parameter.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { execSync, type ExecSyncOptions } from 'node:child_process';
import { IntexuraOSError } from '@intexuraos/common-core';
import { EXEC_TIMEOUT_MS } from '../types/constants.js';

/** Secret name in GCP Secret Manager. Exported for error messages. */
export const GITHUB_APP_PRIVATE_KEY_SECRET = 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY';

/** Cache TTL — 1 hour. */
export const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

/** Minimal injectable dependencies — tests use fakes. */
export interface SecretManagerDeps {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { mtimeMs: number };
  readFileSync: (path: string, encoding: 'utf-8') => string;
  execSync: (command: string, options: ExecSyncOptions) => Buffer | string;
  now: () => number;
}

const defaultDeps: SecretManagerDeps = {
  existsSync,
  statSync,
  readFileSync,
  execSync,
  now: () => Date.now(),
};

/** Options for {@link fetchGitHubKeys}. */
export interface FetchGitHubKeysOptions {
  /** GCP project ID hosting the secret. */
  projectId: string;
  /** Filesystem cache path used to avoid repeated Secret Manager calls. */
  cachePath: string;
  /**
   * Optional override (from env var). Skips cache + Secret Manager. Useful
   * for tests and manual overrides.
   */
  override?: string;
}

/**
 * Returns the GitHub App private key.
 *
 * Resolution order:
 *   1. `options.override` (env var) — used verbatim if provided.
 *   2. Cached file at `options.cachePath`, if fresher than one hour.
 *   3. Secret Manager via `gcloud secrets versions access`.
 *
 * Throws an `Error` mentioning {@link GITHUB_APP_PRIVATE_KEY_SECRET} if
 * the Secret Manager fetch fails.
 */
export function fetchGitHubKeys(
  options: FetchGitHubKeysOptions,
  deps: SecretManagerDeps = defaultDeps
): string {
  const { projectId, cachePath, override } = options;

  if (override !== undefined && override !== '') {
    return override;
  }

  if (deps.existsSync(cachePath)) {
    const stats = deps.statSync(cachePath);
    const ageMs = deps.now() - stats.mtimeMs;
    if (ageMs < CACHE_MAX_AGE_MS) {
      return deps.readFileSync(cachePath, 'utf-8');
    }
  }

  try {
    const raw = deps.execSync(
      `gcloud secrets versions access latest --secret=${GITHUB_APP_PRIVATE_KEY_SECRET} --project=${projectId}`,
      { encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS }
    );
    return String(raw).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `Failed to fetch secret '${GITHUB_APP_PRIVATE_KEY_SECRET}' from Secret Manager ` +
        `(project=${projectId}). Ensure the service account has ` +
        `'roles/secretmanager.secretAccessor' and the secret exists. ` +
        `Original error: ${detail}`
    );
  }
}
