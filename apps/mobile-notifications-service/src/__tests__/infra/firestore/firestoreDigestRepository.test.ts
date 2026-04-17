import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreDigestRepository } from '../../../infra/firestore/firestoreDigestRepository.js';
import { COLD_START_EXAMPLE as COLD_START } from '@intexuraos/llm-prompts';
import { resetFirestoreFake, useFirestoreFake } from './helpers/firestoreFake.js';
import type { DailySummary } from '../../../domain/schemas/digestSchemas.js';
import type { FakeFirestore } from '@intexuraos/infra-firestore';

// COLD_START uses readonly tuple literals; cast to mutable DailySummary for repository tests
const EXAMPLE_SUMMARY = COLD_START.dailySummary as unknown as DailySummary;

describe('FirestoreDigestRepository', () => {
  let fake: FakeFirestore;
  beforeEach(() => { fake = useFirestoreFake(); });
  afterEach(() => resetFirestoreFake());

  it('saves a new summary with generation = 1', async () => {
    const repo = new FirestoreDigestRepository();
    const result = await repo.save({
      userId: 'u', groupKey: 'g', summary: EXAMPLE_SUMMARY, modelId: 'or:google/gemini-3-flash-preview',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generation).toBe(1);
    expect(result.value.modelId).toBe('or:google/gemini-3-flash-preview');
  });

  it('increments generation when saving over an existing date', async () => {
    const repo = new FirestoreDigestRepository();
    await repo.save({ userId: 'u', groupKey: 'g', summary: EXAMPLE_SUMMARY, modelId: 'm' });
    const second = await repo.save({ userId: 'u', groupKey: 'g', summary: EXAMPLE_SUMMARY, modelId: 'm' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.generation).toBe(2);
  });

  it('findByDate returns null when missing', async () => {
    const repo = new FirestoreDigestRepository();
    const result = await repo.findByDate({ userId: 'u', groupKey: 'g', date: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('findRecentByGroup returns docs ordered by date desc', async () => {
    const repo = new FirestoreDigestRepository();
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10']) {
      await repo.save({
        userId: 'u', groupKey: 'g',
        summary: { ...EXAMPLE_SUMMARY, date: d },
        modelId: 'm',
      });
    }
    const result = await repo.findRecentByGroup({ userId: 'u', groupKey: 'g', limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.summary.date)).toEqual(['2026-04-10', '2026-04-09']);
  });

  it('findInRange respects fromDate, toDate, and limit', async () => {
    const repo = new FirestoreDigestRepository();
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12']) {
      await repo.save({
        userId: 'u', groupKey: 'g',
        summary: { ...EXAMPLE_SUMMARY, date: d },
        modelId: 'm',
      });
    }
    const result = await repo.findInRange({
      userId: 'u', groupKey: 'g',
      fromDate: '2026-04-09', toDate: '2026-04-11', limit: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((p) => p.summary.date).sort()).toEqual(['2026-04-09', '2026-04-10', '2026-04-11']);
  });

  it('findInRange returns nextCursor when more results exist beyond limit', async () => {
    const repo = new FirestoreDigestRepository();
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12']) {
      await repo.save({
        userId: 'u', groupKey: 'g',
        summary: { ...EXAMPLE_SUMMARY, date: d },
        modelId: 'm',
      });
    }
    const result = await repo.findInRange({
      userId: 'u', groupKey: 'g',
      fromDate: '2026-04-08', toDate: '2026-04-12', limit: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBe(2);
    expect(result.value.nextCursor).toBeDefined();
  });

  it('findInRange uses cursor to paginate', async () => {
    const repo = new FirestoreDigestRepository();
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12']) {
      await repo.save({
        userId: 'u', groupKey: 'g',
        summary: { ...EXAMPLE_SUMMARY, date: d },
        modelId: 'm',
      });
    }
    const first = await repo.findInRange({ userId: 'u', groupKey: 'g', fromDate: '2026-04-08', toDate: '2026-04-12', limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cursor = first.value.nextCursor;
    const second = await repo.findInRange({ userId: 'u', groupKey: 'g', fromDate: '2026-04-08', toDate: '2026-04-12', limit: 2, cursor });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items.length).toBeGreaterThan(0);
  });

  it('findByDate returns error on Firestore failure', async () => {
    const repo = new FirestoreDigestRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.findByDate({ userId: 'u', groupKey: 'g', date: '2026-04-15' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('findRecentByGroup returns error on Firestore failure', async () => {
    const repo = new FirestoreDigestRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.findRecentByGroup({ userId: 'u', groupKey: 'g', limit: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('findInRange returns error on Firestore failure', async () => {
    const repo = new FirestoreDigestRepository();
    fake.configure({ errorToThrow: new Error('DB error') });
    const result = await repo.findInRange({ userId: 'u', groupKey: 'g', fromDate: '2026-04-08', toDate: '2026-04-12', limit: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });
});
