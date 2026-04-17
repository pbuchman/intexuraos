import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreGroupStateRepository } from '../../../infra/firestore/firestoreGroupStateRepository.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { resetFirestoreFake, useFirestoreFake } from './helpers/firestoreFake.js';

describe('FirestoreGroupStateRepository', () => {
  beforeEach(() => useFirestoreFake());
  afterEach(() => resetFirestoreFake());

  it('save then getByDate roundtrips a snapshot', async () => {
    const repo = new FirestoreGroupStateRepository();
    await repo.save({ state: COLD_START_EXAMPLE.stateUpdate, date: '2026-04-08' });
    const result = await repo.getByDate({ userId: COLD_START_EXAMPLE.stateUpdate.userId, groupKey: COLD_START_EXAMPLE.stateUpdate.groupKey, date: '2026-04-08' });
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
    const userId = COLD_START_EXAMPLE.stateUpdate.userId;
    const groupKey = COLD_START_EXAMPLE.stateUpdate.groupKey;
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10']) {
      await repo.save({ state: { ...COLD_START_EXAMPLE.stateUpdate, recentSummaryDates: [d] }, date: d });
    }
    const result = await repo.getLatest({ userId, groupKey });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) return;
    expect(result.value.recentSummaryDates).toEqual(['2026-04-10']);
  });

  it('save trims recentSummaryDates to the last 30', async () => {
    const repo = new FirestoreGroupStateRepository();
    const dates = Array.from({ length: 35 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
    const stateWithLong = { ...COLD_START_EXAMPLE.stateUpdate, recentSummaryDates: dates };
    await repo.save({ state: stateWithLong, date: '2026-04-08' });
    const result = await repo.getByDate({ userId: stateWithLong.userId, groupKey: stateWithLong.groupKey, date: '2026-04-08' });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) return;
    expect(result.value.recentSummaryDates.length).toBe(30);
    expect(result.value.recentSummaryDates[0]).toBe('2026-03-06'); // oldest after trim
  });
});
