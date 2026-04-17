import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreBackfillRunRepository } from '../../../infra/firestore/firestoreBackfillRunRepository.js';
import type { BackfillRun } from '../../../domain/repositories/digestRepositories.js';
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

  it('markDayComplete appends to completedDates and moves currentDate', async () => {
    const repo = new FirestoreBackfillRunRepository();
    await repo.create(makeRun('bf_002'));

    const r1 = await repo.markDayComplete({ runId: 'bf_002', completedDate: '2026-04-01', nextCurrentDate: '2026-04-02' });
    expect(r1.ok).toBe(true);
    const r2 = await repo.markDayComplete({ runId: 'bf_002', completedDate: '2026-04-02', nextCurrentDate: '2026-04-03' });
    expect(r2.ok).toBe(true);

    const found = await repo.findById('bf_002');
    if (!found.ok || found.value === null) throw new Error('unexpected');
    expect(found.value.completedDates).toEqual(['2026-04-01', '2026-04-02']);
    expect(found.value.currentDate).toBe('2026-04-03');
  });

  it('markDayFailed appends to failedDates and optionally sets status=failed', async () => {
    const repo = new FirestoreBackfillRunRepository();
    await repo.create(makeRun('bf_003'));

    const r = await repo.markDayFailed({
      runId: 'bf_003',
      failure: { date: '2026-04-01', error: 'boom' },
      markRunFailed: true,
    });
    expect(r.ok).toBe(true);

    const found = await repo.findById('bf_003');
    if (!found.ok || found.value === null) throw new Error('unexpected');
    expect(found.value.failedDates).toEqual([{ date: '2026-04-01', error: 'boom' }]);
    expect(found.value.status).toBe('failed');
  });

  it('markDayFailed with markRunFailed=false preserves status', async () => {
    const repo = new FirestoreBackfillRunRepository();
    await repo.create(makeRun('bf_004'));

    await repo.markDayFailed({
      runId: 'bf_004',
      failure: { date: '2026-04-01', error: 'transient' },
      markRunFailed: false,
    });

    const found = await repo.findById('bf_004');
    if (!found.ok || found.value === null) throw new Error('unexpected');
    expect(found.value.status).toBe('queued');
  });

  it('markRunCompleted sets status=completed and completedAt', async () => {
    const repo = new FirestoreBackfillRunRepository();
    await repo.create(makeRun('bf_005'));

    const r = await repo.markRunCompleted('bf_005');
    expect(r.ok).toBe(true);

    const found = await repo.findById('bf_005');
    if (!found.ok || found.value === null) throw new Error('unexpected');
    expect(found.value.status).toBe('completed');
    expect(found.value.completedAt).toBeDefined();
  });

  it('create returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.create(makeRun('bf_006'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('findById returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.findById('bf_007');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('markDayComplete returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.markDayComplete({ runId: 'bf_008', completedDate: '2026-04-01', nextCurrentDate: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('markDayFailed returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.markDayFailed({
      runId: 'bf_009',
      failure: { date: '2026-04-01', error: 'x' },
      markRunFailed: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('markRunCompleted returns error on Firestore failure', async () => {
    const repo = new FirestoreBackfillRunRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.markRunCompleted('bf_010');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
