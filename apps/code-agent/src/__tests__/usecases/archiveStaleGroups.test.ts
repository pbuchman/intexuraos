import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import type { ArchiveStaleGroupsDeps } from '../../domain/usecases/archiveStaleGroups.js';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { GitHubPRSummary } from '../../domain/models/gitHubPRSummary.js';

function createFakeLogger(): Record<string, MockedFunction<() => void>> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// Fixed "now" for all tests
const NOW = new Date('2026-03-30T12:00:00Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

type TaskOverrides = Omit<
  Partial<CodeTask>,
  'updatedAt' | 'createdAt' | 'statusChangedAt' | 'completedAt'
> & {
  id: string;
  updatedAt: Date;
  createdAt?: Date;
  statusChangedAt?: Date | null;
  completedAt?: Date | null;
};

function makeTask(overrides: TaskOverrides): CodeTask {
  const {
    updatedAt,
    createdAt,
    statusChangedAt,
    completedAt,
    ...taskOverrides
  } = overrides;
  const status = overrides.status ?? 'implemented';
  const task: CodeTask = {
    userId: 'user-1',
    prompt: 'test prompt',
    sanitizedPrompt: 'test prompt',
    systemPromptHash: 'hash',
    workerType: 'sonnet',
    workerLocation: 'test',
    repository: 'test/repo',
    baseBranch: 'main',
    traceId: 'trace-1',
    status,
    dedupKey: `dedup-${overrides.id}`,
    callbackReceived: false,
    createdAt: Timestamp.fromDate(createdAt ?? updatedAt),
    ...taskOverrides,
    updatedAt: Timestamp.fromDate(updatedAt),
  } as CodeTask;

  if (statusChangedAt !== null) {
    task.statusChangedAt = Timestamp.fromDate(
      statusChangedAt ?? updatedAt,
    );
  }
  if (
    completedAt !== null &&
    status !== 'queued' &&
    status !== 'dispatched' &&
    status !== 'running'
  ) {
    task.completedAt = Timestamp.fromDate(completedAt ?? updatedAt);
  }

  return task;
}

describe('archiveStaleGroups', () => {
  let deps: ArchiveStaleGroupsDeps;
  let useCase: ReturnType<typeof createArchiveStaleGroupsUseCase>;
  let listAllNonArchivedGlobalMock: MockedFunction<
    ArchiveStaleGroupsDeps['codeTaskRepository']['listAllNonArchivedGlobal']
  >;
  let updateMock: MockedFunction<ArchiveStaleGroupsDeps['codeTaskRepository']['update']>;
  let findAllOpenMock: MockedFunction<ArchiveStaleGroupsDeps['gitHubPRSummaryRepo']['findAllOpen']>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    listAllNonArchivedGlobalMock = vi.fn() as MockedFunction<
      ArchiveStaleGroupsDeps['codeTaskRepository']['listAllNonArchivedGlobal']
    >;
    updateMock = vi.fn() as MockedFunction<
      ArchiveStaleGroupsDeps['codeTaskRepository']['update']
    >;
    findAllOpenMock = vi.fn().mockResolvedValue(ok([])) as MockedFunction<
      ArchiveStaleGroupsDeps['gitHubPRSummaryRepo']['findAllOpen']
    >;

    deps = {
      codeTaskRepository: {
        listAllNonArchivedGlobal: listAllNonArchivedGlobalMock,
        update: updateMock,
      } as unknown as ArchiveStaleGroupsDeps['codeTaskRepository'],
      gitHubPRSummaryRepo: {
        findAllOpen: findAllOpenMock,
      } as unknown as ArchiveStaleGroupsDeps['gitHubPRSummaryRepo'],
      logger: createFakeLogger() as unknown as ArchiveStaleGroupsDeps['logger'],
    } as unknown as ArchiveStaleGroupsDeps;
    useCase = createArchiveStaleGroupsUseCase(deps);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('archives group where all tasks have updatedAt > 7 days ago', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-100', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-100', updatedAt: daysAgo(10) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(ok(tasks[0] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
    expect(updateMock).toHaveBeenCalledWith('task-2', { status: 'archived' });
  });

  it('retains group where maxUpdatedAt is within 7 days', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-200', updatedAt: daysAgo(3) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-200', updatedAt: daysAgo(3) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('retains stale group when any task matches an open PR summary', async () => {
    const task = makeTask({
      id: 'task-open-pr',
      linearIssueId: 'INT-250',
      repository: 'intexuraos/app',
      prNumber: 42,
      updatedAt: daysAgo(14),
    });
    const openSummary: GitHubPRSummary = {
      repository: 'intexuraos/app',
      pullRequestNumber: 42,
      title: 'Open work',
      state: 'open',
      mergedAt: null,
      baseBranch: 'development',
      authorLogin: 'codex',
      headBranch: 'worker-b',
      mergeConflictStatus: null,
      lastConflictCheckedAt: null,
      conflictEpisodeStartedAt: null,
      conflictResolvedAt: null,
      managedConflictCommentId: null,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: null,
      lastActivityAt: NOW,
      firstSeenAt: NOW,
      lastReviewedCommitSha: null,
      lastReviewNeedsRemediation: null,
    };
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    findAllOpenMock.mockResolvedValue(ok([openSummary]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(findAllOpenMock).toHaveBeenCalledOnce();
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsRetained).toBe(1);
      expect(result.value.groupsArchived).toBe(0);
    }
  });

  it('skips group with active task (status=running) even if updatedAt is old', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-300', status: 'running', updatedAt: daysAgo(14) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-300', status: 'failed', updatedAt: daysAgo(14) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedActive).toBe(1);
    }
  });

  it('groups tasks by linearIssueId — stale group archived, fresh group retained', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-400', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-400', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-3', linearIssueId: 'INT-500', updatedAt: daysAgo(2) }),
      makeTask({ id: 'task-4', linearIssueId: 'INT-500', updatedAt: daysAgo(2) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));
    updateMock.mockResolvedValue(ok(tasks[0] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
    expect(updateMock).toHaveBeenCalledWith('task-2', { status: 'archived' });
    expect(updateMock).not.toHaveBeenCalledWith('task-3', expect.anything());
    expect(updateMock).not.toHaveBeenCalledWith('task-4', expect.anything());
    if (result.ok) {
      expect(result.value.groupsArchived).toBe(1);
      expect(result.value.groupsRetained).toBe(1);
    }
  });

  it('standalone tasks (no linearIssueId) grouped by task.id, archived when stale', async () => {
    const task = makeTask({ id: 'standalone-1', updatedAt: daysAgo(10) });
    // no linearIssueId
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('standalone-1', { status: 'archived' });
  });

  it('handles update failure — logs error, continues, reports tasksFailed: 1', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-600', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-600', updatedAt: daysAgo(10) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));
    updateMock
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR' as const, message: 'Write failed' }))
      .mockResolvedValueOnce(ok(tasks[1] as CodeTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.tasksArchived).toBe(1);
    }
  });

  it('returns zero counts when no non-archived tasks exist', async () => {
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalTasksFetched).toBe(0);
      expect(result.value.totalGroupsEvaluated).toBe(0);
      expect(result.value.groupsArchived).toBe(0);
      expect(result.value.groupsRetained).toBe(0);
      expect(result.value.groupsSkippedActive).toBe(0);
      expect(result.value.tasksArchived).toBe(0);
      expect(result.value.tasksFailed).toBe(0);
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns error when listAllNonArchivedGlobal fails', async () => {
    listAllNonArchivedGlobalMock.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR' as const, message: 'Query failed' })
    );

    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Query failed');
    }
  });

  it('returns error when open PR summary lookup fails', async () => {
    const task = makeTask({ id: 'task-1', linearIssueId: 'INT-701', updatedAt: daysAgo(10) });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    findAllOpenMock.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR' as const, message: 'PR summary query failed' })
    );

    const result = await useCase();

    expect(result.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    if (!result.ok) {
      expect(result.error.message).toBe('PR summary query failed');
    }
  });

  it('custom staleDays parameter respected — tasks 5 days old archived with staleDays: 3', async () => {
    const task = makeTask({ id: 'task-1', linearIssueId: 'INT-700', updatedAt: daysAgo(5) });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    // With staleDays: 3, 5-day-old task should be archived
    const result = await useCase({ staleDays: 3 });

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith('task-1', { status: 'archived' });
  });

  it('custom staleDays parameter respected — tasks 5 days old retained with default (7)', async () => {
    const task = makeTask({ id: 'task-1', linearIssueId: 'INT-800', updatedAt: daysAgo(5) });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));

    // With default staleDays: 7, 5-day-old task should be retained
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('handles update throwing an exception — catches, logs error, reports tasksFailed', async () => {
    const task = makeTask({ id: 'task-1', linearIssueId: 'INT-601', updatedAt: daysAgo(10) });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockRejectedValue(new Error('Unexpected Firestore crash'));

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.tasksArchived).toBe(0);
    }
  });

  it('mixed group: one task stale, one task fresh → group retained', async () => {
    const tasks = [
      makeTask({ id: 'task-1', linearIssueId: 'INT-900', updatedAt: daysAgo(10) }),
      makeTask({ id: 'task-2', linearIssueId: 'INT-900', updatedAt: daysAgo(2) }),
    ];
    listAllNonArchivedGlobalMock.mockResolvedValue(ok(tasks));

    const result = await useCase();

    expect(result.ok).toBe(true);
    // maxUpdatedAt is 2 days ago (fresh) → group retained
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsRetained).toBe(1);
    }
  });

  it('archives by lifecycle activity when a later metadata write advanced updatedAt', async () => {
    const lifecycleAt = daysAgo(10);
    const task = makeTask({
      id: 'task-metadata-newer',
      linearIssueId: 'INT-1000',
      status: 'failed',
      statusChangedAt: lifecycleAt,
      completedAt: lifecycleAt,
      updatedAt: daysAgo(1),
    });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(task.id, { status: 'archived' });
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        groupKey: 'INT-1000',
        maxLifecycleAt: lifecycleAt.toISOString(),
        daysSinceLifecycleActivity: 10,
      }),
      'Archiving stale issue group',
    );
  });

  it('retains a group whose lifecycle activity is fresh even when updatedAt is old', async () => {
    const task = makeTask({
      id: 'task-lifecycle-newer',
      linearIssueId: 'INT-1001',
      statusChangedAt: daysAgo(2),
      completedAt: daysAgo(2),
      updatedAt: daysAgo(10),
    });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        groupKey: 'INT-1001',
        maxLifecycleAt: daysAgo(2).toISOString(),
        reason: 'not_stale',
      }),
      'Retaining issue group',
    );
  });

  it('uses terminal dispatch fallback for retention and backfills completion while archiving', async () => {
    const failedAt = daysAgo(10);
    const dispatchAt = Timestamp.fromDate(failedAt);
    const task = makeTask({
      id: 'task-terminal-fallback',
      linearIssueId: 'INT-1002',
      status: 'failed',
      statusChangedAt: null,
      completedAt: null,
      updatedAt: daysAgo(1),
      dispatchStatus: {
        state: 'terminal',
        reason: 'codex_auth_unavailable',
        terminal: true,
        severity: 'warning',
        message: 'Codex auth unavailable',
        remediation: 'Use an authorized worker',
        workerNames: ['home-dev'],
        firstSeenAt: dispatchAt,
        lastSeenAt: dispatchAt,
        terminalCause: {
          reason: 'codex_auth_unavailable',
          message: 'Codex auth unavailable',
          remediation: 'Use an authorized worker',
          workerNames: ['home-dev'],
          lastSeenAt: dispatchAt,
        },
        nextAction: 'retry_after_fix',
      },
    });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));
    updateMock.mockResolvedValue(ok(task));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(task.id, {
      status: 'archived',
      completedAt: failedAt,
    });
  });

  it('retains lifecycle activity exactly at the seven-day boundary', async () => {
    const boundaryAt = daysAgo(7);
    const task = makeTask({
      id: 'task-boundary',
      linearIssueId: 'INT-1003',
      statusChangedAt: boundaryAt,
      completedAt: boundaryAt,
      updatedAt: daysAgo(20),
    });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([task]));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('evaluates the same Linear issue independently for each user', async () => {
    const staleTask = makeTask({
      id: 'task-user-1',
      userId: 'user-1',
      linearIssueId: 'INT-SHARED',
      statusChangedAt: daysAgo(10),
      completedAt: daysAgo(10),
      updatedAt: daysAgo(1),
    });
    const freshTask = makeTask({
      id: 'task-user-2',
      userId: 'user-2',
      linearIssueId: 'INT-SHARED',
      statusChangedAt: daysAgo(2),
      completedAt: daysAgo(2),
      updatedAt: daysAgo(20),
    });
    listAllNonArchivedGlobalMock.mockResolvedValue(ok([staleTask, freshTask]));
    updateMock.mockResolvedValue(ok(staleTask));

    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(staleTask.id, { status: 'archived' });
    if (result.ok) {
      expect(result.value.totalGroupsEvaluated).toBe(2);
      expect(result.value.groupsArchived).toBe(1);
      expect(result.value.groupsRetained).toBe(1);
    }
  });
});
