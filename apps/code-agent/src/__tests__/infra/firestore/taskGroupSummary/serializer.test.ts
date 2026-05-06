/**
 * Unit tests for the pure serializer/aggregation helpers.
 * These tests hit the helpers directly — no Firestore, no transactions.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../../domain/models/codeTask.js';
import type { UserGroupCounts, TaskGroupSummary } from '../../../../domain/models/taskGroupSummary.js';
import {
  applyDeleteGroupDelta,
  applyDeleteUpdate,
  applyIncrementalCreateUpdate,
  applyNewGroupDelta,
  applyStatusChangeDelta,
  applyStatusChangeUpdate,
  buildInitialSummary,
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
});

describe('serializer: docToSummary', () => {
  const now = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));

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
    const task = makeTask({ userId: 'u', linearIssueId: 'INT-1', agentType: 'planning', status: 'planned' });
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

  it('updates review needs-remediation', () => {
    const updated = applyIncrementalCreateUpdate(base, makeTask({ agentType: 'review', status: 'reviewed', result: { needs_remediation: '1' }, createdAt: t2, updatedAt: t2 }), t2);
    expect(updated.latestReviewNeedsRemediation).toBe(true);
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
    expect(s.agentTypesPresent).toEqual(expect.arrayContaining(['planning', 'execution']));
    expect(s.linearIssueId).toBe('INT-9');
    expect(s.linearIssueNumber).toBe(9);
    expect(s.linearIssueSortKey).toBe(9);
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

  it('first task with prUrl wins for prNumber', () => {
    const t1Task = makeTask({ id: 'a', agentType: 'execution', status: 'implemented', result: { prUrl: 'https://1' }, prNumber: 10, createdAt: t1, updatedAt: t1 });
    const t2Task = makeTask({ id: 'b', agentType: 'execution', status: 'implemented', result: { prUrl: 'https://2' }, prNumber: 20, createdAt: t2, updatedAt: t2 });
    expect(computeSummaryFromTasks('u', 'g', [t1Task, t2Task], t2)?.prNumber).toBe(10);
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
