import { describe, expect, it } from 'vitest';
import type { CodeTask } from '@/types';
import { groupByLinearIssue } from '../issueGroups.js';

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
