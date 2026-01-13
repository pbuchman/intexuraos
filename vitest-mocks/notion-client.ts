/**
 * Mock for @notionhq/client
 * Used in tests to avoid real HTTP calls to Notion API
 *
 * This file creates mock functions and stores them on globalThis.__notionMocks
 * so tests can control their behavior.
 */

// Mock function class that behaves like vitest's vi.fn()
class MockFn {
  _mockCalls: unknown[][] = [];
  _mockImpl: ((...args: unknown[]) => unknown) | undefined;
  _mockReturnValue: unknown | undefined;

  mockImplementation(fn: (...args: unknown[]) => unknown) {
    this._mockImpl = fn;
    return this;
  }

  mockReturnValue(value: unknown) {
    this._mockReturnValue = value;
    return this;
  }

  mockResolvedValue(value: unknown) {
    this._mockReturnValue = Promise.resolve(value);
    return this;
  }

  mockRejectedValue(value: unknown) {
    this._mockReturnValue = Promise.reject(value);
    return this;
  }

  mockReset() {
    this._mockCalls = [];
    this._mockImpl = undefined;
    this._mockReturnValue = undefined;
  }

  __call(...args: unknown[]) {
    this._mockCalls.push(args);
    if (this._mockReturnValue !== undefined) return this._mockReturnValue;
    if (this._mockImpl !== undefined) {
      if (typeof this._mockImpl === 'function') return this._mockImpl(...args);
    }
    return Promise.resolve({});
  }

  get mockCalls() {
    return this._mockCalls;
  }

  get calls() {
    return this._mockCalls;
  }
}

// Create mock methods that can be controlled by tests
const createMock = () => new MockFn();

// Initialize global mocks if not already present
if (!(globalThis as any).__notionMocks) {
  (globalThis as any).__notionMocks = {
    retrieve: createMock(),
    create: createMock(),
    update: createMock(),
    listBlocks: createMock(),
    appendBlocks: createMock(),
    updateBlock: createMock(),
    deleteBlock: createMock(),
  };
}

const mockNotionMethods = (globalThis as any).__notionMocks;

class MockClient {
  pages = {
    retrieve: (...args: unknown[]) => mockNotionMethods.retrieve(...args),
    create: (...args: unknown[]) => mockNotionMethods.create(...args),
    update: (...args: unknown[]) => mockNotionMethods.update(...args),
  };
  blocks = {
    children: {
      list: (...args: unknown[]) => mockNotionMethods.listBlocks(...args),
      append: (...args: unknown[]) => mockNotionMethods.appendBlocks(...args),
    },
    update: (...args: unknown[]) => mockNotionMethods.updateBlock(...args),
    delete: (...args: unknown[]) => mockNotionMethods.deleteBlock(...args),
  };
}

const mockIsNotionClientError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error;
};

// Export the mocked Client and utilities
export const Client = MockClient;
export const isNotionClientError = mockIsNotionClientError;
export const APIErrorCode = {
  Unauthorized: 'unauthorized',
  ObjectNotFound: 'object_not_found',
  RateLimited: 'rate_limited',
  ValidationError: 'validation_error',
  InvalidJSON: 'invalid_json',
  Conflict: 'conflict',
};
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};
export type APIErrorCode = (typeof APIErrorCode)[keyof typeof APIErrorCode];
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

// Export mock methods for tests to use
export const __mockMethods = mockNotionMethods;
