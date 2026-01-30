/**
 * Shared mock for @google-cloud/compute
 *
 * This mock is used by gateway.test.ts, idle-check.test.ts, and vm-control.test.ts
 * All tests use the same mockResize/mockGet functions to ensure consistent behavior
 */
import { vi } from 'vitest';

// Create mock functions that will be shared across all tests
export const mockResize = vi.fn();
export const mockGet = vi.fn();

// Mock class that uses the shared functions
export class MockInstanceGroupManagersClient {
  resize = mockResize;
  get = mockGet;
}
