import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeTask } from '../../../../domain/models/codeTask.js';
import type { GitHubPRSummary } from '../../../../domain/models/gitHubPRSummary.js';
import {
  buildStatusOnlyUpsertInput,
  buildSummaryUpdateInput,
  classifyMergeConflictStatus,
  defaultSleep,
  detectConflictForPushedPR,
  extractPushedBranch,
  handleMergeConflictTransition,
  loadPullRequestDetails,
  reconcilePRSummaries,
  resolveGitHubAccessContext,
  upsertSummary,
  type DetectConflictDeps,
  type ProcessingTrigger,
} from '../../../../domain/usecases/mergeConflicts/detectConflicts.js';
import { resetServices, setServices, type ServiceContainer } from '../../../../services.js';

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

function createDetectDeps(): DetectConflictDeps {
  const deps = {
    gitHubPRClient: {
      getPullRequestDetails: vi.fn().mockResolvedValue(ok(createPRDetails())),
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 12345 })),
      updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 12345 })),
      listAllOpenPullRequests: vi.fn().mockResolvedValue(ok([])),
    },
    gitHubPRSummaryRepo: {
      findOpenByBaseBranch: vi.fn().mockResolvedValue(ok([])),
      findOpenByRepository: vi.fn().mockResolvedValue(ok([])),
      findAllOpen: vi.fn().mockResolvedValue(ok([])),
      findRecentlyActive: vi.fn().mockResolvedValue(ok([])),
      upsert: vi.fn().mockResolvedValue(ok(undefined)),
    },
    codeTaskRepo: {
      findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'not found' })),
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn().mockResolvedValue(ok(createTask({ id: 'task-created', status: 'queued' }))),
      update: vi.fn().mockResolvedValue(ok(createTask({ id: 'task-created', status: 'dispatched' }))),
    },
    userServiceClient: {
      resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'user-1' })),
      getOAuthToken: vi.fn().mockResolvedValue(ok({
        accessToken: 'oauth-token',
        email: 'alice@example.com',
      })),
    },
    gitHubPREventRepo: {
      findByPullRequest: vi.fn().mockResolvedValue(ok([])),
    },
    linearIssueService: {
      ensureIssueExists: vi.fn().mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Linked issue',
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
          name: 'home-mac',
          url: 'https://worker.local',
          cfAccessClientId: 'c',
          cfAccessClientSecret: 's',
          dispatchSigningSecret: 'd',
          enabled: true,
        }],
        createdAt: '2026-03-11T09:00:00Z',
        updatedAt: '2026-03-11T09:00:00Z',
      })),
    },
    allowedBots: new Set<string>(),
    orchestratorSecret: 'orchestrator-secret',
    sleep: vi.fn().mockResolvedValue(undefined),
  };
  // Register fakes in the service container per INT-1440 DoD #4, exercising the
  // repo's standardized `setServices()` wiring path. Each sub-use-case function
  // still receives `deps` directly as arguments; tests read/mutate the same
  // reference that is now reachable via `getServices()`.
  setServices(deps as unknown as ServiceContainer);
  return deps as unknown as DetectConflictDeps;
}

afterEach(() => {
  resetServices();
});

describe('extractPushedBranch', () => {
  it('returns branch name when payload has refs/heads/ ref', () => {
    expect(extractPushedBranch({ ref: 'refs/heads/main' })).toBe('main');
  });

  it('returns null for non-object payloads', () => {
    expect(extractPushedBranch(null)).toBeNull();
    expect(extractPushedBranch('string')).toBeNull();
    expect(extractPushedBranch(42)).toBeNull();
  });

  it('returns null for non-branch refs and non-string refs', () => {
    expect(extractPushedBranch({ ref: 'refs/tags/v1.0.0' })).toBeNull();
    expect(extractPushedBranch({ ref: 42 })).toBeNull();
    expect(extractPushedBranch({})).toBeNull();
  });
});

describe('classifyMergeConflictStatus', () => {
  it('maps mergeable=false to conflicting', () => {
    expect(classifyMergeConflictStatus(false)).toBe('conflicting');
  });
  it('maps mergeable=true to clean', () => {
    expect(classifyMergeConflictStatus(true)).toBe('clean');
  });
  it('maps mergeable=null to unknown', () => {
    expect(classifyMergeConflictStatus(null)).toBe('unknown');
  });
});

describe('defaultSleep', () => {
  it('resolves after at least the requested delay', async () => {
    const start = Date.now();
    await defaultSleep(15);
    const elapsed = Date.now() - start;
    // Allow small scheduling jitter; we care that it actually waited,
    // not returned synchronously.
    expect(elapsed).toBeGreaterThanOrEqual(10);
  });
});

describe('loadPullRequestDetails', () => {
  it('returns details when mergeable is resolved on first attempt', async () => {
    const deps = createDetectDeps();
    const result = await loadPullRequestDetails(
      deps, 'tok', 'owner', 'repo', 42, 2, 10
    );
    expect(result.ok).toBe(true);
  });

  it('retries when mergeable is null, returns unresolved details after retries exhausted', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      ok(createPRDetails({ mergeable: null }))
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await loadPullRequestDetails(
      { gitHubPRClient: deps.gitHubPRClient, sleep },
      'tok', 'owner', 'repo', 42, 2, 10
    );
    expect(result.ok).toBe(true);
    expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('propagates errors', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      err({ code: 'API_ERROR', message: 'boom' })
    );
    const result = await loadPullRequestDetails(
      deps, 'tok', 'owner', 'repo', 42, 1, 1
    );
    expect(result.ok).toBe(false);
  });

  it('uses defaultSleep when no sleep provided', async () => {
    const client = {
      getPullRequestDetails: vi.fn()
        .mockResolvedValueOnce(ok(createPRDetails({ mergeable: null })))
        .mockResolvedValueOnce(ok(createPRDetails({ mergeable: true }))),
    };
    const result = await loadPullRequestDetails(
      { gitHubPRClient: client }, 'tok', 'owner', 'repo', 42, 1, 1
    );
    expect(result.ok).toBe(true);
  });
});

describe('upsertSummary', () => {
  it('logs warning when upsert fails', async () => {
    const logger = createLogger();
    const repo = { upsert: vi.fn().mockResolvedValue(err({ code: 'X', message: 'm' })) };
    await upsertSummary(repo as never, {} as never, logger);
    expect(logger.warn).toHaveBeenCalled();
  });
  it('does not warn on success', async () => {
    const logger = createLogger();
    const repo = { upsert: vi.fn().mockResolvedValue(ok(undefined)) };
    await upsertSummary(repo as never, {} as never, logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('buildSummaryUpdateInput', () => {
  it('includes all managed fields for conflicting status', () => {
    const result = buildSummaryUpdateInput({
      repository: 'owner/repo',
      lastActivityAt: new Date('2026-03-11T10:00:00Z'),
      existingSummary: createSummary(),
      details: createPRDetails() as never,
      status: 'conflicting',
      workflowResult: { commentId: 1, taskId: 't1', ownerUserId: 'u1' },
    });
    expect(result.managedConflictCommentId).toBe(1);
    expect(result.managedConflictTaskId).toBe('t1');
    expect(result.managedConflictTaskOwnerUserId).toBe('u1');
    expect(result.conflictEpisodeStartedAt).toBeInstanceOf(Date);
  });

  it('clears managed fields for clean status', () => {
    const result = buildSummaryUpdateInput({
      repository: 'owner/repo',
      lastActivityAt: new Date(),
      existingSummary: createSummary({ mergeConflictStatus: 'conflicting' }),
      details: createPRDetails() as never,
      status: 'clean',
      workflowResult: { commentId: 1, taskId: 't1', ownerUserId: 'u1' },
    });
    expect(result.managedConflictCommentId).toBeNull();
    expect(result.managedConflictTaskId).toBeNull();
    expect(result.managedConflictTaskOwnerUserId).toBeNull();
    expect(result.conflictResolvedAt).toBeInstanceOf(Date);
  });

  it('preserves conflict episode when unknown follows conflicting', () => {
    const existing = createSummary({
      mergeConflictStatus: 'conflicting',
      conflictEpisodeStartedAt: new Date('2026-03-01T00:00:00Z'),
    });
    const result = buildSummaryUpdateInput({
      repository: 'owner/repo',
      lastActivityAt: new Date(),
      existingSummary: existing,
      details: createPRDetails() as never,
      status: 'unknown',
      workflowResult: { commentId: null, taskId: null, ownerUserId: null },
    });
    expect(result.conflictEpisodeStartedAt).toEqual(new Date('2026-03-01T00:00:00Z'));
  });

  it('returns null conflict episode for clean status without prior conflict', () => {
    const result = buildSummaryUpdateInput({
      repository: 'owner/repo',
      lastActivityAt: new Date(),
      existingSummary: createSummary(),
      details: createPRDetails() as never,
      status: 'clean',
      workflowResult: { commentId: null, taskId: null, ownerUserId: null },
    });
    expect(result.conflictEpisodeStartedAt).toBeNull();
  });

  it('seeds conflictEpisodeStartedAt with now when none exists', () => {
    const result = buildSummaryUpdateInput({
      repository: 'owner/repo',
      lastActivityAt: new Date(),
      existingSummary: createSummary({ conflictEpisodeStartedAt: null }),
      details: createPRDetails() as never,
      status: 'conflicting',
      workflowResult: { commentId: 1, taskId: null, ownerUserId: null },
    });
    expect(result.conflictEpisodeStartedAt).toBeInstanceOf(Date);
  });

  it('uses existing conflictEpisodeStartedAt when already set for conflicting', () => {
    const started = new Date('2026-03-01T00:00:00Z');
    const result = buildSummaryUpdateInput({
      repository: 'owner/repo',
      lastActivityAt: new Date(),
      existingSummary: createSummary({
        mergeConflictStatus: 'conflicting',
        conflictEpisodeStartedAt: started,
      }),
      details: createPRDetails() as never,
      status: 'conflicting',
      workflowResult: { commentId: 1, taskId: null, ownerUserId: null },
    });
    expect(result.conflictEpisodeStartedAt).toEqual(started);
  });

  it('returns null episode for unknown without prior conflict', () => {
    const result = buildSummaryUpdateInput({
      repository: 'owner/repo',
      lastActivityAt: new Date(),
      existingSummary: createSummary({ mergeConflictStatus: 'clean' }),
      details: createPRDetails() as never,
      status: 'unknown',
      workflowResult: { commentId: null, taskId: null, ownerUserId: null },
    });
    expect(result.conflictEpisodeStartedAt).toBeNull();
  });
});

describe('buildStatusOnlyUpsertInput', () => {
  it('returns input with just status fields', () => {
    const existing = createSummary();
    const result = buildStatusOnlyUpsertInput('owner/repo', existing, 'clean');
    expect(result.repository).toBe('owner/repo');
    expect(result.mergeConflictStatus).toBe('clean');
    expect(result.lastConflictCheckedAt).toBeInstanceOf(Date);
  });
});

describe('resolveGitHubAccessContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns context from managed owner id first', async () => {
    const deps = createDetectDeps();
    const summary = createSummary({ managedConflictTaskOwnerUserId: 'user-managed' });
    const logger = createLogger();
    const ctx = await resolveGitHubAccessContext(deps, summary, logger);
    expect(ctx).toEqual({ userId: 'user-managed', token: 'oauth-token' });
    expect(deps.userServiceClient.resolveGitHubUsername).not.toHaveBeenCalled();
  });

  it('returns null when no user can be resolved at all', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(err({
      code: 'NETWORK_ERROR',
      message: 'boom',
    }));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([]));
    const summary = createSummary({ authorLogin: 'alice' });
    const logger = createLogger();
    const ctx = await resolveGitHubAccessContext(deps, summary, logger);
    expect(ctx).toBeNull();
  });

  it('returns null when PR event lookup errors', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok(null));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(err({
      code: 'X', message: 'm',
    }));
    const summary = createSummary({ authorLogin: 'alice' });
    const logger = createLogger();
    const ctx = await resolveGitHubAccessContext(deps, summary, logger);
    expect(ctx).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('falls back to event history for opened events', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok({ userId: 'user-event' }));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([
      {
        id: 'e1', githubEventId: 1, deliveryId: 'd',
        repository: 'owner/repo', repositoryId: 1,
        pullRequestNumber: 42, pullRequestId: 1,
        eventType: 'pull_request', action: 'opened',
        senderLogin: 'event-author', senderId: 1, senderType: 'User',
        prAuthorLogin: null, title: null, body: null, state: null,
        isDraft: null, baseBranch: null, mergedAt: null,
        createdAt: new Date(), processedAt: new Date(),
        payload: {},
      },
    ]));
    deps.userServiceClient.getOAuthToken = vi.fn().mockResolvedValue(ok({
      accessToken: 'event-token', email: 'e@e.com',
    }));
    const summary = createSummary({ authorLogin: 'alice' });
    const logger = createLogger();
    const ctx = await resolveGitHubAccessContext(deps, summary, logger);
    expect(ctx).toEqual({ userId: 'user-event', token: 'event-token' });
  });

  it('returns null when fallback login resolves no user', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok(null));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([
      {
        id: 'e1', githubEventId: 1, deliveryId: 'd',
        repository: 'owner/repo', repositoryId: 1,
        pullRequestNumber: 42, pullRequestId: 1,
        eventType: 'pull_request', action: 'opened',
        senderLogin: 'event-author', senderId: 1, senderType: 'User',
        prAuthorLogin: null, title: null, body: null, state: null,
        isDraft: null, baseBranch: null, mergedAt: null,
        createdAt: new Date(), processedAt: new Date(),
        payload: {},
      },
    ]));
    const summary = createSummary({ authorLogin: null });
    const logger = createLogger();
    const ctx = await resolveGitHubAccessContext(deps, summary, logger);
    expect(ctx).toBeNull();
  });

  it('returns null when no login can be found in events', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok(null));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([]));
    const summary = createSummary({ authorLogin: null });
    const logger = createLogger();
    const ctx = await resolveGitHubAccessContext(deps, summary, logger);
    expect(ctx).toBeNull();
  });

  it('returns null when fallback token fetch fails', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok({ userId: 'user-x' }));
    deps.userServiceClient.getOAuthToken = vi.fn().mockResolvedValue(err({ code: 'E', message: 'nope' }));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([
      {
        id: 'e1', githubEventId: 1, deliveryId: 'd',
        repository: 'owner/repo', repositoryId: 1,
        pullRequestNumber: 42, pullRequestId: 1,
        eventType: 'pull_request', action: 'opened',
        senderLogin: 'event-author', senderId: 1, senderType: 'User',
        prAuthorLogin: null, title: null, body: null, state: null,
        isDraft: null, baseBranch: null, mergedAt: null,
        createdAt: new Date(), processedAt: new Date(),
        payload: {},
      },
    ]));
    const summary = createSummary({ authorLogin: null });
    const logger = createLogger();
    const ctx = await resolveGitHubAccessContext(deps, summary, logger);
    expect(ctx).toBeNull();
  });
});

describe('detectConflictForPushedPR (clean push / conflicting push)', () => {
  const trigger: ProcessingTrigger = {
    eventId: 'event-1',
    repository: 'owner/repo',
    lastActivityAt: new Date('2026-03-11T10:00:00Z'),
  };
  const parsedRepository = { owner: 'owner', repo: 'repo' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns clean for a clean push with no prior conflict', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      ok(createPRDetails({ mergeable: true }))
    );
    const summary = createSummary();
    const logger = createLogger();
    const outcome = await detectConflictForPushedPR(deps, trigger, logger, parsedRepository, summary);
    expect(outcome).toBe('clean');
    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('returns conflicting and dispatches a workflow for a conflicting push', async () => {
    const deps = createDetectDeps();
    const summary = createSummary();
    const logger = createLogger();
    const outcome = await detectConflictForPushedPR(deps, trigger, logger, parsedRepository, summary);
    expect(outcome).toBe('conflicting');
    expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).toHaveBeenCalled();
  });

  it('returns skipped when no access context can be resolved', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok(null));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([]));
    const summary = createSummary({ authorLogin: null, managedConflictTaskOwnerUserId: null });
    const logger = createLogger();
    const outcome = await detectConflictForPushedPR(deps, trigger, logger, parsedRepository, summary);
    expect(outcome).toBe('skipped');
  });

  it('returns skipped when pull request details fetch fails', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      err({ code: 'API_ERROR', message: 'nope' })
    );
    const summary = createSummary();
    const logger = createLogger();
    const outcome = await detectConflictForPushedPR(deps, trigger, logger, parsedRepository, summary);
    expect(outcome).toBe('skipped');
  });

  it('returns closed when PR is no longer open', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      ok(createPRDetails({ state: 'closed' }))
    );
    const summary = createSummary();
    const logger = createLogger();
    const outcome = await detectConflictForPushedPR(deps, trigger, logger, parsedRepository, summary);
    expect(outcome).toBe('closed');
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      state: 'closed',
    }));
  });

  it('returns skipped when resolving existing conflict task errors (non-NOT_FOUND)', async () => {
    const deps = createDetectDeps();
    deps.codeTaskRepo.findById = vi.fn().mockResolvedValue(err({ code: 'INTERNAL', message: 'x' }));
    const summary = createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictTaskId: 'task-stale',
    });
    const logger = createLogger();
    const outcome = await detectConflictForPushedPR(deps, trigger, logger, parsedRepository, summary);
    expect(outcome).toBe('skipped');
  });

  it('dispatches resolved comment when conflict is cleared', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      ok(createPRDetails({ mergeable: true }))
    );
    const summary = createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 9999,
    });
    const logger = createLogger();
    const outcome = await detectConflictForPushedPR(deps, trigger, logger, parsedRepository, summary);
    expect(outcome).toBe('clean');
    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenCalled();
  });
});

describe('handleMergeConflictTransition', () => {
  const parsedRepository = { owner: 'owner', repo: 'repo' };

  it('writes a status-only upsert when no workflow is needed', async () => {
    const deps = createDetectDeps();
    const logger = createLogger();
    const res = await handleMergeConflictTransition({
      deps, logger, repository: 'owner/repo', parsedRepository,
      existingSummary: createSummary(),
      details: createPRDetails() as never,
      newStatus: 'clean',
      needsConflictWorkflow: false,
      needsResolveWorkflow: false,
    });
    expect(res).toEqual({ mergeConflictRefreshed: 1, conflictWorkflowsTriggered: 0 });
  });

  it('writes status-only when no access context', async () => {
    const deps = createDetectDeps();
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok(null));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([]));
    const logger = createLogger();
    const res = await handleMergeConflictTransition({
      deps, logger, repository: 'owner/repo', parsedRepository,
      existingSummary: createSummary({ authorLogin: null, managedConflictTaskOwnerUserId: null }),
      details: createPRDetails() as never,
      newStatus: 'conflicting',
      needsConflictWorkflow: true,
      needsResolveWorkflow: false,
    });
    expect(res).toEqual({ mergeConflictRefreshed: 1, conflictWorkflowsTriggered: 0 });
  });

  it('runs conflict workflow when needed', async () => {
    const deps = createDetectDeps();
    const logger = createLogger();
    const res = await handleMergeConflictTransition({
      deps, logger, repository: 'owner/repo', parsedRepository,
      existingSummary: createSummary(),
      details: createPRDetails() as never,
      newStatus: 'conflicting',
      needsConflictWorkflow: true,
      needsResolveWorkflow: false,
    });
    expect(res.conflictWorkflowsTriggered).toBe(1);
  });

  it('runs resolve workflow when needed', async () => {
    const deps = createDetectDeps();
    const logger = createLogger();
    const res = await handleMergeConflictTransition({
      deps, logger, repository: 'owner/repo', parsedRepository,
      existingSummary: createSummary({
        mergeConflictStatus: 'conflicting',
        managedConflictCommentId: 777,
      }),
      details: createPRDetails({ mergeable: true }) as never,
      newStatus: 'clean',
      needsConflictWorkflow: false,
      needsResolveWorkflow: true,
    });
    expect(res.conflictWorkflowsTriggered).toBe(1);
  });

  it('does not run resolve workflow if no managed comment', async () => {
    const deps = createDetectDeps();
    const logger = createLogger();
    const res = await handleMergeConflictTransition({
      deps, logger, repository: 'owner/repo', parsedRepository,
      existingSummary: createSummary({
        mergeConflictStatus: 'conflicting',
        managedConflictCommentId: null,
      }),
      details: createPRDetails({ mergeable: true }) as never,
      newStatus: 'clean',
      needsConflictWorkflow: false,
      needsResolveWorkflow: true,
    });
    expect(res.conflictWorkflowsTriggered).toBe(0);
  });

  it('uses resolveExistingConflictTask when applicable', async () => {
    const deps = createDetectDeps();
    deps.codeTaskRepo.findById = vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'x' }));
    const logger = createLogger();
    const res = await handleMergeConflictTransition({
      deps, logger, repository: 'owner/repo', parsedRepository,
      existingSummary: createSummary({ managedConflictTaskId: 'stale' }),
      details: createPRDetails() as never,
      newStatus: 'conflicting',
      needsConflictWorkflow: true,
      needsResolveWorkflow: false,
    });
    expect(res.conflictWorkflowsTriggered).toBe(1);
  });
});

describe('reconcilePRSummaries', () => {
  it('returns empty result when findRecentlyActive fails', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      err({ code: 'X', message: 'm' })
    );
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.processed).toBe(0);
  });

  it('returns empty result when there are no summaries', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(ok([]));
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.processed).toBe(0);
  });

  it('skips invalid repository format', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary({ repository: 'bad-format' })])
    );
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.processed).toBe(0);
  });

  it('skips repo without access context', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary({ authorLogin: null, managedConflictTaskOwnerUserId: null })])
    );
    deps.userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok(null));
    deps.gitHubPREventRepo.findByPullRequest = vi.fn().mockResolvedValue(ok([]));
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('skips repo when listAllOpenPullRequests errors', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary()])
    );
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(
      err({ code: 'X', message: 'm' })
    );
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.skipped).toBe(1);
  });

  it('closes PR summary when PR is no longer open', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary()])
    );
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(ok([]));
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.closed).toBe(1);
  });

  it('re-opens summary when closed in Firestore but open on GitHub', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary({ state: 'closed' })])
    );
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(
      ok([{ number: 42, title: 't', authorLogin: 'a', baseBranch: 'main', headBranch: 'f', createdAt: 'x' }])
    );
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.reopened).toBe(1);
  });

  it('refreshes merge conflict status when changed', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary({ mergeConflictStatus: 'clean' })])
    );
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(
      ok([{ number: 42, title: 't', authorLogin: 'a', baseBranch: 'main', headBranch: 'f', createdAt: 'x' }])
    );
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.mergeConflictRefreshed).toBe(1);
  });

  it('logs getPullRequestDetails errors during reconcile', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary()])
    );
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(
      ok([{ number: 42, title: 't', authorLogin: 'a', baseBranch: 'main', headBranch: 'f', createdAt: 'x' }])
    );
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      err({ code: 'E', message: 'm' })
    );
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.mergeConflictRefreshed).toBe(0);
  });

  it('catches thrown errors during summary processing', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary()])
    );
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(
      ok([{ number: 42, title: 't', authorLogin: 'a', baseBranch: 'main', headBranch: 'f', createdAt: 'x' }])
    );
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockRejectedValue(new Error('boom'));
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.error).toBe(1);
  });

  it('skips refresh when status is unchanged', async () => {
    const deps = createDetectDeps();
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(
      ok([createSummary({ mergeConflictStatus: 'conflicting' })])
    );
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(
      ok([{ number: 42, title: 't', authorLogin: 'a', baseBranch: 'main', headBranch: 'f', createdAt: 'x' }])
    );
    deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
      ok(createPRDetails({ mergeable: false }))
    );
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.mergeConflictRefreshed).toBe(0);
  });

  it('groups summaries by repository and handles each', async () => {
    const deps = createDetectDeps();
    const s1 = createSummary({ pullRequestNumber: 1 });
    const s2 = createSummary({ pullRequestNumber: 2, repository: 'other/repo' });
    deps.gitHubPRSummaryRepo.findRecentlyActive = vi.fn().mockResolvedValue(ok([s1, s2]));
    deps.gitHubPRClient.listAllOpenPullRequests = vi.fn().mockResolvedValue(ok([]));
    const logger = createLogger();
    const result = await reconcilePRSummaries(deps, logger);
    expect(result.processed).toBe(2);
  });
});
