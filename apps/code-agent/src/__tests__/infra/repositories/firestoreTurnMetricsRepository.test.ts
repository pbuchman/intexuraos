import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore, Timestamp as FirestoreTimestamp } from '@google-cloud/firestore';
import { Timestamp } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createFirestoreTurnMetricsRepository } from '../../../infra/repositories/firestoreTurnMetricsRepository.js';
import type { TurnMetrics } from '../../../domain/models/turnMetrics.js';

describe('FirestoreTurnMetricsRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  // Fixed time so `computeExpireAt` produces a deterministic Timestamp the tests
  // can assert against. expireAt = NOW + 7 days = 2026-05-06T00:00:00.000Z.
  const NOW = new Date('2026-04-29T00:00:00.000Z');
  const EXPECTED_EXPIRE_AT_MS = NOW.getTime() + 7 * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    resetFirestore();
  });

  const createMetrics = (overrides: Partial<TurnMetrics> = {}): TurnMetrics => ({
    taskId: 'task-123',
    attempt: 1,
    timestamp: '2025-01-01T01:00:00Z',
    cpuTimeSeconds: 3600,
    cpuCores: 2,
    peakMemoryMB: 2048,
    wallTimeSeconds: 3600,
    apiWaitSeconds: 1368,
    toolExecSeconds: 612,
    backgroundWaitSeconds: 1620,
    overheadSeconds: 0,
    totalInputTokens: 50000,
    totalOutputTokens: 10000,
    totalCacheReadTokens: 40000,
    totalCacheCreationTokens: 5000,
    apiCallCount: 25,
    cpuUtilizationPercent: 50,
    idlePercent: 83,
    ...overrides,
  });

  describe('store', () => {
    it('stores metrics with padded attempt number as doc ID', async () => {
      const repo = createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const metrics = createMetrics();
      const result = await repo.store('task-123', 1, metrics);

      expect(result.ok).toBe(true);

      // Verify data was stored under correct path
      const docRef = (fakeFirestore as unknown as Firestore)
        .collection('code_tasks')
        .doc('task-123')
        .collection('turn_metrics')
        .doc('0001');
      const doc = await docRef.get();
      expect(doc.exists).toBe(true);
      expect(doc.data()?.['cpuTimeSeconds']).toBe(3600);
    });

    it('stores metrics for multi-digit attempt numbers', async () => {
      const repo = createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const metrics = createMetrics({ attempt: 12 });
      const result = await repo.store('task-456', 12, metrics);

      expect(result.ok).toBe(true);

      const docRef = (fakeFirestore as unknown as Firestore)
        .collection('code_tasks')
        .doc('task-456')
        .collection('turn_metrics')
        .doc('0012');
      const doc = await docRef.get();
      expect(doc.exists).toBe(true);
    });

    it('writes expireAt = now + 7d for Firestore native TTL', async () => {
      const repo = createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.store('task-ttl', 1, createMetrics());

      const docRef = (fakeFirestore as unknown as Firestore)
        .collection('code_tasks')
        .doc('task-ttl')
        .collection('turn_metrics')
        .doc('0001');
      const doc = await docRef.get();
      const data = doc.data();
      expect(data?.['expireAt']).toBeDefined();
      const expireAt = data?.['expireAt'] as FirestoreTimestamp;
      expect(expireAt).toBeInstanceOf(Timestamp);
      expect(expireAt.toMillis()).toBe(EXPECTED_EXPIRE_AT_MS);
    });

    it('returns error when Firestore fails', async () => {
      // Create a repo with a firestore that throws on set
      const brokenFirestore = {
        collection: (): object => ({
          doc: (): object => ({
            collection: (): object => ({
              doc: (): object => ({
                set: (): never => {
                  throw new Error('Firestore unavailable');
                },
              }),
            }),
          }),
        }),
      } as unknown as Firestore;

      const repo = createFirestoreTurnMetricsRepository({
        firestore: brokenFirestore,
        logger,
      });

      const metrics = createMetrics();
      const result = await repo.store('task-123', 1, metrics);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });

  describe('listByTask', () => {
    it('returns all stored metrics ordered by attempt ascending', async () => {
      const repo = createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.store('task-123', 2, createMetrics({ attempt: 2, timestamp: '2025-01-01T02:00:00Z' }));
      await repo.store('task-123', 1, createMetrics({ attempt: 1, timestamp: '2025-01-01T01:00:00Z' }));

      const result = await repo.listByTask('task-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.map((metric) => metric.attempt)).toEqual([1, 2]);
    });

    it('returns FIRESTORE_ERROR when query fails', async () => {
      const brokenFirestore = {
        collection: (): object => ({
          doc: (): object => ({
            collection: (): object => ({
              orderBy: (): object => ({
                get: (): never => {
                  throw new Error('Firestore unavailable');
                },
              }),
            }),
          }),
        }),
      } as unknown as Firestore;

      const repo = createFirestoreTurnMetricsRepository({
        firestore: brokenFirestore,
        logger,
      });

      const result = await repo.listByTask('task-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FIRESTORE_ERROR');
      }
    });
  });
});
