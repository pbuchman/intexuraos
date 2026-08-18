/**
 * GCP credential validation.
 *
 * Validates the service-account key file exists and that `gcloud` can obtain
 * a token with an isolated credential override. Throws descriptive `Error`s so callers (i.e. `start.ts`)
 * can format the failure message and exit the process.
 */

import { existsSync } from 'node:fs';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { IntexuraOSError } from '@intexuraos/common-core';
import { EXEC_TIMEOUT_MS } from '../types/constants.js';

/** Minimal injectable dependencies — tests use fakes. */
export interface GcpValidatorDeps {
  existsSync: (path: string) => boolean;
  execFileSync: (
    file: string,
    args: readonly string[],
    options: ExecFileSyncOptions
  ) => Buffer | string;
}

const defaultDeps: GcpValidatorDeps = {
  existsSync,
  execFileSync,
};

/**
 * Ensure the GCP service-account key file exists and is usable.
 *
 * Throws an `Error` if:
 *   - the file is missing (message names the expected path)
 *   - isolated `gcloud auth print-access-token` fails (message names the key file)
 */
export function validateGcpCredentials(
  gcpSaKeyPath: string,
  projectId: string,
  deps: GcpValidatorDeps = defaultDeps
): void {
  if (!deps.existsSync(gcpSaKeyPath)) {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `GCP service account key not found at ${gcpSaKeyPath}. ` +
        `Add to .envrc: export GOOGLE_APPLICATION_CREDENTIALS=<path-to-key.json>`
    );
  }

  try {
    deps.execFileSync('gcloud', ['auth', 'print-access-token', '--project', projectId], {
      timeout: EXEC_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: gcpSaKeyPath,
        CLOUDSDK_CORE_PROJECT: projectId,
      },
    });
  } catch {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      `GCP authentication failed for credentials file ${gcpSaKeyPath}. ` +
        `Verify the file exists, is readable, and has correct permissions.`
    );
  }
}
