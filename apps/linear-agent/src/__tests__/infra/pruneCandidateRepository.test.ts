import type { Firestore } from '@google-cloud/firestore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { createPruneCandidateRepository } from '../../infra/firestore/pruneCandidateRepository.js';
import type { StoredPruneCandidate } from '../../domain/models.js';

describe('createPruneCandidateRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  function makeCandidate(index: number): StoredPruneCandidate {
    return {
      id: `issue-${String(index).padStart(3, '0')}`,
      identifier: `INT-${String(index)}`,
      title: `Candidate ${String(index)}`,
      score: 1_000 - index,
      reason: `Reason ${String(index)}`,
      category: 'duplicate',
      classifiedAt: new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString(),
    };
  }

  it('returns an empty list when no candidates exist', async () => {
    const repo = createPruneCandidateRepository();

    const result = await repo.listAll();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('lists candidates across multiple batches in descending score order', async () => {
    const repo = createPruneCandidateRepository();
    const candidates = Array.from({ length: 501 }, (_, index) => makeCandidate(index));

    const storeResult = await repo.storeAll(candidates);
    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) return;

    const result = await repo.listAll();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(501);
      expect(result.value[0]?.id).toBe('issue-000');
      expect(result.value[500]?.id).toBe('issue-500');
    }
  });
});
