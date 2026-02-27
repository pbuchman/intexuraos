import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { createGithubWebhookAgentLeaseRepository } from '../../../infra/firestore/githubWebhookAgentLeaseRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const mockGetFirestore = vi.mocked(getFirestore);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('createGithubWebhookAgentLeaseRepository', () => {
  let mockDocRef: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let mockCollection: { doc: ReturnType<typeof vi.fn> };
  let mockRunTransaction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocRef = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    mockCollection = {
      doc: vi.fn(() => mockDocRef),
    };
    mockRunTransaction = vi.fn();
    mockGetFirestore.mockReturnValue({
      collection: vi.fn(() => mockCollection),
      runTransaction: mockRunTransaction,
    } as never);
  });

  describe('acquire()', () => {
    it('acquires lease when key is unused', async () => {
      mockRunTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const txn = {
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn(),
        };
        return fn(txn);
      });

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.acquire({
        savedEventId: 'evt-100',
        owner: 'run-abc',
        traceId: 'trace-001',
        ttlMs: 30_000,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.acquired).toBe(true);
      }
    });

    it('rejects lease when key is already held and not expired', async () => {
      const futureExpiry = new Date(Date.now() + 60_000).toISOString();
      mockRunTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const txn = {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              owner: 'run-existing',
              traceId: 'trace-old',
              acquiredAt: new Date().toISOString(),
              expiresAt: futureExpiry,
            }),
          }),
          set: vi.fn(),
        };
        return fn(txn);
      });

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.acquire({
        savedEventId: 'evt-100',
        owner: 'run-new',
        traceId: 'trace-002',
        ttlMs: 30_000,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.acquired).toBe(false);
        if (!result.value.acquired) {
          expect(result.value.existingOwner).toBe('run-existing');
        }
      }
    });

    it('acquires lease when existing lease has expired', async () => {
      const pastExpiry = new Date(Date.now() - 10_000).toISOString();
      mockRunTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const txn = {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              owner: 'run-old',
              traceId: 'trace-old',
              acquiredAt: new Date().toISOString(),
              expiresAt: pastExpiry,
            }),
          }),
          set: vi.fn(),
        };
        return fn(txn);
      });

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.acquire({
        savedEventId: 'evt-100',
        owner: 'run-new',
        traceId: 'trace-003',
        ttlMs: 30_000,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.acquired).toBe(true);
      }
    });

    it('handles Firestore errors during acquisition', async () => {
      mockRunTransaction.mockRejectedValue(new Error('Transaction failed'));

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.acquire({
        savedEventId: 'evt-100',
        owner: 'run-abc',
        traceId: 'trace-001',
        ttlMs: 30_000,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('release()', () => {
    it('releases an active lease', async () => {
      mockRunTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const txn = {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              owner: 'run-abc',
              traceId: 'trace-001',
              acquiredAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
            }),
          }),
          delete: vi.fn(),
        };
        return fn(txn);
      });

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.release('evt-100', 'run-abc');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.released).toBe(true);
      }
    });

    it('returns released=false for non-existent lease (duplicate release)', async () => {
      mockRunTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const txn = {
          get: vi.fn().mockResolvedValue({ exists: false }),
          delete: vi.fn(),
        };
        return fn(txn);
      });

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.release('evt-999', 'run-abc');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.released).toBe(false);
      }
    });

    it('returns released=false when owner does not match', async () => {
      mockRunTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const txn = {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              owner: 'run-different',
              traceId: 'trace-001',
              acquiredAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
            }),
          }),
          delete: vi.fn(),
        };
        return fn(txn);
      });

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.release('evt-100', 'run-abc');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.released).toBe(false);
      }
    });

    it('handles Firestore errors during release', async () => {
      mockRunTransaction.mockRejectedValue(new Error('Delete failed'));

      const repo = createGithubWebhookAgentLeaseRepository({ logger: mockLogger });
      const result = await repo.release('evt-100', 'run-abc');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });
});
