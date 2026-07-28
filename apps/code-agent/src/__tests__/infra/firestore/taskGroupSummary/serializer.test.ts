/**
 * Unit tests for the pure serializer/aggregation helpers.
 * These tests hit the helpers directly — no Firestore, no transactions.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../../domain/models/codeTask.js';
import type { UserGroupCounts, TaskGroupSummary } from '../../../../domain/models/taskGroupSummary.js';
import { deriveAggregateStatusFromSummary } from '../../../../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import {
  applyDeleteGroupDelta,
  applyDeleteUpdate,
  applyIncrementalCreateUpdate,
  applyNewGroupDelta,
  applyStatusChangeDelta,
  applyStatusChangeUpdate,
  buildInitialSummary,
  computeAllArchivedSummaryFromTasks,
  computeReviewNeedsRemediation,
  computeSummaryFromTasks,
  defaultCounts,
  docToCounts,
  docToSummary,
  getLinearIssueSortFields,
  getGroupKey,
  hasCompletedExecutionAgentOnly,
  hasCompletedExecutionTask,
  hasImplementationLink,
  isActiveStatus,
  statusToCountField,
  toTimestamp,
} from '../../../../infra/firestore/taskGroupSummary/serializer.js';

function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = Timestamp.now();
  return {
    id: 'task-1',
    traceId: 'trace-1',
    userId: 'user-1',
    workerType: 'sonnet',
    workerLocation: 'home-dev',
    status: 'planned',
    prompt: 'hi',
    sanitizedPrompt: 'hi',
    systemPromptHash: 'abc123',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    dedupKey: 'abc123',
    callbackReceived: false,
    createdAt: now,
    statusChangedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('serializer: predicates', () => {
  it('getLinearIssueSortFields extracts numeric issue fields', () => {
    expect(getLinearIssueSortFields('INT-1606')).toEqual({
      linearIssueNumber: 1606,
      linearIssueSortKey: 1606,
    });
  });

  it('getLinearIssueSortFields uses standalone-first sort key for null or unparsable issue IDs', () => {
    expect(getLinearIssueSortFields(null)).toEqual({
      linearIssueNumber: null,
      linearIssueSortKey: Number.MAX_SAFE_INTEGER,
    });
    expect(getLinearIssueSortFields('not-linear')).toEqual({
      linearIssueNumber: null,
      linearIssueSortKey: Number.MAX_SAFE_INTEGER,
    });
  });

  it('getLinearIssueSortFields uses standalone-first sort key for non-finite issue numbers', () => {
    expect(getLinearIssueSortFields(`INT-${'9'.repeat(400)}`)).toEqual({
      linearIssueNumber: null,
      linearIssueSortKey: Number.MAX_SAFE_INTEGER,
    });
  });

  it('getGroupKey returns linearIssueId when present', () => {
    expect(getGroupKey(makeTask({ linearIssueId: 'INT-1' }))).toBe('INT-1');
  });

  it('getGroupKey falls back to standalone_{id}', () => {
    expect(getGroupKey(makeTask({ id: 'abc' }))).toBe('standalone_abc');
  });

  it('isActiveStatus covers queued/dispatched/running only', () => {
    expect(isActiveStatus('queued')).toBe(true);
    expect(isActiveStatus('dispatched')).toBe(true);
    expect(isActiveStatus('running')).toBe(true);
    expect(isActiveStatus('planned')).toBe(false);
    expect(isActiveStatus('implemented')).toBe(false);
    expect(isActiveStatus('archived')).toBe(false);
  });

  it('statusToCountField maps each GroupStatus correctly', () => {
    expect(statusToCountField('active')).toBe('active');
    expect(statusToCountField('needs-action')).toBe('needsAction');
    expect(statusToCountField('done')).toBe('done');
    expect(statusToCountField('failed')).toBe('failed');
    expect(statusToCountField('archived')).toBe('archived');
  });

  it('computeReviewNeedsRemediation returns null for non-review agent', () => {
    expect(computeReviewNeedsRemediation(makeTask({ agentType: 'execution', result: { needs_remediation: '1' } }))).toBeNull();
  });

  it('computeReviewNeedsRemediation returns null when no result', () => {
    expect(computeReviewNeedsRemediation(makeTask({ agentType: 'review' }))).toBeNull();
  });

  it('computeReviewNeedsRemediation returns false for "0"', () => {
    expect(computeReviewNeedsRemediation(makeTask({ agentType: 'review', result: { needs_remediation: '0' } }))).toBe(false);
  });

  it('computeReviewNeedsRemediation returns true for "1"', () => {
    expect(computeReviewNeedsRemediation(makeTask({ agentType: 'review', result: { needs_remediation: '1' } }))).toBe(true);
  });

  it('computeReviewNeedsRemediation returns null for unknown value', () => {
    expect(computeReviewNeedsRemediation(makeTask({ agentType: 'review', result: { needs_remediation: 'x' } }))).toBeNull();
  });

  it('hasCompletedExecutionTask returns true for execution implemented/reviewed', () => {
    expect(hasCompletedExecutionTask(makeTask({ agentType: 'execution', status: 'implemented' }))).toBe(true);
    expect(hasCompletedExecutionTask(makeTask({ agentType: 'execution', status: 'reviewed' }))).toBe(true);
  });

  it('hasCompletedExecutionTask returns true for pull_request implemented', () => {
    expect(hasCompletedExecutionTask(makeTask({ agentType: 'pull_request', status: 'implemented' }))).toBe(true);
  });

  it('hasCompletedExecutionTask returns false for review agent', () => {
    expect(hasCompletedExecutionTask(makeTask({ agentType: 'review', status: 'reviewed' }))).toBe(false);
  });

  it('hasCompletedExecutionAgentOnly only returns true for execution agent', () => {
    expect(hasCompletedExecutionAgentOnly(makeTask({ agentType: 'execution', status: 'implemented' }))).toBe(true);
    expect(hasCompletedExecutionAgentOnly(makeTask({ agentType: 'execution', status: 'reviewed' }))).toBe(true);
    expect(hasCompletedExecutionAgentOnly(makeTask({ agentType: 'pull_request', status: 'implemented' }))).toBe(false);
    expect(hasCompletedExecutionAgentOnly(makeTask({ agentType: 'execution', status: 'planned' }))).toBe(false);
  });

  it('hasImplementationLink detects implementationTaskId', () => {
    expect(hasImplementationLink(makeTask({ implementationTaskId: 'x' }))).toBe(true);
  });

  it('hasImplementationLink detects non-empty fanOutChildTaskIds', () => {
    expect(hasImplementationLink(makeTask({ fanOutChildTaskIds: ['a'] }))).toBe(true);
  });

  it('hasImplementationLink returns false for empty fanOutChildTaskIds', () => {
    expect(hasImplementationLink(makeTask({ fanOutChildTaskIds: [] }))).toBe(false);
  });

  it('hasImplementationLink returns false when neither field set', () => {
    expect(hasImplementationLink(makeTask())).toBe(false);
  });
});

describe('serializer: toTimestamp', () => {
  it('returns existing Timestamp unchanged', () => {
    const ts = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
    expect(toTimestamp(ts)).toBe(ts);
  });

  it('converts valid Date and timestamp-like values', () => {
    const date = new Date('2026-01-02T03:04:05.006Z');

    expect(toTimestamp(date).toMillis()).toBe(date.getTime());
    expect(toTimestamp({ toDate: () => date }).toMillis()).toBe(date.getTime());
    expect(toTimestamp({ _seconds: 1_767_322_800 }).seconds).toBe(1_767_322_800);
    expect(toTimestamp({ _seconds: 1_767_322_800, _nanoseconds: 123 }).nanoseconds).toBe(123);
  });

  it.each([
    ['invalid Date', new Date(Number.NaN)],
    ['timestamp-like object returning an invalid Date', { toDate: (): Date => new Date(Number.NaN) }],
    ['timestamp-like object returning a non-Date', { toDate: (): string => 'invalid' }],
    ['timestamp-like object throwing', { toDate: (): never => { throw new Error('invalid'); } }],
    ['private timestamp outside the Firestore range', { _seconds: Number.MAX_SAFE_INTEGER }],
    ['primitive value', 'invalid'],
  ])('rejects %s', (_label, value) => {
    expect(() => toTimestamp(value)).toThrow('Invalid task group summary timestamp: timestamp');
  });
});

describe('serializer: docToSummary', () => {
  const now = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));

  function requiredSummaryFields(): Record<string, unknown> {
    return {
      userId: 'u1',
      linearIssueId: 'INT-42',
      groupKey: 'INT-42',
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
    };
  }

  it('uses documented defaults when optional legacy fields are absent', () => {
    const back = docToSummary({
      latestTaskUpdatedAt: now,
      oldestTaskCreatedAt: now,
      updatedAt: now,
    });

    expect(back).toMatchObject({
      userId: '',
      linearIssueId: null,
      groupKey: '',
      taskCount: 0,
      activeTaskCount: 0,
      latestTaskStatus: '',
      agentTypesPresent: [],
      prNumber: null,
      latestMergeReadyReason: null,
      latestMergeReadyUpdatedAt: null,
      prMergedAt: null,
      prClosedAt: null,
      latestReviewNeedsRemediation: null,
      mostRecentDispatchedAt: null,
      aggregateStatus: 'done',
    });
  });

  it('preserves true latest review remediation evidence', () => {
    const back = docToSummary({
      ...requiredSummaryFields(),
      latestReviewNeedsRemediation: true,
    });

    expect(back.latestReviewNeedsRemediation).toBe(true);
  });

  it('reads a full summary', () => {
    const original: TaskGroupSummary = {
      userId: 'u1',
      linearIssueId: 'INT-1',
      linearIssueNumber: 1,
      linearIssueSortKey: 1,
      groupKey: 'INT-1',
      taskCount: 2,
      activeTaskCount: 1,
      latestTaskStatus: 'running',
      latestTaskId: 'task-running',
      latestTaskCreatedAt: now,
      latestTaskUpdatedAt: now,
      agentTypesPresent: ['planning', 'execution'],
      hasCompletedPlanning: true,
      hasCompletedExecution: false,
      hasCompletedExecutionAgent: false,
      hasImplementationTaskId: false,
      hasPrUrl: false,
      prNumber: null,
      latestReviewNeedsRemediation: null,
      oldestTaskCreatedAt: now,
      mostRecentDispatchedAt: now,
      aggregateStatus: 'active',
      updatedAt: now,
    };
    const back = docToSummary(original as unknown as Record<string, unknown>);
    expect(back).toMatchObject(original);
  });

  it('keeps legacy identity fields absent instead of fabricating them from the read clock', () => {
    const back = docToSummary({
      userId: 'u1', linearIssueId: 'INT-42', groupKey: 'INT-42', taskCount: 1, activeTaskCount: 0,
      latestTaskStatus: 'planned', latestTaskUpdatedAt: now, agentTypesPresent: ['planning'],
      hasCompletedPlanning: true, hasCompletedExecution: false, hasImplementationTaskId: false,
      hasPrUrl: false, prNumber: null, latestReviewNeedsRemediation: null,
      oldestTaskCreatedAt: now, mostRecentDispatchedAt: null, aggregateStatus: 'done', updatedAt: now,
    });

    expect(back.latestTaskId).toBeUndefined();
    expect(back.latestTaskCreatedAt).toBeUndefined();
  });

  it('derives linear sort fields for legacy docs', () => {
    const back = docToSummary({
      userId: 'u1', linearIssueId: 'INT-42', groupKey: 'INT-42', taskCount: 1, activeTaskCount: 0,
      latestTaskStatus: 'planned', latestTaskUpdatedAt: now, agentTypesPresent: ['planning'],
      hasCompletedPlanning: true, hasCompletedExecution: false, hasImplementationTaskId: false,
      hasPrUrl: false, prNumber: null, latestReviewNeedsRemediation: null,
      oldestTaskCreatedAt: now, mostRecentDispatchedAt: null, aggregateStatus: 'done', updatedAt: now,
    });
    expect(back.linearIssueNumber).toBe(42);
    expect(back.linearIssueSortKey).toBe(42);
  });

  it('preserves optional label fields when present', () => {
    const s: TaskGroupSummary = {
      userId: 'u', linearIssueId: null, groupKey: 'standalone_x', taskCount: 1, activeTaskCount: 0,
      linearIssueNumber: null, linearIssueSortKey: Number.MAX_SAFE_INTEGER,
      latestTaskStatus: 'planned', latestTaskUpdatedAt: now, agentTypesPresent: [],
      hasCompletedPlanning: false, hasCompletedExecution: false, hasCompletedExecutionAgent: false,
      hasImplementationTaskId: false, hasPrUrl: false, prNumber: null,
      latestReviewNeedsRemediation: null, oldestTaskCreatedAt: now, mostRecentDispatchedAt: null,
      hasImplementationReadyLabel: true, hasMergeReadyLabel: false, labelsUpdatedAt: now,
      isImportant: true, aggregateStatus: 'done', updatedAt: now,
    };
    const back = docToSummary(s as unknown as Record<string, unknown>);
    expect(back.hasImplementationReadyLabel).toBe(true);
    expect(back.hasMergeReadyLabel).toBe(false);
    expect(back.labelsUpdatedAt).toBeDefined();
    expect(back.isImportant).toBe(true);
  });

  it('omits optional label fields when absent (legacy shape)', () => {
    const legacy: Record<string, unknown> = {
      userId: 'u1', linearIssueId: null, groupKey: 'g', taskCount: 1, activeTaskCount: 0,
      latestTaskStatus: 'planned', latestTaskUpdatedAt: now, agentTypesPresent: ['planning'],
      hasCompletedPlanning: true, hasCompletedExecution: false, hasImplementationTaskId: false,
      hasPrUrl: false, prNumber: null, latestReviewNeedsRemediation: null,
      oldestTaskCreatedAt: now, mostRecentDispatchedAt: null, aggregateStatus: 'done', updatedAt: now,
    };
    const back = docToSummary(legacy);
    expect(back.hasImplementationReadyLabel).toBeUndefined();
    expect(back.hasMergeReadyLabel).toBeUndefined();
    expect(back.labelsUpdatedAt).toBeUndefined();
    expect(back.isImportant).toBeUndefined();
  });

  it('does not set isImportant when flag is false', () => {
    const back = docToSummary({
      userId: 'u1', linearIssueId: null, groupKey: 'g', taskCount: 1, activeTaskCount: 0,
      latestTaskStatus: 'planned', latestTaskUpdatedAt: now, agentTypesPresent: [],
      hasCompletedPlanning: false, hasCompletedExecution: false, hasImplementationTaskId: false,
      hasPrUrl: false, prNumber: null, latestReviewNeedsRemediation: null,
      oldestTaskCreatedAt: now, mostRecentDispatchedAt: null,
      isImportant: false, aggregateStatus: 'done', updatedAt: now,
    });
    expect(back.isImportant).toBeUndefined();
  });

  it('preserves explicit false latestReviewNeedsRemediation', () => {
    const back = docToSummary({
      userId: 'u1', linearIssueId: null, groupKey: 'g', taskCount: 1, activeTaskCount: 0,
      latestTaskStatus: 'reviewed', latestTaskUpdatedAt: now, agentTypesPresent: ['review'],
      hasCompletedPlanning: false, hasCompletedExecution: false, hasImplementationTaskId: false,
      hasPrUrl: false, prNumber: null, latestReviewNeedsRemediation: false,
      oldestTaskCreatedAt: now, mostRecentDispatchedAt: null, aggregateStatus: 'done', updatedAt: now,
    });
    expect(back.latestReviewNeedsRemediation).toBe(false);
  });

  it('omits malformed optional timestamps instead of replacing them with the read clock', () => {
    const back = docToSummary({
      ...requiredSummaryFields(),
      latestTaskCreatedAt: {},
      latestMergeReadyUpdatedAt: {},
      latestMergeReadyDecisionAt: {},
      prMergedAt: {},
      prClosedAt: {},
      latestReviewUpdatedAt: {},
      representativePrUpdatedAt: {},
      mostRecentDispatchedAt: {},
      labelsUpdatedAt: {},
      taskLifecycleAtById: {
        task_valid: now,
        task_invalid: {},
      },
    });

    expect(back.latestTaskCreatedAt).toBeUndefined();
    expect(back.latestMergeReadyUpdatedAt).toBeNull();
    expect(back.latestMergeReadyDecisionAt).toBeUndefined();
    expect(back.prMergedAt).toBeNull();
    expect(back.prClosedAt).toBeNull();
    expect(back.latestReviewUpdatedAt).toBeUndefined();
    expect(back.representativePrUpdatedAt).toBeUndefined();
    expect(back.mostRecentDispatchedAt).toBeNull();
    expect(back.labelsUpdatedAt).toBeUndefined();
    expect(back.taskLifecycleAtById).toEqual({ task_valid: now });
  });

  it.each([
    ['finite Date outside Firestore range', new Date(8.64e15)],
    ['private timestamp with non-finite present nanos', { _seconds: 1_775_000_000, _nanoseconds: Number.NaN }],
    ['private timestamp with fractional present nanos', { _seconds: 1_775_000_000, _nanoseconds: 1.5 }],
    ['private timestamp with out-of-range present nanos', { _seconds: 1_775_000_000, _nanoseconds: 1_000_000_000 }],
  ])('omits optional %s without throwing', (_label, malformedTimestamp) => {
    expect(() => docToSummary({
      ...requiredSummaryFields(),
      latestTaskCreatedAt: malformedTimestamp,
      mostRecentDispatchedAt: malformedTimestamp,
      taskLifecycleAtById: { malformed: malformedTimestamp },
    })).not.toThrow();

    const back = docToSummary({
      ...requiredSummaryFields(),
      latestTaskCreatedAt: malformedTimestamp,
      mostRecentDispatchedAt: malformedTimestamp,
      taskLifecycleAtById: { malformed: malformedTimestamp },
    });
    expect(back.latestTaskCreatedAt).toBeUndefined();
    expect(back.mostRecentDispatchedAt).toBeNull();
    expect(back.taskLifecycleAtById).toEqual({});
  });

  it('rejects malformed required timestamps instead of fabricating now', () => {
    expect(() => docToSummary({
      ...requiredSummaryFields(),
      latestTaskUpdatedAt: {},
    })).toThrow('Invalid task group summary timestamp: latestTaskUpdatedAt');
  });

  it.each([
    ['finite Date outside Firestore range', new Date(8.64e15)],
    ['private timestamp with non-finite present nanos', { _seconds: 1_775_000_000, _nanoseconds: Number.NaN }],
    ['private timestamp with fractional present nanos', { _seconds: 1_775_000_000, _nanoseconds: 1.5 }],
    ['private timestamp with out-of-range present nanos', { _seconds: 1_775_000_000, _nanoseconds: 1_000_000_000 }],
  ])('rejects required %s', (_label, malformedTimestamp) => {
    expect(() => docToSummary({
      ...requiredSummaryFields(),
      latestTaskUpdatedAt: malformedTimestamp,
    })).toThrow('Invalid task group summary timestamp: latestTaskUpdatedAt');
  });
});

describe('serializer: docToCounts / defaultCounts', () => {
  it('defaultCounts is all zeros', () => {
    const c = defaultCounts('u1');
    expect(c.userId).toBe('u1');
    expect(c.active).toBe(0);
    expect(c.needsAction).toBe(0);
    expect(c.done).toBe(0);
    expect(c.failed).toBe(0);
    expect(c.archived).toBe(0);
    expect(c.totalGroups).toBe(0);
  });

  it('reads a counts doc', () => {
    const now = Timestamp.now();
    const original: UserGroupCounts = {
      userId: 'u', active: 1, needsAction: 2, done: 3, failed: 4, archived: 5, totalGroups: 15, updatedAt: now,
    };
    const back = docToCounts(original as unknown as Record<string, unknown>);
    expect(back).toMatchObject(original);
  });
});

describe('serializer: buildInitialSummary', () => {
  const now = Timestamp.fromDate(new Date('2026-02-01T00:00:00Z'));

  it('builds basic summary for new planning task', () => {
    const createdAt = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
    const lifecycleAt = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
    const technicalAt = Timestamp.fromDate(new Date('2026-01-03T00:00:00Z'));
    const task = makeTask({
      id: 'task-initial',
      userId: 'u',
      linearIssueId: 'INT-1',
      agentType: 'planning',
      status: 'planned',
      createdAt,
      statusChangedAt: lifecycleAt,
      updatedAt: technicalAt,
    });
    const summary = buildInitialSummary(task, now);
    expect(summary.userId).toBe('u');
    expect(summary.linearIssueId).toBe('INT-1');
    expect(summary.linearIssueNumber).toBe(1);
    expect(summary.linearIssueSortKey).toBe(1);
    expect(summary.groupKey).toBe('INT-1');
    expect(summary.taskCount).toBe(1);
    expect(summary.activeTaskCount).toBe(0);
    expect(summary.hasCompletedPlanning).toBe(true);
    expect(summary.agentTypesPresent).toEqual(['planning']);
    expect(summary.latestTaskId).toBe('task-initial');
    expect(summary.latestTaskCreatedAt).toBe(createdAt);
    expect(summary.latestTaskUpdatedAt).toEqual(lifecycleAt);
    expect(summary.updatedAt).toBe(now);
  });

  it('sets taskCount=0 for archived first task', () => {
    const task = makeTask({ status: 'archived' });
    expect(buildInitialSummary(task, now).taskCount).toBe(0);
  });

  it('agentTypesPresent is empty when agentType absent', () => {
    expect(buildInitialSummary(makeTask(), now).agentTypesPresent).toEqual([]);
  });

  it('hasPrUrl only when task result has prUrl', () => {
    const task = makeTask({ agentType: 'execution', status: 'implemented', result: { prUrl: 'https://x' }, prNumber: 42 });
    const s = buildInitialSummary(task, now);
    expect(s.hasPrUrl).toBe(true);
    expect(s.prNumber).toBe(42);
  });

  it('tracks durable merge-ready evidence and representative PR terminal state from the initial task', () => {
    const prClosedAt = Timestamp.fromDate(new Date('2026-07-05T10:00:00Z'));
    const summary = buildInitialSummary(makeTask({
      agentType: 'execution',
      status: 'implemented',
      prClosedAt,
      prNumber: 42,
      result: {
        prUrl: 'https://github.com/org/repo/pull/42',
        merge_ready: '1',
        merge_ready_reason: 'review_skipped',
      },
    }), now);

    expect(summary.latestMergeReadyEvidence).toBe(true);
    expect(summary.latestMergeReadyReason).toBe('review_skipped');
    expect(summary.prClosedAt).toBe(prClosedAt);
    expect(summary.prMergedAt).toBeNull();
  });

  it('tracks merged representative PR terminal state from the initial task', () => {
    const prMergedAt = Timestamp.fromDate(new Date('2026-07-05T11:00:00Z'));
    const summary = buildInitialSummary(makeTask({
      agentType: 'execution',
      status: 'implemented',
      prMergedAt,
      prNumber: 42,
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
    }), now);

    expect(summary.prMergedAt).toBe(prMergedAt);
    expect(summary.prClosedAt).toBeNull();
  });

  it('prNumber is null when hasPrUrl but prNumber absent', () => {
    const task = makeTask({ agentType: 'execution', status: 'implemented', result: { prUrl: 'https://x' } });
    expect(buildInitialSummary(task, now).prNumber).toBeNull();
  });

  it('mostRecentDispatchedAt set from dispatchedAt', () => {
    const task = makeTask({ status: 'dispatched', dispatchedAt: now });
    expect(buildInitialSummary(task, now).mostRecentDispatchedAt).toBe(now);
  });

  it('mostRecentDispatchedAt null when no dispatchedAt', () => {
    expect(buildInitialSummary(makeTask(), now).mostRecentDispatchedAt).toBeNull();
  });

  it('activeTaskCount=1 for running status', () => {
    expect(buildInitialSummary(makeTask({ status: 'running' }), now).activeTaskCount).toBe(1);
  });

  it('sets standalone-first sort key when no linear issue is present', () => {
    const summary = buildInitialSummary(makeTask(), now);
    expect(summary.linearIssueNumber).toBeNull();
    expect(summary.linearIssueSortKey).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('serializer: applyIncrementalCreateUpdate', () => {
  const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
  const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
  const base: TaskGroupSummary = {
    userId: 'u', linearIssueId: 'INT-1', groupKey: 'INT-1', taskCount: 1, activeTaskCount: 0,
    linearIssueNumber: 1, linearIssueSortKey: 1,
    latestTaskStatus: 'planned', latestTaskUpdatedAt: t1, agentTypesPresent: ['planning'],
    hasCompletedPlanning: true, hasCompletedExecution: false, hasCompletedExecutionAgent: false,
    hasImplementationTaskId: false, hasPrUrl: false, prNumber: null,
    latestReviewNeedsRemediation: null, oldestTaskCreatedAt: t1, mostRecentDispatchedAt: null,
    aggregateStatus: 'needs-action', updatedAt: t1,
  };

  it('increments taskCount for non-archived task', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ agentType: 'execution', status: 'implemented', createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.taskCount).toBe(2);
    expect(updated.hasCompletedExecution).toBe(true);
    expect(updated.hasCompletedExecutionAgent).toBe(true);
  });

  it('initializes per-task maps when adding to a partially migrated summary', () => {
    const legacy: TaskGroupSummary = { ...base, taskIds: ['existing'] };
    const updated = applyIncrementalCreateUpdate(
      legacy,
      makeTask({ id: 'new', status: 'planned', createdAt: t2, statusChangedAt: t2, updatedAt: t2 }),
      t2,
    );

    expect(updated.taskStatusById).toEqual({ new: 'planned' });
    expect(updated.taskLifecycleAtById).toEqual({ new: t2 });
  });

  it('does not increment for archived task', () => {
    expect(applyIncrementalCreateUpdate(base, makeTask({ status: 'archived' }), t2).taskCount).toBe(1);
  });

  it('adds new agent type', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ agentType: 'execution', status: 'running', createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.agentTypesPresent).toEqual(['planning', 'execution']);
    expect(updated.activeTaskCount).toBe(1);
  });

  it('skips duplicate agent type', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ agentType: 'planning', status: 'planned', createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.agentTypesPresent).toEqual(['planning']);
  });

  it('updates latestTaskStatus when newer', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ status: 'running', createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.latestTaskStatus).toBe('running');
  });

  it('selects new attempt identity by createdAt and id while lifecycle activity uses statusChangedAt', () => {
    const lifecycleAt = Timestamp.fromDate(new Date('2026-01-03T00:00:00Z'));
    const current: TaskGroupSummary = {
      ...base,
      latestTaskId: 'task-A',
      latestTaskCreatedAt: t1,
      latestTaskUpdatedAt: lifecycleAt,
    };
    const updated = applyIncrementalCreateUpdate(
      current,
      makeTask({
        id: 'task-B',
        status: 'running',
        createdAt: t2,
        statusChangedAt: t2,
        updatedAt: Timestamp.fromDate(new Date('2026-01-05T00:00:00Z')),
      }),
      Timestamp.fromDate(new Date('2026-01-06T00:00:00Z')),
    );

    expect(updated.latestTaskId).toBe('task-B');
    expect(updated.latestTaskCreatedAt).toBe(t2);
    expect(updated.latestTaskStatus).toBe('running');
    expect(updated.latestTaskUpdatedAt).toBe(lifecycleAt);
  });

  it('uses id descending to break equal creation-time identity ties', () => {
    const current: TaskGroupSummary = {
      ...base,
      latestTaskId: 'task-A',
      latestTaskCreatedAt: t1,
    };
    const updated = applyIncrementalCreateUpdate(
      current,
      makeTask({ id: 'task-B', status: 'running', createdAt: t1, statusChangedAt: t1, updatedAt: t1 }),
      t2,
    );

    expect(updated.latestTaskId).toBe('task-B');
    expect(updated.latestTaskStatus).toBe('running');
  });

  it('updates oldestTaskCreatedAt when older', () => {
    const older = Timestamp.fromDate(new Date('2025-12-01T00:00:00Z'));
    const updated = applyIncrementalCreateUpdate(base, makeTask({ status: 'planned', createdAt: older, updatedAt: t2 }), t2);
    expect(updated.oldestTaskCreatedAt.toMillis()).toBe(older.toMillis());
  });

  it('sets hasPrUrl and prNumber when prUrl present', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ agentType: 'execution', status: 'implemented', result: { prUrl: 'https://x' }, prNumber: 7, createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.hasPrUrl).toBe(true);
    expect(updated.prNumber).toBe(7);
  });

  it('sets representative PR terminal timestamps when prUrl is added incrementally', () => {
    const prMergedAt = Timestamp.fromDate(new Date('2026-07-05T12:00:00Z'));
    const prClosedAt = Timestamp.fromDate(new Date('2026-07-05T13:00:00Z'));
    const updated = applyIncrementalCreateUpdate(
      base,
      makeTask({
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://x' },
        prNumber: 7,
        prMergedAt,
        prClosedAt,
        createdAt: t2,
        updatedAt: t2,
      }),
      t2,
    );

    expect(updated.prMergedAt).toBe(prMergedAt);
    expect(updated.prClosedAt).toBe(prClosedAt);
  });

  it('keeps newer representative PR evidence and compares legacy ownerless evidence', () => {
    const withNewerPr: TaskGroupSummary = {
      ...base,
      hasPrUrl: true,
      prNumber: 99,
      representativePrUpdatedAt: t2,
    };
    const older = applyIncrementalCreateUpdate(
      withNewerPr,
      makeTask({
        id: 'older-pr', status: 'implemented', result: { prUrl: 'https://older' }, prNumber: 1,
        createdAt: t1, updatedAt: t1,
      }),
      t2,
    );
    const withOwnedPr = { ...withNewerPr, representativePrTaskId: 'owner' };
    const newer = applyIncrementalCreateUpdate(
      withOwnedPr,
      makeTask({
        id: 'newer-pr', status: 'implemented', result: { prUrl: 'https://newer' }, prNumber: 100,
        createdAt: t2, updatedAt: Timestamp.fromMillis(t2.toMillis() + 1),
      }),
      t2,
    );

    expect(older.prNumber).toBe(99);
    expect(newer.prNumber).toBe(100);
  });

  it('sets durable merge-ready evidence when added incrementally', () => {
    const updated = applyIncrementalCreateUpdate(
      base,
      makeTask({
        agentType: 'execution',
        status: 'implemented',
        result: {
          prUrl: 'https://x',
          merge_ready: '1',
          merge_ready_reason: 'review_skipped',
        },
        createdAt: t2,
        updatedAt: t2,
      }),
      t2,
    );

    expect(updated.latestMergeReadyEvidence).toBe(true);
    expect(updated.latestMergeReadyReason).toBe('review_skipped');
  });

  it('clears durable merge-ready evidence when a newer pull_request pushed commits', () => {
    const withEvidence: TaskGroupSummary = {
      ...base,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_no_remediation',
      latestMergeReadyUpdatedAt: t1,
    };
    const updated = applyIncrementalCreateUpdate(
      withEvidence,
      makeTask({
        agentType: 'pull_request',
        status: 'implemented',
        result: {
          prUrl: 'https://x',
          pull_request_outcome_label: 'commits_pushed',
        },
        createdAt: t2,
        updatedAt: t2,
      }),
      t2,
    );

    expect(updated.latestMergeReadyEvidence).toBe(false);
    expect(updated.latestMergeReadyReason).toBeNull();
    expect(updated.latestMergeReadyUpdatedAt).toBeNull();
  });

  it('clears durable merge-ready evidence when existing evidence timestamp is missing', () => {
    const withLegacyEvidence: TaskGroupSummary = {
      ...base,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_no_remediation',
    };
    const updated = applyIncrementalCreateUpdate(
      withLegacyEvidence,
      makeTask({
        agentType: 'pull_request',
        status: 'implemented',
        result: { pull_request_outcome_label: 'commits_pushed' },
        createdAt: t2,
        updatedAt: t2,
      }),
      t2,
    );

    expect(updated.latestMergeReadyEvidence).toBe(false);
    expect(updated.latestMergeReadyReason).toBeNull();
    expect(updated.latestMergeReadyUpdatedAt).toBeNull();
  });

  it('keeps durable merge-ready evidence when an older invalidator is added incrementally', () => {
    const withEvidence: TaskGroupSummary = {
      ...base,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_no_remediation',
      latestMergeReadyUpdatedAt: t2,
    };
    const updated = applyIncrementalCreateUpdate(
      withEvidence,
      makeTask({
        agentType: 'pull_request',
        status: 'implemented',
        result: { pull_request_outcome_label: 'commits_pushed' },
        createdAt: t1,
        updatedAt: t1,
      }),
      t2,
    );

    expect(updated.latestMergeReadyEvidence).toBe(true);
    expect(updated.latestMergeReadyReason).toBe('review_no_remediation');
    expect(updated.latestMergeReadyUpdatedAt).toBe(t2);
  });

  it('updates review needs-remediation', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ agentType: 'review', status: 'reviewed', result: { needs_remediation: '1' }, createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.latestReviewNeedsRemediation).toBe(true);
  });

  it('handles null and older existing review evidence timestamps incrementally', () => {
    const review = makeTask({
      id: 'review', agentType: 'review', status: 'reviewed', result: { needs_remediation: '1' },
      createdAt: t1, updatedAt: t1,
    });
    const fromNull = applyIncrementalCreateUpdate({ ...base, latestReviewUpdatedAt: null }, review, t2);
    const fromNewer = applyIncrementalCreateUpdate(
      { ...base, latestReviewUpdatedAt: t2, latestReviewNeedsRemediation: false },
      review,
      t2,
    );

    expect(fromNull.latestReviewNeedsRemediation).toBe(true);
    expect(fromNewer.latestReviewNeedsRemediation).toBe(false);
  });

  it('recomputes aggregateStatus', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ status: 'running', createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.aggregateStatus).toBe('active');
  });

  it('mostRecentDispatchedAt advances when new dispatch is newer than existing', () => {
    const existingDispatch = Timestamp.fromMillis(100);
    const newerDispatch = Timestamp.fromMillis(200);
    const withExisting: TaskGroupSummary = { ...base, mostRecentDispatchedAt: existingDispatch };
    const updated = applyIncrementalCreateUpdate(
      withExisting,
      makeTask({ status: 'dispatched', dispatchedAt: newerDispatch, createdAt: t2, updatedAt: t2 }),
      t2,
    );
    expect(updated.mostRecentDispatchedAt?.toMillis()).toBe(200);
  });

  it('mostRecentDispatchedAt does not regress when new dispatch is older than existing', () => {
    const existingDispatch = Timestamp.fromMillis(100);
    const olderDispatch = Timestamp.fromMillis(50);
    const withExisting: TaskGroupSummary = { ...base, mostRecentDispatchedAt: existingDispatch };
    const updated = applyIncrementalCreateUpdate(
      withExisting,
      makeTask({ status: 'dispatched', dispatchedAt: olderDispatch, createdAt: t2, updatedAt: t2 }),
      t2,
    );
    expect(updated.mostRecentDispatchedAt?.toMillis()).toBe(100);
  });

  it('repairs missing linear sort fields on legacy summaries', () => {
    const legacy = { ...base, linearIssueId: 'INT-1606', groupKey: 'INT-1606' } as TaskGroupSummary;
    delete (legacy as unknown as Record<string, unknown>)['linearIssueNumber'];
    delete (legacy as unknown as Record<string, unknown>)['linearIssueSortKey'];

    const updated = applyIncrementalCreateUpdate(
      legacy,
      makeTask({ status: 'planned', linearIssueId: 'INT-1606', createdAt: t2, updatedAt: t2 }),
      t2,
    );

    expect(updated.linearIssueNumber).toBe(1606);
    expect(updated.linearIssueSortKey).toBe(1606);
  });
});

describe('serializer: applyStatusChangeUpdate', () => {
  const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
  const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
  const base: TaskGroupSummary = {
    userId: 'u', linearIssueId: 'INT-1', groupKey: 'INT-1', taskCount: 1, activeTaskCount: 1,
    linearIssueNumber: 1, linearIssueSortKey: 1,
    latestTaskStatus: 'running', latestTaskUpdatedAt: t1, agentTypesPresent: ['execution'],
    hasCompletedPlanning: false, hasCompletedExecution: false, hasCompletedExecutionAgent: false,
    hasImplementationTaskId: false, hasPrUrl: false, prNumber: null,
    latestReviewNeedsRemediation: null, oldestTaskCreatedAt: t1, mostRecentDispatchedAt: null,
    aggregateStatus: 'active', updatedAt: t1,
  };

  it('decrements activeTaskCount when transitioning from active to non-active', () => {
    const oldTask = makeTask({ agentType: 'execution', status: 'running' });
    const newTask = makeTask({ agentType: 'execution', status: 'implemented', updatedAt: t2 });
    const { updated, allArchived } = applyStatusChangeUpdate(base, oldTask, newTask, t2);
    expect(updated.activeTaskCount).toBe(0);
    expect(updated.hasCompletedExecution).toBe(true);
    expect(allArchived).toBe(false);
  });

  it('lets metadata-only PR evidence advance technical chronology without changing identity or lifecycle', () => {
    const failureAtT1 = Timestamp.fromDate(new Date('2026-01-03T00:00:00Z'));
    const metadataAtT2 = Timestamp.fromDate(new Date('2026-01-05T00:00:00Z'));
    const summaryWriteAt = Timestamp.fromDate(new Date('2026-01-06T00:00:00Z'));
    const current: TaskGroupSummary = {
      ...base,
      latestTaskId: 'task-B',
      latestTaskCreatedAt: t2,
      latestTaskStatus: 'implemented',
      latestTaskUpdatedAt: failureAtT1,
    };
    const oldTask = makeTask({
      id: 'task-A',
      agentType: 'execution',
      status: 'failed',
      createdAt: t1,
      statusChangedAt: failureAtT1,
      updatedAt: failureAtT1,
    });
    const newTask = makeTask({
      ...oldTask,
      result: {
        prUrl: 'https://github.com/org/repo/pull/42',
        merge_ready: '1',
        merge_ready_reason: 'review_no_remediation',
      },
      prNumber: 42,
      updatedAt: metadataAtT2,
    });

    const { updated } = applyStatusChangeUpdate(current, oldTask, newTask, summaryWriteAt);

    expect(updated.latestTaskId).toBe('task-B');
    expect(updated.latestTaskCreatedAt).toBe(t2);
    expect(updated.latestTaskStatus).toBe('implemented');
    expect(updated.latestTaskUpdatedAt).toEqual(failureAtT1);
    expect(updated.latestMergeReadyUpdatedAt).toBe(metadataAtT2);
    expect(updated.prNumber).toBe(42);
    expect(updated.updatedAt).toBe(summaryWriteAt);
  });

  it('updates latestTaskStatus only when the creation-identity representative changes status', () => {
    const current: TaskGroupSummary = {
      ...base,
      latestTaskId: 'task-B',
      latestTaskCreatedAt: t2,
      latestTaskStatus: 'running',
    };
    const oldTask = makeTask({ id: 'task-B', status: 'running', createdAt: t2, statusChangedAt: t1, updatedAt: t1 });
    const newTask = makeTask({ id: 'task-B', status: 'implemented', createdAt: t2, statusChangedAt: t2, updatedAt: t2 });

    const { updated } = applyStatusChangeUpdate(current, oldTask, newTask, t2);

    expect(updated.latestTaskStatus).toBe('implemented');
    expect(updated.latestTaskUpdatedAt).toEqual(t2);
  });

  it('increments activeTaskCount when transitioning from non-active to active', () => {
    const s = { ...base, activeTaskCount: 0, latestTaskStatus: 'planned', aggregateStatus: 'done' as const };
    const { updated } = applyStatusChangeUpdate(s, makeTask({ status: 'planned' }), makeTask({ status: 'running', updatedAt: t2 }), t2);
    expect(updated.activeTaskCount).toBe(1);
  });

  it('marks allArchived when last non-archived task is archived', () => {
    const { updated, allArchived } = applyStatusChangeUpdate(base, makeTask({ status: 'running' }), makeTask({ status: 'archived', updatedAt: t2 }), t2);
    expect(allArchived).toBe(true);
    expect(updated.taskCount).toBe(0);
    expect(updated.aggregateStatus).toBe('archived');
  });

  it('recognizes an unknown callback as already archived when the group is empty', () => {
    const archived: TaskGroupSummary = { ...base, taskIds: [], taskCount: 0, aggregateStatus: 'archived' };
    const { allArchived } = applyStatusChangeUpdate(
      archived,
      makeTask({ id: 'unknown', status: 'running' }),
      makeTask({ id: 'unknown', status: 'archived', updatedAt: t2 }),
      t2,
    );

    expect(allArchived).toBe(true);
  });

  it('removes an archived task from a partially migrated summary without per-task maps', () => {
    const legacy: TaskGroupSummary = { ...base, taskIds: ['task-1'] };
    const { updated, allArchived } = applyStatusChangeUpdate(
      legacy,
      makeTask({ id: 'task-1', status: 'running', statusChangedAt: t1 }),
      makeTask({ id: 'task-1', status: 'archived', statusChangedAt: t2, updatedAt: t2 }),
      t2,
    );

    expect(allArchived).toBe(true);
    expect(updated.taskStatusById).toEqual({});
    expect(updated.taskLifecycleAtById).toEqual({});
  });

  it('does not increment taskCount if archive is re-applied', () => {
    const { updated, allArchived } = applyStatusChangeUpdate(base, makeTask({ status: 'archived' }), makeTask({ status: 'archived', updatedAt: t2 }), t2);
    expect(allArchived).toBe(false);
    expect(updated.taskCount).toBe(1);
  });

  it('adds new agent type to agentTypesPresent', () => {
    const { updated } = applyStatusChangeUpdate(base, makeTask({ agentType: 'execution', status: 'running' }), makeTask({ agentType: 'review', status: 'reviewed', updatedAt: t2 }), t2);
    expect(updated.agentTypesPresent).toContain('review');
  });

  it('sets hasPrUrl + prNumber from newTask', () => {
    const newTask = makeTask({ agentType: 'execution', status: 'implemented', result: { prUrl: 'https://x' }, prNumber: 3, updatedAt: t2 });
    const { updated } = applyStatusChangeUpdate(base, makeTask({ status: 'running' }), newTask, t2);
    expect(updated.hasPrUrl).toBe(true);
    expect(updated.prNumber).toBe(3);
  });

  it('sets representative PR terminal timestamps from newTask during status change', () => {
    const prMergedAt = Timestamp.fromDate(new Date('2026-07-05T14:00:00Z'));
    const prClosedAt = Timestamp.fromDate(new Date('2026-07-05T15:00:00Z'));
    const newTask = makeTask({
      agentType: 'execution',
      status: 'implemented',
      result: { prUrl: 'https://x' },
      prNumber: 3,
      prMergedAt,
      prClosedAt,
      updatedAt: t2,
    });
    const { updated } = applyStatusChangeUpdate(base, makeTask({ status: 'running' }), newTask, t2);

    expect(updated.prMergedAt).toBe(prMergedAt);
    expect(updated.prClosedAt).toBe(prClosedAt);
  });

  it('keeps newer representative PR evidence with a legacy missing owner during status change', () => {
    const current: TaskGroupSummary = {
      ...base,
      hasPrUrl: true,
      prNumber: 99,
      representativePrUpdatedAt: t2,
    };
    const { updated } = applyStatusChangeUpdate(
      current,
      makeTask({ id: 'older-pr', status: 'running', statusChangedAt: t1 }),
      makeTask({
        id: 'older-pr', status: 'implemented', statusChangedAt: t2, updatedAt: t1,
        result: { prUrl: 'https://older' }, prNumber: 1,
      }),
      t2,
    );

    expect(updated.prNumber).toBe(99);
  });

  it('sets durable merge-ready evidence from newTask during status change', () => {
    const newTask = makeTask({
      agentType: 'execution',
      status: 'implemented',
      result: {
        prUrl: 'https://x',
        merge_ready: '1',
        merge_ready_reason: 'review_skipped',
      },
      updatedAt: t2,
    });
    const { updated } = applyStatusChangeUpdate(base, makeTask({ status: 'running' }), newTask, t2);

    expect(updated.latestMergeReadyEvidence).toBe(true);
    expect(updated.latestMergeReadyReason).toBe('review_skipped');
  });

  it('clears durable merge-ready evidence when a newer status-change result pushes commits', () => {
    const withEvidence: TaskGroupSummary = {
      ...base,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_no_remediation',
      latestMergeReadyUpdatedAt: t1,
    };
    const newTask = makeTask({
      agentType: 'pull_request',
      status: 'implemented',
      result: {
        prUrl: 'https://x',
        pull_request_outcome_label: 'commits_pushed',
      },
      updatedAt: t2,
    });
    const { updated } = applyStatusChangeUpdate(withEvidence, makeTask({ status: 'running' }), newTask, t2);

    expect(updated.latestMergeReadyEvidence).toBe(false);
    expect(updated.latestMergeReadyReason).toBeNull();
    expect(updated.latestMergeReadyUpdatedAt).toBeNull();
  });

  it('keeps durable merge-ready evidence when an older status-change invalidator arrives', () => {
    const withEvidence: TaskGroupSummary = {
      ...base,
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_no_remediation',
      latestMergeReadyUpdatedAt: t2,
    };
    const newTask = makeTask({
      agentType: 'pull_request',
      status: 'implemented',
      result: { pull_request_outcome_label: 'commits_pushed' },
      updatedAt: t1,
    });
    const { updated } = applyStatusChangeUpdate(withEvidence, makeTask({ status: 'running' }), newTask, t2);

    expect(updated.latestMergeReadyEvidence).toBe(true);
    expect(updated.latestMergeReadyReason).toBe('review_no_remediation');
    expect(updated.latestMergeReadyUpdatedAt).toBe(t2);
  });

  it('sets hasCompletedPlanning when planning task transitions to planned', () => {
    const { updated } = applyStatusChangeUpdate(base, makeTask({ agentType: 'planning', status: 'running' }), makeTask({ agentType: 'planning', status: 'planned', updatedAt: t2 }), t2);
    expect(updated.hasCompletedPlanning).toBe(true);
  });

  it('sets hasImplementationTaskId when link appears', () => {
    const { updated } = applyStatusChangeUpdate(base, makeTask({ status: 'running' }), makeTask({ status: 'planned', implementationTaskId: 'x', updatedAt: t2 }), t2);
    expect(updated.hasImplementationTaskId).toBe(true);
  });

  it('updates review remediation', () => {
    const { updated } = applyStatusChangeUpdate(base, makeTask({ status: 'running' }), makeTask({ agentType: 'review', status: 'reviewed', result: { needs_remediation: '0' }, updatedAt: t2 }), t2);
    expect(updated.latestReviewNeedsRemediation).toBe(false);
  });

  it('handles null and older existing review evidence timestamps during status change', () => {
    const oldTask = makeTask({ id: 'review', agentType: 'review', status: 'running', statusChangedAt: t1 });
    const newTask = makeTask({
      id: 'review', agentType: 'review', status: 'reviewed', result: { needs_remediation: '1' },
      statusChangedAt: t2, updatedAt: t1,
    });
    const fromNull = applyStatusChangeUpdate(
      { ...base, latestReviewUpdatedAt: null }, oldTask, newTask, t2,
    ).updated;
    const fromNewer = applyStatusChangeUpdate(
      { ...base, latestReviewUpdatedAt: t2, latestReviewNeedsRemediation: false }, oldTask, newTask, t2,
    ).updated;

    expect(fromNull.latestReviewNeedsRemediation).toBe(true);
    expect(fromNewer.latestReviewNeedsRemediation).toBe(false);
  });

  it('mostRecentDispatchedAt advances when new dispatch is newer than existing', () => {
    const existingDispatch = Timestamp.fromMillis(100);
    const newerDispatch = Timestamp.fromMillis(200);
    const withExisting: TaskGroupSummary = { ...base, mostRecentDispatchedAt: existingDispatch };
    const { updated } = applyStatusChangeUpdate(
      withExisting,
      makeTask({ status: 'queued' }),
      makeTask({ status: 'dispatched', dispatchedAt: newerDispatch, updatedAt: t2 }),
      t2,
    );
    expect(updated.mostRecentDispatchedAt?.toMillis()).toBe(200);
  });

  it('mostRecentDispatchedAt does not regress when new dispatch is older than existing', () => {
    const existingDispatch = Timestamp.fromMillis(100);
    const olderDispatch = Timestamp.fromMillis(50);
    const withExisting: TaskGroupSummary = { ...base, mostRecentDispatchedAt: existingDispatch };
    const { updated } = applyStatusChangeUpdate(
      withExisting,
      makeTask({ status: 'queued' }),
      makeTask({ status: 'dispatched', dispatchedAt: olderDispatch, updatedAt: t2 }),
      t2,
    );
    expect(updated.mostRecentDispatchedAt?.toMillis()).toBe(100);
  });

  it('repairs missing linear sort fields on legacy summaries during status change', () => {
    const legacy = { ...base, linearIssueId: 'INT-1606', groupKey: 'INT-1606' } as TaskGroupSummary;
    delete (legacy as unknown as Record<string, unknown>)['linearIssueNumber'];
    delete (legacy as unknown as Record<string, unknown>)['linearIssueSortKey'];

    const { updated } = applyStatusChangeUpdate(
      legacy,
      makeTask({ status: 'running', linearIssueId: 'INT-1606' }),
      makeTask({ status: 'archived', linearIssueId: 'INT-1606', updatedAt: t2 }),
      t2,
    );

    expect(updated.linearIssueNumber).toBe(1606);
    expect(updated.linearIssueSortKey).toBe(1606);
  });
});

describe('serializer: applyDeleteUpdate', () => {
  const now = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
  const base: TaskGroupSummary = {
    userId: 'u', linearIssueId: 'INT-1', groupKey: 'INT-1', taskCount: 2, activeTaskCount: 1,
    linearIssueNumber: 1, linearIssueSortKey: 1,
    latestTaskStatus: 'running', latestTaskUpdatedAt: now, agentTypesPresent: ['execution'],
    hasCompletedPlanning: false, hasCompletedExecution: false, hasCompletedExecutionAgent: false,
    hasImplementationTaskId: false, hasPrUrl: false, prNumber: null,
    latestReviewNeedsRemediation: null, oldestTaskCreatedAt: now, mostRecentDispatchedAt: null,
    aggregateStatus: 'active', updatedAt: now,
  };

  it('decrements counts and returns shouldDelete=false', () => {
    const { updated, shouldDelete } = applyDeleteUpdate(base, makeTask({ status: 'running' }), now);
    expect(shouldDelete).toBe(false);
    expect(updated.taskCount).toBe(1);
    expect(updated.activeTaskCount).toBe(0);
  });

  it('returns shouldDelete=true when last task removed', () => {
    const single = { ...base, taskCount: 1, activeTaskCount: 0 };
    const { shouldDelete } = applyDeleteUpdate(single, makeTask({ status: 'planned' }), now);
    expect(shouldDelete).toBe(true);
  });

  it('does not decrement for archived task', () => {
    const { updated } = applyDeleteUpdate(base, makeTask({ status: 'archived' }), now);
    expect(updated.taskCount).toBe(2);
  });

  it('ignores deletion of a task absent from the persisted task identity set', () => {
    const current: TaskGroupSummary = { ...base, taskIds: ['known'] };
    const { updated, shouldDelete } = applyDeleteUpdate(
      current,
      makeTask({ id: 'unknown', status: 'running' }),
      now,
    );

    expect(shouldDelete).toBe(false);
    expect(updated.taskCount).toBe(2);
  });

  it('repairs missing linear sort fields on legacy summaries during delete', () => {
    const legacy = { ...base, linearIssueId: 'INT-1606', groupKey: 'INT-1606' } as TaskGroupSummary;
    delete (legacy as unknown as Record<string, unknown>)['linearIssueNumber'];
    delete (legacy as unknown as Record<string, unknown>)['linearIssueSortKey'];

    const { updated, shouldDelete } = applyDeleteUpdate(
      legacy,
      makeTask({ status: 'planned', linearIssueId: 'INT-1606' }),
      now,
    );

    expect(shouldDelete).toBe(false);
    expect(updated.linearIssueNumber).toBe(1606);
    expect(updated.linearIssueSortKey).toBe(1606);
  });
});

describe('serializer: computeSummaryFromTasks', () => {
  const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
  const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));

  it('returns null when all archived', () => {
    expect(computeSummaryFromTasks('u', 'g', [makeTask({ status: 'archived' })], t1)).toBeNull();
  });

  it('returns null when empty', () => {
    expect(computeSummaryFromTasks('u', 'g', [], t1)).toBeNull();
  });

  it('aggregates across two tasks', () => {
    const t1Task = makeTask({ userId: 'u', linearIssueId: 'INT-9', agentType: 'planning', status: 'planned', createdAt: t1, updatedAt: t1 });
    const t2Task = makeTask({
      id: 't2', userId: 'u', linearIssueId: 'INT-9', agentType: 'execution', status: 'implemented',
      result: { prUrl: 'https://x' }, prNumber: 42, createdAt: t2, updatedAt: t2,
    });
    const s = computeSummaryFromTasks('u', 'INT-9', [t1Task, t2Task], t2);
    expect(s).not.toBeNull();
    if (s === null) return;
    expect(s.taskCount).toBe(2);
    expect(s.hasCompletedPlanning).toBe(true);
    expect(s.hasCompletedExecution).toBe(true);
    expect(s.hasPrUrl).toBe(true);
    expect(s.prNumber).toBe(42);
    expect(s.latestTaskStatus).toBe('implemented');
    expect(s.latestTaskId).toBe('t2');
    expect(s.latestTaskCreatedAt).toBe(t2);
    expect(s.agentTypesPresent).toEqual(expect.arrayContaining(['planning', 'execution']));
    expect(s.linearIssueId).toBe('INT-9');
    expect(s.linearIssueNumber).toBe(9);
    expect(s.linearIssueSortKey).toBe(9);
  });

  it('computes exact A/B/T1/T2 clocks independently with deterministic lifecycle ties', () => {
    const createdA = Timestamp.fromDate(new Date('2026-07-27T08:00:00Z'));
    const createdB = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
    const failureAtT1 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
    const metadataAtT2 = Timestamp.fromDate(new Date('2026-07-27T12:00:00Z'));
    const taskA = makeTask({
      id: 'task-A',
      linearIssueId: 'INT-3CLOCK',
      agentType: 'execution',
      status: 'failed',
      createdAt: createdA,
      statusChangedAt: failureAtT1,
      updatedAt: metadataAtT2,
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
      prNumber: 42,
    });
    const taskB = makeTask({
      id: 'task-B',
      linearIssueId: 'INT-3CLOCK',
      agentType: 'execution',
      status: 'implemented',
      createdAt: createdB,
      statusChangedAt: createdB,
      updatedAt: createdB,
    });

    const summary = computeSummaryFromTasks('user-1', 'INT-3CLOCK', [taskB, taskA], metadataAtT2);

    expect(summary?.latestTaskId).toBe('task-B');
    expect(summary?.latestTaskCreatedAt).toBe(createdB);
    expect(summary?.latestTaskStatus).toBe('implemented');
    expect(summary?.latestTaskUpdatedAt).toEqual(failureAtT1);
    expect(summary?.prNumber).toBe(42);
    expect(summary?.updatedAt).toBe(metadataAtT2);
  });

  it('uses id descending to break equal creation and statusChangedAt ties in full recompute', () => {
    const tie = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
    const taskA = makeTask({ id: 'task-A', status: 'failed', createdAt: tie, statusChangedAt: tie, updatedAt: tie });
    const taskB = makeTask({ id: 'task-B', status: 'implemented', createdAt: tie, statusChangedAt: tie, updatedAt: tie });

    const summary = computeSummaryFromTasks('user-1', 'tie', [taskB, taskA], tie);

    expect(summary?.latestTaskId).toBe('task-B');
    expect(summary?.latestTaskStatus).toBe('implemented');
    expect(summary?.latestTaskUpdatedAt).toEqual(tie);
  });

  it('uses id descending to break equal technical evidence timestamps', () => {
    const tie = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
    const evidence = makeTask({
      id: 'task-A',
      agentType: 'review',
      status: 'reviewed',
      createdAt: tie,
      statusChangedAt: tie,
      updatedAt: tie,
      result: { merge_ready: '1', merge_ready_reason: 'review_no_remediation' },
    });
    const invalidator = makeTask({
      id: 'task-B',
      agentType: 'review',
      status: 'reviewed',
      createdAt: tie,
      statusChangedAt: tie,
      updatedAt: tie,
      result: { needs_remediation: '1' },
    });

    const forward = computeSummaryFromTasks('user-1', 'tie', [evidence, invalidator], tie);
    const reverse = computeSummaryFromTasks('user-1', 'tie', [invalidator, evidence], tie);

    expect(forward?.latestMergeReadyEvidence).toBe(false);
    expect(reverse?.latestMergeReadyEvidence).toBe(false);
    expect(forward?.latestMergeReadyDecisionTaskId).toBe('task-B');
    expect(reverse?.latestMergeReadyDecisionTaskId).toBe('task-B');
  });

  it('linearIssueId is null when tasks have no linear id', () => {
    const task = makeTask({ status: 'planned', createdAt: t1, updatedAt: t1 });
    const s = computeSummaryFromTasks('u', 'g', [task], t1);
    expect(s?.linearIssueId).toBeNull();
    expect(s?.linearIssueNumber).toBeNull();
    expect(s?.linearIssueSortKey).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('tracks review remediation', () => {
    const review = makeTask({ agentType: 'review', status: 'reviewed', result: { needs_remediation: '1' }, createdAt: t1, updatedAt: t1 });
    expect(computeSummaryFromTasks('u', 'g', [review], t1)?.latestReviewNeedsRemediation).toBe(true);
  });

  it('review remediation = false when result is "0"', () => {
    const review = makeTask({ agentType: 'review', status: 'reviewed', result: { needs_remediation: '0' }, createdAt: t1, updatedAt: t1 });
    expect(computeSummaryFromTasks('u', 'g', [review], t1)?.latestReviewNeedsRemediation).toBe(false);
  });

  it('review remediation null for unknown value', () => {
    const review = makeTask({ agentType: 'review', status: 'reviewed', result: { needs_remediation: 'unknown' }, createdAt: t1, updatedAt: t1 });
    expect(computeSummaryFromTasks('u', 'g', [review], t1)?.latestReviewNeedsRemediation).toBeNull();
  });

  it('sets hasImplementationTaskId for fanout', () => {
    const task = makeTask({ status: 'planned', fanOutChildTaskIds: ['x'], createdAt: t1, updatedAt: t1 });
    expect(computeSummaryFromTasks('u', 'g', [task], t1)?.hasImplementationTaskId).toBe(true);
  });

  it('tracks activeTaskCount', () => {
    const task = makeTask({ status: 'running', createdAt: t1, updatedAt: t1 });
    expect(computeSummaryFromTasks('u', 'g', [task], t1)?.activeTaskCount).toBe(1);
  });

  it('sets hasCompletedExecutionAgent for execution implemented', () => {
    const task = makeTask({ agentType: 'execution', status: 'implemented', createdAt: t1, updatedAt: t1 });
    expect(computeSummaryFromTasks('u', 'g', [task], t1)?.hasCompletedExecutionAgent).toBe(true);
  });

  it('sets mostRecentDispatchedAt', () => {
    const task = makeTask({ status: 'dispatched', dispatchedAt: t1, createdAt: t1, updatedAt: t1 });
    expect(computeSummaryFromTasks('u', 'g', [task], t1)?.mostRecentDispatchedAt).toBeDefined();
  });

  it('latest representative PR task wins for prNumber', () => {
    const t1Task = makeTask({ id: 'a', agentType: 'execution', status: 'implemented', result: { prUrl: 'https://1' }, prNumber: 10, createdAt: t1, updatedAt: t1 });
    const t2Task = makeTask({ id: 'b', agentType: 'execution', status: 'implemented', result: { prUrl: 'https://2' }, prNumber: 20, createdAt: t2, updatedAt: t2 });
    expect(computeSummaryFromTasks('u', 'g', [t1Task, t2Task], t2)?.prNumber).toBe(20);
  });

  it('latest representative PR task carries terminal timestamps', () => {
    const prMergedAt = Timestamp.fromDate(new Date('2026-07-05T16:00:00Z'));
    const prClosedAt = Timestamp.fromDate(new Date('2026-07-05T17:00:00Z'));
    const olderTask = makeTask({
      id: 'a',
      agentType: 'execution',
      status: 'implemented',
      result: { prUrl: 'https://1' },
      prNumber: 10,
      createdAt: t1,
      updatedAt: t1,
    });
    const newerTask = makeTask({
      id: 'b',
      agentType: 'execution',
      status: 'implemented',
      result: { prUrl: 'https://2' },
      prNumber: 20,
      prMergedAt,
      prClosedAt,
      createdAt: t2,
      updatedAt: t2,
    });
    const summary = computeSummaryFromTasks('u', 'g', [olderTask, newerTask], t2);

    expect(summary?.prNumber).toBe(20);
    expect(summary?.prMergedAt).toBe(prMergedAt);
    expect(summary?.prClosedAt).toBe(prClosedAt);
  });

  it('latest durable merge-ready evidence wins during full recompute', () => {
    const olderTask = makeTask({
      id: 'a',
      agentType: 'execution',
      status: 'implemented',
      result: {
        prUrl: 'https://1',
        merge_ready: '1',
        merge_ready_reason: 'review_skipped',
      },
      createdAt: t1,
      updatedAt: t1,
    });
    const newerTask = makeTask({
      id: 'b',
      agentType: 'remediation',
      status: 'implemented',
      result: {
        merge_ready: '1',
        merge_ready_reason: 'remediation_already_completed',
      },
      createdAt: t2,
      updatedAt: t2,
    });
    const summary = computeSummaryFromTasks('u', 'g', [olderTask, newerTask], t2);

    expect(summary?.latestMergeReadyEvidence).toBe(true);
    expect(summary?.latestMergeReadyReason).toBe('remediation_already_completed');
  });

  it('marks remediation already-completed durable evidence as needs-action after an earlier remediation-required review', () => {
    const review = makeTask({
      id: 'review',
      agentType: 'review',
      status: 'reviewed',
      result: {
        prUrl: 'https://github.com/org/repo/pull/42',
        needs_remediation: '1',
      },
      createdAt: t1,
      updatedAt: t1,
    });
    const remediation = makeTask({
      id: 'remediation',
      agentType: 'remediation',
      status: 'implemented',
      result: {
        prUrl: 'https://github.com/org/repo/pull/42',
        execution_outcome_label: 'already_completed',
        merge_ready: '1',
        merge_ready_reason: 'remediation_already_completed',
      },
      createdAt: t2,
      updatedAt: t2,
    });
    const summary = computeSummaryFromTasks('u', 'g', [remediation, review], t2);

    expect(summary?.latestReviewNeedsRemediation).toBe(true);
    expect(summary?.latestMergeReadyEvidence).toBe(true);
    expect(summary?.latestMergeReadyReason).toBe('remediation_already_completed');
    expect(summary).not.toBeNull();
    if (summary === null) {
      throw new Error('expected summary');
    }
    expect(deriveAggregateStatusFromSummary(summary)).toBe('needs-action');
  });

  it('full recompute clears stale durable evidence after a later pull_request pushed commits', () => {
    const review = makeTask({
      id: 'review',
      agentType: 'review',
      status: 'reviewed',
      result: {
        prUrl: 'https://github.com/org/repo/pull/42',
        needs_remediation: '0',
        merge_ready: '1',
        merge_ready_reason: 'review_no_remediation',
      },
      createdAt: t1,
      updatedAt: t1,
    });
    const pullRequest = makeTask({
      id: 'pull-request',
      agentType: 'pull_request',
      status: 'implemented',
      result: {
        prUrl: 'https://github.com/org/repo/pull/42',
        pull_request_outcome_label: 'commits_pushed',
      },
      createdAt: t2,
      updatedAt: t2,
    });
    const summary = computeSummaryFromTasks('u', 'g', [pullRequest, review], t2);

    expect(summary?.latestMergeReadyEvidence).toBe(false);
    expect(summary?.latestMergeReadyReason).toBeNull();
    expect(summary?.latestMergeReadyUpdatedAt).toBeNull();
  });

  it('full recompute clears stale durable evidence after a later remediation pushed commits', () => {
    const review = makeTask({
      id: 'review',
      agentType: 'review',
      status: 'reviewed',
      result: {
        prUrl: 'https://github.com/org/repo/pull/42',
        needs_remediation: '0',
        merge_ready: '1',
        merge_ready_reason: 'review_no_remediation',
      },
      createdAt: t1,
      updatedAt: t1,
    });
    const remediation = makeTask({
      id: 'remediation',
      agentType: 'remediation',
      status: 'implemented',
      result: {
        execution_outcome_label: 'implemented',
      },
      createdAt: t2,
      updatedAt: t2,
    });
    const summary = computeSummaryFromTasks('u', 'g', [remediation, review], t2);

    expect(summary?.latestMergeReadyEvidence).toBe(false);
    expect(summary?.latestMergeReadyReason).toBeNull();
    expect(summary?.latestMergeReadyUpdatedAt).toBeNull();
  });

  it('mostRecentDispatchedAt keeps the max when tasks arrive in descending dispatch order', () => {
    const newerDispatch = Timestamp.fromMillis(200);
    const olderDispatch = Timestamp.fromMillis(100);
    const newerTask = makeTask({ id: 'a', status: 'dispatched', dispatchedAt: newerDispatch, createdAt: t1, updatedAt: t1 });
    const olderTask = makeTask({ id: 'b', status: 'dispatched', dispatchedAt: olderDispatch, createdAt: t1, updatedAt: t1 });
    const s = computeSummaryFromTasks('u', 'g', [newerTask, olderTask], t2);
    expect(s?.mostRecentDispatchedAt?.toMillis()).toBe(200);
  });

  it('latestReviewNeedsRemediation reflects the later review when reviews arrive in reverse chronological order', () => {
    const laterReview = makeTask({
      id: 'later', agentType: 'review', status: 'reviewed',
      result: { needs_remediation: '1' }, createdAt: t1, updatedAt: t2,
    });
    const earlierReview = makeTask({
      id: 'earlier', agentType: 'review', status: 'reviewed',
      result: { needs_remediation: '0' }, createdAt: t1, updatedAt: t1,
    });
    // Tasks iterated in [later, earlier] order — the later-timestamp branch wins first,
    // the earlier review hits the else branch and must not overwrite.
    const s = computeSummaryFromTasks('u', 'g', [laterReview, earlierReview], t2);
    expect(s?.latestReviewNeedsRemediation).toBe(true);
  });
});

describe('serializer: computeAllArchivedSummaryFromTasks', () => {
  const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
  const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));

  it('rebuilds archived PR, completion, merge-ready, and review evidence from all source tasks', () => {
    const execution = makeTask({
      id: 'execution',
      linearIssueId: 'INT-ARCHIVED',
      agentType: 'execution',
      status: 'archived',
      result: {
        prUrl: 'https://github.com/org/repo/pull/1',
        execution_outcome_label: 'already_completed',
      },
      prNumber: 1,
      implementationTaskId: 'implementation',
      createdAt: t1,
      statusChangedAt: t1,
      updatedAt: t1,
    });
    const review = makeTask({
      id: 'review',
      linearIssueId: 'INT-ARCHIVED',
      agentType: 'review',
      status: 'archived',
      result: {
        prUrl: 'https://github.com/org/repo/pull/2',
        merge_ready: '1',
        merge_ready_reason: 'review_no_remediation',
        needs_remediation: '0',
      },
      prNumber: 2,
      createdAt: t2,
      statusChangedAt: t2,
      updatedAt: t2,
    });
    const pullRequest = makeTask({
      id: 'pull-request',
      linearIssueId: 'INT-ARCHIVED',
      agentType: 'pull_request',
      status: 'archived',
      result: { pull_request_outcome_label: 'no_changes_needed' },
      createdAt: t1,
      statusChangedAt: t1,
      updatedAt: t1,
    });

    const summary = computeAllArchivedSummaryFromTasks(
      'user-1', 'INT-ARCHIVED', [pullRequest, review, execution], t2,
    );

    expect(summary).toMatchObject({
      aggregateStatus: 'archived',
      taskCount: 0,
      taskIds: [],
      taskStatusById: {},
      taskLifecycleAtById: {},
      activeTaskCount: 0,
      latestTaskId: 'review',
      latestLifecycleTaskId: 'review',
      hasCompletedExecution: true,
      hasCompletedExecutionAgent: true,
      hasImplementationTaskId: true,
      hasPrUrl: true,
      prNumber: 2,
      representativePrTaskId: 'review',
      latestMergeReadyEvidence: true,
      latestMergeReadyReason: 'review_no_remediation',
      latestMergeReadyDecisionTaskId: 'review',
      latestReviewNeedsRemediation: false,
      latestReviewTaskId: 'review',
    });
    expect(summary?.representativePrUpdatedAt).toEqual(t2);
    expect(summary?.latestMergeReadyDecisionAt).toEqual(t2);
    expect(summary?.latestReviewUpdatedAt).toEqual(t2);
  });

  it('uses timestamp plus task id to select archived technical evidence independent of input order', () => {
    const evidence = makeTask({
      id: 'task-A', agentType: 'review', status: 'archived', createdAt: t1, statusChangedAt: t2, updatedAt: t2,
      result: { merge_ready: '1', merge_ready_reason: 'review_no_remediation' },
    });
    const invalidator = makeTask({
      id: 'task-B', agentType: 'review', status: 'archived', createdAt: t1, statusChangedAt: t2, updatedAt: t2,
      result: { needs_remediation: '1' },
    });
    const earlierInvalidator = makeTask({
      id: 'task-0', agentType: 'review', status: 'archived', createdAt: t1, statusChangedAt: t1, updatedAt: t1,
      result: { needs_remediation: '1' },
    });

    const forward = computeAllArchivedSummaryFromTasks(
      'user-1', 'INT-TIE', [evidence, invalidator, earlierInvalidator], t2,
    );
    const reverse = computeAllArchivedSummaryFromTasks(
      'user-1', 'INT-TIE', [earlierInvalidator, invalidator, evidence], t2,
    );

    expect(forward?.latestMergeReadyEvidence).toBe(false);
    expect(reverse?.latestMergeReadyEvidence).toBe(false);
    expect(forward?.latestMergeReadyDecisionTaskId).toBe('task-B');
    expect(reverse?.latestMergeReadyDecisionTaskId).toBe('task-B');
  });
});

describe('serializer: counts deltas', () => {
  const base: UserGroupCounts = {
    userId: 'u', active: 2, needsAction: 1, done: 3, failed: 0, archived: 4, totalGroups: 10, updatedAt: Timestamp.now(),
  };

  it('applyNewGroupDelta increments totalGroups and status count', () => {
    const out = applyNewGroupDelta(base, 'active');
    expect(out.totalGroups).toBe(11);
    expect(out.active).toBe(3);
  });

  it('applyDeleteGroupDelta decrements totalGroups and status count', () => {
    const out = applyDeleteGroupDelta(base, 'done');
    expect(out.totalGroups).toBe(9);
    expect(out.done).toBe(2);
  });

  it('applyDeleteGroupDelta clamps at zero', () => {
    const zeroed: UserGroupCounts = { ...base, failed: 0, totalGroups: 0 };
    const out = applyDeleteGroupDelta(zeroed, 'failed');
    expect(out.failed).toBe(0);
    expect(out.totalGroups).toBe(0);
  });

  it('applyStatusChangeDelta shifts one count between buckets', () => {
    const out = applyStatusChangeDelta(base, 'active', 'done');
    expect(out.active).toBe(1);
    expect(out.done).toBe(4);
    expect(out.totalGroups).toBe(10);
  });

  it('applyStatusChangeDelta clamps oldField at zero', () => {
    const zero: UserGroupCounts = { ...base, needsAction: 0 };
    const out = applyStatusChangeDelta(zero, 'needs-action', 'done');
    expect(out.needsAction).toBe(0);
    expect(out.done).toBe(4);
  });
});
