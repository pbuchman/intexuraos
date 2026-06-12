import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { GitHubPRSummary } from '../../domain/models/gitHubPRSummary.js';
import type { TaskGroupSummary } from '../../domain/models/taskGroupSummary.js';
import {
  createRepairArchivedOpenPrGroupsUseCase,
  type RepairArchivedOpenPrGroupsDeps,
} from '../../domain/usecases/repairArchivedOpenPrGroups.js';
import { createMockLogger } from '../helpers/mockLogger.js';

function makeTask(overrides: Partial<CodeTask> & { id: string }): CodeTask {
  const { id, ...taskOverrides } = overrides;
  const updatedAt = overrides.updatedAt instanceof Timestamp
    ? overrides.updatedAt
    : Timestamp.fromDate(new Date('2026-05-07T10:00:00Z'));
  const createdAt = overrides.createdAt instanceof Timestamp
    ? overrides.createdAt
    : updatedAt;

  return {
    id,
    userId: 'user-1',
    prompt: 'prompt',
    sanitizedPrompt: 'prompt',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'mac-dev',
    status: 'archived',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    createdAt,
    updatedAt,
    traceId: `trace-${id}`,
    dedupKey: `dedup-${id}`,
    callbackReceived: false,
    linearIssueId: 'INT-1423',
    prNumber: 1903,
    agentType: 'review',
    ...taskOverrides,
  };
}

function makeOpenPrSummary(overrides: Partial<GitHubPRSummary> = {}): GitHubPRSummary {
  const now = new Date('2026-05-07T10:00:00Z');
  return {
    repository: 'pbuchman/intexuraos',
    pullRequestNumber: 1903,
    title: 'Open PR',
    state: 'open',
    mergedAt: null,
    baseBranch: 'development',
    authorLogin: 'pbuchman',
    headBranch: 'worker/int-1423',
    mergeConflictStatus: null,
    lastConflictCheckedAt: null,
    conflictEpisodeStartedAt: null,
    conflictResolvedAt: null,
    managedConflictCommentId: null,
    managedConflictTaskId: null,
    managedConflictTaskOwnerUserId: null,
    lastActivityAt: now,
    firstSeenAt: now,
    lastReviewedCommitSha: null,
    lastReviewNeedsRemediation: null,
    ...overrides,
  };
}

class DateWithToMillis extends Date {
  toMillis(): number {
    return this.getTime();
  }
}

describe('repairArchivedOpenPrGroups', () => {
  let deps: RepairArchivedOpenPrGroupsDeps;
  let findAllOpenMock: MockedFunction<RepairArchivedOpenPrGroupsDeps['gitHubPRSummaryRepo']['findAllOpen']>;
  let findRecentTasksByPRMock: MockedFunction<RepairArchivedOpenPrGroupsDeps['codeTaskRepo']['findRecentTasksByPR']>;
  let findRecentTasksByLinearIssueMock: MockedFunction<RepairArchivedOpenPrGroupsDeps['codeTaskRepo']['findRecentTasksByLinearIssue']>;
  let updateMock: MockedFunction<RepairArchivedOpenPrGroupsDeps['codeTaskRepo']['update']>;
  let recomputeGroupFromTasksMock: MockedFunction<RepairArchivedOpenPrGroupsDeps['groupSummaryRepo']['recomputeGroupFromTasks']>;
  let getSummaryMock: MockedFunction<NonNullable<RepairArchivedOpenPrGroupsDeps['groupSummaryRepo']['getSummary']>>;

  beforeEach(() => {
    findAllOpenMock = vi.fn().mockResolvedValue(ok([makeOpenPrSummary()])) as MockedFunction<
      RepairArchivedOpenPrGroupsDeps['gitHubPRSummaryRepo']['findAllOpen']
    >;
    findRecentTasksByPRMock = vi.fn() as MockedFunction<
      RepairArchivedOpenPrGroupsDeps['codeTaskRepo']['findRecentTasksByPR']
    >;
    findRecentTasksByLinearIssueMock = vi.fn() as MockedFunction<
      RepairArchivedOpenPrGroupsDeps['codeTaskRepo']['findRecentTasksByLinearIssue']
    >;
    updateMock = vi.fn() as MockedFunction<
      RepairArchivedOpenPrGroupsDeps['codeTaskRepo']['update']
    >;
    recomputeGroupFromTasksMock = vi.fn().mockResolvedValue(ok(undefined)) as MockedFunction<
      RepairArchivedOpenPrGroupsDeps['groupSummaryRepo']['recomputeGroupFromTasks']
    >;
    getSummaryMock = vi.fn().mockResolvedValue(ok(null)) as MockedFunction<
      NonNullable<RepairArchivedOpenPrGroupsDeps['groupSummaryRepo']['getSummary']>
    >;

    deps = {
      codeTaskRepo: {
        findRecentTasksByPR: findRecentTasksByPRMock,
        findRecentTasksByLinearIssue: findRecentTasksByLinearIssueMock,
        update: updateMock,
      },
      gitHubPRSummaryRepo: {
        findAllOpen: findAllOpenMock,
      },
      groupSummaryRepo: {
        getSummary: getSummaryMock,
        recomputeGroupFromTasks: recomputeGroupFromTasksMock,
      },
      logger: createMockLogger(),
    };
  });

  it('returns an error when open PR listing fails', async () => {
    findAllOpenMock.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'open PR list failed',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('open PR list failed');
    }
  });

  it('returns an error when fetching PR-scoped tasks fails', async () => {
    findRecentTasksByPRMock.mockResolvedValue(err(new Error('PR task fetch failed')));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('PR task fetch failed');
    }
  });

  it('restores the newest archived review task for an open PR group and preserves updatedAt', async () => {
    const olderArchived = makeTask({
      id: 'task-older',
      agentType: 'planning',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T08:00:00Z')),
    });
    const latestArchivedReview = makeTask({
      id: 'task-latest-review',
      agentType: 'review',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([latestArchivedReview, olderArchived]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([latestArchivedReview, olderArchived]));
    updateMock.mockResolvedValue(ok({
      ...latestArchivedReview,
      status: 'reviewed',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith('task-latest-review', {
      status: 'reviewed',
      updatedAt: new Date('2026-05-07T09:00:00Z'),
    });
    expect(recomputeGroupFromTasksMock).toHaveBeenCalledWith(
      'user-1',
      'INT-1423',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-latest-review',
          status: 'reviewed',
          updatedAt: latestArchivedReview.updatedAt,
        }),
      ]),
    );
    if (result.ok) {
      expect(result.value.groupsRepaired).toBe(1);
      expect(result.value.tasksRestored).toBe(1);
    }
  });

  it('repairs standalone archived tasks and converts Date-like updatedAt values before update', async () => {
    const dateWithToMillis = new DateWithToMillis('2026-05-07T09:00:00Z');
    const standaloneTask = {
      ...makeTask({
        id: 'task-standalone',
        agentType: 'review',
        status: 'archived',
      }),
      createdAt: dateWithToMillis as unknown as Timestamp,
      updatedAt: dateWithToMillis as unknown as Timestamp,
    } as CodeTask & { linearIssueId?: string };
    delete standaloneTask.linearIssueId;

    findRecentTasksByPRMock.mockResolvedValue(ok([standaloneTask]));
    updateMock.mockResolvedValue(ok({
      ...standaloneTask,
      status: 'reviewed',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(findRecentTasksByLinearIssueMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith('task-standalone', {
      status: 'reviewed',
      updatedAt: new Date('2026-05-07T09:00:00Z'),
    });
    expect(recomputeGroupFromTasksMock).toHaveBeenCalledWith(
      'user-1',
      'standalone_task-standalone',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-standalone',
          status: 'reviewed',
        }),
      ]),
    );
  });

  it('prefers a stable execution sibling over a newer merged-PR sibling when repairing visibility', async () => {
    const archivedOpenPrTask = makeTask({
      id: 'task-open-pr-review',
      agentType: 'review',
      prNumber: 1903,
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });
    const newerMergedSibling = makeTask({
      id: 'task-newer-merged-sibling',
      agentType: 'execution',
      prNumber: 1994,
      status: 'archived',
      prMergedAt: Timestamp.fromDate(new Date('2026-04-30T12:00:05Z')),
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T10:00:00Z')),
    });
    const stableExecutionSibling = makeTask({
      id: 'task-stable-execution-sibling',
      agentType: 'execution',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T08:00:00Z')),
    }) as CodeTask & { prNumber?: number };
    delete stableExecutionSibling.prNumber;

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedOpenPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(
      ok([archivedOpenPrTask, newerMergedSibling, stableExecutionSibling]),
    );
    updateMock.mockResolvedValue(ok({
      ...stableExecutionSibling,
      status: 'implemented',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith('task-stable-execution-sibling', {
      status: 'implemented',
      updatedAt: new Date('2026-05-07T08:00:00Z'),
    });
    expect(recomputeGroupFromTasksMock).toHaveBeenCalledWith(
      'user-1',
      'INT-1423',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-stable-execution-sibling',
          status: 'implemented',
        }),
      ]),
    );
  });

  it('prefers a merge-ready review sibling over an execution sibling when the cached summary already marks merge readiness', async () => {
    const mergeReadyReview = makeTask({
      id: 'task-merge-ready-review',
      agentType: 'review',
      prNumber: 1903,
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
      result: {
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1903',
        needs_remediation: '0',
      },
    });
    const stableExecutionSibling = makeTask({
      id: 'task-stable-execution',
      agentType: 'execution',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T08:00:00Z')),
    }) as CodeTask & { prNumber?: number };
    delete stableExecutionSibling.prNumber;
    const archivedSummary: TaskGroupSummary = {
      userId: 'user-1',
      linearIssueId: 'INT-1423',
      groupKey: 'INT-1423',
      linearIssueNumber: 1423,
      linearIssueSortKey: 1423,
      taskCount: 0,
      activeTaskCount: 0,
      latestTaskStatus: 'reviewed',
      latestTaskUpdatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
      agentTypesPresent: ['review', 'execution'],
      hasCompletedPlanning: false,
      hasCompletedExecution: true,
      hasCompletedExecutionAgent: true,
      hasImplementationTaskId: false,
      hasPrUrl: true,
      prNumber: 1903,
      latestReviewNeedsRemediation: false,
      oldestTaskCreatedAt: Timestamp.fromDate(new Date('2026-05-07T07:00:00Z')),
      mostRecentDispatchedAt: null,
      aggregateStatus: 'archived',
      hasImplementationReadyLabel: true,
      hasMergeReadyLabel: true,
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T10:00:01Z')),
    };

    findRecentTasksByPRMock.mockResolvedValue(ok([mergeReadyReview]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(
      ok([mergeReadyReview, stableExecutionSibling]),
    );
    getSummaryMock.mockResolvedValue(ok(archivedSummary));
    updateMock.mockResolvedValue(ok({
      ...mergeReadyReview,
      status: 'reviewed',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith('task-merge-ready-review', {
      status: 'reviewed',
      updatedAt: new Date('2026-05-07T09:00:00Z'),
    });
    expect(recomputeGroupFromTasksMock).toHaveBeenCalledWith(
      'user-1',
      'INT-1423',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-merge-ready-review',
          status: 'reviewed',
        }),
      ]),
    );
  });

  it('prefers a planning sibling over weaker candidates when the cached summary marks implementation readiness', async () => {
    const archivedOpenPrTask = makeTask({
      id: 'task-open-pr-review',
      agentType: 'review',
      prNumber: 1903,
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });
    const planningSibling = makeTask({
      id: 'task-planning-sibling',
      agentType: 'planning',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T08:00:00Z')),
    }) as CodeTask & { prNumber?: number };
    delete planningSibling.prNumber;
    const weakerSibling = makeTask({
      id: 'task-weaker-sibling',
      agentType: 'pull_request',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T10:00:00Z')),
    }) as CodeTask & { prNumber?: number };
    delete weakerSibling.prNumber;
    const archivedSummary: TaskGroupSummary = {
      userId: 'user-1',
      linearIssueId: 'INT-1423',
      groupKey: 'INT-1423',
      linearIssueNumber: 1423,
      linearIssueSortKey: 1423,
      taskCount: 0,
      activeTaskCount: 0,
      latestTaskStatus: 'planned',
      latestTaskUpdatedAt: Timestamp.fromDate(new Date('2026-05-07T10:00:00Z')),
      agentTypesPresent: ['review', 'planning', 'pull_request'],
      hasCompletedPlanning: true,
      hasCompletedExecution: false,
      hasCompletedExecutionAgent: false,
      hasImplementationTaskId: false,
      hasPrUrl: true,
      prNumber: 1903,
      latestReviewNeedsRemediation: null,
      oldestTaskCreatedAt: Timestamp.fromDate(new Date('2026-05-07T07:00:00Z')),
      mostRecentDispatchedAt: null,
      aggregateStatus: 'archived',
      hasImplementationReadyLabel: true,
      hasMergeReadyLabel: false,
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T10:00:01Z')),
    };

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedOpenPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(
      ok([archivedOpenPrTask, planningSibling, weakerSibling]),
    );
    getSummaryMock.mockResolvedValue(ok(archivedSummary));
    updateMock.mockResolvedValue(ok({
      ...planningSibling,
      status: 'planned',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith('task-planning-sibling', {
      status: 'planned',
      updatedAt: new Date('2026-05-07T08:00:00Z'),
    });
  });

  it('repairs archived groups when getSummary is not implemented on the repository adapter', async () => {
    const archivedOpenPrTask = makeTask({
      id: 'task-open-pr-review',
      agentType: 'review',
      prNumber: 1903,
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });
    const stableExecutionSibling = makeTask({
      id: 'task-stable-execution-sibling',
      agentType: 'execution',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T08:00:00Z')),
    }) as CodeTask & { prNumber?: number };
    delete stableExecutionSibling.prNumber;

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedOpenPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(
      ok([archivedOpenPrTask, stableExecutionSibling]),
    );
    updateMock.mockResolvedValue(ok({
      ...stableExecutionSibling,
      status: 'implemented',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase({
      ...deps,
      groupSummaryRepo: {
        recomputeGroupFromTasks: recomputeGroupFromTasksMock,
      },
    });
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith('task-stable-execution-sibling', {
      status: 'implemented',
      updatedAt: new Date('2026-05-07T08:00:00Z'),
    });
  });

  it('returns an error when fetching the existing summary for repair fails', async () => {
    const archivedOpenPrTask = makeTask({
      id: 'task-open-pr-review',
      agentType: 'review',
      prNumber: 1903,
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedOpenPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([archivedOpenPrTask]));
    getSummaryMock.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'summary read failed',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('summary read failed');
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('restores pull_request tasks to implemented', async () => {
    const latestPullRequestTask = makeTask({
      id: 'task-pr',
      agentType: 'pull_request',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([latestPullRequestTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([latestPullRequestTask]));
    updateMock.mockResolvedValue(ok({
      ...latestPullRequestTask,
      status: 'implemented',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith('task-pr', {
      status: 'implemented',
      updatedAt: new Date('2026-05-07T09:00:00Z'),
    });
  });

  it('marks standalone archived tasks as repaired during dry-run without writing', async () => {
    const standaloneTask = makeTask({
      id: 'task-dry-run-standalone',
      agentType: 'review',
      status: 'archived',
    }) as CodeTask & { linearIssueId?: string };
    delete standaloneTask.linearIssueId;

    findRecentTasksByPRMock.mockResolvedValue(ok([standaloneTask]));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase({ dryRun: true });

    expect(result.ok).toBe(true);
    expect(findRecentTasksByLinearIssueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsRepaired).toBe(1);
      expect(result.value.tasksRestored).toBe(1);
    }
  });

  it('does not count a group as repaired when summary recompute fails', async () => {
    const latestArchivedReview = makeTask({
      id: 'task-latest-review',
      agentType: 'review',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([latestArchivedReview]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([latestArchivedReview]));
    updateMock
      .mockResolvedValueOnce(ok({
        ...latestArchivedReview,
        status: 'reviewed',
      }))
      .mockResolvedValueOnce(ok(latestArchivedReview));
    recomputeGroupFromTasksMock.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'recompute failed',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenNthCalledWith(1, 'task-latest-review', {
      status: 'reviewed',
      updatedAt: new Date('2026-05-07T09:00:00Z'),
    });
    expect(updateMock).toHaveBeenNthCalledWith(2, 'task-latest-review', {
      status: 'archived',
      updatedAt: new Date('2026-05-07T09:00:00Z'),
    });
    if (result.ok) {
      expect(result.value.groupsRepaired).toBe(0);
      expect(result.value.tasksRestored).toBe(0);
      expect(result.value.summaryRecomputeFailures).toBe(1);
    }
  });

  it('increments tasksFailed when rollback after recompute failure also fails', async () => {
    const latestArchivedReview = makeTask({
      id: 'task-rollback-fail',
      agentType: 'review',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([latestArchivedReview]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([latestArchivedReview]));
    updateMock
      .mockResolvedValueOnce(ok({
        ...latestArchivedReview,
        status: 'reviewed',
      }))
      .mockResolvedValueOnce(err(new Error('rollback failed')));
    recomputeGroupFromTasksMock.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'recompute failed',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summaryRecomputeFailures).toBe(1);
      expect(result.value.tasksFailed).toBe(1);
    }
  });

  it('skips repair when the latest PR task is already non-archived', async () => {
    const visibleTask = makeTask({
      id: 'task-visible',
      status: 'implemented',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });
    const olderArchived = makeTask({
      id: 'task-older',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T08:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([visibleTask, olderArchived]));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(findRecentTasksByLinearIssueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedAlreadyVisible).toBe(1);
    }
  });

  it('skips repair when the full group already has a non-archived sibling', async () => {
    const archivedPrTask = makeTask({
      id: 'task-archived-pr',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });
    const visibleSibling = makeTask({
      id: 'task-visible-sibling',
      status: 'implemented',
      prNumber: 1994,
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:30:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([archivedPrTask, visibleSibling]));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    expect(recomputeGroupFromTasksMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedAlreadyVisible).toBe(1);
    }
  });

  it('returns an error when fetching full group tasks fails', async () => {
    const archivedPrTask = makeTask({
      id: 'task-group-fetch-fail',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(err(new Error('group task fetch failed')));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('group task fetch failed');
    }
  });

  it('skips repair when no matching tasks remain after group filtering', async () => {
    const archivedPrTask = makeTask({
      id: 'task-filtered-out',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });
    const otherUsersTask = makeTask({
      id: 'task-other-user',
      userId: 'user-2',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:30:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([otherUsersTask]));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsEvaluated).toBe(1);
      expect(result.value.groupsRepaired).toBe(0);
    }
  });

  it('skips repair and records a warning when the group scan exceeds the cap', async () => {
    const prTask = makeTask({
      id: 'task-pr',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });
    const extraTasks = [
      prTask,
      makeTask({ id: 'task-2', status: 'archived' }),
      makeTask({ id: 'task-3', status: 'archived' }),
    ];

    findRecentTasksByPRMock.mockResolvedValue(ok([prTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok(extraTasks));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase({ scanLimit: 2 });

    expect(result.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.groupsSkippedScanLimit).toBe(1);
      expect(result.value.warnings).toEqual([
        expect.objectContaining({
          repository: 'pbuchman/intexuraos',
          prNumber: 1903,
          userId: 'user-1',
          groupKey: 'INT-1423',
          reason: 'group_task_window_capped',
        }),
      ]);
    }
  });

  it('uses the open PR number in scan-cap warnings when the task has no PR number', async () => {
    const prTask = makeTask({
      id: 'task-pr-no-number',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    }) as CodeTask & { prNumber?: number };
    delete prTask.prNumber;
    const extraTaskOne = makeTask({
      id: 'task-extra-1',
      status: 'archived',
    }) as CodeTask & { prNumber?: number };
    delete extraTaskOne.prNumber;
    const extraTaskTwo = makeTask({
      id: 'task-extra-2',
      status: 'archived',
    }) as CodeTask & { prNumber?: number };
    delete extraTaskTwo.prNumber;
    const extraTasks = [
      prTask,
      extraTaskOne,
      extraTaskTwo,
    ];

    findRecentTasksByPRMock.mockResolvedValue(ok([prTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok(extraTasks));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase({ scanLimit: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings).toEqual([
        expect.objectContaining({
          prNumber: 1903,
          reason: 'group_task_window_capped',
        }),
      ]);
    }
  });

  it('skips repair and records a warning when the PR scan exceeds the cap', async () => {
    const prTasks = [
      makeTask({ id: 'task-1', status: 'archived' }),
      makeTask({ id: 'task-2', status: 'archived', updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')) }),
    ];

    findRecentTasksByPRMock.mockResolvedValue(ok(prTasks));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase({ scanLimit: 1 });

    expect(result.ok).toBe(true);
    expect(findRecentTasksByLinearIssueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.prsSkippedScanLimit).toBe(1);
      expect(result.value.warnings).toEqual([
        expect.objectContaining({
          repository: 'pbuchman/intexuraos',
          prNumber: 1903,
          reason: 'pr_task_window_capped',
        }),
      ]);
    }
  });

  it('dedupes the same user and group across multiple open PR summaries', async () => {
    const olderOpenPrTask = makeTask({
      id: 'task-open-pr-1',
      prNumber: 1903,
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T08:00:00Z')),
    });
    const newerOpenPrTask = makeTask({
      id: 'task-open-pr-2',
      prNumber: 1994,
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
      agentType: 'pull_request',
    });

    findAllOpenMock.mockResolvedValue(ok([
      makeOpenPrSummary({ pullRequestNumber: 1903 }),
      makeOpenPrSummary({ pullRequestNumber: 1994 }),
    ]));
    findRecentTasksByPRMock
      .mockResolvedValueOnce(ok([olderOpenPrTask]))
      .mockResolvedValueOnce(ok([newerOpenPrTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([olderOpenPrTask, newerOpenPrTask]));
    updateMock.mockResolvedValue(ok({
      ...newerOpenPrTask,
      status: 'implemented',
    }));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('task-open-pr-2', {
      status: 'implemented',
      updatedAt: new Date('2026-05-07T09:00:00Z'),
    });
    if (result.ok) {
      expect(result.value.groupsEvaluated).toBe(1);
      expect(result.value.groupsRepaired).toBe(1);
    }
  });

  it('counts failed task restores when the status update fails', async () => {
    const archivedTask = makeTask({
      id: 'task-update-fail',
      status: 'archived',
      updatedAt: Timestamp.fromDate(new Date('2026-05-07T09:00:00Z')),
    });

    findRecentTasksByPRMock.mockResolvedValue(ok([archivedTask]));
    findRecentTasksByLinearIssueMock.mockResolvedValue(ok([archivedTask]));
    updateMock.mockResolvedValue(err(new Error('update failed')));

    const useCase = createRepairArchivedOpenPrGroupsUseCase(deps);
    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasksFailed).toBe(1);
      expect(result.value.groupsRepaired).toBe(0);
    }
  });
});
