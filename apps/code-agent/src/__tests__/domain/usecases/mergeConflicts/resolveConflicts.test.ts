import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH, type CodeTask } from '../../../../domain/models/codeTask.js';
import type { GitHubPRSummary } from '../../../../domain/models/gitHubPRSummary.js';
import {
  buildInitialWorkflowResult,
  createMergeConflictTask,
  executeConflictWorkflow,
  isMergeConflictTask,
  isReusableConflictTask,
  resolveConflictParentTaskId,
  resolveConflictWorkflow,
  resolveExistingConflictTask,
  shouldEnsureConflictWorkflow,
  shouldResolveTaskState,
  shouldRetainExistingConflictTask,
  type ConflictWorkflowParams,
  type ResolveConflictDeps,
} from '../../../../domain/usecases/mergeConflicts/resolveConflicts.js';
import { resetServices, setServices, type ServiceContainer } from '../../../../services.js';

const randomUuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = Timestamp.now();
  return {
    id: 'task-existing',
    userId: 'user-1',
    traceId: 'trace-1',
    prompt: 'existing prompt',
    sanitizedPrompt: 'existing prompt',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'home-mac',
    repository: 'owner/repo',
    baseBranch: 'main',
    prNumber: 42,
    agentType: 'pull_request',
    status: 'running',
    dedupKey: 'dedup',
    callbackReceived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createSummary(overrides: Partial<GitHubPRSummary> = {}): GitHubPRSummary {
  return {
    repository: 'owner/repo',
    pullRequestNumber: 42,
    title: 'PR title',
    state: 'open',
    mergedAt: null,
    baseBranch: 'main',
    authorLogin: 'alice',
    headBranch: 'feature/alice',
    mergeConflictStatus: 'clean',
    lastConflictCheckedAt: null,
    conflictEpisodeStartedAt: null,
    conflictResolvedAt: null,
    managedConflictCommentId: null,
    managedConflictTaskId: null,
    managedConflictTaskOwnerUserId: null,
    lastActivityAt: new Date('2026-03-10T09:00:00Z'),
    firstSeenAt: new Date('2026-03-01T09:00:00Z'),
    lastReviewedCommitSha: null,
    lastReviewNeedsRemediation: null,
    ...overrides,
  };
}

function createPRDetails(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 'Fix conflict',
    body: 'Body',
    state: 'open',
    authorLogin: 'alice',
    baseBranch: 'main',
    headBranch: 'feature/alice',
    mergeable: false,
    mergeableState: 'dirty',
    ...overrides,
  };
}

function createResolveDeps(enabledWorker = true): ResolveConflictDeps {
  const deps = {
    gitHubPRClient: {
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 12345 })),
      updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 12345 })),
    },
    codeTaskRepo: {
      findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'nf' })),
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn().mockResolvedValue(ok(createTask({ id: 'task-created' }))),
      update: vi.fn().mockResolvedValue(ok(createTask({ id: 'task-created' }))),
    },
    linearIssueService: {
      ensureIssueExists: vi.fn().mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Linked',
        linearFallback: false,
        linearIssueLabels: [],
        hasChildren: false,
        linearIssueUrl: 'https://linear.app/issue/INT-123',
      }),
    },
    taskEnqueueService: {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'task-created', queuePosition: 1 })),
    },
    workerSettingsRepo: {
      getSettings: vi.fn().mockResolvedValue(ok({
        userId: 'user-1',
        workers: [{
          name: 'home-mac', url: 'https://w', cfAccessClientId: 'c',
          cfAccessClientSecret: 's', dispatchSigningSecret: 'd',
          enabled: enabledWorker,
        }],
        createdAt: '2026-03-11T09:00:00Z',
        updatedAt: '2026-03-11T09:00:00Z',
      })),
    },
    orchestratorSecret: 'orchestrator-secret',
  };
  // Register fakes in the service container per INT-1440 DoD #4, exercising the
  // repo's standardized `setServices()` wiring path. The sub-use-case functions
  // under test receive `deps` explicitly as arguments; the container
  // registration here mirrors the same reference for any transitive lookups.
  setServices(deps as unknown as ServiceContainer);
  return deps as unknown as ResolveConflictDeps;
}

function createParams(overrides: Partial<ConflictWorkflowParams> = {}): ConflictWorkflowParams {
  return {
    deps: createResolveDeps(),
    logger: createLogger(),
    repository: 'owner/repo',
    parsedRepository: { owner: 'owner', repo: 'repo' },
    eventId: 'event-1',
    existingSummary: createSummary(),
    details: createPRDetails() as never,
    accessContext: { userId: 'user-1', token: 'tok' },
    taskResolution: { latestTask: null, reusableTask: null, staleSummaryTaskId: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  randomUuidSpy.mockReturnValue('11111111-1111-4111-8111-111111111111');
});

afterEach(() => {
  randomUuidSpy.mockReset();
  resetServices();
});

describe('predicates', () => {
  it('isMergeConflictTask matches by followUpReason or hash', () => {
    expect(isMergeConflictTask({ followUpReason: 'merge_conflict', systemPromptHash: 'x' })).toBe(true);
    expect(isMergeConflictTask({ systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH })).toBe(true);
    expect(isMergeConflictTask({ systemPromptHash: 'x' })).toBe(false);
  });

  it('isReusableConflictTask only accepts matching pull_request non-archived tasks', () => {
    const base = createTask({ followUpReason: 'merge_conflict' });
    expect(isReusableConflictTask(base, 'owner/repo', 42)).toBe(true);
    expect(isReusableConflictTask({ ...base, status: 'archived' }, 'owner/repo', 42)).toBe(false);
    expect(isReusableConflictTask({ ...base, repository: 'x/y' }, 'owner/repo', 42)).toBe(false);
    expect(isReusableConflictTask({ ...base, prNumber: 100 }, 'owner/repo', 42)).toBe(false);
    expect(isReusableConflictTask({ ...base, agentType: 'ask_agent' }, 'owner/repo', 42)).toBe(false);
  });

  it('resolveConflictParentTaskId returns undefined for missing or merge conflict tasks', () => {
    expect(resolveConflictParentTaskId(null)).toBeUndefined();
    expect(resolveConflictParentTaskId(createTask({ followUpReason: 'merge_conflict' }))).toBeUndefined();
    expect(resolveConflictParentTaskId(createTask({ id: 'origin' }))).toBe('origin');
  });

  it('shouldEnsureConflictWorkflow short-circuits in various paths', () => {
    expect(shouldEnsureConflictWorkflow(createSummary({ mergeConflictStatus: 'clean' }), false)).toBe(true);
    expect(shouldEnsureConflictWorkflow(
      createSummary({ mergeConflictStatus: 'conflicting', managedConflictCommentId: 1, managedConflictTaskId: 't', managedConflictTaskOwnerUserId: 'u' }),
      true
    )).toBe(true);
    expect(shouldEnsureConflictWorkflow(createSummary({ mergeConflictStatus: 'conflicting' }), false)).toBe(true);
    expect(shouldEnsureConflictWorkflow(
      createSummary({ mergeConflictStatus: 'conflicting', managedConflictCommentId: 1, managedConflictTaskId: null, managedConflictTaskOwnerUserId: 'u' }),
      false
    )).toBe(true);
    expect(shouldEnsureConflictWorkflow(
      createSummary({ mergeConflictStatus: 'conflicting', managedConflictCommentId: 1, managedConflictTaskId: 't', managedConflictTaskOwnerUserId: 'u' }),
      false
    )).toBe(false);
  });

  it('shouldResolveTaskState honors conflicting/unknown state', () => {
    expect(shouldResolveTaskState('conflicting', createSummary())).toBe(true);
    expect(shouldResolveTaskState('unknown', createSummary({ mergeConflictStatus: 'conflicting' }))).toBe(true);
    expect(shouldResolveTaskState('clean', createSummary())).toBe(false);
  });

  it('shouldRetainExistingConflictTask returns true only for conflicting/unknown', () => {
    expect(shouldRetainExistingConflictTask('conflicting')).toBe(true);
    expect(shouldRetainExistingConflictTask('unknown')).toBe(true);
    expect(shouldRetainExistingConflictTask('clean')).toBe(false);
  });
});

describe('buildInitialWorkflowResult', () => {
  it('carries over managed IDs when status is conflicting with a reusable task', () => {
    const task = createTask({ id: 'reuse', userId: 'user-x' });
    const summary = createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 99,
      managedConflictTaskId: 'reuse',
      managedConflictTaskOwnerUserId: 'user-x',
    });
    const result = buildInitialWorkflowResult(summary, {
      latestTask: task, reusableTask: task, staleSummaryTaskId: false,
    });
    expect(result).toEqual({ commentId: 99, taskId: 'reuse', ownerUserId: 'user-x' });
  });

  it('nulls taskId when stale', () => {
    const summary = createSummary({ managedConflictTaskId: 'stale' });
    const result = buildInitialWorkflowResult(summary, {
      latestTask: null, reusableTask: null, staleSummaryTaskId: true,
    });
    expect(result.taskId).toBeNull();
  });
});

describe('resolveExistingConflictTask', () => {
  it('reuses task when managed id is reusable', async () => {
    const deps = createResolveDeps();
    const task = createTask({ followUpReason: 'merge_conflict' });
    deps.codeTaskRepo.findById = vi.fn().mockResolvedValue(ok(task));
    const logger = createLogger();
    const result = await resolveExistingConflictTask(
      deps.codeTaskRepo, createSummary({ managedConflictTaskId: task.id }),
      'owner/repo', 42, logger
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reusableTask).toEqual(task);
    }
  });

  it('marks stale when task not found', async () => {
    const deps = createResolveDeps();
    deps.codeTaskRepo.findById = vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'n' }));
    const logger = createLogger();
    const result = await resolveExistingConflictTask(
      deps.codeTaskRepo, createSummary({ managedConflictTaskId: 'old' }),
      'owner/repo', 42, logger
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.staleSummaryTaskId).toBe(true);
    }
  });

  it('returns error when findById errors with non-NOT_FOUND', async () => {
    const deps = createResolveDeps();
    deps.codeTaskRepo.findById = vi.fn().mockResolvedValue(err({ code: 'INTERNAL', message: 'x' }));
    const logger = createLogger();
    const result = await resolveExistingConflictTask(
      deps.codeTaskRepo, createSummary({ managedConflictTaskId: 'old' }),
      'owner/repo', 42, logger
    );
    expect(result.ok).toBe(false);
  });

  it('flags stale when task found but not reusable', async () => {
    const deps = createResolveDeps();
    deps.codeTaskRepo.findById = vi.fn().mockResolvedValue(ok(createTask({
      agentType: 'ask_agent',
    })));
    const logger = createLogger();
    const result = await resolveExistingConflictTask(
      deps.codeTaskRepo, createSummary({ managedConflictTaskId: 'old' }),
      'owner/repo', 42, logger
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.staleSummaryTaskId).toBe(true);
      expect(result.value.reusableTask).toBeNull();
    }
  });

  it('propagates findLatestExecutionTaskByPR error', async () => {
    const deps = createResolveDeps();
    deps.codeTaskRepo.findLatestExecutionTaskByPR = vi.fn().mockResolvedValue(
      err({ code: 'X', message: 'm' })
    );
    const logger = createLogger();
    const result = await resolveExistingConflictTask(
      deps.codeTaskRepo, createSummary(),
      'owner/repo', 42, logger
    );
    expect(result.ok).toBe(false);
  });
});

describe('createMergeConflictTask', () => {
  it('creates task and enqueues with no existingTask', async () => {
    const deps = createResolveDeps();
    const result = await createMergeConflictTask(
      deps,
      {
        logger: createLogger(),
        repository: 'owner/repo',
        eventId: 'ev-1',
        details: createPRDetails() as never,
        commentId: 1000,
        existingTask: null,
        ownerUserId: 'user-1',
      }
    );
    expect(result.ok).toBe(true);
    expect(deps.codeTaskRepo.create).toHaveBeenCalled();
    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalled();
  });

  it('parses INT-xxx from title when existingTask has no linearIssueId', async () => {
    const deps = createResolveDeps();
    await createMergeConflictTask(
      deps,
      {
        logger: createLogger(),
        repository: 'owner/repo',
        eventId: 'ev-1',
        details: createPRDetails({ title: 'INT-789 fix conflict' }) as never,
        commentId: 1000,
        existingTask: null,
        ownerUserId: 'user-1',
      }
    );
    expect(deps.linearIssueService.ensureIssueExists).toHaveBeenCalledWith(expect.objectContaining({
      linearIssueId: 'INT-789',
    }));
  });

  it('returns error when create fails', async () => {
    const deps = createResolveDeps();
    deps.codeTaskRepo.create = vi.fn().mockResolvedValue(err({ code: 'E', message: 'm' }));
    const result = await createMergeConflictTask(
      deps,
      {
        logger: createLogger(),
        repository: 'owner/repo',
        eventId: 'ev-1',
        details: createPRDetails() as never,
        commentId: 1000,
        existingTask: null,
        ownerUserId: 'user-1',
      }
    );
    expect(result.ok).toBe(false);
  });

  it('marks task failed when enqueue fails', async () => {
    const deps = createResolveDeps();
    deps.taskEnqueueService.enqueue = vi.fn().mockResolvedValue(err({ code: 'E', message: 'm' }));
    const result = await createMergeConflictTask(
      deps,
      {
        logger: createLogger(),
        repository: 'owner/repo',
        eventId: 'ev-1',
        details: createPRDetails() as never,
        commentId: 1000,
        existingTask: null,
        ownerUserId: 'user-1',
      }
    );
    expect(result.ok).toBe(false);
    expect(deps.codeTaskRepo.update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      status: 'failed',
    }));
  });

  it('passes parentTaskId when existing is not a conflict task', async () => {
    const deps = createResolveDeps();
    const existing = createTask({ id: 'origin-1' });
    await createMergeConflictTask(
      deps,
      {
        logger: createLogger(),
        repository: 'owner/repo',
        eventId: 'ev-1',
        details: createPRDetails() as never,
        commentId: 1000,
        existingTask: existing,
        ownerUserId: 'user-1',
      }
    );
    expect(deps.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      parentTaskId: 'origin-1',
    }));
  });
});

describe('executeConflictWorkflow — auto-resolvable and manual-intervention paths', () => {
  it('creates a task when a conflict workflow is required and worker is enabled (auto-resolvable)', async () => {
    const params = createParams();
    const result = await executeConflictWorkflow(params);
    expect(result.taskId).toBe('task_11111111-1111-4111-8111-111111111111');
    expect(params.deps.codeTaskRepo.create).toHaveBeenCalled();
  });

  it('emits no-worker phase when no enabled worker (manual-intervention)', async () => {
    const deps = createResolveDeps(false);
    const params = createParams({ deps });
    const result = await executeConflictWorkflow(params);
    expect(result.taskId).toBeNull();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.stringContaining('no enabled worker mapping')
    );
  });

  it('returns failed when worker settings internal error', async () => {
    const deps = createResolveDeps();
    deps.workerSettingsRepo.getSettings = vi.fn().mockResolvedValue(err({ code: 'X', message: 'm' }));
    const params = createParams({ deps });
    const result = await executeConflictWorkflow(params);
    expect(result.taskId).toBeNull();
  });

  it('returns failed when task creation fails', async () => {
    const deps = createResolveDeps();
    deps.codeTaskRepo.create = vi.fn().mockResolvedValue(err({ code: 'E', message: 'm' }));
    const params = createParams({ deps });
    const result = await executeConflictWorkflow(params);
    expect(result.taskId).toBeNull();
  });

  it('short-circuits when conflict workflow not needed', async () => {
    const deps = createResolveDeps();
    const params = createParams({
      deps,
      existingSummary: createSummary({
        mergeConflictStatus: 'conflicting',
        managedConflictCommentId: 123,
        managedConflictTaskId: 'existing-task',
        managedConflictTaskOwnerUserId: 'user-1',
      }),
    });
    const result = await executeConflictWorkflow(params);
    expect(result).toEqual({
      commentId: 123,
      taskId: 'existing-task',
      ownerUserId: 'user-1',
    });
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('reuses existing task when reusable and updates starting comment', async () => {
    const deps = createResolveDeps();
    const reusableTask = createTask({ id: 'reuse', followUpReason: 'merge_conflict' });
    const params = createParams({
      deps,
      existingSummary: createSummary({ mergeConflictStatus: 'conflicting' }),
      taskResolution: {
        latestTask: reusableTask,
        reusableTask,
        staleSummaryTaskId: false,
      },
    });
    const result = await executeConflictWorkflow(params);
    expect(result).toEqual({
      commentId: 12345,
      taskId: 'reuse',
      ownerUserId: 'user-1',
    });
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns initial result when managed comment update+create both fail', async () => {
    const deps = createResolveDeps();
    deps.gitHubPRClient.postPRComment = vi.fn().mockResolvedValue(err({ code: 'E', message: 'm' }));
    const params = createParams({ deps });
    const result = await executeConflictWorkflow(params);
    expect(result.taskId).toBeNull();
  });
});

describe('resolveConflictWorkflow', () => {
  it('posts a resolved comment and clears managed fields', async () => {
    const deps = createResolveDeps();
    const params = createParams({
      deps,
      existingSummary: createSummary({
        mergeConflictStatus: 'conflicting',
        managedConflictCommentId: 333,
      }),
    });
    const result = await resolveConflictWorkflow(params);
    expect(result).toEqual({ commentId: null, taskId: null, ownerUserId: null });
    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String), 333,
      expect.stringContaining('appears to be resolved')
    );
  });
});
