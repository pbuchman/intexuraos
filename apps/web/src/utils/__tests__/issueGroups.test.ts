import { describe, expect, it } from 'vitest';
import type { CodeTask } from '@/types';
import { groupByLinearIssue, sortGroups } from '../issueGroups.js';

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
    expect(groups[0]?.pipeline.planning).toBe('completed');
  });

  it('derives execution step as completed', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.execution).toBe('completed');
  });

  it('derives execution step as actionable', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.execution).toBe('actionable');
  });

  it('derives execution step as running', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'running' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.execution).toBe('running');
  });

  it('derives execution step as failed with attempt count', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'failed' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'execution', status: 'failed', updatedAt: '2026-03-07T14:00:00Z' }),
    ];
    // Archive one of them
    tasks[1] = createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'execution', status: 'archived', updatedAt: '2026-03-07T14:00:00Z' });

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
    expect(groups[0]?.pipeline.planning).toBe('completed');
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
    expect(groups[0]?.pipeline.review).toBe('completed');
  });

  it('derives review step as running', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-100', agentType: 'review', status: 'running', updatedAt: '2026-03-07T16:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.review).toBe('running');
  });

  it('derives review step as null when no review task exists', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.review).toBeNull();
  });

  it('excludes archived review tasks from review step', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'review', status: 'archived' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.review).toBeNull();
  });

  it('review tasks do not affect planning/execution steps', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'review', status: 'reviewed' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.planning).toBeNull();
    expect(groups[0]?.pipeline.execution).toBeNull();
    expect(groups[0]?.pipeline.review).toBe('completed');
  });

  it('tasks with agentType pull_request do not affect planning/execution steps', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'pull_request', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.planning).toBeNull();
    expect(groups[0]?.pipeline.execution).toBeNull();
  });

  it('tasks with agentType undefined do not affect planning/execution steps', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', status: 'implemented' }),
    ];

    const groups = groupByLinearIssue(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pipeline.planning).toBeNull();
    expect(groups[0]?.pipeline.execution).toBeNull();
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
});

describe('sortGroups', () => {
  it('sorts by linearId (default)', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T12:00:00Z' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T13:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);
    const sorted = sortGroups(groups, 'linearId');

    expect(sorted[0]?.linearIssueId).toBe('INT-200');
    expect(sorted[1]?.linearIssueId).toBe('INT-100');
  });

  it('sorts by startedAt - most recently dispatched first', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'running', dispatchedAt: '2026-03-07T10:00:00Z' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'running', dispatchedAt: '2026-03-07T12:00:00Z' }),
      createMockTask({ id: 't3', linearIssueId: 'INT-300', agentType: 'execution', status: 'running' }), // no dispatchedAt
    ];

    const groups = groupByLinearIssue(tasks);
    const sorted = sortGroups(groups, 'startedAt');

    // INT-200 (12:00) first, INT-100 (10:00) second, INT-300 (no dispatchedAt) last
    expect(sorted[0]?.linearIssueId).toBe('INT-200');
    expect(sorted[1]?.linearIssueId).toBe('INT-100');
    expect(sorted[2]?.linearIssueId).toBe('INT-300');
  });

  it('sorts by startedAt - groups without dispatchedAt sort last', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned' }), // no dispatchedAt
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'running', dispatchedAt: '2026-03-07T12:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);
    const sorted = sortGroups(groups, 'startedAt');

    // INT-200 first (has dispatchedAt), INT-100 last (no dispatchedAt)
    expect(sorted[0]?.linearIssueId).toBe('INT-200');
    expect(sorted[1]?.linearIssueId).toBe('INT-100');
  });

  it('sorts by finished - most recently finished first', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T10:00:00Z' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'reviewed', updatedAt: '2026-03-07T12:00:00Z' }),
      createMockTask({ id: 't3', linearIssueId: 'INT-300', agentType: 'execution', status: 'running' }), // not finished
    ];

    const groups = groupByLinearIssue(tasks);
    const sorted = sortGroups(groups, 'finished');

    // INT-200 (reviewed at 12:00) first, INT-100 (implemented at 10:00) second, INT-300 (not finished) last
    expect(sorted[0]?.linearIssueId).toBe('INT-200');
    expect(sorted[1]?.linearIssueId).toBe('INT-100');
    expect(sorted[2]?.linearIssueId).toBe('INT-300');
  });

  it('sorts by finished - groups without finished sort last', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'queued' }), // not finished
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'implemented', updatedAt: '2026-03-07T12:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);
    const sorted = sortGroups(groups, 'finished');

    // INT-200 first (finished), INT-100 last (not finished)
    expect(sorted[0]?.linearIssueId).toBe('INT-200');
    expect(sorted[1]?.linearIssueId).toBe('INT-100');
  });

  it('sorts by pr - groups with PRs first by PR number desc', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', result: { prUrl: 'https://github.com/org/repo/pull/10' } }),
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'implemented', result: { prUrl: 'https://github.com/org/repo/pull/50' } }),
      createMockTask({ id: 't3', linearIssueId: 'INT-300', agentType: 'execution', status: 'running' }), // no PR
    ];

    const groups = groupByLinearIssue(tasks);
    const sorted = sortGroups(groups, 'pr');

    // INT-200 (PR 50) first, INT-100 (PR 10) second, INT-300 (no PR) last
    expect(sorted[0]?.linearIssueId).toBe('INT-200');
    expect(sorted[1]?.linearIssueId).toBe('INT-100');
    expect(sorted[2]?.linearIssueId).toBe('INT-300');
  });

  it('sorts by pr - groups without PRs sort last', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'planning', status: 'planned' }), // no PR
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'implemented', result: { prUrl: 'https://github.com/org/repo/pull/50' } }),
    ];

    const groups = groupByLinearIssue(tasks);
    const sorted = sortGroups(groups, 'pr');

    // INT-200 first (has PR), INT-100 last (no PR)
    expect(sorted[0]?.linearIssueId).toBe('INT-200');
    expect(sorted[1]?.linearIssueId).toBe('INT-100');
  });

  it('does not mutate original groups array', () => {
    const tasks = [
      createMockTask({ id: 't1', linearIssueId: 'INT-100', agentType: 'execution', status: 'implemented', dispatchedAt: '2026-03-07T10:00:00Z' }),
      createMockTask({ id: 't2', linearIssueId: 'INT-200', agentType: 'execution', status: 'implemented', dispatchedAt: '2026-03-07T12:00:00Z' }),
    ];

    const groups = groupByLinearIssue(tasks);
    const originalOrder = groups.map((g) => g.linearIssueId);
    sortGroups(groups, 'startedAt');

    expect(groups.map((g) => g.linearIssueId)).toEqual(originalOrder);
  });
});
