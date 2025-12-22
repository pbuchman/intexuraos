/**
 * Firestore emulator utilities for testing.
 *
 * Detects running emulator or starts a new one for test execution.
 * The production code is completely unaware of emulator configuration -
 * this only affects tests via FIRESTORE_EMULATOR_HOST environment variable.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { Firestore } from '@google-cloud/firestore';

const DEFAULT_EMULATOR_HOST = 'localhost';
const DEFAULT_EMULATOR_PORT = 8085;
const DEFAULT_EMULATOR_HOST_PORT = `${DEFAULT_EMULATOR_HOST}:${String(DEFAULT_EMULATOR_PORT)}`;

/**
 * Get the emulator host:port from env var or default.
 */
function getEmulatorHostPort(): string {
  return process.env['FIRESTORE_EMULATOR_HOST'] ?? DEFAULT_EMULATOR_HOST_PORT;
}

let emulatorProcess: ChildProcess | null = null;

/**
 * Check if Firestore emulator is already running.
 * Respects FIRESTORE_EMULATOR_HOST env var if set.
 */
export async function isEmulatorRunning(): Promise<boolean> {
  const hostPort = getEmulatorHostPort();
  try {
    const response = await fetch(`http://${hostPort}/`);
    // Emulator returns 200 on root path
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/**
 * Wait for emulator to be ready with health check.
 */
async function waitForEmulator(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isEmulatorRunning()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Firestore emulator did not start within ${String(timeoutMs)}ms`);
}

/**
 * Start Firestore emulator if not already running.
 * Sets FIRESTORE_EMULATOR_HOST environment variable if not already set.
 *
 * @returns true if a new emulator was started, false if existing emulator was detected
 * @throws Error if emulator is not running and cannot be started
 */
export async function ensureEmulator(): Promise<boolean> {
  // Set emulator host for Firestore SDK to pick up (only if not pre-configured)
  process.env['FIRESTORE_EMULATOR_HOST'] ??= DEFAULT_EMULATOR_HOST_PORT;

  // Check if emulator is already running (e.g., via Docker or CI sidecar)
  if (await isEmulatorRunning()) {
    return false;
  }

  // Try to start emulator process locally
  // This requires gcloud CLI to be installed
  const localHostPort = DEFAULT_EMULATOR_HOST_PORT;
  return await new Promise((resolve, reject) => {
    emulatorProcess = spawn(
      'gcloud',
      ['emulators', 'firestore', 'start', `--host-port=${localHostPort}`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      }
    );

    emulatorProcess.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            'Firestore emulator not running and gcloud CLI not found.\n' +
              'Either:\n' +
              '  1. Start the emulator: npm run emulator:start\n' +
              '  2. Or install gcloud CLI: https://cloud.google.com/sdk/docs/install'
          )
        );
      } else {
        reject(new Error(`Failed to start Firestore emulator: ${err.message}`));
      }
    });

    // Update env to point to local emulator we're starting
    process.env['FIRESTORE_EMULATOR_HOST'] = localHostPort;

    // Wait for emulator to be ready
    waitForEmulator()
      .then(() => {
        resolve(true);
      })
      .catch(reject);
  });
}

/**
 * Stop the emulator if it was started by this process.
 */
export function stopEmulator(): void {
  if (emulatorProcess !== null) {
    emulatorProcess.kill('SIGTERM');
    emulatorProcess = null;
  }
}

/**
 * Fetch wrapper that returns null on network error.
 */
async function safeFetch(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await globalThis.fetch(url, init);
  } catch {
    // Network error - emulator might not be running
    return null;
  }
}

/**
 * Clear all data from the emulator.
 * Uses Firestore emulator's REST API.
 */
export async function clearEmulatorData(): Promise<void> {
  const projectId = process.env['GCLOUD_PROJECT'] ?? 'test-project';
  const hostPort = getEmulatorHostPort();
  const url = `http://${hostPort}/emulator/v1/projects/${projectId}/databases/(default)/documents`;

  // Best-effort cleanup - silently ignore network errors
  const response = await safeFetch(url, { method: 'DELETE' });

  // If fetch failed, silently ignore (best-effort cleanup)
  if (response === null || typeof response === 'undefined') {
    return;
  }

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to clear emulator data: ${response.statusText}`);
  }
}

/**
 * Create a Firestore instance configured for the emulator.
 * This is for test utilities only - production code uses getFirestore() from client.ts.
 */
export function createEmulatorFirestore(): Firestore {
  return new Firestore({
    projectId: process.env['GCLOUD_PROJECT'] ?? 'test-project',
  });
}

/**
 * Get the emulator host string.
 */
export function getEmulatorHost(): string {
  return getEmulatorHostPort();
}
