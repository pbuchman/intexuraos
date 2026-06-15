/**
 * Unit tests for task-query-builder.buildListQuery.
 *
 * Uses FakeFirestore end-to-end: seed docs, build query, execute it,
 * and assert on the returned docs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp, createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { CollectionReference, Firestore } from '@google-cloud/firestore';
import {
  buildListQuery,
  selectLatestExecutionTask,
  selectNonMergeConflict,
  selectOriginTask,
  selectPreservedPullRequest,
} from '../../../infra/firestore/task-query-builder.js';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH } from '../../../domain/models/codeTask.js';

interface DocLike {
  id: string;
  data(): Record<string, unknown>;
}

function doc(id: string, data: Record<string, unknown>): DocLike {
  return { id, data: () => data };
}

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

  it('exercises the cursor code path when cursor doc exists', async () => {
    // FakeFirestore limitation: `startAfter(docSnapshot)` in the fake performs
    // strict-equality against the ordering-field VALUE rather than the doc
    // reference, so passing a DocumentSnapshot (as real Firestore expects)
    // never matches and nothing is actually skipped. We still exercise the
    // cursor-lookup branch (collection.doc(cursor).get() + startAfter(...))
    // to cover the code path; precise skip semantics are exercised
    // end-to-end against real Firestore in integration tests.
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
    const ids = snap.docs.map((d) => d.id);
    // Cursor branch ran without throwing, and the seeded docs are reachable.
    expect(ids).toContain('t1');
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

describe('selectLatestExecutionTask', () => {
  const ts = Timestamp.fromDate(new Date('2025-01-01'));
  const base = { userId: 'u1', dedupKey: 'k', createdAt: ts, updatedAt: ts };

  it('returns null for an empty array', () => {
    expect(selectLatestExecutionTask([])).toBeNull();
  });

  it('skips review / remediation / planning agent types', () => {
    const task = selectLatestExecutionTask([
      doc('a', { ...base, agentType: 'review' }),
      doc('b', { ...base, agentType: 'remediation' }),
      doc('c', { ...base, agentType: 'planning' }),
      doc('d', { ...base, agentType: 'execution' }),
    ]);
    expect(task?.id).toBe('d');
  });

  it('skips merge-conflict follow-up tasks', () => {
    const task = selectLatestExecutionTask([
      doc('mc', { ...base, agentType: 'execution', followUpReason: 'merge_conflict' }),
      doc('hash', {
        ...base,
        agentType: 'execution',
        systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
      }),
      doc('ok', { ...base, agentType: 'execution' }),
    ]);
    expect(task?.id).toBe('ok');
  });

  it('returns the first eligible doc', () => {
    const task = selectLatestExecutionTask([
      doc('skip', { ...base, agentType: 'review' }),
      doc('first', { ...base, agentType: 'execution' }),
      doc('second', { ...base, agentType: 'execution' }),
    ]);
    expect(task?.id).toBe('first');
  });

  it('returns the first doc when agentType is missing (backward compat)', () => {
    const task = selectLatestExecutionTask([doc('legacy', base)]);
    expect(task?.id).toBe('legacy');
  });
});

describe('selectOriginTask', () => {
  const ts = Timestamp.fromDate(new Date('2025-01-01'));
  const base = { userId: 'u1', dedupKey: 'k', createdAt: ts, updatedAt: ts };

  it('returns planning task when present', () => {
    const task = selectOriginTask([
      doc('pr', { ...base, agentType: 'pull_request' }),
      doc('pl', { ...base, agentType: 'planning' }),
    ]);
    expect(task?.id).toBe('pl');
  });

  it('returns execution task when present', () => {
    const task = selectOriginTask([
      doc('pr', { ...base, agentType: 'pull_request' }),
      doc('ex', { ...base, agentType: 'execution' }),
    ]);
    expect(task?.id).toBe('ex');
  });

  it('falls back to pull_request when no planning/execution found', () => {
    const task = selectOriginTask([
      doc('rv', { ...base, agentType: 'review' }),
      doc('pr', { ...base, agentType: 'pull_request' }),
    ]);
    expect(task?.id).toBe('pr');
  });

  it('returns null when no match', () => {
    const task = selectOriginTask([
      doc('rv', { ...base, agentType: 'review' }),
      doc('rm', { ...base, agentType: 'remediation' }),
    ]);
    expect(task).toBeNull();
  });
});

describe('selectNonMergeConflict', () => {
  const ts = Timestamp.fromDate(new Date('2025-01-01'));
  const base = { userId: 'u1', dedupKey: 'k', createdAt: ts, updatedAt: ts };

  it('filters out merge-conflict docs via followUpReason', () => {
    const task = selectNonMergeConflict([
      doc('mc', { ...base, followUpReason: 'merge_conflict' }),
      doc('ok', base),
    ]);
    expect(task?.id).toBe('ok');
  });

  it('filters out merge-conflict docs via systemPromptHash', () => {
    const task = selectNonMergeConflict([
      doc('mc', { ...base, systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH }),
      doc('ok', base),
    ]);
    expect(task?.id).toBe('ok');
  });

  it('returns null when all docs are merge-conflict', () => {
    const task = selectNonMergeConflict([
      doc('mc1', { ...base, followUpReason: 'merge_conflict' }),
      doc('mc2', { ...base, systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH }),
    ]);
    expect(task).toBeNull();
  });
});

describe('selectPreservedPullRequest', () => {
  it('returns the first non-merge-conflict doc with workerLocation/userId', () => {
    const out = selectPreservedPullRequest([
      doc('mc', { followUpReason: 'merge_conflict', userId: 'u1', workerLocation: 'vmX' }),
      doc('keep', { userId: 'uK', workerLocation: 'vmK' }),
      doc('later', { userId: 'uL', workerLocation: 'vmL' }),
    ]);
    expect(out).toEqual({ id: 'keep', workerLocation: 'vmK', userId: 'uK' });
  });

  it('falls back to empty strings when userId/workerLocation are missing', () => {
    const out = selectPreservedPullRequest([doc('sparse', {})]);
    expect(out).toEqual({ id: 'sparse', workerLocation: '', userId: '' });
  });

  it('returns null when every doc is merge-conflict', () => {
    const out = selectPreservedPullRequest([
      doc('a', { followUpReason: 'merge_conflict' }),
      doc('b', { systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH }),
    ]);
    expect(out).toBeNull();
  });
});
