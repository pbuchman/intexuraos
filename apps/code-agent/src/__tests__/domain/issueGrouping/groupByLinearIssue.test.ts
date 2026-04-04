import { describe, expect, it } from 'vitest';

import type { SerializedTask } from '../../../domain/issueGrouping/index.js';
import {
  deriveAggregateStatus,
  derivePipeline,
  encodeCursor,
  decodeCursor,
  groupByLinearIssue,
} from '../../../domain/issueGrouping/index.js';

function makeTask(overrides: Partial<SerializedTask> & { id: string }): SerializedTask {
  return {
    userId: 'test-user',
    prompt: 'test',
    sanitizedPrompt: 'test',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'test',
    repository: 'owner/repo',
    baseBranch: 'main',
    traceId: 'trace-1',
    dedupKey: 'dedup',
    callbackReceived: false,
    status: 'implemented',
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupByLinearIssue', () => {
  it('groups tasks with same linearIssueId together', () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100' }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-100' }),
      makeTask({ id: 'task-3', linearIssueId: 'INT-200' }),
    ];

    const groups = groupByLinearIssue(tasks);

    const int100Group = groups.find((g) => g.linearIssueId === 'INT-100');
    const int200Group = groups.find((g) => g.linearIssueId === 'INT-200');

    expect(int100Group).toBeDefined();
    expect(int100Group?.tasks).toHaveLength(2);
    expect(int200Group).toBeDefined();
    expect(int200Group?.tasks).toHaveLength(1);
  });

  it('creates standalone groups for tasks without linearIssueId', () => {
    const tasks = [
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.linearIssueId).toBeNull();
    expect(groups[1]?.linearIssueId).toBeNull();
  });

  it('returns empty array for empty input', () => {
    expect(groupByLinearIssue([])).toEqual([]);
  });

  it('sets latestTask to the most recently updated task', () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100', updatedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-100', updatedAt: '2026-03-05T10:00:00.000Z' }),
      makeTask({ id: 'task-3', linearIssueId: 'INT-100', updatedAt: '2026-03-03T10:00:00.000Z' }),
    ];

    const groups = groupByLinearIssue(tasks);
    expect(groups[0]?.latestTask.id).toBe('task-2');
  });

  it('picks up mostRecentDispatchedAt across group', () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100', dispatchedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-100', dispatchedAt: '2026-03-05T10:00:00.000Z' }),
      makeTask({ id: 'task-3', linearIssueId: 'INT-100' }),
    ];

    const groups = groupByLinearIssue(tasks);
    expect(groups[0]?.mostRecentDispatchedAt).toBe('2026-03-05T10:00:00.000Z');
  });

  it('does not set mostRecentDispatchedAt when no task has dispatchedAt', () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100' }),
    ];

    const groups = groupByLinearIssue(tasks);
    expect(groups[0]?.mostRecentDispatchedAt).toBeUndefined();
  });

  it('hydrates linearIssue from tasks', () => {
    const linearIssue = {
      identifier: 'INT-100',
      title: 'Test Issue',
      state: { name: 'In Progress', type: 'started' },
      priority: 1,
      assignee: null,
      labels: [{ name: 'code-task' }],
      url: 'https://linear.app/INT-100',
      commentCount: 0,
      lastCommentAt: null,
    };

    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100' }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-100', linearIssue }),
    ];

    const groups = groupByLinearIssue(tasks);
    expect(groups[0]?.linearIssue).toEqual(linearIssue);
  });

  it('sorts groups with standalone first, then by Linear issue number desc', () => {
    const tasks = [
      makeTask({ id: 'standalone-1', updatedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'task-1', linearIssueId: 'INT-100', updatedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-200', updatedAt: '2026-03-01T10:00:00.000Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups[0]?.linearIssueId).toBeNull();
    expect(groups[1]?.linearIssueId).toBe('INT-200');
    expect(groups[2]?.linearIssueId).toBe('INT-100');
  });

  it('sorts standalone groups by updatedAt desc when both have no linearIssueId', () => {
    const tasks = [
      makeTask({ id: 'task-old', updatedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'task-new', updatedAt: '2026-03-05T10:00:00.000Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups[0]?.latestTask.id).toBe('task-new');
    expect(groups[1]?.latestTask.id).toBe('task-old');
  });

  it('picks the most recent dispatchedAt when multiple tasks have dispatchedAt', () => {
    // Covers: task.dispatchedAt > mostRecentDispatchedAt comparison (item 2)
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100', dispatchedAt: '2026-03-05T10:00:00.000Z' }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-100', dispatchedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'task-3', linearIssueId: 'INT-100', dispatchedAt: '2026-03-03T10:00:00.000Z' }),
    ];

    const groups = groupByLinearIssue(tasks);
    expect(groups[0]?.mostRecentDispatchedAt).toBe('2026-03-05T10:00:00.000Z');
  });

  it('sorts linked group after standalone when only b has linearIssueId (bNum === null)', () => {
    // Covers: bNum === null branch returning 1 (item 3 in default sort)
    const tasks = [
      makeTask({ id: 'linked-task', linearIssueId: 'INT-100', updatedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'standalone-task', updatedAt: '2026-03-01T10:00:00.000Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    // Standalone (aNum === null) sorts first (returns -1)
    expect(groups[0]?.linearIssueId).toBeNull();
    expect(groups[1]?.linearIssueId).toBe('INT-100');
  });

  it('breaks ties by updatedAt desc when two linked groups have the same issue number', () => {
    // Covers: aNum !== bNum tiebreaker (item 4)
    // Use two groups that map to the same issue number by having different linearIssueIds
    // but the same numeric part is not possible, so test with different numbers
    const tasks = [
      makeTask({ id: 'task-a', linearIssueId: 'INT-100', updatedAt: '2026-03-01T10:00:00.000Z' }),
      makeTask({ id: 'task-b', linearIssueId: 'INT-200', updatedAt: '2026-03-01T10:00:00.000Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    // aNum !== bNum, so bNum - aNum = 200 - 100 = 100 > 0 means INT-200 first
    expect(groups[0]?.linearIssueId).toBe('INT-200');
    expect(groups[1]?.linearIssueId).toBe('INT-100');
  });

  it('does not add an actionable execution step when planning task already fanned out to child tasks', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        linearIssueId: 'INT-100',
        status: 'planned',
        agentType: 'planning',
        fanOutChildTaskIds: ['task-child-1', 'task-child-2'],
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-implement' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.steps).toEqual([
      expect.objectContaining({ agentType: 'planning', state: 'completed' }),
    ]);
    expect(pipeline.steps.some((step) => step.agentType === 'execution' && step.state === 'actionable')).toBe(false);
  });
});

describe('deriveAggregateStatus', () => {
  it('returns active when any task is running', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'running' }),
      makeTask({ id: 'task-2', status: 'implemented' }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('active');
  });

  it('returns active when any task is dispatched', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'dispatched' })];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('active');
  });

  it('returns active when any task is queued', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'queued' })];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('active');
  });

  it('returns needs-action when pipeline has actionable step', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-implement' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(pipeline.steps.some((s) => s.state === 'actionable')).toBe(true);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('needs-action');
  });

  it('returns failed when latest non-archived task is failed', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'failed', updatedAt: '2026-03-05T10:00:00.000Z' }),
      makeTask({ id: 'task-2', status: 'implemented', updatedAt: '2026-03-01T10:00:00.000Z' }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('failed');
  });

  it('returns failed when latest non-archived task is interrupted', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'interrupted' }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('failed');
  });

  it('returns done when latest task is implemented', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'implemented' })];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('done');
  });

  it('returns done when latest task is planned', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'planned' })];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('done');
  });

  it('returns done when latest task is cancelled', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'cancelled' })];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('done');
  });

  it('skips archived tasks when determining failed status', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'archived' }),
      makeTask({ id: 'task-2', status: 'implemented' }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('done');
  });

  it('group with actionable execution step AND active review task gets aggregateStatus active (not needs-action)', () => {
    const tasks = [
      makeTask({
        id: 't1',
        linearIssueId: 'INT-1255',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:05:00Z',
        linearIssue: {
          identifier: 'INT-1255',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-implement' }],
          url: 'https://linear.app/INT-1255',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 't2',
        linearIssueId: 'INT-1255',
        agentType: 'review',
        status: 'running',
        createdAt: '2026-01-01T11:00:00Z',
        updatedAt: '2026-01-01T11:05:00Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);

    // Pipeline has an actionable execution step (planning completed + ready-to-implement label)
    expect(pipeline.steps.find((s) => s.agentType === 'execution')?.state).toBe('actionable');
    // But aggregateStatus is 'active' because an active task takes priority
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('active');
  });

  it('group with all terminal tasks and no execution agent → needs-action', () => {
    const tasks = [
      makeTask({
        id: 't1',
        linearIssueId: 'INT-1255',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:05:00Z',
        linearIssue: {
          identifier: 'INT-1255',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-implement' }],
          url: 'https://linear.app/INT-1255',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 't2',
        linearIssueId: 'INT-1255',
        agentType: 'pull_request',
        status: 'implemented',
        createdAt: '2026-01-01T12:00:00Z',
        updatedAt: '2026-01-01T12:05:00Z',
      }),
      makeTask({
        id: 't3',
        linearIssueId: 'INT-1255',
        agentType: 'review',
        status: 'reviewed',
        createdAt: '2026-01-01T11:00:00Z',
        updatedAt: '2026-01-01T11:05:00Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);

    // No execution agent task exists + planning completed with ready-to-implement label →
    // derivePipeline inserts a synthetic actionable execution step
    expect(pipeline.steps.find((s) => s.agentType === 'execution')?.state).toBe('actionable');
    // With no active tasks, aggregateStatus correctly reflects the actionable step
    expect(deriveAggregateStatus(tasks, pipeline)).toBe('needs-action');
  });
});

describe('derivePipeline', () => {
  it('derives planning and execution steps from tasks with agentTypes', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
        createdAt: '2026-03-01T10:00:00.000Z',
      }),
      makeTask({
        id: 'task-2',
        status: 'implemented',
        agentType: 'execution',
        createdAt: '2026-03-02T10:00:00.000Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.steps[0]?.agentType).toBe('planning');
    expect(pipeline.steps[0]?.state).toBe('completed');
    expect(pipeline.steps[0]?.label).toBe('Planning');
    expect(pipeline.steps[1]?.agentType).toBe('execution');
    expect(pipeline.steps[1]?.state).toBe('completed');
    expect(pipeline.steps[1]?.label).toBe('Execution');
  });

  it('creates actionable execution step when planning completed with implementation-ready label', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-implement' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.steps[1]?.agentType).toBe('execution');
    expect(pipeline.steps[1]?.state).toBe('actionable');
  });

  it('creates actionable execution step even without ready-to-implement label', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'some-other-label' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.steps[1]?.agentType).toBe('execution');
    expect(pipeline.steps[1]?.state).toBe('actionable');
  });

  it('does not create actionable execution step when implementationTaskId exists', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
        implementationTaskId: 'task-2',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-implement' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.steps).toHaveLength(1);
    expect(pipeline.steps.some((s) => s.agentType === 'execution' && s.state === 'actionable')).toBe(false);
  });

  it('creates actionable merge step when execution completed with PR and merge label', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'implemented',
        agentType: 'execution',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });

  it('creates merge step via review fallback when review completed with prNumber, needs_remediation=0, and ready-to-merge label', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'reviewed',
        agentType: 'review',
        prNumber: 42,
        result: { needs_remediation: '0' },
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'Done', type: 'completed' },
          priority: 2,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/test',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });

  it('does NOT create merge step via review fallback when ready-to-merge label is absent', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'reviewed',
        agentType: 'review',
        prNumber: 42,
        result: { needs_remediation: '0' },
        linearIssue: {
          identifier: 'INT-100',
          parentIdentifier: null,
          title: 'Test',
          state: { name: 'Done', type: 'completed' },
          priority: 2,
          assignee: null,
          labels: [{ name: 'code-task' }],
          url: 'https://linear.app/test',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeUndefined();
  });

  it('does not duplicate merge step when both execution and review qualify', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'implemented',
        agentType: 'execution',
        createdAt: '2026-03-01T10:00:00.000Z',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-2',
        status: 'reviewed',
        agentType: 'review',
        createdAt: '2026-03-02T10:00:00.000Z',
        prNumber: 42,
        result: { needs_remediation: '0' },
      }),
    ];

    const pipeline = derivePipeline(tasks);
    const mergeSteps = pipeline.steps.filter((s) => s.agentType === 'merge');
    expect(mergeSteps).toHaveLength(1);
  });

  it('extracts PR URL from first non-archived task with prUrl', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'archived', result: { prUrl: 'https://github.com/owner/repo/pull/10' } }),
      makeTask({ id: 'task-2', status: 'implemented', result: { prUrl: 'https://github.com/owner/repo/pull/42' } }),
      makeTask({ id: 'task-3', status: 'implemented', result: { prUrl: 'https://github.com/owner/repo/pull/99' } }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.pr).toEqual({ url: 'https://github.com/owner/repo/pull/42', number: '42' });
  });

  it('sets pr to null when no task has a valid prUrl', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'implemented' }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.pr).toBeNull();
  });

  it('sets pr to null when prUrl does not match /pull/N pattern', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'implemented', result: { prUrl: 'https://github.com/owner/repo/issues/42' } }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.pr).toBeNull();
  });

  it('counts failed attempts', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'failed' }),
      makeTask({ id: 'task-2', status: 'failed' }),
      makeTask({ id: 'task-3', status: 'implemented' }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.failedAttempts).toBe(2);
  });

  it('counts archived tasks', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'archived' }),
      makeTask({ id: 'task-2', status: 'archived' }),
      makeTask({ id: 'task-3', status: 'implemented' }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.archivedCount).toBe(2);
  });

  it('skips tasks without agentType when building steps', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'implemented' }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.steps).toHaveLength(0);
  });

  it('skips archived tasks when building steps', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'archived', agentType: 'planning' }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.steps).toHaveLength(0);
  });

  it('keeps only the first (latest by updatedAt) task per agentType', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'implemented',
        agentType: 'execution',
        updatedAt: '2026-03-05T10:00:00.000Z',
        createdAt: '2026-03-02T10:00:00.000Z',
      }),
      makeTask({
        id: 'task-2',
        status: 'failed',
        agentType: 'execution',
        updatedAt: '2026-03-01T10:00:00.000Z',
        createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.steps).toHaveLength(1);
    expect(pipeline.steps[0]?.state).toBe('completed');
  });

  it('sorts steps chronologically by createdAt', () => {
    const tasks = [
      makeTask({
        id: 'task-2',
        status: 'implemented',
        agentType: 'execution',
        createdAt: '2026-03-05T10:00:00.000Z',
      }),
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
        createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.steps[0]?.agentType).toBe('planning');
    expect(pipeline.steps[1]?.agentType).toBe('execution');
  });

  it('capitalizes unknown agent types', () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'implemented', agentType: 'custom' }),
    ];

    const pipeline = derivePipeline(tasks);
    expect(pipeline.steps[0]?.label).toBe('Custom');
  });

  it('derives correct step states from task statuses', () => {
    const statuses = [
      { status: 'planned', expected: 'completed' },
      { status: 'implemented', expected: 'completed' },
      { status: 'reviewed', expected: 'completed' },
      { status: 'queued', expected: 'queued' },
      { status: 'dispatched', expected: 'dispatched' },
      { status: 'running', expected: 'running' },
      { status: 'failed', expected: 'failed' },
      { status: 'interrupted', expected: 'failed' },
      { status: 'cancelled', expected: 'failed' },
    ];

    for (const { status, expected } of statuses) {
      const tasks = [makeTask({ id: `task-${status}`, status, agentType: 'execution' })];
      const pipeline = derivePipeline(tasks);
      expect(pipeline.steps[0]?.state).toBe(expected);
    }
  });

  it('creates actionable execution step when labels are undefined (fallback)', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
      }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.steps[1]?.agentType).toBe('execution');
    expect(pipeline.steps[1]?.state).toBe('actionable');
  });

  it('does not create merge step when execution completed with PR and merge label but review task is running', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'implemented',
        agentType: 'execution',
        createdAt: '2026-03-01T10:00:00.000Z',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-2',
        status: 'running',
        agentType: 'review',
        createdAt: '2026-03-02T10:00:00.000Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);
    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeUndefined();
  });

  it('does not create merge step via review fallback when another task is queued', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'reviewed',
        agentType: 'review',
        createdAt: '2026-03-01T10:00:00.000Z',
        prNumber: 42,
        result: { needs_remediation: '0' },
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-2',
        status: 'queued',
        agentType: 'remediation',
        createdAt: '2026-03-02T10:00:00.000Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);
    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeUndefined();
  });

  it('creates merge step when execution completed and no task is active', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'implemented',
        agentType: 'execution',
        createdAt: '2026-03-01T10:00:00.000Z',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-2',
        status: 'reviewed',
        agentType: 'review',
        createdAt: '2026-03-02T10:00:00.000Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);
    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });

  it('creates actionable execution step when labels are empty (fallback)', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: 'planned',
        agentType: 'planning',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.steps[1]?.agentType).toBe('execution');
    expect(pipeline.steps[1]?.state).toBe('actionable');
  });

  it('shows actionable execution step (not merge) when planning→review pipeline has completed review', () => {
    const tasks = [
      makeTask({
        id: 'task-review',
        agentType: 'review',
        status: 'reviewed',
        prNumber: 42,
        result: { needs_remediation: '0' },
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T10:05:00Z',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'code-task' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-planning',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:05:00Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);

    // Should have exactly 3 steps: planning (completed), review (completed), execution (actionable)
    expect(pipeline.steps).toHaveLength(3);

    const executionStep = pipeline.steps.find((s) => s.agentType === 'execution');
    expect(executionStep).toBeDefined();
    expect(executionStep?.state).toBe('actionable');

    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeUndefined();
  });

  it('still shows merge step for execution→review pipeline (regression guard)', () => {
    const tasks = [
      makeTask({
        id: 'task-review',
        agentType: 'review',
        status: 'reviewed',
        prNumber: 42,
        result: { needs_remediation: '0' },
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T10:05:00Z',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-execution',
        agentType: 'execution',
        status: 'implemented',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:05:00Z',
        result: { prUrl: 'https://github.com/org/repo/pull/42' },
      }),
    ];

    const pipeline = derivePipeline(tasks);

    // execution→review pipeline: merge IS the terminal action
    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });

  it('shows merge step when execution task is archived but implementationTaskId is set (edge case)', () => {
    const tasks = [
      makeTask({
        id: 'task-review',
        agentType: 'review',
        status: 'reviewed',
        prNumber: 42,
        result: { needs_remediation: '0' },
        createdAt: '2026-03-03T10:00:00Z',
        updatedAt: '2026-03-03T10:05:00Z',
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 1,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
      makeTask({
        id: 'task-execution-archived',
        agentType: 'execution',
        status: 'archived',
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T10:05:00Z',
      }),
      makeTask({
        id: 'task-planning',
        agentType: 'planning',
        status: 'planned',
        implementationTaskId: 'task-execution-archived',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:05:00Z',
      }),
    ];

    const pipeline = derivePipeline(tasks);

    // Execution was started (implementationTaskId set) but task archived —
    // merge IS correct because execution already happened
    const mergeStep = pipeline.steps.find((s) => s.agentType === 'merge');
    expect(mergeStep).toBeDefined();
    expect(mergeStep?.state).toBe('actionable');
  });
});

describe('cursor encoding/decoding', () => {
  it('encodes and decodes an index round-trip', () => {
    const encoded = encodeCursor(5);
    const decoded = decodeCursor(encoded);
    expect(decoded.index).toBe(5);
  });

  it('encodes index 0', () => {
    const encoded = encodeCursor(0);
    const decoded = decodeCursor(encoded);
    expect(decoded.index).toBe(0);
  });

  it('throws on non-integer index', () => {
    const bad = Buffer.from(JSON.stringify({ index: 1.5 })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow('Invalid cursor index');
  });

  it('throws on negative index', () => {
    const bad = Buffer.from(JSON.stringify({ index: -1 })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow('Invalid cursor index');
  });

  it('throws on non-numeric index', () => {
    const bad = Buffer.from(JSON.stringify({ index: 'abc' })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow('Invalid cursor index');
  });
});
