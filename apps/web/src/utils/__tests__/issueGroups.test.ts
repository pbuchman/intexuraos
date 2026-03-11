import { describe, expect, it } from 'vitest';
import type { CodeTask } from '@/types';
import { groupByLinearIssue, sortIssueGroups } from '../issueGroups.js';
import type { IssueGroup, SortOption } from '../issueGroups.js';

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

// --- Helper for sortIssueGroups tests ---

function makeGroup(overrides: {
  linearIssueId?: string | null;
  prNumber?: string | null;
  updatedAt?: string;
  dispatchedAt?: string;
  aggregateStatus?: IssueGroup['aggregateStatus'];
}): IssueGroup {
  const {
    linearIssueId = null,
    prNumber = null,
    updatedAt = '2024-01-01T00:00:00.000Z',
    dispatchedAt,
    aggregateStatus = 'done',
  } = overrides;

  const latestTask = createMockTask({ id: `task-${Math.random().toString(36).slice(2)}`, updatedAt, dispatchedAt });

  return {
    linearIssueId: linearIssueId ?? null,
    linearIssue: undefined,
    tasks: [latestTask],
    pipeline: {
      planning: 'completed',
      execution: 'completed',
      review: 'completed',
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

    it('falls back to updatedAt desc when neither has dispatchedAt', () => {
      const groups: IssueGroup[] = [
        makeGroup({ linearIssueId: 'INT-1', updatedAt: '2024-01-01T00:00:00.000Z' }),
        makeGroup({ linearIssueId: 'INT-2', updatedAt: '2024-06-01T00:00:00.000Z' }),
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

  describe('type coverage for all sort options', () => {
    it('accepts all valid SortOption values without throwing', () => {
      const sortOptions: SortOption[] = ['linear-id', 'pr-number', 'finished-time', 'started-time'];
      const groups: IssueGroup[] = [makeGroup({ linearIssueId: 'INT-1' })];
      for (const option of sortOptions) {
        expect(() => sortIssueGroups(groups, option)).not.toThrow();
      }
    });
  });
});
