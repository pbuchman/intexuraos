/**
 * GCP credential validation.
 *
 * Validates the service-account key file exists and that `gcloud` can
 * activate it. Throws descriptive `Error`s so callers (i.e. `start.ts`)
 * can format the failure message and exit the process.
 */

import { existsSync } from 'node:fs';
import { execSync, type ExecSyncOptions } from 'node:child_process';
import { EXEC_TIMEOUT_MS } from '../types/constants.js';

/** Minimal injectable dependencies — tests use fakes. */
export interface GcpValidatorDeps {
  existsSync: (path: string) => boolean;
  execSync: (command: string, options: ExecSyncOptions) => Buffer | string;
}

const defaultDeps: GcpValidatorDeps = {
  existsSync,
  execSync,
};

/**
 * Ensure the GCP service-account key file exists and is usable.
 *
 * Throws an `Error` if:
 *   - the file is missing (message names the expected path)
 *   - `gcloud auth activate-service-account` fails (message names the key file)
 */
export function validateGcpCredentials(
  gcpSaKeyPath: string,
  projectId: string,
  deps: GcpValidatorDeps = defaultDeps
): void {
  if (!deps.existsSync(gcpSaKeyPath)) {
    throw new Error(
      `GCP service account key not found at ${gcpSaKeyPath}. ` +
        `Add to .envrc: export GOOGLE_APPLICATION_CREDENTIALS=<path-to-key.json>`
    );
  }

  try {
    deps.execSync(
      `gcloud auth activate-service-account --key-file="${gcpSaKeyPath}" --project="${projectId}"`,
      { timeout: EXEC_TIMEOUT_MS, stdio: 'pipe' }
    );
  } catch (error) {
    throw new Error(
      `GCP authentication failed for credentials file ${gcpSaKeyPath}. ` +
        `Verify the file exists, is readable, and has correct permissions. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
