import { describe, expect, it } from 'vitest';
import type { CodeTask } from '@/types';
import { groupByLinearIssue, sortIssueGroups } from '../issueGroups.js';
import type { IssueGroup, PipelineStepData, SortOption } from '../issueGroups.js';

function createMockTask(overrides: Partial<CodeTask> & { id: string }): CodeTask {
  return {
    id: overrides.id,
    userId: 'user-1',
    prompt: 'test prompt',
    sanitizedPrompt: overrides.sanitizedPrompt ?? 'test prompt',
    systemPromptHash: 'hash',
    workerType: overrides.workerType ?? 'opus',
    workerLocation: overrides.workerLocation ?? 'Home-Dev',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    status: overrides.status ?? 'planned',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: overrides.createdAt ?? '2026-03-07T15:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-07T15:05:00Z',
    ...overrides,
  };
}

function findStep(pipeline: { steps: PipelineStepData[] } | undefined, agentType: string): PipelineStepData | undefined {
  return pipeline?.steps.find((s) => s.agentType === agentType);
}

describe('groupByLinearIssue', () => {
  it('groups tasks by linearIssueId', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'execution' }),
      createMockTask({ id: 't3', linearIssueId: 'INT-200', agentType: 'planning' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(2);
    const int100 = groups.find((g) => g.linearIssueId === 'INT-100');
    expect(int100).toBeDefined();
    expect(int100?.tasks).toHaveLength(2);
    const int200 = groups.find((g) => g.linearIssueId === 'INT-200');
    expect(int200).toBeDefined();
    expect(int200?.tasks).toHaveLength(1);
  });

  it('tasks without linearIssueId get individual groups', () => {
    const tasks = [
      createMockTask({ id: 't1', agentType: 'planning' }),
      createMockTask({ id: 't2', agentType: 'planning' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.linearIssueId).toBeNull();
    expect(groups[1]?.linearIssueId).toBeNull();
  });

  it('derives planning step as completed', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'planning')?.state).toBe('completed');
  });

  it('derives execution step as completed', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('completed');
  });

  it('derives execution step as actionable', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('actionable');
  });

  it('derives execution step as running', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'running' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'execution')?.state).toBe('running');
  });

  it('derives execution step as failed with attempt count', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'failed' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'execution', status: 'archived', updatedAt: '2026-03-07T14:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.failedAttempts).toBe(1);
    expect(groups[0]?.pipeline.archivedCount).toBe(1);
  });

  it('derives PR step', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/org/repo/pull/42' },
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.pr).toEqual({ url: 'https://github.com/org/repo/pull/42', number: '42' });
  });

  it('derives aggregateStatus active', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'running' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.aggregateStatus).toBe('active');
  });

  it('derives aggregateStatus needs-action', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.aggregateStatus).toBe('needs-action');
  });

  it('derives aggregateStatus failed', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'failed' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.aggregateStatus).toBe('failed');
  });

  it('derives aggregateStatus done', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.aggregateStatus).toBe('done');
  });

  it('sorts groups by Linear issue ID descending', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T12:00:00Z' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-400', agentType: 'execution', status: 'failed', updatedAt: '2026-03-07T13:00:00Z' }),
      createMockTask({ id: 't3', linearIssueId: 'INT-200', agentType: 'planning', status: 'planned', updatedAt: '2026-03-07T14:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(3);
    expect(groups[0]?.linearIssueId).toBe('INT-400');
    expect(groups[1]?.linearIssueId).toBe('INT-200');
    expect(groups[2]?.linearIssueId).toBe('INT-100');
  });

  it('sorts groups without linearIssueId before those with', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T12:00:00Z' }),
      createMockTask({ id: 't2', agentType: 'planning', status: 'planned', updatedAt: '2026-03-07T14:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.linearIssueId).toBeNull();
    expect(groups[1]?.linearIssueId).toBe('INT-100');
  });

  it('sorts standalone groups by updatedAt desc among themselves', () => {
    const tasks = [
      createMockTask({ id: 't1', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T12:00:00Z' }),
      createMockTask({ id: 't2', agentType: 'planning', status: 'planned', updatedAt: '2026-03-07T16:00:00Z' }),
      createMockTask({ id: 't3', agentType: 'execution', status: 'failed', updatedAt: '2026-03-07T14:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(3);
    expect(groups[0]?.latestTask.id).toBe('t2');
    expect(groups[1]?.latestTask.id).toBe('t3');
    expect(groups[2]?.latestTask.id).toBe('t1');
  });

  it('uses updatedAt desc as tie-breaker within same Linear ID number', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T12:00:00Z' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T14:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.linearIssueId).toBe('INT-200');
    expect(groups[1]?.linearIssueId).toBe('INT-100');
  });

  it('sorts tasks within a group by createdAt ascending', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-03-07T10:00:00Z',
        updatedAt: '2026-03-07T16:00:00Z',
      }),
      createMockTask({
        id: 't2',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        createdAt: '2026-03-07T14:00:00Z',
        updatedAt: '2026-03-07T15:00:00Z',
      }),
      createMockTask({
        id: 't3',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'failed',
        createdAt: '2026-03-07T12:00:00Z',
        updatedAt: '2026-03-07T17:00:00Z',
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    // Sorted by createdAt ascending: t1 (10:00), t3 (12:00), t2 (14:00)
    expect(groups[0]?.tasks[0]?.id).toBe('t1');
    expect(groups[0]?.tasks[1]?.id).toBe('t3');
    expect(groups[0]?.tasks[2]?.id).toBe('t2');
  });

  it('latestTask is still the most recently updated task after createdAt sort', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-03-07T10:00:00Z',
        updatedAt: '2026-03-07T18:00:00Z',
      }),
      createMockTask({
        id: 't2',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        createdAt: '2026-03-07T14:00:00Z',
        updatedAt: '2026-03-07T15:00:00Z',
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    // latestTask should be t1 (updatedAt 18:00 is most recent)
    expect(groups[0]?.latestTask.id).toBe('t1');
    // But tasks array should be by createdAt asc
    expect(groups[0]?.tasks[0]?.id).toBe('t1');
    expect(groups[0]?.tasks[1]?.id).toBe('t2');
  });

  it('excludes archived tasks from latest planning/execution lookup', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'archived', updatedAt: '2026-03-07T16:00:00Z' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned', updatedAt: '2026-03-07T14:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'planning')?.state).toBe('completed');
  });

  it('empty input returns empty array', () => {
    const groups = groupByLinearIssue([]);

    expect(groups).toHaveLength(0);
  });

  it('derives review step as completed for reviewed status', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'review', status: 'reviewed', updatedAt: '2026-03-07T16:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'review')?.state).toBe('completed');
  });

  it('derives review step as running', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'review', status: 'running', updatedAt: '2026-03-07T16:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'review')?.state).toBe('running');
  });

  it('derives review step as undefined when no review task exists', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'review')).toBeUndefined();
  });

  it('excludes archived review tasks from review step', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'review', status: 'archived' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'review')).toBeUndefined();
  });

  it('review tasks do not affect planning/execution steps', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'review', status: 'reviewed' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'planning')).toBeUndefined();
    expect(findStep(groups[0]?.pipeline, 'execution')).toBeUndefined();
    expect(findStep(groups[0]?.pipeline, 'review')?.state).toBe('completed');
  });

  it('pull_request tasks appear in pipeline steps with label "PR Task"', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'pull_request', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    const step = findStep(groups[0]?.pipeline, 'pull_request');
    expect(step).toBeDefined();
    expect(step?.state).toBe('completed');
    expect(step?.label).toBe('PR Task');
  });

  it('pull_request tasks do not affect planning/execution steps', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'pull_request', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(findStep(groups[0]?.pipeline, 'planning')).toBeUndefined();
    expect(findStep(groups[0]?.pipeline, 'execution')).toBeUndefined();
  });

  it('tasks with agentType undefined do not appear in pipeline steps', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.steps).toHaveLength(0);
  });

  it('steps are ordered by task createdAt', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-03-07T10:00:00Z',
        updatedAt: '2026-03-07T10:05:00Z',
      }),
      createMockTask({
        id: 't2',
        linearIssueId: 'INT-100',
        agentType: 'pull_request',
        status: 'implemented',
        createdAt: '2026-03-07T11:00:00Z',
        updatedAt: '2026-03-07T11:05:00Z',
      }),
      createMockTask({
        id: 't3',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        createdAt: '2026-03-07T12:00:00Z',
        updatedAt: '2026-03-07T12:05:00Z',
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    const steps = groups[0]?.pipeline.steps ?? [];
    // Planning at T1 gets actionable execution appended after it
    // Then pull_request at T2, then review at T3
    expect(steps[0]?.agentType).toBe('planning');
    expect(steps[1]?.agentType).toBe('execution'); // synthetic actionable
    expect(steps[2]?.agentType).toBe('pull_request');
    expect(steps[3]?.agentType).toBe('review');
  });

  it('multiple tasks of same agentType: only latest non-archived appears', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'archived',
        createdAt: '2026-03-07T10:00:00Z',
        updatedAt: '2026-03-07T14:00:00Z',
      }),
      createMockTask({
        id: 't2',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'failed',
        createdAt: '2026-03-07T12:00:00Z',
        updatedAt: '2026-03-07T13:00:00Z',
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    const execSteps = groups[0]?.pipeline.steps.filter((s) => s.agentType === 'execution');
    expect(execSteps).toHaveLength(1);
    expect(execSteps[0]?.state).toBe('failed');
  });

  it('pipeline with 5+ steps supports vertical collapse data shape', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: '2026-03-07T10:00:00Z',
        updatedAt: '2026-03-07T10:05:00Z',
        implementationTaskId: 'some-task',
      }),
      createMockTask({
        id: 't2',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        createdAt: '2026-03-07T11:00:00Z',
        updatedAt: '2026-03-07T11:05:00Z',
      }),
      createMockTask({
        id: 't3',
        linearIssueId: 'INT-100',
        agentType: 'pull_request',
        status: 'implemented',
        createdAt: '2026-03-07T12:00:00Z',
        updatedAt: '2026-03-07T12:05:00Z',
      }),
      createMockTask({
        id: 't4',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        createdAt: '2026-03-07T13:00:00Z',
        updatedAt: '2026-03-07T13:05:00Z',
        result: { prUrl: 'https://github.com/org/repo/pull/42' },
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    const steps = groups[0]?.pipeline.steps ?? [];
    const pr = groups[0]?.pipeline.pr ?? null;
    // 4 steps + 1 PR = 5 total visible elements
    expect(steps).toHaveLength(4);
    expect(pr).not.toBeNull();
    expect(steps[0]?.agentType).toBe('planning');
    expect(steps[1]?.agentType).toBe('execution');
    expect(steps[2]?.agentType).toBe('pull_request');
    expect(steps[3]?.agentType).toBe('review');
  });

  it('step labels use the agent type label map', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned', implementationTaskId: 'x' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', createdAt: '2026-03-07T15:01:00Z', updatedAt: '2026-03-07T15:06:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    const steps = groups[0]?.pipeline.steps ?? [];
    expect(steps[0]?.label).toBe('Planning');
    expect(steps[1]?.label).toBe('Execution');
  });

  it('unknown agent type gets capitalized label', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'merge_conflict' as string, status: 'running' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    const step = findStep(groups[0]?.pipeline, 'merge_conflict');
    expect(step).toBeDefined();
    expect(step?.label).toBe('Merge_conflict');
  });

  it('fully-archived group gets aggregateStatus archived', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'archived' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'execution', status: 'archived', updatedAt: '2026-03-07T16:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.aggregateStatus).toBe('archived');
  });

  it('cancelled tasks are treated as done', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'cancelled' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.aggregateStatus).toBe('done');
  });

  it('malformed prUrl does not produce PR step', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/org/repo/issues/42' },
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.pr).toBeNull();
  });

  it('extracts PR from latest non-archived task result', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        result: { prUrl: 'https://github.com/org/repo/pull/123' },
        updatedAt: '2026-03-07T16:00:00Z',
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.pr).toEqual({ url: 'https://github.com/org/repo/pull/123', number: '123' });
  });

  it('extracts PR from latest task by updatedAt', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/org/repo/pull/42' },
        updatedAt: '2026-03-07T16:00:00Z',
      }),
      createMockTask({
        id: 't2',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        result: { prUrl: 'https://github.com/org/repo/pull/999' },
        updatedAt: '2026-03-07T17:00:00Z',
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    // Should use the latest task's result.prUrl (t2 with updatedAt 17:00)
    expect(groups[0]?.pipeline.pr).toEqual({ url: 'https://github.com/org/repo/pull/999', number: '999' });
  });

  it('does not extract PR from archived tasks', () => {
    const tasks = [
      createMockTask({
        id: 't1',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'archived',
        result: { prUrl: 'https://github.com/org/repo/pull/42' },
        updatedAt: '2026-03-07T16:00:00Z',
      }),
      createMockTask({
        id: 't2',
        linearIssueId: 'INT-100',
        agentType: 'review',
        status: 'reviewed',
        updatedAt: '2026-03-07T17:00:00Z',
      }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    // Latest non-archived task (t2) has no result.prUrl, so no PR shown
    expect(groups[0]?.pipeline.pr).toBeNull();
  });
});

// --- Helper for sortIssueGroups tests ---

function makeGroup(overrides: {
  linearIssueId?: string | null;
  prNumber?: string | null;
  createdAt?: string;
  updatedAt?: string;
  dispatchedAt?: string;
  aggregateStatus?: IssueGroup['aggregateStatus'];
}): IssueGroup {
  const {
    linearIssueId = null,
    prNumber = null,
    createdAt = '2024-01-01T00:00:00.000Z',
    updatedAt = '2024-01-01T00:00:00.000Z',
    dispatchedAt,
    aggregateStatus = 'done',
  } = overrides;

  const latestTask = createMockTask({ id: `task-${Math.random().toString(36).slice(2)}`, createdAt, updatedAt, dispatchedAt });

  return {
    linearIssueId: linearIssueId ?? null,
    linearIssue: undefined,
    tasks: [latestTask],
    pipeline: {
      steps: [
        { agentType: 'planning', state: 'completed', label: 'Planning' },
        { agentType: 'execution', state: 'completed', label: 'Execution' },
        { agentType: 'review', state: 'completed', label: 'Review' },
      ],
      pr:
        prNumber !== null
          ? { url: `https://github.com/org/repo/pull/${prNumber}`, number: prNumber }
          : null,
      failedAttempts: 0,
      archivedCount: 0,
    },
    latestTask,
    aggregateStatus,
  };
}

describe('sortIssueGroups', () => {
  describe('linear-id sort', () => {
    it('sorts by Linear issue number descending regardless of input order', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-700' }),
        makeGroup({ linearIssueId: 'INT-900' }),
        makeGroup({ linearIssueId: 'INT-800' }),
      ];
      const result = sortIssueGroups(groups, 'linear-id');
      expect(result.map((g) => g.linearIssueId)).toEqual(['INT-900', 'INT-800', 'INT-700']);
    });

    it('does not mutate the original array', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-100' }),
        makeGroup({ linearIssueId: 'INT-200' }),
      ];
      const firstId = groups[0]?.linearIssueId;
      sortIssueGroups(groups, 'linear-id');
      expect(groups[0]?.linearIssueId).toBe(firstId);
    });

    it('returns empty array for empty input', () => {
      expect(sortIssueGroups([], 'linear-id')).toEqual([]);
    });

    it('puts standalone (null linearIssueId) groups before Linear-linked groups', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-100' }),
        makeGroup({ linearIssueId: null }),
      ];
      const result = sortIssueGroups(groups, 'linear-id');
      expect(result[0]?.linearIssueId).toBeNull();
      expect(result[1]?.linearIssueId).toBe('INT-100');
    });
  });

  describe('pr-number sort', () => {
    it('sorts groups by PR number descending', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', prNumber: '50' }),
        makeGroup({ linearIssueId: 'INT-2', prNumber: '200' }),
        makeGroup({ linearIssueId: 'INT-3', prNumber: '100' }),
      ];
      const result = sortIssueGroups(groups, 'pr-number');
      expect(result.map((g) => g.pipeline.pr?.number)).toEqual(['200', '100', '50']);
    });

    it('puts groups without PR after groups with PR', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', prNumber: null }),
        makeGroup({ linearIssueId: 'INT-2', prNumber: '100' }),
        makeGroup({ linearIssueId: 'INT-3', prNumber: null }),
      ];
      const result = sortIssueGroups(groups, 'pr-number');
      expect(result[0]?.pipeline.pr).not.toBeNull();
      expect(result[1]?.pipeline.pr).toBeNull();
      expect(result[2]?.pipeline.pr).toBeNull();
    });

    it('falls back to updatedAt desc for groups without PR', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', prNumber: null, updatedAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', prNumber: null, updatedAt: '2024-03-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'pr-number');
      expect(result[0]?.linearIssueId).toBe('INT-2');
      expect(result[1]?.linearIssueId).toBe('INT-1');
    });

    it('returns empty array for empty input', () => {
      expect(sortIssueGroups([], 'pr-number')).toEqual([]);
    });

    it('handles all groups without PRs', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', prNumber: null }),
        makeGroup({ linearIssueId: 'INT-2', prNumber: null }),
      ];
      const result = sortIssueGroups(groups, 'pr-number');
      expect(result).toHaveLength(2);
    });

    it('does not mutate the original array', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', prNumber: '50' }),
        makeGroup({ linearIssueId: 'INT-2', prNumber: '200' }),
      ];
      const firstId = groups[0]?.linearIssueId;
      sortIssueGroups(groups, 'pr-number');
      expect(groups[0]?.linearIssueId).toBe(firstId);
    });
  });

  describe('finished-time sort', () => {
    it('sorts done groups first by updatedAt desc, non-done groups last', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', aggregateStatus: 'active', updatedAt: '2024-12-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', aggregateStatus: 'done', updatedAt: '2024-06-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-3', aggregateStatus: 'done', updatedAt: '2024-09-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-4', aggregateStatus: 'failed', updatedAt: '2024-01-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'finished-time');
      expect(result[0]?.linearIssueId).toBe('INT-3'); // done, 2024-09 (most recent done)
      expect(result[1]?.linearIssueId).toBe('INT-2'); // done, 2024-06
      expect(result[2]?.aggregateStatus).not.toBe('done');
      expect(result[3]?.aggregateStatus).not.toBe('done');
    });

    it('sorts non-done groups by updatedAt desc among themselves', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', aggregateStatus: 'active', updatedAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', aggregateStatus: 'failed', updatedAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'finished-time');
      expect(result[0]?.linearIssueId).toBe('INT-2');
      expect(result[1]?.linearIssueId).toBe('INT-1');
    });

    it('returns empty array for empty input', () => {
      expect(sortIssueGroups([], 'finished-time')).toEqual([]);
    });

    it('handles all non-done groups', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', aggregateStatus: 'active' }),
        makeGroup({ linearIssueId: 'INT-2', aggregateStatus: 'failed' }),
      ];
      const result = sortIssueGroups(groups, 'finished-time');
      expect(result).toHaveLength(2);
    });

    it('handles all done groups sorted by updatedAt desc', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', aggregateStatus: 'done', updatedAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', aggregateStatus: 'done', updatedAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'finished-time');
      expect(result[0]?.linearIssueId).toBe('INT-2');
      expect(result[1]?.linearIssueId).toBe('INT-1');
    });

    it('does not mutate the original array', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', aggregateStatus: 'active' }),
        makeGroup({ linearIssueId: 'INT-2', aggregateStatus: 'done' }),
      ];
      const firstId = groups[0]?.linearIssueId;
      sortIssueGroups(groups, 'finished-time');
      expect(groups[0]?.linearIssueId).toBe(firstId);
    });
  });

  describe('started-time', () => {
    it('sorts by most recent dispatchedAt desc', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', dispatchedAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', dispatchedAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'started-time');
      expect(result[0]?.linearIssueId).toBe('INT-2');
      expect(result[1]?.linearIssueId).toBe('INT-1');
    });

    it('groups with dispatchedAt sort before groups without dispatchedAt', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1' }),
        makeGroup({ linearIssueId: 'INT-2', dispatchedAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'started-time');
      expect(result[0]?.linearIssueId).toBe('INT-2');
      expect(result[1]?.linearIssueId).toBe('INT-1');
    });

    it('falls back to createdAt desc when neither has dispatchedAt', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', createdAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', createdAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'started-time');
      expect(result[0]?.linearIssueId).toBe('INT-2');
      expect(result[1]?.linearIssueId).toBe('INT-1');
    });

    it('returns empty array for empty input', () => {
      expect(sortIssueGroups([], 'started-time')).toEqual([]);
    });

    it('does not mutate the original array', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', dispatchedAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', dispatchedAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const firstId = groups[0]?.linearIssueId;
      sortIssueGroups(groups, 'started-time');
      expect(groups[0]?.linearIssueId).toBe(firstId);
    });
  });

  describe('created-time sort', () => {
    it('sorts by createdAt desc', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', createdAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', createdAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'created-time');
      expect(result[0]?.linearIssueId).toBe('INT-2');
      expect(result[1]?.linearIssueId).toBe('INT-1');
    });

    it('returns empty array for empty input', () => {
      expect(sortIssueGroups([], 'created-time')).toEqual([]);
    });

    it('does not mutate the original array', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', createdAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', createdAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const firstId = groups[0]?.linearIssueId;
      sortIssueGroups(groups, 'created-time');
      expect(groups[0]?.linearIssueId).toBe(firstId);
    });

    it('handles groups with identical createdAt', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', createdAt: '2024-06-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', createdAt: '2024-06-01T00:00:00.000Z' }),
      ];
      const result = sortIssueGroups(groups, 'created-time');
      expect(result).toHaveLength(2);
    });
  });

  describe('type coverage for all sort options', () => {
    it('accepts all valid SortOption values without throwing', () => {
      const sortOptions: SortOption[] = ['linear-id', 'pr-number', 'finished-time', 'started-time', 'created-time'];
      const groups: IssueGroup[] = [makeGroup({ linearIssueId: 'INT-1' })];
      for (const option of sortOptions) {
        expect(() => sortIssueGroups(groups, option)).not.toThrow();
      }
    });
  });
});
