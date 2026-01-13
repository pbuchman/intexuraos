/**
 * Vitest global setup - runs before all tests
 *
 * This file ensures that:
 * 1. Firebase/Firestore never tries to connect to real GCP
 * 2. Tests are fully isolated from external services
 * 3. Logging is suppressed during tests
 * 4. HTTP requests use node-fetch polyfill for nock interception (fetch only)
 * 5. @notionhq/client is mocked to prevent real API calls
 */

import { vi } from 'vitest';
import nodeFetch from 'node-fetch';

// Mock @notionhq/client globally to prevent any real HTTP calls
// This mock is hoisted and applied to all test files
vi.mock('@notionhq/client', () => {
  // Create mock methods using vitest's vi.fn()
  const mockMethods = {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    listBlocks: vi.fn(),
    appendBlocks: vi.fn(),
    updateBlock: vi.fn(),
    deleteBlock: vi.fn(),
  };

  class MockClient {
    pages = {
      retrieve: mockMethods.retrieve,
      create: mockMethods.create,
      update: mockMethods.update,
    };
    blocks = {
      children: {
        list: mockMethods.listBlocks,
        append: mockMethods.appendBlocks,
      },
      update: mockMethods.updateBlock,
      delete: mockMethods.deleteBlock,
    };
  }

  const mockIsNotionClientError = vi.fn((error: unknown): boolean => {
    return typeof error === 'object' && error !== null && 'code' in error;
  });

  // Store on globalThis for tests to access
  // Use a getter to always return the current mock state
  Object.defineProperty(globalThis, '__notionMocks', {
    value: mockMethods,
    writable: false,
    configurable: false,
  });

  return {
    Client: MockClient,
    isNotionClientError: mockIsNotionClientError,
    APIErrorCode: {
      Unauthorized: 'unauthorized',
      ObjectNotFound: 'object_not_found',
      RateLimited: 'rate_limited',
      ValidationError: 'validation_error',
      InvalidJSON: 'invalid_json',
      Conflict: 'conflict',
    },
    LogLevel: {
      DEBUG: 'debug',
      INFO: 'info',
      WARN: 'warn',
      ERROR: 'error',
    },
  };
});

// Polyfill only fetch, not Headers/Request/Response, to avoid breaking jose
// Native fetch (Node.js 18+) is not intercepted by nock
globalThis.fetch = nodeFetch as unknown as typeof fetch;

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
// Suppress HTTP request logging during tests
process.env.LOG_LEVEL = 'silent';
// Prevent any GCP metadata lookups
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.GCLOUD_PROJECT = 'test-project';
