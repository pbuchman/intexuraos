/**
 * Unit tests for task-serializer module.
 *
 * Pure functions — no Firestore needed (uses Timestamp directly from
 * @google-cloud/firestore).
 */
import { describe, expect, it } from 'vitest';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import {
  buildUpdateData,
  fromFirestoreDoc,
  mergeUpdateForTransaction,
  serializeDispatchSchedule,
  serializeExecutionMemoryContext,
  serializeExecutionMemoryPostRun,
  stripLegacyLinearFields,
  toFirestoreDoc,
  toTimestamp,
} from '../../../infra/firestore/task-serializer.js';
import type { CreateTaskInput, UpdateTaskInput } from '../../../domain/repositories/codeTaskRepository.js';

const baseCreate = (): CreateTaskInput => ({
  userId: 'u1',
  prompt: 'hello',
  sanitizedPrompt: 'hello',
  systemPromptHash: 'h1',
  workerType: 'opus',
  workerLocation: 'vm',
  repository: 'o/r',
  baseBranch: 'main',
  traceId: 't1',
});

describe('stripLegacyLinearFields', () => {
  it('removes legacy Linear keys and keeps other fields', () => {
    const out = stripLegacyLinearFields({
      id: 'x',
      linearIssueTitle: 'drop',
      linearIssueUrl: 'drop',
      linearIssueType: 'drop',
      linearIssueLabels: ['drop'],
      linearFallback: true,
      keep: 'me',
    });
    expect(out).toEqual({ id: 'x', keep: 'me' });
  });
});

describe('fromFirestoreDoc', () => {
  it('treats undefined data() (missing DocumentSnapshot) as empty', () => {
    const task = fromFirestoreDoc({
      id: 'task_missing',
      data: (): undefined => undefined,
    } as unknown as Parameters<typeof fromFirestoreDoc>[0]);
    expect(task.id).toBe('task_missing');
    expect(task.createdAt).toBeUndefined();
    expect(task.updatedAt).toBeUndefined();
  });

  it('returns CodeTask with id, createdAt, updatedAt; strips legacy fields', () => {
    const now = Timestamp.fromDate(new Date('2025-01-01T00:00:00Z'));
    const doc = {
      id: 'task_1',
      data: (): Record<string, unknown> => ({
        userId: 'u1',
        status: 'queued',
        dedupKey: 'dk',
        createdAt: now,
        updatedAt: now,
        linearIssueTitle: 'stripme',
      }),
    };
    const task = fromFirestoreDoc(doc);
    expect(task.id).toBe('task_1');
    expect(task.userId).toBe('u1');
    expect(task.createdAt).toBe(now);
    expect(task.updatedAt).toBe(now);
    expect((task as unknown as Record<string, unknown>)['linearIssueTitle']).toBeUndefined();
  });
});

describe('toTimestamp', () => {
  it('returns undefined for undefined input', () => {
    expect(toTimestamp(undefined)).toBeUndefined();
  });
  it('returns the same Timestamp for Timestamp input', () => {
    const ts = Timestamp.fromDate(new Date('2025-01-01'));
    expect(toTimestamp(ts)).toBe(ts);
  });
  it('converts Date to Timestamp', () => {
    const d = new Date('2025-02-03T04:05:06Z');
    const ts = toTimestamp(d);
    expect(ts).toBeInstanceOf(Timestamp);
    expect(ts?.toDate().toISOString()).toBe(d.toISOString());
  });
  it('returns undefined for unsupported types', () => {
    expect(toTimestamp('2025-01-01')).toBeUndefined();
    expect(toTimestamp(12345)).toBeUndefined();
    expect(toTimestamp(null)).toBeUndefined();
    expect(toTimestamp({})).toBeUndefined();
  });
});

describe('serializeExecutionMemoryContext', () => {
  it('converts Date matchedAt to Timestamp', () => {
    const matchedAt = new Date('2025-01-01T10:00:00Z');
    const out = serializeExecutionMemoryContext({
      status: 'matched',
      matchedAt,
    });
    expect(out.matchedAt).toBeInstanceOf(Timestamp);
  });
  it('omits matchedAt when absent', () => {
    const out = serializeExecutionMemoryContext({ status: 'none' });
    expect(out.matchedAt).toBeUndefined();
  });
  it('preserves Timestamp matchedAt as-is', () => {
    const ts = Timestamp.fromDate(new Date('2025-06-01'));
    const out = serializeExecutionMemoryContext({ status: 'matched', matchedAt: ts });
    expect(out.matchedAt).toBe(ts);
  });
});

describe('serializeExecutionMemoryPostRun', () => {
  it('converts Date lastAttemptAt/completedAt to Timestamps', () => {
    const lastAttemptAt = new Date('2025-01-01T10:00:00Z');
    const completedAt = new Date('2025-01-01T11:00:00Z');
    const out = serializeExecutionMemoryPostRun({
      status: 'completed',
      attempts: 1,
      generatedMemoryIds: [],
      lastAttemptAt,
      completedAt,
    });
    expect(out.lastAttemptAt).toBeInstanceOf(Timestamp);
    expect(out.completedAt).toBeInstanceOf(Timestamp);
  });
  it('omits lastAttemptAt/completedAt when absent', () => {
    const out = serializeExecutionMemoryPostRun({
      status: 'pending',
      attempts: 0,
      generatedMemoryIds: [],
    });
    expect(out.lastAttemptAt).toBeUndefined();
    expect(out.completedAt).toBeUndefined();
  });
});

describe('serializeDispatchSchedule', () => {
  it('converts Date notBeforeAt to Timestamp', () => {
    const notBeforeAt = new Date('2026-04-24T22:00:00Z');
    const out = serializeDispatchSchedule({
      notBeforeAt,
      source: 'user_scheduled',
      derivedBy: 'user_input',
    });
    expect(out.notBeforeAt).toBeInstanceOf(Timestamp);
    expect(out.notBeforeAt.toMillis()).toBe(notBeforeAt.getTime());
  });

  it('preserves Timestamp notBeforeAt as-is (no double conversion)', () => {
    const ts = Timestamp.fromDate(new Date('2026-04-24T22:00:00Z'));
    const out = serializeDispatchSchedule({
      notBeforeAt: ts,
      source: 'user_scheduled',
      derivedBy: 'user_input',
    });
    expect(out.notBeforeAt).toBe(ts);
  });

  it('omits optional fields when absent', () => {
    const out = serializeDispatchSchedule({
      notBeforeAt: Timestamp.fromDate(new Date('2026-04-24T22:00:00Z')),
      source: 'user_scheduled',
      derivedBy: 'user_input',
    });
    expect(out.timezone).toBeUndefined();
    expect(out.localDateTime).toBeUndefined();
    expect(out.sourceText).toBeUndefined();
    expect(out.derivedFromTaskId).toBeUndefined();
  });

  it('includes every optional field when provided', () => {
    const ts = Timestamp.fromDate(new Date('2026-04-24T22:00:00Z'));
    const out = serializeDispatchSchedule({
      notBeforeAt: ts,
      source: 'retry_cooloff',
      derivedBy: 'llm',
      timezone: 'Europe/Warsaw',
      localDateTime: '2026-04-25T00:00',
      sourceText: 'resets 10pm (UTC)',
      derivedFromTaskId: 'task_prev',
    });
    expect(out.source).toBe('retry_cooloff');
    expect(out.derivedBy).toBe('llm');
    expect(out.timezone).toBe('Europe/Warsaw');
    expect(out.localDateTime).toBe('2026-04-25T00:00');
    expect(out.sourceText).toBe('resets 10pm (UTC)');
    expect(out.derivedFromTaskId).toBe('task_prev');
  });
});

describe('toFirestoreDoc', () => {
  const opts = {
    taskId: 'task_abc',
    dedupKey: 'deadbeefcafebabe',
    now: new Date('2025-01-01T00:00:00Z'),
  };

  it('builds a minimal doc with defaults (status queued, callbackReceived false)', () => {
    const doc = toFirestoreDoc(baseCreate(), opts);
    expect(doc.id).toBe('task_abc');
    expect(doc.status).toBe('queued');
    expect(doc.callbackReceived).toBe(false);
    expect(doc.dedupKey).toBe('deadbeefcafebabe');
    expect(doc.createdAt).toBeInstanceOf(Timestamp);
    expect(doc.updatedAt).toBeInstanceOf(Timestamp);
    expect(doc.createdAt.toMillis()).toBe(opts.now.getTime());
    expect(doc.schemaVersion).toBe(1);
    expect(doc.schemaUpdatedAt.toMillis()).toBe(opts.now.getTime());
  });

  it('honors initialStatus', () => {
    const doc = toFirestoreDoc({ ...baseCreate(), initialStatus: 'dispatched' }, opts);
    expect(doc.status).toBe('dispatched');
  });

  it('sets every optional field when provided', () => {
    const memCtxMatchedAt = Timestamp.fromDate(new Date('2025-01-02'));
    const memPostLastAttempt = Timestamp.fromDate(new Date('2025-01-03'));
    const doc = toFirestoreDoc(
      {
        ...baseCreate(),
        actionId: 'a1',
        approvalEventId: 'ap1',
        linearIssueId: 'L1',
        webhookSecret: 's1',
        retriedFrom: 'task_orig',
        prNumber: 42,
        prBranch: 'br',
        parentTaskId: 'task_parent',
        followUpReason: 'pr_comment',
        agentType: 'review',
        planningPrBranch: 'plan-br',
        planningPrUrl: 'https://example/plan',
        trackingCommentId: 'tc1',
        reviewTypes: ['security'],
        executionMemoryContext: { status: 'matched', matchedAt: memCtxMatchedAt },
        executionMemoryPostRun: {
          status: 'pending',
          attempts: 0,
          generatedMemoryIds: [],
          lastAttemptAt: memPostLastAttempt,
        },
        failedWorkerLocation: 'vm-prev',
        autoRetryAttempt: 2,
        dispatchSchedule: {
          notBeforeAt: new Date('2026-04-24T22:00:00Z'),
          source: 'user_scheduled',
          derivedBy: 'user_input',
        },
      },
      opts
    );
    expect(doc.actionId).toBe('a1');
    expect(doc.approvalEventId).toBe('ap1');
    expect(doc.linearIssueId).toBe('L1');
    expect(doc.webhookSecret).toBe('s1');
    expect(doc.retriedFrom).toBe('task_orig');
    expect(doc.prNumber).toBe(42);
    expect(doc.prBranch).toBe('br');
    expect(doc.parentTaskId).toBe('task_parent');
    expect(doc.followUpReason).toBe('pr_comment');
    expect(doc.agentType).toBe('review');
    expect(doc.planningPrBranch).toBe('plan-br');
    expect(doc.planningPrUrl).toBe('https://example/plan');
    expect(doc.trackingCommentId).toBe('tc1');
    expect(doc.reviewTypes).toEqual(['security']);
    expect(doc.executionMemoryContext?.matchedAt).toBe(memCtxMatchedAt);
    expect(doc.executionMemoryPostRun?.lastAttemptAt).toBe(memPostLastAttempt);
    expect(doc.failedWorkerLocation).toBe('vm-prev');
    expect(doc.autoRetryAttempt).toBe(2);
    expect(doc.dispatchSchedule?.notBeforeAt).toBeInstanceOf(Timestamp);
    expect(doc.dispatchSchedule?.source).toBe('user_scheduled');
  });

  it('persists timeoutHours when provided (INT-1585)', () => {
    const doc = toFirestoreDoc({ ...baseCreate(), timeoutHours: 8 }, opts);
    expect(doc.timeoutHours).toBe(8);
  });

  it('omits timeoutHours when not provided — backward compat (INT-1585)', () => {
    const doc = toFirestoreDoc(baseCreate(), opts);
    expect(doc.timeoutHours).toBeUndefined();
  });

  it('omits optional fields when not provided', () => {
    const doc = toFirestoreDoc(baseCreate(), opts);
    expect(doc.actionId).toBeUndefined();
    expect(doc.approvalEventId).toBeUndefined();
    expect(doc.linearIssueId).toBeUndefined();
    expect(doc.webhookSecret).toBeUndefined();
    expect(doc.retriedFrom).toBeUndefined();
    expect(doc.prNumber).toBeUndefined();
    expect(doc.prBranch).toBeUndefined();
    expect(doc.parentTaskId).toBeUndefined();
    expect(doc.followUpReason).toBeUndefined();
    expect(doc.agentType).toBeUndefined();
    expect(doc.planningPrBranch).toBeUndefined();
    expect(doc.planningPrUrl).toBeUndefined();
    expect(doc.trackingCommentId).toBeUndefined();
    expect(doc.reviewTypes).toBeUndefined();
    expect(doc.executionMemoryContext).toBeUndefined();
    expect(doc.executionMemoryPostRun).toBeUndefined();
    expect(doc.failedWorkerLocation).toBeUndefined();
    expect(doc.autoRetryAttempt).toBeUndefined();
    expect(doc.dispatchSchedule).toBeUndefined();
    expect(doc.timeoutHours).toBeUndefined();
  });
});

describe('buildUpdateData', () => {
  it('always sets updatedAt (from input.updatedAt when provided)', () => {
    const d = new Date('2025-05-01T00:00:00Z');
    const data = buildUpdateData({ updatedAt: d });
    expect(data['updatedAt']).toBeInstanceOf(Timestamp);
    expect((data['updatedAt'] as Timestamp).toMillis()).toBe(d.getTime());
  });

  it('always sets updatedAt (from current time when not provided)', () => {
    const before = Date.now();
    const data = buildUpdateData({});
    const after = Date.now();
    expect(data['updatedAt']).toBeInstanceOf(Timestamp);
    const ms = (data['updatedAt'] as Timestamp).toMillis();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it('converts Date fields to Timestamps', () => {
    const data = buildUpdateData({
      queuedAt: new Date('2025-01-01'),
      dispatchedAt: new Date('2025-01-02'),
      completedAt: new Date('2025-01-03'),
      lastHeartbeat: new Date('2025-01-04'),
      prMergedAt: new Date('2025-01-05'),
      prClosedAt: new Date('2025-01-06'),
    });
    expect(data['queuedAt']).toBeInstanceOf(Timestamp);
    expect(data['dispatchedAt']).toBeInstanceOf(Timestamp);
    expect(data['completedAt']).toBeInstanceOf(Timestamp);
    expect(data['lastHeartbeat']).toBeInstanceOf(Timestamp);
    expect(data['prMergedAt']).toBeInstanceOf(Timestamp);
    expect(data['prClosedAt']).toBeInstanceOf(Timestamp);
  });

  it('uses FieldValue.delete() for null-clear fields', () => {
    const data = buildUpdateData({
      error: null,
      cancelNonce: null,
      cancelNonceExpiresAt: null,
      implementationTaskId: null,
      fanOutChildTaskIds: null,
      dispatchStatus: null,
    } as UpdateTaskInput);
    expect(data['error']).toBeInstanceOf(FieldValue);
    expect(data['cancelNonce']).toBeInstanceOf(FieldValue);
    expect(data['cancelNonceExpiresAt']).toBeInstanceOf(FieldValue);
    expect(data['implementationTaskId']).toBeInstanceOf(FieldValue);
    expect(data['fanOutChildTaskIds']).toBeInstanceOf(FieldValue);
    expect(data['dispatchStatus']).toBeInstanceOf(FieldValue);
  });

  it('passes non-null values through for nullable fields', () => {
    const data = buildUpdateData({
      error: { code: 'X', message: 'oops' },
      cancelNonce: 'abcd',
      cancelNonceExpiresAt: '2025-01-01',
      implementationTaskId: 'task_impl',
      fanOutChildTaskIds: ['task_a', 'task_b'],
      dispatchStatus: {
        state: 'waiting',
        reason: 'workers_at_capacity',
        terminal: false,
        severity: 'warning',
        message: 'All workers are busy.',
        remediation: 'Wait for capacity.',
        workerNames: ['home-dev'],
        firstSeenAt: Timestamp.fromDate(new Date('2026-06-05T12:00:00.000Z')),
        lastSeenAt: Timestamp.fromDate(new Date('2026-06-05T12:05:00.000Z')),
        nextAction: 'will_retry_automatically',
      },
    } as UpdateTaskInput);
    expect(data['error']).toEqual({ code: 'X', message: 'oops' });
    expect(data['cancelNonce']).toBe('abcd');
    expect(data['cancelNonceExpiresAt']).toBe('2025-01-01');
    expect(data['implementationTaskId']).toBe('task_impl');
    expect(data['fanOutChildTaskIds']).toEqual(['task_a', 'task_b']);
    expect(data['dispatchStatus']).toEqual(expect.objectContaining({
      reason: 'workers_at_capacity',
      nextAction: 'will_retry_automatically',
    }));
  });

  it('sets every scalar field when provided', () => {
    const input: UpdateTaskInput = {
      status: 'running',
      result: { summary: 'ok' },
      statusSummary: {
        phase: 'implementing',
        message: 'go',
        updatedAt: Timestamp.fromDate(new Date('2025-01-10')),
      },
      workerLocation: 'vm1',
      callbackReceived: true,
      logChunksDropped: 7,
      pendingUserMessages: ['hi'],
      prNumber: 9,
      prBranch: 'b',
      requiresReReview: true,
      prUrlValidationFailed: true,
      prUrlValidationErrors: ['bad'],
      callbackState: {
        webhookUrl: 'https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete',
        callbackBaseUrl: 'https://dev.intexuraos.cloud/api/code',
        owner: 'dev',
        configuredAt: new Date('2026-06-09T14:44:12.000Z'),
        lastFailure: {
          endpoint: 'status',
          status: 401,
          message: 'Unauthorized',
          occurredAt: new Date('2026-06-09T14:47:40.000Z'),
        },
      },
    };
    const data = buildUpdateData(input);
    expect(data['status']).toBe('running');
    expect(data['result']).toEqual({ summary: 'ok' });
    expect(data['statusSummary']).toEqual(input.statusSummary);
    expect(data['workerLocation']).toBe('vm1');
    expect(data['callbackReceived']).toBe(true);
    expect(data['logChunksDropped']).toBe(7);
    expect(data['pendingUserMessages']).toEqual(['hi']);
    expect(data['prNumber']).toBe(9);
    expect(data['prBranch']).toBe('b');
    expect(data['requiresReReview']).toBe(true);
    expect(data['prUrlValidationFailed']).toBe(true);
    expect(data['prUrlValidationErrors']).toEqual(['bad']);
    expect(data['callbackState']).toEqual(expect.objectContaining({
      webhookUrl: 'https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete',
      callbackBaseUrl: 'https://dev.intexuraos.cloud/api/code',
      owner: 'dev',
      configuredAt: expect.any(Timestamp),
      lastFailure: expect.objectContaining({
        endpoint: 'status',
        status: 401,
        message: 'Unauthorized',
        occurredAt: expect.any(Timestamp),
      }),
    }));
  });

  it('falls back to a generated callbackState configuredAt timestamp for malformed update input', () => {
    const data = buildUpdateData({
      callbackState: {
        webhookUrl: 'https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete',
        callbackBaseUrl: 'https://dev.intexuraos.cloud/api/code',
        owner: 'dev',
        configuredAt: 'not-a-date',
      },
    } as unknown as UpdateTaskInput);

    const callbackState = data['callbackState'] as { configuredAt: Timestamp };
    expect(callbackState.configuredAt).toBeInstanceOf(Timestamp);
  });

  it('serializes executionMemoryContext/PostRun when provided', () => {
    const ctxMatched = new Date('2025-01-01');
    const postRunLast = new Date('2025-01-02');
    const data = buildUpdateData({
      executionMemoryContext: {
        status: 'matched',
        matchedAt: ctxMatched,
      },
      executionMemoryPostRun: {
        status: 'pending',
        attempts: 0,
        generatedMemoryIds: [],
        lastAttemptAt: postRunLast,
      },
    });
    const ctx = data['executionMemoryContext'] as { matchedAt: Timestamp };
    const post = data['executionMemoryPostRun'] as { lastAttemptAt: Timestamp };
    expect(ctx.matchedAt).toBeInstanceOf(Timestamp);
    expect(post.lastAttemptAt).toBeInstanceOf(Timestamp);
  });

  it('leaves unspecified fields absent', () => {
    const data = buildUpdateData({});
    expect(Object.keys(data).sort()).toEqual(['updatedAt']);
  });

  it('serializes dispatchSchedule when provided', () => {
    const notBeforeAt = new Date('2026-04-24T22:00:00Z');
    const data = buildUpdateData({
      dispatchSchedule: {
        notBeforeAt,
        source: 'retry_cooloff',
        derivedBy: 'llm',
        sourceText: 'resets 10pm (UTC)',
        derivedFromTaskId: 'task_prev',
      },
    });
    const schedule = data['dispatchSchedule'] as {
      notBeforeAt: Timestamp;
      source: string;
      sourceText: string;
    };
    expect(schedule.notBeforeAt).toBeInstanceOf(Timestamp);
    expect(schedule.notBeforeAt.toMillis()).toBe(notBeforeAt.getTime());
    expect(schedule.source).toBe('retry_cooloff');
    expect(schedule.sourceText).toBe('resets 10pm (UTC)');
  });
});

describe('mergeUpdateForTransaction', () => {
  it('merges update data onto existing and strips FieldValue sentinels', () => {
    const existing = { a: 1, b: 'old', toDelete: 'still here' };
    const update = {
      b: 'new',
      toDelete: FieldValue.delete(),
      fresh: 9,
    };
    const merged = mergeUpdateForTransaction(existing, update);
    expect(merged).toEqual({ a: 1, b: 'new', fresh: 9 });
  });
});
