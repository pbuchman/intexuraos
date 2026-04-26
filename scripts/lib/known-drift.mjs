/**
 * Shared helper for loading the known-drift allowlist.
 *
 * The allowlist captures pre-existing drift between Terraform, application code,
 * the PM2 ecosystem config, and Secret Manager declarations. Each entry must
 * reference the issue/subtask that will eventually remove it.
 *
 * CI fails on ANY drift not present in the allowlist (NEW drift) AND on stale
 * allowlist entries (allowlisted items that are no longer drifting).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load the known-drift JSON file from the repo root's scripts/__fixtures__/ dir.
 * Returns the parsed object. Throws (loudly) if the file is missing or malformed.
 */
export function loadKnownDrift(repoRoot) {
  const driftPath = join(repoRoot, 'scripts', '__fixtures__', 'known-drift.json');
  if (!existsSync(driftPath)) {
    throw new Error(`known-drift.json not found at ${driftPath}`);
  }
  const raw = readFileSync(driftPath, 'utf8');
  return JSON.parse(raw);
}
