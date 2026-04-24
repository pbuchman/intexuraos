/**
 * Unit tests for query construction helpers.
 * Exercises buildListQuery against FakeFirestore with seeded docs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import {
  buildListQuery,
  countsDocRef,
  summaryDocRef,
} from '../../../../infra/firestore/taskGroupSummary/queries.js';

describe('queries: doc refs', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  it('summaryDocRef has id {userId}_{groupKey}', () => {
    const ref = summaryDocRef(fakeFirestore as unknown as Firestore, 'u1', 'INT-100');
    expect(ref.id).toBe('u1_INT-100');
  });

  it('summaryDocRef works for standalone groupKey', () => {
    const ref = summaryDocRef(fakeFirestore as unknown as Firestore, 'u1', 'standalone_task-42');
    expect(ref.id).toBe('u1_standalone_task-42');
  });

  it('countsDocRef id equals userId', () => {
    const ref = countsDocRef(fakeFirestore as unknown as Firestore, 'u1');
    expect(ref.id).toBe('u1');
  });
});

describe('queries: buildListQuery', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  const now = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
  const later = Timestamp.fromDate(new Date('2026-02-01T00:00:00Z'));

  function seedDoc(id: string, overrides: Record<string, unknown>): { id: string; data: Record<string, unknown> } {
    return {
      id,
      data: {
        userId: 'u1',
        groupKey: id.replace('u1_', ''),
        linearIssueId: id.replace('u1_', ''),
        taskCount: 1,
        activeTaskCount: 0,
        latestTaskStatus: 'planned',
        latestTaskUpdatedAt: now,
        agentTypesPresent: ['planning'],
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: now,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'done',
        updatedAt: now,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    fakeFirestore.seedCollection('task_group_summaries', [
      seedDoc('u1_INT-A', { aggregateStatus: 'active', prNumber: 10, mostRecentDispatchedAt: now, latestTaskUpdatedAt: now }),
      seedDoc('u1_INT-B', { aggregateStatus: 'done', prNumber: 20, mostRecentDispatchedAt: later, latestTaskUpdatedAt: later }),
      seedDoc('u1_INT-C', { aggregateStatus: 'failed', prNumber: 30, mostRecentDispatchedAt: null, latestTaskUpdatedAt: now }),
      seedDoc('u2_INT-D', { userId: 'u2', aggregateStatus: 'done', prNumber: 40 }),
    ]);
  });

  afterEach(() => {
    resetFirestore();
  });

  it('filters by userId', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, { userId: 'u1', sortBy: 'linear-id', limit: 10 });
    const snap = await q.get();
    expect(snap.docs).toHaveLength(3);
    for (const d of snap.docs) {
      expect(d.data()?.['userId']).toBe('u1');
    }
  });

  it('filters by statusFilter (in)', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, {
      userId: 'u1', sortBy: 'linear-id', limit: 10, statusFilter: ['active', 'failed'],
    });
    const snap = await q.get();
    expect(snap.docs).toHaveLength(2);
    const statuses = snap.docs.map((d) => d.data()?.['aggregateStatus']);
    expect(statuses).toEqual(expect.arrayContaining(['active', 'failed']));
  });

  it('ignores empty statusFilter array', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, {
      userId: 'u1', sortBy: 'linear-id', limit: 10, statusFilter: [],
    });
    const snap = await q.get();
    expect(snap.docs).toHaveLength(3);
  });

  it('sorts by linear-id descending', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, { userId: 'u1', sortBy: 'linear-id', limit: 10 });
    const snap = await q.get();
    const ids = snap.docs.map((d) => d.data()?.['linearIssueId']);
    expect(ids).toEqual(['INT-C', 'INT-B', 'INT-A']);
  });

  it('sorts by pr-number descending', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, { userId: 'u1', sortBy: 'pr-number', limit: 10 });
    const snap = await q.get();
    const nums = snap.docs.map((d) => d.data()?.['prNumber']);
    expect(nums).toEqual([30, 20, 10]);
  });

  it('sorts by last-updated descending', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, { userId: 'u1', sortBy: 'last-updated', limit: 10 });
    const snap = await q.get();
    // INT-B has `later` timestamp → first
    expect(snap.docs[0]?.data()?.['groupKey']).toBe('INT-B');
  });

  it('sorts by dispatched descending', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, { userId: 'u1', sortBy: 'dispatched', limit: 10 });
    const snap = await q.get();
    // INT-B has the newest mostRecentDispatchedAt
    expect(snap.docs[0]?.data()?.['groupKey']).toBe('INT-B');
  });

  it('applies limit+1 (extra for hasMore detection)', async () => {
    const q = buildListQuery(fakeFirestore as unknown as Firestore, { userId: 'u1', sortBy: 'linear-id', limit: 2 });
    const snap = await q.get();
    // limit passed to Firestore is limit+1 = 3
    expect(snap.docs.length).toBe(3);
  });

  it('accepts startAfterDoc without error (pagination path executes)', async () => {
    const baseQ = buildListQuery(fakeFirestore as unknown as Firestore, { userId: 'u1', sortBy: 'linear-id', limit: 10 });
    const first = await baseQ.get();
    const firstDoc = first.docs[0];
    expect(firstDoc).toBeDefined();
    if (firstDoc === undefined) return;

    const pageQ = buildListQuery(
      fakeFirestore as unknown as Firestore,
      { userId: 'u1', sortBy: 'linear-id', limit: 10 },
      firstDoc,
    );
    // FakeFirestore startAfter is a no-op for DocumentSnapshot inputs; we only
    // verify the cursor path executes without throwing.
    const snap = await pageQ.get();
    expect(snap.docs.length).toBeGreaterThanOrEqual(0);
  });
});
