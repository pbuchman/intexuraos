/**
 * Vitest global setup for Firestore emulator.
 *
 * This setup runs once before all tests:
 * 1. Detects if emulator is already running (e.g., Docker container)
 * 2. If not, starts a temporary emulator process
 * 3. Sets FIRESTORE_EMULATOR_HOST so SDK auto-connects to emulator
 *
 * Production code remains unaware of emulator - only env var changes.
 */
import type { GlobalSetupContext } from 'vitest/node';
import { ensureEmulator, stopEmulator } from './emulator.js';

let startedByUs = false;

export async function setup(_ctx: GlobalSetupContext): Promise<void> {
  // Set project ID for emulator
  process.env['GCLOUD_PROJECT'] ??= 'test-project';

  // Ensure emulator is running
  startedByUs = await ensureEmulator();
}

export function teardown(): void {
  if (startedByUs) {
    stopEmulator();
  }
}
