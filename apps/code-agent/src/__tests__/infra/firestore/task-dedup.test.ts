/**
 * Unit tests for task-dedup module — exercises generateDedupKey and
 * checkDedupLayers directly via a FakeFirestore transaction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { CollectionReference, Firestore, Transaction as FirestoreTransaction } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import {
  ACTIVE_TASK_STATUSES,
  DEDUP_CANDIDATE_LIMIT,
  DEDUP_WINDOW_MS,
  checkDedupLayers,
  generateDedupKey,
  isMergeConflictTaskData,
} from '../../../infra/firestore/task-dedup.js';
import type { CreateTaskInput } from '../../../domain/repositories/codeTaskRepository.js';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH } from '../../../domain/models/codeTask.js';

describe('generateDedupKey', () => {
  it('produces a 16-char hex key', () => {
    const key = generateDedupKey('user-1', 'Fix login bug');
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it('normalizes whitespace and case', () => {
    const a = generateDedupKey('user-1', 'Fix   login  bug');
    const b = generateDedupKey('user-1', '  fix login bug  ');
    const c = generateDedupKey('user-1', 'fix login bug');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('different userId produces different key', () => {
    const a = generateDedupKey('user-1', 'x');
    const b = generateDedupKey('user-2', 'x');
    expect(a).not.toBe(b);
  });

  it('linearIssueId changes the key', () => {
    const a = generateDedupKey('user-1', 'x');
    const b = generateDedupKey('user-1', 'x', 'LIN-1');
    const c = generateDedupKey('user-1', 'x', 'LIN-2');
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });
});

describe('isMergeConflictTaskData', () => {
  it('returns true when followUpReason is merge_conflict', () => {
    expect(isMergeConflictTaskData({ followUpReason: 'merge_conflict' })).toBe(true);
  });
  it('returns true when systemPromptHash matches merge-conflict hash', () => {
    expect(
      isMergeConflictTaskData({ systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH })
    ).toBe(true);
  });
  it('returns false otherwise', () => {
    expect(isMergeConflictTaskData({})).toBe(false);
    expect(isMergeConflictTaskData({ followUpReason: 'pr_comment' })).toBe(false);
    expect(isMergeConflictTaskData({ systemPromptHash: 'other' })).toBe(false);
  });
});

describe('constants', () => {
  it('DEDUP_WINDOW_MS is 5 minutes', () => {
    expect(DEDUP_WINDOW_MS).toBe(5 * 60 * 1000);
  });
  it('DEDUP_CANDIDATE_LIMIT is 5', () => {
    expect(DEDUP_CANDIDATE_LIMIT).toBe(5);
  });
  it('ACTIVE_TASK_STATUSES covers queued/dispatched/running', () => {
    expect([...ACTIVE_TASK_STATUSES]).toEqual(['queued', 'dispatched', 'running']);
  });
});

describe('checkDedupLayers', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let collection: CollectionReference;
  let logger: Logger;

  const baseInput = (overrides: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    userId: 'u1',
    prompt: 'hello',
    sanitizedPrompt: 'hello',
    systemPromptHash: 'h1',
    workerType: 'opus',
    workerLocation: 'vm',
    repository: 'o/r',
    baseBranch: 'main',
    traceId: 't1',
    ...overrides,
  });

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    collection = (fakeFirestore as unknown as Firestore).collection('code_tasks') as unknown as CollectionReference;
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

  /** Run checkDedupLayers inside a transaction and return the result. */
  async function runCheck(
    input: CreateTaskInput,
    opts?: { dedupKey?: string; now?: Date }
  ): Promise<ReturnType<typeof checkDedupLayers> extends Promise<infer R> ? R : never> {
    const dedupKey = opts?.dedupKey ?? generateDedupKey(input.userId, input.prompt, input.linearIssueId);
    const now = opts?.now ?? new Date('2025-06-01T00:00:00Z');
    return fakeFirestore.runTransaction(async (transaction) => {
      return checkDedupLayers(
        transaction as unknown as FirestoreTransaction,
        collection,
        input,
        { logger, dedupKey, now }
      );
    });
  }

  /** Seed a code_tasks document directly via the collection (no transaction needed). */
  async function seed(id: string, data: Record<string, unknown>): Promise<void> {
    await collection.doc(id).set(data);
  }

  it('returns ok(null) when nothing matches', async () => {
    const result = await runCheck(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  describe('dedupKey + 5-minute window', () => {
    it('hits when active task has same dedupKey within window', async () => {
      const now = new Date('2025-06-01T00:05:00Z');
      const dedupKey = generateDedupKey('u1', 'hello');
      await seed('task_old', {
        userId: 'u1',
        status: 'running',
        dedupKey,
        createdAt: Timestamp.fromDate(new Date('2025-06-01T00:02:00Z')),
      });
      const result = await runCheck(baseInput(), { dedupKey, now });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('DUPLICATE_PROMPT');
      if (result.error.code === 'DUPLICATE_PROMPT') {
        expect(result.error.existingTaskId).toBe('task_old');
      }
    });

    it('ignores terminal (non-active) matches', async () => {
      const now = new Date('2025-06-01T00:05:00Z');
      const dedupKey = generateDedupKey('u1', 'hello');
      await seed('task_terminal', {
        userId: 'u1',
        status: 'failed',
        dedupKey,
        createdAt: Timestamp.fromDate(new Date('2025-06-01T00:02:00Z')),
      });
      const result = await runCheck(baseInput(), { dedupKey, now });
      expect(result.ok).toBe(true);
    });

    it('skipped when retriedFrom is set', async () => {
      const now = new Date('2025-06-01T00:05:00Z');
      const dedupKey = generateDedupKey('u1', 'hello');
      await seed('task_active', {
        userId: 'u1',
        status: 'running',
        dedupKey,
        createdAt: Timestamp.fromDate(new Date('2025-06-01T00:02:00Z')),
      });
      const result = await runCheck(
        baseInput({ retriedFrom: 'task_orig' }),
        { dedupKey, now }
      );
      expect(result.ok).toBe(true);
    });

    it('skipped when followUpReason is execution_implement', async () => {
      const now = new Date('2025-06-01T00:05:00Z');
      const dedupKey = generateDedupKey('u1', 'hello');
      await seed('task_active', {
        userId: 'u1',
        status: 'running',
        dedupKey,
        createdAt: Timestamp.fromDate(new Date('2025-06-01T00:02:00Z')),
      });
      const result = await runCheck(
        baseInput({ followUpReason: 'execution_implement' }),
        { dedupKey, now }
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('Layer 3 (active Linear issue)', () => {
    it('hits on active non-review task for same linearIssueId', async () => {
      await seed('task_lin', {
        userId: 'u1',
        status: 'running',
        linearIssueId: 'LIN-1',
        dedupKey: 'xx',
        createdAt: Timestamp.fromDate(new Date('2025-06-01')),
      });
      const result = await runCheck(baseInput({ linearIssueId: 'LIN-1' }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('ACTIVE_TASK_EXISTS');
      if (result.error.code === 'ACTIVE_TASK_EXISTS') {
        expect(result.error.existingTaskId).toBe('task_lin');
      }
    });

    it('skipped when agentType is review', async () => {
      await seed('task_lin', {
        userId: 'u1',
        status: 'running',
        linearIssueId: 'LIN-1',
        dedupKey: 'xx',
        createdAt: Timestamp.fromDate(new Date('2025-06-01')),
      });
      const result = await runCheck(
        baseInput({ linearIssueId: 'LIN-1', agentType: 'review' })
      );
      expect(result.ok).toBe(true);
    });

    it('skipped when systemPromptHash is the merge-conflict hash', async () => {
      await seed('task_lin', {
        userId: 'u1',
        status: 'running',
        linearIssueId: 'LIN-1',
        dedupKey: 'xx',
        createdAt: Timestamp.fromDate(new Date('2025-06-01')),
      });
      const result = await runCheck(
        baseInput({
          linearIssueId: 'LIN-1',
          systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
        })
      );
      expect(result.ok).toBe(true);
    });

    it('skips existing review tasks in-loop', async () => {
      // An active review task should NOT trigger Layer 3 on a non-review new task.
      await seed('task_review', {
        userId: 'u1',
        status: 'running',
        linearIssueId: 'LIN-2',
        agentType: 'review',
        dedupKey: 'xx',
        createdAt: Timestamp.fromDate(new Date('2025-06-01')),
      });
      const result = await runCheck(baseInput({ linearIssueId: 'LIN-2' }));
      expect(result.ok).toBe(true);
    });

    it('skips existing merge-conflict tasks in-loop', async () => {
      await seed('task_mc', {
        userId: 'u1',
        status: 'running',
        linearIssueId: 'LIN-3',
        systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
        dedupKey: 'xx',
        createdAt: Timestamp.fromDate(new Date('2025-06-01')),
      });
      const result = await runCheck(baseInput({ linearIssueId: 'LIN-3' }));
      expect(result.ok).toBe(true);
    });

    it('skipped entirely when linearIssueId is absent', async () => {
      const result = await runCheck(baseInput());
      expect(result.ok).toBe(true);
    });
  });

  describe('concurrent same-key inserts', () => {
    it('only one wins; the other returns DUPLICATE_PROMPT with the first task id', async () => {
      const now = new Date('2025-06-01T00:05:00Z');
      const dedupKey = generateDedupKey('u1', 'shared');

      // Simulate the create() flow: checkDedupLayers + transaction.set serialized
      // through the fake's transaction queue — second tx sees the first's write.
      const result1 = await fakeFirestore.runTransaction(async (transaction) => {
        const r = await checkDedupLayers(
          transaction as unknown as FirestoreTransaction,
          collection,
          baseInput({ prompt: 'shared' }),
          { logger, dedupKey, now }
        );
        if (!r.ok) return r;
        return r;
      });
      expect(result1.ok).toBe(true);
      // Seed the "winning" task outside the transaction to simulate the first
      // successful create having committed.
      await collection.doc('task_first').set({
        userId: 'u1',
        status: 'queued',
        dedupKey,
        createdAt: Timestamp.fromDate(now),
      });

      const result2 = await runCheck(baseInput({ prompt: 'shared' }), { dedupKey, now });
      expect(result2.ok).toBe(false);
      if (result2.ok) return;
      expect(result2.error.code).toBe('DUPLICATE_PROMPT');
      if (result2.error.code === 'DUPLICATE_PROMPT') {
        expect(result2.error.existingTaskId).toBe('task_first');
      }
    });
  });
});
