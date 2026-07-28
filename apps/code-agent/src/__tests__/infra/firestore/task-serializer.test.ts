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
import type { CodeTask, TaskStatus } from '../../../domain/models/codeTask.js';
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

const writeTime = new Date('2026-07-27T12:00:00.000Z');
const lifecycleTask = (
  status: TaskStatus = 'running',
  overrides: Partial<CodeTask> = {}
): CodeTask => {
  const initial = Timestamp.fromDate(new Date('2026-07-27T10:00:00.000Z'));
  return {
    id: 'task_lifecycle',
    traceId: 'trace_lifecycle',
    userId: 'u1',
    workerType: 'opus',
    workerLocation: 'vm',
    status,
    prompt: 'hello',
    sanitizedPrompt: 'hello',
    systemPromptHash: 'h1',
    repository: 'o/r',
    baseBranch: 'main',
    createdAt: initial,
    statusChangedAt: initial,
    updatedAt: initial,
    callbackReceived: false,
    dedupKey: 'dedup',
    ...overrides,
  };
};

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

  it('hydrates a missing statusChangedAt from the canonical legacy resolver', () => {
    const createdAt = Timestamp.fromDate(new Date('2026-07-27T08:00:00.000Z'));
    const updatedAt = Timestamp.fromDate(new Date('2026-07-27T08:30:00.000Z'));
    const completedAt = Timestamp.fromDate(new Date('2026-07-27T08:10:00.000Z'));

    const task = fromFirestoreDoc({
      id: 'task_legacy',
      data: () => ({ status: 'failed', createdAt, updatedAt, completedAt }),
    });

    expect(task.statusChangedAt?.toMillis()).toBe(completedAt.toMillis());
  });

  it.each([
    { agentType: 'planning', expectedStatus: 'planned' },
    { agentType: 'review', expectedStatus: 'reviewed' },
    { agentType: 'execution', expectedStatus: 'implemented' },
    { agentType: undefined, expectedStatus: 'implemented' },
  ] as const)(
    'normalizes a legacy completed $agentType task only after resolving its raw terminal lifecycle',
    ({ agentType, expectedStatus }) => {
      const createdAt = Timestamp.fromDate(new Date('2026-03-19T01:55:00.000Z'));
      const completedAt = Timestamp.fromDate(new Date('2026-03-19T02:06:53.707Z'));
      const updatedAt = Timestamp.fromDate(new Date('2026-03-19T02:14:34.998Z'));

      const task = fromFirestoreDoc({
        id: 'task_76d13dde-c6d9-4c08-86c4-5589f1c8dcf2',
        data: () => ({
          status: 'completed',
          ...(agentType !== undefined && { agentType }),
          createdAt,
          completedAt,
          updatedAt,
        }),
      });

      expect(task.status).toBe(expectedStatus);
      expect(task.statusChangedAt?.toMillis()).toBe(completedAt.toMillis());
      expect(task.completedAt?.toMillis()).toBe(completedAt.toMillis());
      expect(task.updatedAt.toMillis()).toBe(updatedAt.toMillis());
    },
  );
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
    expect(doc.updatedAt.toMillis()).toBe(doc.createdAt.toMillis());
    expect(doc.statusChangedAt?.toMillis()).toBe(doc.createdAt.toMillis());
    expect(doc.schemaVersion).toBe(2);
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
        sentryIssue: {
          organizationSlug: 'intexura',
          projectSlug: 'code-agent',
          issueId: '123456',
          issueUrl: 'https://intexura.sentry.io/issues/123456/',
          title: 'TypeError',
          action: 'created',
          receivedAt: '2026-06-28T12:00:00.000Z',
        },
      },
      opts
    );
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
    expect(doc.sentryIssue).toEqual({
      organizationSlug: 'intexura',
      projectSlug: 'code-agent',
      issueId: '123456',
      issueUrl: 'https://intexura.sentry.io/issues/123456/',
      title: 'TypeError',
      action: 'created',
      receivedAt: '2026-06-28T12:00:00.000Z',
    });
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
    expect(doc.sentryIssue).toBeUndefined();
  });
});

describe('buildUpdateData', () => {
  it('always sets updatedAt (from input.updatedAt when provided)', () => {
    const d = new Date('2025-05-01T00:00:00Z');
    const data = buildUpdateData(lifecycleTask(), { updatedAt: d }, writeTime);
    expect(data['updatedAt']).toBeInstanceOf(Timestamp);
    expect((data['updatedAt'] as Timestamp).toMillis()).toBe(d.getTime());
  });

  it('always sets updatedAt from the captured write time when not provided', () => {
    const data = buildUpdateData(lifecycleTask(), {}, writeTime);
    expect(data['updatedAt']).toBeInstanceOf(Timestamp);
    expect((data['updatedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
  });

  it('converts non-completion Date fields to Timestamps without completing an active task', () => {
    const data = buildUpdateData(lifecycleTask(), {
      queuedAt: new Date('2025-01-01'),
      dispatchedAt: new Date('2025-01-02'),
      completedAt: new Date('2025-01-03'),
      lastHeartbeat: new Date('2025-01-04'),
      prMergedAt: new Date('2025-01-05'),
      prClosedAt: new Date('2025-01-06'),
    }, writeTime);
    expect(data['queuedAt']).toBeInstanceOf(Timestamp);
    expect(data['dispatchedAt']).toBeInstanceOf(Timestamp);
    expect(data['completedAt']).toBeUndefined();
    expect(data['lastHeartbeat']).toBeInstanceOf(Timestamp);
    expect(data['prMergedAt']).toBeInstanceOf(Timestamp);
    expect(data['prClosedAt']).toBeInstanceOf(Timestamp);
  });

  it('uses FieldValue.delete() for null-clear fields', () => {
    const data = buildUpdateData(lifecycleTask(), {
      error: null,
      cancelNonce: null,
      cancelNonceExpiresAt: null,
      implementationTaskId: null,
      fanOutChildTaskIds: null,
      dispatchStatus: null,
    } as UpdateTaskInput, writeTime);
    expect(data['error']).toBeInstanceOf(FieldValue);
    expect(data['cancelNonce']).toBeInstanceOf(FieldValue);
    expect(data['cancelNonceExpiresAt']).toBeInstanceOf(FieldValue);
    expect(data['implementationTaskId']).toBeInstanceOf(FieldValue);
    expect(data['fanOutChildTaskIds']).toBeInstanceOf(FieldValue);
    expect(data['dispatchStatus']).toBeInstanceOf(FieldValue);
  });

  it('passes non-null values through for nullable fields', () => {
    const data = buildUpdateData(lifecycleTask(), {
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
    } as UpdateTaskInput, writeTime);
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
    const data = buildUpdateData(lifecycleTask(), input, writeTime);
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
    const data = buildUpdateData(lifecycleTask(), {
      callbackState: {
        webhookUrl: 'https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete',
        callbackBaseUrl: 'https://dev.intexuraos.cloud/api/code',
        owner: 'dev',
        configuredAt: 'not-a-date',
      },
    } as unknown as UpdateTaskInput, writeTime);

    const callbackState = data['callbackState'] as { configuredAt: Timestamp };
    expect(callbackState.configuredAt).toBeInstanceOf(Timestamp);
  });

  it('serializes executionMemoryContext/PostRun when provided', () => {
    const ctxMatched = new Date('2025-01-01');
    const postRunLast = new Date('2025-01-02');
    const data = buildUpdateData(lifecycleTask(), {
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
    }, writeTime);
    const ctx = data['executionMemoryContext'] as { matchedAt: Timestamp };
    const post = data['executionMemoryPostRun'] as { lastAttemptAt: Timestamp };
    expect(ctx.matchedAt).toBeInstanceOf(Timestamp);
    expect(post.lastAttemptAt).toBeInstanceOf(Timestamp);
  });

  it('leaves unspecified fields absent', () => {
    const data = buildUpdateData(lifecycleTask(), {}, writeTime);
    expect(Object.keys(data).sort()).toEqual(['schemaUpdatedAt', 'schemaVersion', 'updatedAt']);
  });

  it('serializes dispatchSchedule when provided', () => {
    const notBeforeAt = new Date('2026-04-24T22:00:00Z');
    const data = buildUpdateData(lifecycleTask(), {
      dispatchSchedule: {
        notBeforeAt,
        source: 'retry_cooloff',
        derivedBy: 'llm',
        sourceText: 'resets 10pm (UTC)',
        derivedFromTaskId: 'task_prev',
      },
    }, writeTime);
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

  it('uses explicit completion time for both lifecycle fields on a completion transition', () => {
    const completedAt = new Date('2026-07-27T11:00:00.000Z');
    const data = buildUpdateData(
      lifecycleTask('running'),
      { status: 'failed', completedAt },
      writeTime
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(completedAt.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(completedAt.getTime());
    expect((data['updatedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
  });

  it('uses one captured write timestamp when a completion transition omits completedAt', () => {
    const data = buildUpdateData(lifecycleTask('running'), { status: 'reviewed' }, writeTime);

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['updatedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
  });

  it('does not write lifecycle fields for a same-status metadata update', () => {
    const completedAt = Timestamp.fromDate(new Date('2026-07-27T11:00:00.000Z'));
    const data = buildUpdateData(
      lifecycleTask('failed', { completedAt }),
      { status: 'failed', prNumber: 42 },
      writeTime
    );

    expect(data['statusChangedAt']).toBeUndefined();
    expect(data['completedAt']).toBeUndefined();
    expect((data['updatedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
  });

  it.each(['planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled'] as const)(
    'does not overwrite completedAt for a same-status %s write even when input is later',
    (status) => {
      const originalCompletedAt = Timestamp.fromDate(new Date('2026-07-27T10:30:00.000Z'));
      const laterCompletedAt = new Date('2026-07-27T11:30:00.000Z');
      const data = buildUpdateData(
        lifecycleTask(status, { completedAt: originalCompletedAt }),
        { status, completedAt: laterCompletedAt, prNumber: 42 },
        writeTime,
      );

      expect(data['completedAt']).toBeUndefined();
      expect(data['statusChangedAt']).toBeUndefined();
      expect((data['updatedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    },
  );

  it('treats an invalid existing completion as missing and accepts a valid explicit replacement', () => {
    const completedAt = new Date('2026-07-27T10:30:00.000Z');
    const data = buildUpdateData(
      lifecycleTask('failed', {
        completedAt: new Date(Number.NaN) as unknown as Timestamp,
      }),
      { status: 'failed', completedAt },
      writeTime,
    );

    expect((data['completedAt'] as Timestamp).toMillis()).toBe(completedAt.getTime());
    expect(data['statusChangedAt']).toBeUndefined();
  });

  it('rejects an invalid explicit completion when no valid completion exists', () => {
    expect(() => buildUpdateData(
      lifecycleTask('failed'),
      { status: 'failed', completedAt: new Date(Number.NaN) },
      writeTime,
    )).toThrowError('Invalid explicit task completion timestamp');
  });

  it('preserves a valid existing completion when a same-status input is invalid', () => {
    const completedAt = new Timestamp(1_775_000_000, 123_456_789);

    expect(() => buildUpdateData(
      lifecycleTask('failed', { completedAt }),
      { status: 'failed', completedAt: new Date(Number.NaN) },
      writeTime,
    )).not.toThrow();

    const data = buildUpdateData(
      lifecycleTask('failed', { completedAt }),
      { status: 'failed', completedAt: new Date(Number.NaN) },
      writeTime,
    );
    expect(data['completedAt']).toBeUndefined();
    expect(data['statusChangedAt']).toBeUndefined();
  });

  it('does not introduce completion state during active metadata writes', () => {
    const data = buildUpdateData(
      lifecycleTask('running'),
      { status: 'running', completedAt: new Date('2026-07-27T10:30:00.000Z') },
      writeTime,
    );

    expect(data['completedAt']).toBeUndefined();
    expect(data['statusChangedAt']).toBeUndefined();
  });

  it.each(['planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled'] as const)(
    'allows an explicit completedAt to fill missing same-status %s completion state',
    (status) => {
      const completedAt = new Date('2026-07-27T10:30:00.000Z');
      const data = buildUpdateData(
        lifecycleTask(status),
        { status, completedAt },
        writeTime,
      );

      expect((data['completedAt'] as Timestamp).toMillis()).toBe(completedAt.getTime());
      expect(data['statusChangedAt']).toBeUndefined();
    },
  );

  it('advances archive status time while preserving the original completion time', () => {
    const completedAt = Timestamp.fromDate(new Date('2026-07-27T11:00:00.000Z'));
    const data = buildUpdateData(
      lifecycleTask('failed', { completedAt }),
      { status: 'archived' },
      writeTime
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect(data['completedAt']).toBeUndefined();
  });

  it('fills missing archive completion state from an explicit completion time', () => {
    const completedAt = new Date('2026-07-27T11:00:00.000Z');
    const data = buildUpdateData(
      lifecycleTask('failed'),
      { status: 'archived', completedAt },
      writeTime
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(completedAt.getTime());
  });

  it('fills missing archive completion state from the resolved pre-archive lifecycle time', () => {
    const failedAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00.000Z'));
    const data = buildUpdateData(
      lifecycleTask('failed', { statusChangedAt: failedAt }),
      { status: 'archived' },
      writeTime
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(failedAt.toMillis());
  });

  it('uses a legacy terminal cause at T1 when archiving at T2 without completion fields', () => {
    const failedAt = Timestamp.fromDate(new Date('2026-07-27T09:00:00.000Z'));
    const technicalUpdateAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00.000Z'));
    const legacyFailed = lifecycleTask('failed', {
      updatedAt: technicalUpdateAt,
      dispatchStatus: {
        state: 'terminal',
        reason: 'codex_auth_unavailable',
        terminal: true,
        severity: 'warning',
        message: 'Codex auth unavailable',
        remediation: 'Use an authorized worker',
        workerNames: ['home-dev'],
        firstSeenAt: failedAt,
        lastSeenAt: technicalUpdateAt,
        terminalCause: {
          reason: 'codex_auth_unavailable',
          message: 'Codex auth unavailable',
          remediation: 'Use an authorized worker',
          workerNames: ['home-dev'],
          lastSeenAt: failedAt,
        },
        nextAction: 'retry_after_fix',
      },
    });
    delete legacyFailed.statusChangedAt;
    delete legacyFailed.completedAt;

    const data = buildUpdateData(legacyFailed, { status: 'archived' }, writeTime);

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(failedAt.toMillis());
  });

  it('uses the archive write time when an active task has no completion evidence', () => {
    const data = buildUpdateData(
      lifecycleTask('running'),
      { status: 'archived' },
      writeTime,
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
  });

  it.each(['planned', 'implemented', 'reviewed'] as const)(
    'restores archived to %s with a new lifecycle clock and the historical completion intact',
    (status) => {
      const historicalCompletion = Timestamp.fromDate(
        new Date('2026-07-20T09:00:00.000Z'),
      );
      const backdatedTechnicalTime = new Date('2026-07-21T09:00:00.000Z');
      const data = buildUpdateData(
        lifecycleTask('archived', { completedAt: historicalCompletion }),
        { status, updatedAt: backdatedTechnicalTime },
        writeTime,
      );

      expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
      expect((data['updatedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
      expect(data['completedAt']).toBeUndefined();
    },
  );

  it('fills missing completion on archived restoration from pre-transition lifecycle time', () => {
    const archivedAt = Timestamp.fromDate(new Date('2026-07-20T09:00:00.000Z'));
    const data = buildUpdateData(
      lifecycleTask('archived', {
        statusChangedAt: archivedAt,
        updatedAt: Timestamp.fromDate(new Date('2026-07-25T09:00:00.000Z')),
      }),
      { status: 'reviewed' },
      writeTime,
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(archivedAt.toMillis());
  });

  it('uses an explicit completion when restoring an archive with no completion state', () => {
    const completedAt = new Date('2026-07-19T08:30:00.000Z');
    const data = buildUpdateData(
      lifecycleTask('archived'),
      { status: 'reviewed', completedAt },
      writeTime,
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect((data['completedAt'] as Timestamp).toMillis()).toBe(completedAt.getTime());
  });

  it('uses terminal-cause lifecycle fallback when restoring a legacy archive', () => {
    const failedAt = Timestamp.fromDate(new Date('2026-07-19T09:00:00.000Z'));
    const legacyArchived = lifecycleTask('archived', {
      dispatchStatus: {
        state: 'terminal',
        reason: 'codex_auth_unavailable',
        terminal: true,
        severity: 'warning',
        message: 'Codex auth unavailable',
        remediation: 'Use an authorized worker',
        workerNames: ['home-dev'],
        firstSeenAt: failedAt,
        lastSeenAt: failedAt,
        terminalCause: {
          reason: 'codex_auth_unavailable',
          message: 'Codex auth unavailable',
          remediation: 'Use an authorized worker',
          workerNames: ['home-dev'],
          lastSeenAt: failedAt,
        },
        nextAction: 'retry_after_fix',
      },
      updatedAt: Timestamp.fromDate(new Date('2026-07-25T09:00:00.000Z')),
    });
    delete legacyArchived.statusChangedAt;
    delete legacyArchived.completedAt;

    const data = buildUpdateData(
      legacyArchived,
      { status: 'reviewed' },
      writeTime,
    );

    expect((data['completedAt'] as Timestamp).toMillis()).toBe(failedAt.toMillis());
  });

  it('does not let archive status time mask the earlier failure when restoring completion', () => {
    const failedAt = new Timestamp(1_775_000_000, 123_456_789);
    const archivedAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00.000Z'));
    const legacyArchived = lifecycleTask('archived', {
      statusChangedAt: archivedAt,
      dispatchStatus: {
        state: 'terminal',
        reason: 'codex_auth_unavailable',
        terminal: true,
        severity: 'warning',
        message: 'Codex auth unavailable',
        remediation: 'Use an authorized worker',
        workerNames: ['home-dev'],
        firstSeenAt: failedAt,
        lastSeenAt: archivedAt,
        terminalCause: {
          reason: 'codex_auth_unavailable',
          message: 'Codex auth unavailable',
          remediation: 'Use an authorized worker',
          workerNames: ['home-dev'],
          lastSeenAt: failedAt,
        },
        nextAction: 'retry_after_fix',
      },
    });

    const data = buildUpdateData(legacyArchived, { status: 'reviewed' }, writeTime);
    const completedAt = data['completedAt'] as Timestamp;

    expect(completedAt.seconds).toBe(failedAt.seconds);
    expect(completedAt.nanoseconds).toBe(failedAt.nanoseconds);
  });

  it('preserves archived completion on a same-status write with a later completedAt', () => {
    const originalCompletedAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00.000Z'));
    const laterCompletedAt = new Date('2026-07-27T11:00:00.000Z');
    const data = buildUpdateData(
      lifecycleTask('archived', { completedAt: originalCompletedAt }),
      { status: 'archived', completedAt: laterCompletedAt, prNumber: 42 },
      writeTime
    );

    expect(data['completedAt']).toBeUndefined();
    expect(data['statusChangedAt']).toBeUndefined();
  });

  it('fills missing archived completion from failure T1 during a metadata-only write at T3', () => {
    const failedAt = new Timestamp(1_775_000_000, 123_456_789);
    const archivedAt = Timestamp.fromDate(new Date('2026-07-27T09:00:00.000Z'));
    const technicalUpdateAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00.000Z'));
    const data = buildUpdateData(
      lifecycleTask('archived', {
        statusChangedAt: archivedAt,
        updatedAt: technicalUpdateAt,
        dispatchStatus: {
          state: 'terminal',
          reason: 'codex_auth_unavailable',
          terminal: true,
          severity: 'warning',
          message: 'Codex auth unavailable',
          remediation: 'Use an authorized worker',
          workerNames: ['home-dev'],
          firstSeenAt: failedAt,
          lastSeenAt: archivedAt,
          terminalCause: {
            reason: 'codex_auth_unavailable',
            message: 'Codex auth unavailable',
            remediation: 'Use an authorized worker',
            workerNames: ['home-dev'],
            lastSeenAt: failedAt,
          },
          nextAction: 'retry_after_fix',
        },
      }),
      { prNumber: 42 },
      writeTime
    );

    const completedAt = data['completedAt'] as Timestamp;
    expect(completedAt.seconds).toBe(failedAt.seconds);
    expect(completedAt.nanoseconds).toBe(failedAt.nanoseconds);
    expect(data['statusChangedAt']).toBeUndefined();
    expect((data['updatedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
  });

  it('fills missing archived completion from explicit input on a same-status write', () => {
    const completedAt = new Date('2026-07-27T11:00:00.000Z');
    const data = buildUpdateData(
      lifecycleTask('archived'),
      { status: 'archived', completedAt },
      writeTime
    );

    expect((data['completedAt'] as Timestamp).toMillis()).toBe(completedAt.getTime());
  });

  it.each([
    { status: 'queued', field: 'queuedAt', at: new Date('2026-07-27T11:10:00.000Z') },
    { status: 'dispatched', field: 'dispatchedAt', at: new Date('2026-07-27T11:20:00.000Z') },
  ] as const)('uses explicit $field for a $status transition', ({ status, field, at }) => {
    const data = buildUpdateData(
      lifecycleTask('running'),
      { status, [field]: at },
      writeTime
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(at.getTime());
  });

  it('clears stale completion state when transitioning back to an active status', () => {
    const completedAt = Timestamp.fromDate(new Date('2026-07-27T11:00:00.000Z'));
    const data = buildUpdateData(
      lifecycleTask('failed', { completedAt }),
      { status: 'running' },
      writeTime
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect(data['completedAt']).toBeInstanceOf(FieldValue);
  });

  it('clears stale or missing completion state when restoring an archive to active', () => {
    const data = buildUpdateData(
      lifecycleTask('archived'),
      { status: 'running' },
      writeTime,
    );

    expect((data['statusChangedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    expect(data['completedAt']).toBeInstanceOf(FieldValue);
  });

  it.each(['planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled'] as const)(
    'ensures %s completion transitions store completedAt',
    (status) => {
      const data = buildUpdateData(lifecycleTask('running'), { status }, writeTime);

      expect((data['completedAt'] as Timestamp).toMillis()).toBe(writeTime.getTime());
    }
  );
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
