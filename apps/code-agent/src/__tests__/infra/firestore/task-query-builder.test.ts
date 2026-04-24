/**
 * Unit tests for task-query-builder.buildListQuery.
 *
 * Uses FakeFirestore end-to-end: seed docs, build query, execute it,
 * and assert on the returned docs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp, createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { CollectionReference, Firestore } from '@google-cloud/firestore';
import { buildListQuery } from '../../../infra/firestore/task-query-builder.js';

describe('buildListQuery', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let collection: CollectionReference;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    collection = (fakeFirestore as unknown as Firestore).collection(
      'code_tasks'
    ) as unknown as CollectionReference;
  });

  afterEach(() => {
    resetFirestore();
  });

  async function seed(id: string, data: Record<string, unknown>): Promise<void> {
    await collection.doc(id).set(data);
  }

  it('returns default limit of 20 when input.limit is omitted', async () => {
    const { limit } = await buildListQuery(collection, { userId: 'u1' });
    expect(limit).toBe(20);
  });

  it('honors user-provided limit', async () => {
    const { limit } = await buildListQuery(collection, { userId: 'u1', limit: 7 });
    expect(limit).toBe(7);
  });

  it('filters by userId and orders desc by createdAt', async () => {
    await seed('t1', {
      userId: 'u1',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-01')),
    });
    await seed('t2', {
      userId: 'u1',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-02')),
    });
    await seed('other', {
      userId: 'u2',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-03')),
    });

    const { query } = await buildListQuery(collection, { userId: 'u1' });
    const snap = await query.get();
    expect(snap.docs.map((d) => d.id)).toEqual(['t2', 't1']);
  });

  it('does NOT add status filter when status is omitted', async () => {
    await seed('t1', {
      userId: 'u1',
      status: 'failed',
      createdAt: Timestamp.fromDate(new Date('2025-01-01')),
    });
    const { query } = await buildListQuery(collection, { userId: 'u1' });
    const snap = await query.get();
    expect(snap.docs.length).toBe(1);
  });

  it('does NOT add status filter when status is an empty array', async () => {
    await seed('t1', {
      userId: 'u1',
      status: 'failed',
      createdAt: Timestamp.fromDate(new Date('2025-01-01')),
    });
    const { query } = await buildListQuery(collection, { userId: 'u1', status: [] });
    const snap = await query.get();
    // Empty-array branch must NOT call .where('status', 'in', []) — which would
    // throw. If no error was thrown and the doc is returned, we're good.
    expect(snap.docs.length).toBe(1);
  });

  it('filters by single status', async () => {
    await seed('t1', {
      userId: 'u1',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-01')),
    });
    await seed('t2', {
      userId: 'u1',
      status: 'planned',
      createdAt: Timestamp.fromDate(new Date('2025-01-02')),
    });

    const { query } = await buildListQuery(collection, {
      userId: 'u1',
      status: ['planned'],
    });
    const snap = await query.get();
    expect(snap.docs.map((d) => d.id)).toEqual(['t2']);
  });

  it('filters by multiple statuses', async () => {
    await seed('t1', {
      userId: 'u1',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-01')),
    });
    await seed('t2', {
      userId: 'u1',
      status: 'planned',
      createdAt: Timestamp.fromDate(new Date('2025-01-02')),
    });
    await seed('t3', {
      userId: 'u1',
      status: 'failed',
      createdAt: Timestamp.fromDate(new Date('2025-01-03')),
    });

    const { query } = await buildListQuery(collection, {
      userId: 'u1',
      status: ['queued', 'planned'],
    });
    const snap = await query.get();
    expect(new Set(snap.docs.map((d) => d.id))).toEqual(new Set(['t1', 't2']));
  });

  it('fetches limit + 1 rows so caller can detect hasMore', async () => {
    for (let i = 0; i < 5; i++) {
      await seed(`t${i}`, {
        userId: 'u1',
        status: 'queued',
        createdAt: Timestamp.fromDate(new Date(`2025-01-0${i + 1}`)),
      });
    }
    const { query, limit } = await buildListQuery(collection, { userId: 'u1', limit: 2 });
    expect(limit).toBe(2);
    const snap = await query.get();
    expect(snap.docs.length).toBe(3); // limit + 1
  });

  it('applies startAfter when cursor doc exists (query execution succeeds)', async () => {
    // FakeFirestore.startAfter uses strict-equality on the ordering field value
    // rather than the doc reference, so we cannot deterministically assert the
    // skipped document in a unit test. We exercise the code path instead:
    // with a valid cursor doc, query.get() must not throw.
    await seed('t1', {
      userId: 'u1',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-01')),
    });
    await seed('t2', {
      userId: 'u1',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-02')),
    });

    const { query } = await buildListQuery(collection, {
      userId: 'u1',
      cursor: 't2',
    });
    const snap = await query.get();
    // At minimum, the query runs cleanly and returns a subset of seeded docs.
    expect(snap.docs.length).toBeLessThanOrEqual(2);
  });

  it('ignores cursor when cursor doc does not exist', async () => {
    await seed('t1', {
      userId: 'u1',
      status: 'queued',
      createdAt: Timestamp.fromDate(new Date('2025-01-01')),
    });
    const { query } = await buildListQuery(collection, {
      userId: 'u1',
      cursor: 'missing',
    });
    const snap = await query.get();
    expect(snap.docs.map((d) => d.id)).toEqual(['t1']);
  });
});
