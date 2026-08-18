/**
 * GitHub App private-key loading from a host-rendered DEV secret package.
 *
 * This module deliberately has no Secret Manager client and no `gcloud`
 * fallback. The package renderer owns remote access, checksum validation, and
 * atomic publication; the orchestrator consumes only the resulting mode-0600
 * file.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { IntexuraOSError } from '@intexuraos/common-core';

/** Environment variable naming the rendered GitHub App private-key path. */
export const GITHUB_APP_PRIVATE_KEY_PATH = 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY_PATH';

const PRIVATE_KEY_PEM_PATTERN =
  /^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*$/u;

/** Minimal injectable filesystem dependencies used by unit tests. */
export interface SecretManagerDeps {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { mode: number };
  readFileSync: (path: string, encoding: 'utf-8') => string;
}

const defaultDeps: SecretManagerDeps = {
  existsSync,
  statSync,
  readFileSync,
};

/** Options for {@link fetchGitHubKeys}. */
export interface FetchGitHubKeysOptions {
  /** Exact host path atomically published by the DEV package renderer. */
  privateKeyPath: string;
}

/**
 * Validates and returns the rendered GitHub App private key.
 *
 * The historical function name remains to avoid a noisy call-site migration,
 * but remote fetching is intentionally impossible here.
 */
export function fetchGitHubKeys(
  options: FetchGitHubKeysOptions,
  deps: SecretManagerDeps = defaultDeps
): string {
  const { privateKeyPath } = options;

  if (!deps.existsSync(privateKeyPath)) {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `The rendered GitHub App private key file is missing at ${privateKeyPath}. ` +
        'Render the pinned DEV secret package before starting orchestrator.'
    );
  }

  if ((deps.statSync(privateKeyPath).mode & 0o777) !== 0o600) {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `The rendered GitHub App private key file at ${privateKeyPath} must have mode 0600.`
    );
  }

  let privateKey: string;
  try {
    privateKey = deps.readFileSync(privateKeyPath, 'utf-8');
  } catch {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `Unable to read the rendered GitHub App private key file at ${privateKeyPath}.`
    );
  }

  if (!PRIVATE_KEY_PEM_PATTERN.test(privateKey)) {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `The rendered GitHub App private key file at ${privateKeyPath} is not a valid PEM private key.`
    );
  }

  return privateKey;
}
