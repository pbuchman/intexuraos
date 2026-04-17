import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreBackfillRunRepository, type BackfillRun } from '../../../infra/firestore/firestoreBackfillRunRepository.js';
import { resetFirestoreFake, useFirestoreFake } from './helpers/firestoreFake.js';
import type { FakeFirestore } from '@intexuraos/infra-firestore';

const NOW = '2026-04-15T00:00:00.000Z';

function makeRun(runId: string): BackfillRun {
  return {
    runId,
    userId: 'u',
    groupKey: 'g',
    fromDate: '2026-04-01',
    toDate: '2026-04-15',
    status: 'queued',
    totalDates: 15,
    completedDates: [],
    failedDates: [],
    currentDate: '2026-04-01',
    startedAt: NOW,
    updatedAt: NOW,
  };
}

describe('FirestoreBackfillRunRepository', () => {
  let fake: FakeFirestore;
  beforeEach(() => { fake = useFirestoreFake(); });
  afterEach(() => resetFirestoreFake());

  it('creates a run doc and finds it by id', async () => {
    const repo = new FirestoreBackfillRunRepository();
    const run = makeRun('bf_001');
    const created = await repo.create(run);
    expect(created.ok).toBe(true);

    const found = await repo.findById('bf_001');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).not.toBeNull();
    expect(found.value?.runId).toBe('bf_001');
    expect(found.value?.status).toBe('queued');
  });

  it('findById returns null when doc does not exist', async () => {
    const repo = new FirestoreBackfillRunRepository();
    const result = await repo.findById('nonexistent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('update changes status and updatedAt', async () => {
    const repo = new FirestoreBackfillRunRepository();
    const run = makeRun('bf_002');
    await repo.create(run);

    const updated = await repo.update('bf_002', { status: 'running', currentDate: '2026-04-02' });
    expect(updated.ok).toBe(true);

    const found = await repo.findById('bf_002');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.status).toBe('running');
    expect(found.value?.currentDate).toBe('2026-04-02');
  });

  it('create returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.create(makeRun('bf_003'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('findById returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.findById('bf_004');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('update returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.update('bf_005', { status: 'completed' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
