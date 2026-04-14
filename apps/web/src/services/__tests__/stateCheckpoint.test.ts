/**
 * Tests for stateCheckpoint service.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StateCheckpoint } from '../stateCheckpoint.js';

// --- IndexedDB Mock Infrastructure ---

interface MockStore {
  data: Map<string, unknown>;
}

interface MockTransaction {
  objectStore: (name: string) => MockObjectStore;
  commit?: () => void;
  oncomplete: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

interface MockObjectStore {
  put: (value: unknown, key?: string) => MockRequest;
  get: (key: string) => MockRequest;
  delete: (key: string) => MockRequest;
}

interface MockRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

interface MockDBInstance {
  transaction: (storeNames: string | string[], mode?: string) => MockTransaction;
  close: () => void;
  createObjectStore: (name: string) => void;
  objectStoreNames: { contains: (name: string) => boolean };
}

interface MockOpenRequest {
  result: MockDBInstance | null;
  error: DOMException | null;
  onsuccess: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onupgradeneeded: ((ev: Event) => void) | null;
}

function createMockIndexedDB(): {
  open: (_name: string, _version?: number) => MockOpenRequest;
  _stores: Map<string, MockStore>;
  _reset: () => void;
} {
  const stores = new Map<string, MockStore>();

  function createRequest(fn: () => unknown): MockRequest {
    const request: MockRequest = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };

    // Simulate async via microtask
    queueMicrotask(() => {
      try {
        request.result = fn();
        request.onsuccess?.call(request, new Event('success'));
      } catch {
        request.error = new DOMException('Mock IDB error');
        request.onerror?.call(request, new Event('error'));
      }
    });

    return request;
  }

  function createMockObjectStore(storeName: string): MockObjectStore {
    const store = stores.get(storeName);
    return {
      put(value: unknown, key?: string): MockRequest {
        const k = key ?? 'current';
        return createRequest((): undefined => {
          store?.data.set(k, value);
          return undefined;
        });
      },
      get(key: string): MockRequest {
        return createRequest((): unknown => {
          return store?.data.get(key);
        });
      },
      delete(key: string): MockRequest {
        return createRequest((): undefined => {
          store?.data.delete(key);
          return undefined;
        });
      },
    };
  }

  function createTransaction(): MockTransaction {
    const tx: MockTransaction = {
      objectStore(_name: string): MockObjectStore {
        return createMockObjectStore(_name);
      },
      commit: vi.fn(),
      oncomplete: null,
      onerror: null,
    };
    return tx;
  }

  function createDB(): MockDBInstance {
    return {
      transaction(_storeNames: string | string[], _mode?: string): MockTransaction {
        return createTransaction();
      },
      close(): void {
        // no-op
      },
      createObjectStore(storeName: string): void {
        if (!stores.has(storeName)) {
          stores.set(storeName, { data: new Map() });
        }
      },
      objectStoreNames: {
        contains(checkName: string): boolean {
          return stores.has(checkName);
        },
      },
    };
  }

  const mockDB = createDB();

  return {
    open(_name: string, _version?: number): MockOpenRequest {
      const request: MockOpenRequest = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      queueMicrotask(() => {
        // Set result before upgradeneeded so request.result is available
        request.result = mockDB;

        // Fire upgradeneeded if store doesn't exist
        if (!stores.has('checkpoint')) {
          stores.set('checkpoint', { data: new Map() });
          request.onupgradeneeded?.call(request, new Event('upgradeneeded') as never);
        }

        request.onsuccess?.call(request, new Event('success'));
      });

      return request;
    },
    _stores: stores,
    _reset(): void {
      stores.clear();
    },
  };
}

let mockIDB: ReturnType<typeof createMockIndexedDB>;

beforeEach(() => {
  mockIDB = createMockIndexedDB();
  // @ts-expect-error -- assigning mock IDB to global for testing
  globalThis.indexedDB = mockIDB;
});

afterEach(() => {
  mockIDB._reset();
  // @ts-expect-error -- removing mock IDB from global after test
  delete globalThis.indexedDB;
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadModule(): Promise<typeof import('../stateCheckpoint.js')> {
  return import('../stateCheckpoint.js');
}

describe('stateCheckpoint', () => {
  const validCheckpoint: StateCheckpoint = {
    routeHash: '/#/dashboard',
    scrollY: 150,
    timestamp: Date.now(),
  };

  describe('saveCheckpoint and loadCheckpoint', () => {
    it('should round-trip a checkpoint correctly', async () => {
      const { saveCheckpoint, loadCheckpoint } = await loadModule();

      await saveCheckpoint(validCheckpoint);
      const loaded = await loadCheckpoint();

      expect(loaded).not.toBeNull();
      expect(loaded?.routeHash).toBe(validCheckpoint.routeHash);
      expect(loaded?.scrollY).toBe(validCheckpoint.scrollY);
      expect(loaded?.timestamp).toBe(validCheckpoint.timestamp);
    });
  });

  describe('loadCheckpoint', () => {
    it('should return null when no checkpoint exists', async () => {
      const { loadCheckpoint } = await loadModule();

      const result = await loadCheckpoint();

      expect(result).toBeNull();
    });

    it('should return null when checkpoint is stale (>30 min old)', async () => {
      const { saveCheckpoint, loadCheckpoint } = await loadModule();

      const staleCheckpoint: StateCheckpoint = {
        routeHash: '/#/settings',
        scrollY: 0,
        timestamp: Date.now() - 31 * 60 * 1000, // 31 minutes ago
      };

      await saveCheckpoint(staleCheckpoint);
      const result = await loadCheckpoint();

      expect(result).toBeNull();
    });

    it('should return checkpoint when under 30 min old', async () => {
      const { saveCheckpoint, loadCheckpoint } = await loadModule();

      const borderlineCheckpoint: StateCheckpoint = {
        routeHash: '/#/tasks',
        scrollY: 200,
        timestamp: Date.now() - 29 * 60 * 1000, // 29 minutes ago
      };

      await saveCheckpoint(borderlineCheckpoint);
      const result = await loadCheckpoint();

      expect(result).not.toBeNull();
      expect(result?.routeHash).toBe('/#/tasks');
    });
  });

  describe('clearCheckpoint', () => {
    it('should remove saved data', async () => {
      const { saveCheckpoint, loadCheckpoint, clearCheckpoint } = await loadModule();

      await saveCheckpoint(validCheckpoint);
      await clearCheckpoint();
      const result = await loadCheckpoint();

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should return null on load when indexedDB is unavailable', async () => {
      // @ts-expect-error -- removing mock IDB to test unavailability
      delete globalThis.indexedDB;

      const { loadCheckpoint } = await loadModule();
      const result = await loadCheckpoint();

      expect(result).toBeNull();
    });

    it('should not throw on save when indexedDB is unavailable', async () => {
      // @ts-expect-error -- removing mock IDB to test unavailability
      delete globalThis.indexedDB;

      const { saveCheckpoint } = await loadModule();

      // Should not throw
      await expect(saveCheckpoint(validCheckpoint)).resolves.toBeUndefined();
    });

    it('should not throw on clear when indexedDB is unavailable', async () => {
      // @ts-expect-error -- removing mock IDB to test unavailability
      delete globalThis.indexedDB;

      const { clearCheckpoint } = await loadModule();

      await expect(clearCheckpoint()).resolves.toBeUndefined();
    });
  });
});
