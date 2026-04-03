import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';

import { createFirestoreLogLineRepository } from '../../../infra/repositories/firestoreLogLineRepository.js';

describe('firestoreLogLineRepository listRecent', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(() => {
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
    resetFirestore();
  });

  it('returns the most recent log lines in chronological order', async () => {
    const repo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    await repo.storeBatch('task-123', [
      { sequence: 1, text: 'line 1', timestamp: Timestamp.fromDate(new Date('2025-01-01T00:00:01Z')) },
      { sequence: 2, text: 'line 2', timestamp: Timestamp.fromDate(new Date('2025-01-01T00:00:02Z')) },
      { sequence: 3, text: 'line 3', timestamp: Timestamp.fromDate(new Date('2025-01-01T00:00:03Z')) },
    ]);

    const result = await repo.listRecent('task-123', 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((line) => line.sequence)).toEqual([2, 3]);
    expect(result.value.map((line) => line.text)).toEqual(['line 2', 'line 3']);
  });

  it('returns FIRESTORE_ERROR when the query fails', async () => {
    const brokenFirestore = {
      collection: (): object => ({
        doc: (): object => ({
          collection: (): object => ({
            orderBy: (): object => ({
              limit: (): object => ({
                get: (): never => {
                  throw new Error('Read failed');
                },
              }),
            }),
          }),
        }),
      }),
    } as unknown as Firestore;

    const repo = createFirestoreLogLineRepository({
      firestore: brokenFirestore,
      logger,
    });

    const result = await repo.listRecent('task-123', 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FIRESTORE_ERROR');
    }
  });

  it('falls back to default sequence and text for malformed log documents', async () => {
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          data: (): Record<string, unknown> => ({
            timestamp: Timestamp.fromDate(new Date('2025-01-01T00:00:03Z')),
          }),
        },
      ],
    });
    const firestore = {
      collection: (): object => ({
        doc: (): object => ({
          collection: (): object => ({
            orderBy: (): object => ({
              limit: (): object => ({ get }),
            }),
          }),
        }),
      }),
    } as unknown as Firestore;

    const repo = createFirestoreLogLineRepository({
      firestore,
      logger,
    });

    const result = await repo.listRecent('task-123', 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      expect.objectContaining({
        sequence: 0,
        text: '',
      }),
    ]);
  });
});
