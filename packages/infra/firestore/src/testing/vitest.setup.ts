/**
 * Vitest setup file for Firestore tests.
 *
 * Sets up the emulator environment and provides test utilities.
 */
import { beforeEach, afterAll } from 'vitest';
import { resetFirestore } from '../client.js';
import { clearEmulatorData, getEmulatorHost } from './emulator.js';

// Ensure emulator host is set for all tests
process.env['FIRESTORE_EMULATOR_HOST'] ??= getEmulatorHost();
process.env['GCLOUD_PROJECT'] ??= 'test-project';

// Clear data between tests for isolation
beforeEach(async (): Promise<void> => {
  // Reset singleton to ensure fresh Firestore client
  resetFirestore();
  // Clear all emulator data for test isolation
  await clearEmulatorData();
});

afterAll((): void => {
  resetFirestore();
});
