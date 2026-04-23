/**
 * Filesystem helpers used across bootstrap modules.
 */

import { mkdirSync } from 'node:fs';

/**
 * Creates `path` and all parents if missing. No-op when the directory
 * already exists. Throws if the filesystem cannot be written.
 */
/* v8 ignore start -- module-init: bootstrap helper cannot be unit-tested without real filesystem; exercised indirectly via start.ts and service-wiring.ts @preserve */
export function ensureDirectoryExists(path: string): void {
  mkdirSync(path, { recursive: true });
}
/* v8 ignore stop @preserve */
