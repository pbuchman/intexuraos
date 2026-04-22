import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreGroupStateRepository } from '../../../infra/firestore/firestoreGroupStateRepository.js';
import { COLD_START_EXAMPLE as COLD_START } from '@intexuraos/llm-prompts';
import { resetFirestoreFake, useFirestoreFake } from './helpers/firestoreFake.js';
import type { GroupState } from '../../../domain/schemas/digestSchemas.js';
import type { FakeFirestore } from '@intexuraos/infra-firestore';

// COLD_START uses readonly tuple literals; cast to mutable GroupState for repository tests
const EXAMPLE_STATE = COLD_START.stateUpdate as unknown as GroupState;

describe('FirestoreGroupStateRepository', () => {
  let fake: FakeFirestore;
  beforeEach(() => { fake = useFirestoreFake(); });
  afterEach(() => resetFirestoreFake());

  it('save then getByDate roundtrips a snapshot', async () => {
    const repo = new FirestoreGroupStateRepository();
    await repo.save({ state: EXAMPLE_STATE, date: '2026-04-08' });
    const result = await repo.getByDate({ userId: EXAMPLE_STATE.userId, groupKey: EXAMPLE_STATE.groupKey, date: '2026-04-08' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
  });

  it('getByDate returns null for missing snapshot', async () => {
    const repo = new FirestoreGroupStateRepository();
    const result = await repo.getByDate({ userId: 'u', groupKey: 'g', date: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('getLatest returns the snapshot with the highest date', async () => {
    const repo = new FirestoreGroupStateRepository();
    const userId = EXAMPLE_STATE.userId;
    const groupKey = EXAMPLE_STATE.groupKey;
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10']) {
      await repo.save({ state: { ...EXAMPLE_STATE, recentSummaryDates: [d] }, date: d });
    }
    const result = await repo.getLatest({ userId, groupKey });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) return;
    expect(result.value.recentSummaryDates).toEqual(['2026-04-10']);
  });

  it('save trims recentSummaryDates to the last 30', async () => {
    const repo = new FirestoreGroupStateRepository();
    const dates = Array.from({ length: 35 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
    const stateWithLong = { ...EXAMPLE_STATE, recentSummaryDates: dates };
    await repo.save({ state: stateWithLong, date: '2026-04-08' });
    const result = await repo.getByDate({ userId: stateWithLong.userId, groupKey: stateWithLong.groupKey, date: '2026-04-08' });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) return;
    expect(result.value.recentSummaryDates.length).toBe(30);
    expect(result.value.recentSummaryDates[0]).toBe('2026-03-06'); // oldest after trim
  });

  it('getLatest returns null when no snapshots exist', async () => {
    const repo = new FirestoreGroupStateRepository();
    const result = await repo.getLatest({ userId: 'u', groupKey: 'g' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('getByDate returns error on Firestore failure', async () => {
    const repo = new FirestoreGroupStateRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.getByDate({ userId: 'u', groupKey: 'g', date: '2026-04-15' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('getLatest returns error on Firestore failure', async () => {
    const repo = new FirestoreGroupStateRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.getLatest({ userId: 'u', groupKey: 'g' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('save returns error on Firestore failure', async () => {
    const repo = new FirestoreGroupStateRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.save({ state: EXAMPLE_STATE, date: '2026-04-08' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
