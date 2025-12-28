/**
 * Vitest global setup - runs before all tests
 *
 * This file ensures that:
 * 1. Firebase/Firestore never tries to connect to real GCP
 * 2. Tests are fully isolated from external services
 */

import { vi } from 'vitest';

// Mock firebase-admin to prevent any GCP connections
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
  cert: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
  })),
}));

// Set environment to test mode
process.env.NODE_ENV = 'test';
// Prevent any GCP metadata lookups
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.GCLOUD_PROJECT = 'test-project';

