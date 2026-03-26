import { Timestamp } from '@google-cloud/firestore';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import type { GitHubPRSummary } from '../../../domain/models/gitHubPRSummary.js';
import { EMPTY_RECONCILE_RESULT } from '../../../domain/services/mergeConflictDetector.js';
import { createDetectMergeConflictsOnPush } from '../../../domain/usecases/detectMergeConflictsOnPush.js';

interface TestDeps {
  logger: Logger;
  gitHubPRClient: {
    getPullRequestDetails: ReturnType<typeof vi.fn>;
    postPRComment: ReturnType<typeof vi.fn>;
    updateIssueComment: ReturnType<typeof vi.fn>;
    listAllOpenPullRequests: ReturnType<typeof vi.fn>;
  };
  gitHubPRSummaryRepo: {
    findOpenByBaseBranch: ReturnType<typeof vi.fn>;
    findOpenByRepository: ReturnType<typeof vi.fn>;
    findAllOpen: ReturnType<typeof vi.fn>;
    findRecentlyActive: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  codeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByPR: ReturnType<typeof vi.fn>;
    findLatestNonReviewTaskByPR: ReturnType<typeof vi.fn>;
    findByIdForUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  userServiceClient: {
    resolveGitHubUsername: ReturnType<typeof vi.fn>;
    getOAuthToken: ReturnType<typeof vi.fn>;
  };
  gitHubPREventRepo: {
    findByPullRequest: ReturnType<typeof vi.fn>;
  };
  linearIssueService: {
    ensureIssueExists: ReturnType<typeof vi.fn>;
  };
  taskDispatcher: {
    dispatch: ReturnType<typeof vi.fn>;
    sendMessageToWorker: ReturnType<typeof vi.fn>;
  };
  taskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
  };
  logLineRepo: {
    storeBatch: ReturnType<typeof vi.fn>;
  };
  workerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  statusMirrorService: {
    mirrorStatus: ReturnType<typeof vi.fn>;
  };
  whatsappNotifier: {
    notifyTaskResumed: ReturnType<typeof vi.fn>;
  };
  allowedBots: Set<string>;
  orchestratorSecret: string;
  sleep?: ReturnType<typeof vi.fn>;
}

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function createPushEvent(ref: string): GitHubPREvent {
  return {
    id: 'push-event-1',
    githubEventId: 1,
    deliveryId: 'delivery-1',
    repository: 'intexuraos/intexuraos',
    repositoryId: 1,
    pullRequestNumber: 0,
    pullRequestId: 0,
    eventType: 'push',
    action: null,
    senderLogin: 'pusher',
    senderId: 1,
    senderType: 'User',
    prAuthorLogin: null,
    title: null,
    body: null,
    state: null,
    baseBranch: null,
    mergedAt: null,
    createdAt: new Date('2026-03-11T10:00:00Z'),
    processedAt: new Date('2026-03-11T10:00:01Z'),
    payload: { ref },
  };
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
    repository: 'intexuraos/intexuraos',
    baseBranch: 'release/2026.03',
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
    repository: 'intexuraos/intexuraos',
    pullRequestNumber: 42,
    title: 'Fix conflict',
    state: 'open',
    mergedAt: null,
    baseBranch: 'release/2026.03',
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
    ...overrides,
  };
}

function createWorkerSettings(userId = 'user-1', enabled = true): {
  userId: string;
  workers: {
    name: string;
    url: string;
    cfAccessClientId: string;
    cfAccessClientSecret: string;
    dispatchSigningSecret: string;
    enabled: boolean;
  }[];
  createdAt: string;
  updatedAt: string;
} {
  return {
    userId,
    workers: [{
      name: 'home-mac',
      url: 'https://worker.local',
      cfAccessClientId: 'client-id',
      cfAccessClientSecret: 'client-secret',
      dispatchSigningSecret: 'dispatch-secret',
      enabled,
    }],
    createdAt: '2026-03-11T09:00:00Z',
    updatedAt: '2026-03-11T09:00:00Z',
  };
}

function createPRDetails(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 'Fix conflict',
    body: 'Body',
    state: 'open',
    authorLogin: 'alice',
    baseBranch: 'release/2026.03',
    headBranch: 'feature/alice',
    mergeable: false,
    mergeableState: 'dirty',
    ...overrides,
  };
}

function createOpenPRListItem(prNumber: number): { number: number; title: string; authorLogin: string; baseBranch: string; headBranch: string; createdAt: string } {
  return {
    number: prNumber,
    title: `PR #${String(prNumber)}`,
    authorLogin: 'alice',
    baseBranch: 'release/2026.03',
    headBranch: `feature/pr-${String(prNumber)}`,
    createdAt: '2026-03-10T09:00:00Z',
  };
}

function createDeps(logger: Logger, options?: { includeSleep?: boolean }): TestDeps {
  const includeSleep = options?.includeSleep ?? true;

  return {
    logger,
    gitHubPRClient: {
      getPullRequestDetails: vi.fn().mockResolvedValue(ok(createPRDetails())),
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 12345 })),
      updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 12345 })),
      listAllOpenPullRequests: vi.fn().mockResolvedValue(ok([])),
    },
    gitHubPRSummaryRepo: {
      findOpenByBaseBranch: vi.fn().mockResolvedValue(ok([createSummary()])),
      findOpenByRepository: vi.fn().mockResolvedValue(ok([])),
      findAllOpen: vi.fn().mockResolvedValue(ok([])),
      findRecentlyActive: vi.fn().mockResolvedValue(ok([])),
      upsert: vi.fn().mockResolvedValue(ok(undefined)),
    },
    codeTaskRepo: {
      findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'not found' })),
      // findByPR satisfies the CodeTaskRepository shape but is unused by the use case
      // (lineage lookups use findLatestNonReviewTaskByPR instead).
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      findLatestNonReviewTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findByIdForUser: vi.fn(),
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
        linearIssueLabels: ['bug'],
        hasChildren: false,
        linearIssueUrl: 'https://linear.app/issue/INT-123',
      }),
    },
    taskDispatcher: {
      dispatch: vi.fn().mockResolvedValue(ok({
        dispatched: true,
        workerLocation: 'home-mac',
      })),
      sendMessageToWorker: vi.fn().mockResolvedValue(ok({ action: 'queued' })),
    },
    taskEnqueueService: {
      enqueue: vi.fn().mockResolvedValue(ok({
        taskId: 'task-created',
        queuePosition: 1,
      })),
    },
    logLineRepo: { storeBatch: vi.fn().mockResolvedValue(ok(undefined)) },
    workerSettingsRepo: {
      getSettings: vi.fn().mockResolvedValue(ok(createWorkerSettings())),
    },
    statusMirrorService: { mirrorStatus: vi.fn() },
    whatsappNotifier: { notifyTaskResumed: vi.fn() },
    allowedBots: new Set(['intexuraos-code-worker[bot]', 'claude[bot]']),
    orchestratorSecret: 'orchestrator-secret',
    ...(includeSleep ? { sleep: vi.fn().mockResolvedValue(undefined) } : {}),
  };
}

describe('createDetectMergeConflictsOnPush', () => {
  const randomUuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');

  beforeEach(() => {
    vi.clearAllMocks();
    randomUuidSpy.mockReturnValue('11111111-1111-4111-8111-111111111111');
  });

  afterEach(() => {
    randomUuidSpy.mockReset();
  });

  it('ignores pushes with invalid payload shapes or non-branch refs', async () => {
    const logger = createLogger();

    for (const payload of [null, 'refs/heads/release/2026.03', { ref: 42 }, { ref: 'refs/tags/v1.0.0' }]) {
      const deps = createDeps(logger);
      const detector = createDetectMergeConflictsOnPush(deps as never);
      const event = createPushEvent('refs/heads/release/2026.03');
      event.payload = payload as never;

      await detector.detectOnPush(event, logger);

      expect(deps.gitHubPRSummaryRepo.findOpenByBaseBranch).not.toHaveBeenCalled();
      expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    }
  });

  it('exits before GitHub calls when the pushed branch is not the base of any open PR summary', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([]));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRSummaryRepo.findOpenByBaseBranch).toHaveBeenCalledWith(
      'intexuraos/intexuraos',
      'release/2026.03'
    );
    expect(deps.userServiceClient.getOAuthToken).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
  });

  it('skips merge-conflict detection when the repository name is invalid', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    const event = createPushEvent('refs/heads/release/2026.03');
    event.repository = 'invalid-repository';

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(event, logger);

    expect(deps.gitHubPRSummaryRepo.findOpenByBaseBranch).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
  });

  it('creates a managed comment and dispatches a new pull_request task using user OAuth', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('alice');
    expect(deps.userServiceClient.getOAuthToken).toHaveBeenCalledWith('user-1', 'github');
    expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledWith(
      'oauth-token',
      'intexuraos',
      'intexuraos',
      42
    );
    expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalledTimes(1);
    expect(deps.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: 'task_11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
    });
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      repository: 'intexuraos/intexuraos',
      pullRequestNumber: 42,
      baseBranch: 'release/2026.03',
      authorLogin: 'alice',
      headBranch: 'feature/alice',
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task_11111111-1111-4111-8111-111111111111',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('warns when summary upsert fails after a successful check', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.upsert.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'summary write failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'FIRESTORE_ERROR', message: 'summary write failed' },
      }),
      'Failed to upsert merge-conflict summary'
    );
  });

  it('uses the stored managed owner user id before resolving usernames again', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      managedConflictTaskOwnerUserId: 'user-managed',
    })]));
    deps.userServiceClient.getOAuthToken
      .mockResolvedValueOnce(ok({ accessToken: 'managed-token', email: 'managed@example.com' }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.userServiceClient.getOAuthToken).toHaveBeenCalledWith('user-managed', 'github');
    expect(deps.userServiceClient.resolveGitHubUsername).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledWith(
      'managed-token',
      'intexuraos',
      'intexuraos',
      42
    );
  });

  it('falls back from a missing managed-owner token to the summary author login', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      managedConflictTaskOwnerUserId: 'user-managed',
      authorLogin: 'alice',
    })]));
    deps.userServiceClient.getOAuthToken
      .mockResolvedValueOnce(err({ code: 'CONNECTION_NOT_FOUND', message: 'missing token' }))
      .mockResolvedValueOnce(ok({ accessToken: 'author-token', email: 'alice@example.com' }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.userServiceClient.getOAuthToken).toHaveBeenNthCalledWith(1, 'user-managed', 'github');
    expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('alice');
    expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledWith(
      'author-token',
      'intexuraos',
      'intexuraos',
      42
    );
  });

  it('falls back to PR event history when summary author login is missing', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      authorLogin: null,
    })]));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([
      {
        ...createPushEvent('refs/heads/release/2026.03'),
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'event-author',
        pullRequestNumber: 42,
      },
    ]));
    deps.userServiceClient.resolveGitHubUsername.mockResolvedValue(ok({ userId: 'user-event' }));
    deps.userServiceClient.getOAuthToken.mockResolvedValue(ok({
      accessToken: 'event-token',
      email: 'event@example.com',
    }));
    deps.workerSettingsRepo.getSettings.mockResolvedValue(ok(createWorkerSettings('user-event')));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPREventRepo.findByPullRequest).toHaveBeenCalledWith(
      'intexuraos/intexuraos',
      42
    );
    expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('event-author');
    expect(deps.userServiceClient.getOAuthToken).toHaveBeenCalledWith('user-event', 'github');
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictTaskOwnerUserId: 'user-event',
    }));
  });

  it('skips a PR when resolving the summary author login fails and no fallback user can be found', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.userServiceClient.resolveGitHubUsername.mockResolvedValue(err({
      code: 'NETWORK_ERROR',
      message: 'lookup failed',
    }));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([]));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
  });

  it('skips a PR when event fallback resolves no user id', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      authorLogin: null,
      managedConflictTaskOwnerUserId: null,
    })]));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([
      {
        ...createPushEvent('refs/heads/release/2026.03'),
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'event-author',
        pullRequestNumber: 42,
      },
    ]));
    deps.userServiceClient.resolveGitHubUsername.mockResolvedValue(ok(null));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
  });

  it('skips a PR when event fallback cannot fetch an OAuth token', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      authorLogin: null,
      managedConflictTaskOwnerUserId: null,
    })]));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([
      {
        ...createPushEvent('refs/heads/release/2026.03'),
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'event-author',
        pullRequestNumber: 42,
      },
    ]));
    deps.userServiceClient.resolveGitHubUsername.mockResolvedValue(ok({ userId: 'user-event' }));
    deps.userServiceClient.getOAuthToken.mockResolvedValue(err({
      code: 'CONNECTION_NOT_FOUND',
      message: 'no token',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
  });

  it('falls back to PR event history when the summary author has no GitHub OAuth token', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.userServiceClient.getOAuthToken
      .mockResolvedValueOnce(err({ code: 'CONNECTION_NOT_FOUND', message: 'no author token' }))
      .mockResolvedValueOnce(ok({
        accessToken: 'event-token',
        email: 'event@example.com',
      }));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([
      {
        ...createPushEvent('refs/heads/release/2026.03'),
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'event-author',
        pullRequestNumber: 42,
      },
    ]));
    deps.userServiceClient.resolveGitHubUsername
      .mockResolvedValueOnce(ok({ userId: 'user-author' }))
      .mockResolvedValueOnce(ok({ userId: 'user-event' }));
    deps.workerSettingsRepo.getSettings.mockResolvedValue(ok(createWorkerSettings('user-event')));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.userServiceClient.getOAuthToken).toHaveBeenNthCalledWith(1, 'user-author', 'github');
    expect(deps.userServiceClient.getOAuthToken).toHaveBeenNthCalledWith(2, 'user-event', 'github');
    expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledWith(
      'event-token',
      'intexuraos',
      'intexuraos',
      42
    );
  });

  it('reuses an existing pull_request task when one already exists', async () => {
    const logger = createLogger();
    const existingTask = createTask({
      id: 'task-existing',
      agentType: 'pull_request',
      status: 'running',
    });
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'clean',
      managedConflictCommentId: 54321,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(ok(existingTask));
    deps.codeTaskRepo.findByIdForUser.mockResolvedValue(ok(existingTask));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.taskDispatcher.sendMessageToWorker).toHaveBeenCalledTimes(1);
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('restarts workflow when a conflicting summary is missing the managed comment id', async () => {
    const logger = createLogger();
    const existingTask = createTask({
      id: 'task-existing',
      status: 'running',
    });
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: null,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(ok(existingTask));
    deps.codeTaskRepo.findByIdForUser.mockResolvedValue(ok(existingTask));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalledTimes(1);
    expect(deps.taskDispatcher.sendMessageToWorker).toHaveBeenCalledTimes(1);
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('updates the managed comment with a resumed message when the worker resumes an existing task', async () => {
    const logger = createLogger();
    const existingTask = createTask({
      id: 'task-existing',
      status: 'failed',
    });
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'clean',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(ok(existingTask));
    deps.codeTaskRepo.findByIdForUser.mockResolvedValue(ok(existingTask));
    deps.taskDispatcher.sendMessageToWorker.mockResolvedValue(ok({ action: 'resumed' }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenLastCalledWith(
      'oauth-token',
      'intexuraos',
      'intexuraos',
      12345,
      expect.stringContaining('existing PR task has been instructed')
    );
  });

  it('recovers from a stale managed task id by reusing the latest pull request task', async () => {
    const logger = createLogger();
    const currentTask = createTask({
      id: 'task-current',
      status: 'running',
    });
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-stale',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(err({
      code: 'NOT_FOUND',
      message: 'Task task-stale not found',
    }));
    deps.codeTaskRepo.findLatestNonReviewTaskByPR.mockResolvedValue(ok(currentTask));
    deps.codeTaskRepo.findByIdForUser.mockResolvedValue(ok(currentTask));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.taskDispatcher.sendMessageToWorker).toHaveBeenCalledTimes(1);
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictTaskId: 'task-current',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('restarts workflow when the managed task is stale and no reusable pull request task exists', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-stale',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(err({
      code: 'NOT_FOUND',
      message: 'Task task-stale not found',
    }));
    deps.codeTaskRepo.findLatestNonReviewTaskByPR.mockResolvedValue(ok(null));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task_11111111-1111-4111-8111-111111111111',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('treats a loaded managed task as stale when it is no longer reusable', async () => {
    const logger = createLogger();
    const staleManagedTask = createTask({
      id: 'task-stale',
      status: 'running',
    });
    delete staleManagedTask.prNumber;
    delete staleManagedTask.agentType;
    const currentTask = createTask({
      id: 'task-current',
      status: 'running',
    });
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-stale',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(ok(staleManagedTask));
    deps.codeTaskRepo.findLatestNonReviewTaskByPR.mockResolvedValue(ok(currentTask));
    deps.codeTaskRepo.findByIdForUser.mockResolvedValue(ok(currentTask));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-stale',
        taskPrNumber: null,
        taskAgentType: null,
      }),
      'Stored merge-conflict task is stale'
    );
  });

  it('skips a PR when latest task lookup by PR fails', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findLatestNonReviewTaskByPR.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'lookup failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
  });

  it('records a comment-only conflict when OAuth exists but the owner has no enabled worker', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.workerSettingsRepo.getSettings.mockResolvedValue(ok(createWorkerSettings('user-1', false)));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('records a failed workflow when worker settings cannot be loaded', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.workerSettingsRepo.getSettings.mockResolvedValue(err({
      code: 'internal_error',
      message: 'worker repo failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenLastCalledWith(
      'oauth-token',
      'intexuraos',
      'intexuraos',
      12345,
      expect.stringContaining('could not be started')
    );
  });

  it('skips a PR without mutating state when no OAuth-backed user can be resolved', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.userServiceClient.resolveGitHubUsername.mockResolvedValue(ok(null));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([]));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('closes summary when PR details show state is not open', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({
      mergeable: true,
      state: 'closed',
    })));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'closed' }),
    );
    // No conflict comment or task should be created for a closed PR
    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('updates the managed comment and clears conflict metadata when conflicts are resolved', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
      conflictEpisodeStartedAt: new Date('2026-03-11T09:30:00Z'),
    })]));
    deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({
      mergeable: true,
      mergeableState: 'clean',
    })));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenCalledTimes(1);
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      mergeConflictStatus: 'clean',
      managedConflictCommentId: null,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: null,
    }));
  });

  it('preserves a null conflictEpisodeStartedAt when mergeability stays unknown', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 33333,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
      conflictEpisodeStartedAt: null,
    })]));
    deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({
      mergeable: null,
      mergeableState: null,
    })));

    const detector = createDetectMergeConflictsOnPush({
      ...deps,
      mergeabilityRetries: 0,
    } as never);

    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      mergeConflictStatus: 'unknown',
      conflictEpisodeStartedAt: null,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('preserves existing workflow metadata when mergeability stays unknown without re-entering the workflow', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'unknown',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({
      mergeable: null,
      mergeableState: null,
    })));

    const detector = createDetectMergeConflictsOnPush({
      ...deps,
      mergeabilityRetries: 0,
    } as never);

    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.codeTaskRepo.findById).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.findByPR).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      mergeConflictStatus: 'unknown',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('retries mergeability checks before clearing a resolved conflict', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    const sleep = vi.fn().mockResolvedValue(undefined);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
      conflictEpisodeStartedAt: new Date('2026-03-11T09:30:00Z'),
    })]));
    deps.gitHubPRClient.getPullRequestDetails
      .mockResolvedValueOnce(ok(createPRDetails({ mergeable: null, mergeableState: null })))
      .mockResolvedValueOnce(ok(createPRDetails({ mergeable: true, mergeableState: 'clean' })));

    const detector = createDetectMergeConflictsOnPush({
      ...deps,
      sleep,
      mergeabilityRetries: 1,
      retryDelayMs: 25,
    } as never);

    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(sleep).toHaveBeenCalledWith(25);
    expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledTimes(2);
  });

  it('uses the default sleep helper when no custom sleep is provided', async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const deps = createDeps(logger, { includeSleep: false });
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
      conflictEpisodeStartedAt: new Date('2026-03-11T09:30:00Z'),
    })]));
    deps.gitHubPRClient.getPullRequestDetails
      .mockResolvedValueOnce(ok(createPRDetails({ mergeable: null, mergeableState: null })))
      .mockResolvedValueOnce(ok(createPRDetails({ mergeable: true, mergeableState: 'clean' })));

    const detector = createDetectMergeConflictsOnPush({
      ...deps,
      mergeabilityRetries: 1,
      retryDelayMs: 25,
    } as never);

    const detectPromise = detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);
    await vi.advanceTimersByTimeAsync(25);
    await detectPromise;
    vi.useRealTimers();

    expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledTimes(2);
  });

  it('does not restart workflow when the PR remains conflicting with an active managed task', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
      conflictEpisodeStartedAt: new Date('2026-03-11T09:30:00Z'),
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(ok(createTask({
      id: 'task-existing',
      status: 'running',
    })));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('restarts workflow when a conflicting summary has a managed owner but no managed task id', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.gitHubPRClient.updateIssueComment.mockResolvedValue(ok({ commentId: 12345 }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenCalledTimes(2);
    expect(deps.codeTaskRepo.create).toHaveBeenCalledTimes(1);
  });

  it('skips merge-conflict detection when loading open summaries fails', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'boom',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.userServiceClient.getOAuthToken).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
  });

  it('logs and skips a PR when loading mergeability details fails', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(err({
      code: 'API_ERROR',
      message: 'details failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('skips a PR when the stored managed task cannot be loaded due to repository failure', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-stale',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'read failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
  });

  it('skips a PR when PR-event lookup fails during OAuth fallback', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      authorLogin: null,
      managedConflictTaskOwnerUserId: null,
    })]));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'events failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
  });

  it('skips a PR when event fallback cannot find an author login', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      authorLogin: null,
      managedConflictTaskOwnerUserId: null,
    })]));
    deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([
      {
        ...createPushEvent('refs/heads/release/2026.03'),
        eventType: 'issue_comment',
        senderLogin: '',
        pullRequestNumber: 42,
      },
    ]));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
  });

  it('falls back to creating a managed comment when updating the existing one fails', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 12345,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.gitHubPRClient.updateIssueComment.mockResolvedValueOnce(err({
      code: 'NOT_FOUND',
      message: 'missing comment',
    }));
    deps.gitHubPRClient.postPRComment.mockResolvedValueOnce(ok({ commentId: 67890 }));
    deps.workerSettingsRepo.getSettings.mockResolvedValue(ok(createWorkerSettings('user-1', false)));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictCommentId: 67890,
    }));
  });

  it('keeps workflow metadata empty when creating the managed comment fails', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRClient.postPRComment.mockResolvedValue(err({
      code: 'API_ERROR',
      message: 'comment failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.workerSettingsRepo.getSettings).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: null,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: null,
    }));
  });

  it('updates the comment with a failure state when sending instructions to an existing task fails', async () => {
    const logger = createLogger();
    const existingTask = createTask({
      id: 'task-existing',
      status: 'running',
    });
    const deps = createDeps(logger);
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'clean',
      managedConflictCommentId: 12345,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(ok(existingTask));
    deps.codeTaskRepo.findByIdForUser.mockResolvedValue(ok(existingTask));
    deps.taskDispatcher.sendMessageToWorker.mockResolvedValue(err({
      code: 'worker_error',
      message: 'nope',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenLastCalledWith(
      'oauth-token',
      'intexuraos',
      'intexuraos',
      12345,
      expect.stringContaining('could not be started')
    );
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('marks the workflow failed when task creation fails before dispatch', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.codeTaskRepo.create.mockResolvedValue(err({
      code: 'FIRESTORE_ERROR',
      message: 'create failed',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.taskEnqueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenLastCalledWith(
      'oauth-token',
      'intexuraos',
      'intexuraos',
      12345,
      expect.stringContaining('could not be started')
    );
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictCommentId: 12345,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('marks the workflow failed when task enqueue fails after task creation', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.taskEnqueueService.enqueue.mockResolvedValue(err({
      code: 'queue_full',
      message: 'queue full',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.codeTaskRepo.update).toHaveBeenCalledWith(
      'task_11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        status: 'failed',
        error: { code: 'queue_full', message: 'queue full' },
      })
    );
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('does not retry task creation after ACTIVE_TASK_EXISTS', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({
      title: 'INT-777 Resolve merge issue',
    })));
    deps.codeTaskRepo.create.mockResolvedValue(err({
      code: 'ACTIVE_TASK_EXISTS',
      message: 'already active',
    }));

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.codeTaskRepo.create).toHaveBeenCalledTimes(1);
    expect(deps.taskEnqueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  it('inherits linearIssueId from the latest non-review task even when newer review tasks exist', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    deps.codeTaskRepo.findByPR.mockResolvedValue(ok(createTask({
      id: 'task-review-newest',
      agentType: 'review',
      status: 'running',
      linearIssueId: 'INT-999',
    })));
    deps.codeTaskRepo.findLatestNonReviewTaskByPR.mockResolvedValue(ok(createTask({
      id: 'task-execution-existing',
      agentType: 'execution',
      status: 'running',
      linearIssueId: 'INT-555',
    })));
    deps.linearIssueService.ensureIssueExists.mockResolvedValue({
      linearIssueId: 'INT-555',
      linearIssueTitle: 'Linked issue',
      linearFallback: false,
      linearIssueLabels: ['pr-comment'],
      hasChildren: false,
      linearIssueUrl: 'https://linear.app/issue/INT-555',
    });

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    const createCall = deps.codeTaskRepo.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(deps.codeTaskRepo.findLatestNonReviewTaskByPR).toHaveBeenCalledWith('intexuraos/intexuraos', 42);
    expect(deps.codeTaskRepo.findByPR).not.toHaveBeenCalled();
    expect(createCall?.['linearIssueId']).toBe('INT-555');
    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: 'task_11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
    });
  });

  it('treats review-only history as a fresh conflict workflow start', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);

    const detector = createDetectMergeConflictsOnPush(deps as never);
    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.codeTaskRepo.findLatestNonReviewTaskByPR).toHaveBeenCalledWith('intexuraos/intexuraos', 42);
    expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenLastCalledWith(
      'oauth-token',
      'intexuraos',
      'intexuraos',
      12345,
      expect.stringContaining('Automated conflict resolution has started.')
    );
  });

  it('preserves an active conflict episode when mergeability remains unknown after retries', async () => {
    const logger = createLogger();
    const deps = createDeps(logger);
    const existingStartedAt = new Date('2026-03-11T09:15:00Z');
    deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([createSummary({
      mergeConflictStatus: 'conflicting',
      managedConflictCommentId: 33333,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
      conflictEpisodeStartedAt: existingStartedAt,
    })]));
    deps.codeTaskRepo.findById.mockResolvedValue(ok(createTask({
      id: 'task-existing',
      status: 'running',
    })));
    deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({
      mergeable: null,
      mergeableState: null,
    })));

    const detector = createDetectMergeConflictsOnPush({
      ...deps,
      mergeabilityRetries: 0,
    } as never);

    await detector.detectOnPush(createPushEvent('refs/heads/release/2026.03'), logger);

    expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      mergeConflictStatus: 'unknown',
      conflictEpisodeStartedAt: existingStartedAt,
      managedConflictCommentId: 33333,
      managedConflictTaskId: 'task-existing',
      managedConflictTaskOwnerUserId: 'user-1',
    }));
  });

  describe('bot login remapping', () => {
    it('remaps bot authorLogin to repo owner on personal fork', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);

      deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([
        createSummary({
          repository: 'pbuchman/intexuraos',
          authorLogin: 'intexuraos-code-worker[bot]',
          managedConflictTaskOwnerUserId: null,
        }),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails()));

      const event = createPushEvent('refs/heads/release/2026.03');
      event.repository = 'pbuchman/intexuraos';
      const detector = createDetectMergeConflictsOnPush(deps as never);
      await detector.detectOnPush(event, logger);

      expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('pbuchman');
    });

    it('remaps bot fallback login from event history to repo owner on personal fork', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);

      deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([
        createSummary({
          repository: 'pbuchman/intexuraos',
          authorLogin: null,
          managedConflictTaskOwnerUserId: null,
        }),
      ]));
      deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([
        {
          id: 'ev-1',
          githubEventId: 10,
          deliveryId: null,
          repository: 'pbuchman/intexuraos',
          repositoryId: 1,
          pullRequestNumber: 42,
          pullRequestId: 100,
          eventType: 'pull_request',
          action: 'opened',
          senderLogin: 'intexuraos-code-worker[bot]',
          senderId: 99,
          senderType: 'Bot',
          prAuthorLogin: null,
          title: null,
          body: null,
          state: null,
          baseBranch: null,
          mergedAt: null,
          createdAt: new Date('2026-03-11T10:00:00Z'),
          processedAt: new Date('2026-03-11T10:00:01Z'),
          payload: {},
        } satisfies GitHubPREvent,
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails()));

      const event = createPushEvent('refs/heads/release/2026.03');
      event.repository = 'pbuchman/intexuraos';
      const detector = createDetectMergeConflictsOnPush(deps as never);
      await detector.detectOnPush(event, logger);

      expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('pbuchman');
    });

    it('does NOT remap bot login on org repos', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);

      deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([
        createSummary({
          repository: 'intexuraos/intexuraos',
          authorLogin: 'intexuraos-code-worker[bot]',
          managedConflictTaskOwnerUserId: null,
        }),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails()));

      const event = createPushEvent('refs/heads/release/2026.03');
      const detector = createDetectMergeConflictsOnPush(deps as never);
      await detector.detectOnPush(event, logger);

      expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('intexuraos-code-worker[bot]');
    });

    it('does NOT remap non-bot login on personal fork', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);

      deps.gitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([
        createSummary({
          repository: 'pbuchman/intexuraos',
          authorLogin: 'alice',
          managedConflictTaskOwnerUserId: null,
        }),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails()));

      const event = createPushEvent('refs/heads/release/2026.03');
      event.repository = 'pbuchman/intexuraos';
      const detector = createDetectMergeConflictsOnPush(deps as never);
      await detector.detectOnPush(event, logger);

      expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('alice');
    });
  });

  describe('reconcile()', () => {
    it('returns empty result when findRecentlyActive fails', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'query failed',
      }));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(EMPTY_RECONCILE_RESULT);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.anything() }),
        expect.stringContaining('Failed to load PR summaries')
      );
      expect(deps.gitHubPRClient.listAllOpenPullRequests).not.toHaveBeenCalled();
    });

    it('returns empty result when there are no tracked summaries', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(EMPTY_RECONCILE_RESULT);
      expect(deps.gitHubPRClient.listAllOpenPullRequests).not.toHaveBeenCalled();
    });

    it('closes open summary when PR is not in GitHub open list', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ processed: 1, closed: 1, reopened: 0 }));
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'closed', pullRequestNumber: 10 }),
      );
      // Closed PRs don't get mergeability checks
      expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    });

    it('skips already-closed summary when PR is not in GitHub open list', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'closed' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      // Already closed — no state change, but still counted as examined
      expect(result).toEqual(expect.objectContaining({ processed: 1, closed: 0 }));
      expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    });

    it('reopens closed summary when PR is in GitHub open list', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'closed', mergeConflictStatus: 'conflicting' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      // mergeable: false → 'conflicting' matches existing, so no mergeConflictRefresh
      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ processed: 1, reopened: 1, closed: 0, mergeConflictRefreshed: 0 }));
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'open', pullRequestNumber: 10 }),
      );
    });

    it('skips state upsert for already-open summary but refreshes mergeability and triggers workflow', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'clean' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      // Default mock returns mergeable: false → 'conflicting', different from 'clean'
      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      // State didn't change (already open), but mergeConflictStatus was refreshed + workflow triggered
      expect(result).toEqual(expect.objectContaining({
        processed: 1,
        reopened: 0,
        closed: 0,
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 1,
      }));
      expect(deps.gitHubPRClient.getPullRequestDetails).toHaveBeenCalledTimes(1);
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          mergeConflictStatus: 'conflicting',
          pullRequestNumber: 10,
          managedConflictCommentId: 12345,
          managedConflictTaskOwnerUserId: 'user-1',
        }),
      );
    });

    it('handles mixed state transitions across summaries', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open' }),   // will be closed
        createSummary({ pullRequestNumber: 11, state: 'closed' }), // will be reopened
        createSummary({ pullRequestNumber: 12, state: 'open' }),   // stays open
      ]));
      // Only PRs 11 and 12 are open on GitHub
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(11),
        createOpenPRListItem(12),
      ]));
      // Return mergeable: true so mergeConflictStatus stays 'clean' (no refresh needed)
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: true })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      // 3 examined: 1 closed + 1 reopened + 1 already-open no-op; mergeability checked but no change
      expect(result).toEqual(expect.objectContaining({ processed: 3, closed: 1, reopened: 1, mergeConflictRefreshed: 0 }));
    });

    it('skips repo with invalid repository format', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ repository: 'bad-repo-no-slash', pullRequestNumber: 5, state: 'open' }),
        createSummary({ pullRequestNumber: 42, state: 'open' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'bad-repo-no-slash' }),
        expect.stringContaining('invalid repository')
      );
      // Only the valid-repo summary is processed (closed because not in GitHub list)
      expect(result).toEqual(expect.objectContaining({ processed: 1, closed: 1 }));
    });

    it('preserves lastActivityAt from the summary', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      const originalActivityAt = new Date('2026-03-10T09:00:00Z');
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ lastActivityAt: originalActivityAt, state: 'open' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      await detector.reconcile(logger);

      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ lastActivityAt: originalActivityAt }),
      );
    });

    it('skips entire repo when no OAuth-backed user found', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, authorLogin: null, managedConflictTaskOwnerUserId: null, state: 'open' }),
      ]));
      deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ processed: 1, skipped: 1 }));
      expect(deps.gitHubPRClient.listAllOpenPullRequests).not.toHaveBeenCalled();
    });

    it('skips entire repo when listAllOpenPullRequests fails', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open' }),
        createSummary({ pullRequestNumber: 11, state: 'open' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(err({
        code: 'API_ERROR' as const,
        message: 'GitHub API error',
      }));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ processed: 2, skipped: 2, closed: 0 }));
      expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    });

    it('groups by repo and calls listAllOpenPullRequests once per repo', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ repository: 'org/repo-a', pullRequestNumber: 1, state: 'open' }),
        createSummary({ repository: 'org/repo-a', pullRequestNumber: 2, state: 'open' }),
        createSummary({ repository: 'org/repo-b', pullRequestNumber: 3, state: 'open' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests
        .mockResolvedValueOnce(ok([]))
        .mockResolvedValueOnce(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(deps.gitHubPRClient.listAllOpenPullRequests).toHaveBeenCalledTimes(2);
      // All 3 open summaries are closed (not in GitHub lists)
      expect(result).toEqual(expect.objectContaining({ processed: 3, closed: 3 }));
    });

    it('reuses repo-level token — resolves once per repo, not per PR', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open' }),
        createSummary({ pullRequestNumber: 11, state: 'open' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      await detector.reconcile(logger);

      // resolveGitHubUsername called once for the repo, not per summary
      expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledTimes(1);
    });

    it('falls back to second summary when first has no OAuth token', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, authorLogin: null, managedConflictTaskOwnerUserId: null, state: 'open' }),
        createSummary({ pullRequestNumber: 11, authorLogin: 'alice', state: 'open' }),
      ]));
      deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      // Both open summaries closed (not in GitHub list)
      expect(result).toEqual(expect.objectContaining({ processed: 2, closed: 2, skipped: 0 }));
      expect(deps.gitHubPRClient.listAllOpenPullRequests).toHaveBeenCalledTimes(1);
    });

    it('skips entire repo when all summaries fail token resolution', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, authorLogin: null, managedConflictTaskOwnerUserId: null, state: 'open' }),
        createSummary({ pullRequestNumber: 11, authorLogin: null, managedConflictTaskOwnerUserId: null, state: 'open' }),
      ]));
      deps.gitHubPREventRepo.findByPullRequest.mockResolvedValue(ok([]));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ processed: 2, skipped: 2 }));
      expect(deps.gitHubPRClient.listAllOpenPullRequests).not.toHaveBeenCalled();
    });

    it('counts error when upsert throws during state transition', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([]));
      deps.gitHubPRSummaryRepo.upsert.mockRejectedValue(new Error('Firestore crash'));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ processed: 1, error: 1 }));
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 10 }),
        expect.stringContaining('Unhandled error processing PR summary in reconcile')
      );
    });

    it('refreshes mergeConflictStatus from clean to conflicting and triggers workflow for open PRs', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'clean' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: false })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 1,
      }));
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequestNumber: 10,
          mergeConflictStatus: 'conflicting',
          lastConflictCheckedAt: expect.any(Date),
          managedConflictCommentId: 12345,
        }),
      );
    });

    it('refreshes mergeConflictStatus from conflicting to clean without resolve workflow when no managed comment', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        // No managedConflictCommentId → resolve workflow won't fire
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'conflicting' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: true })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 0,
      }));
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequestNumber: 10,
          mergeConflictStatus: 'clean',
          conflictResolvedAt: expect.any(Date),
        }),
      );
      expect(deps.gitHubPRClient.updateIssueComment).not.toHaveBeenCalled();
    });

    it('skips mergeability refresh when status is already correct', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'conflicting' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: false })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ mergeConflictRefreshed: 0 }));
      expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    });

    it('skips mergeability refresh when GitHub returns unknown (mergeable: null)', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'clean' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: null })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      // unknown status is not written — we preserve the existing value
      expect(result).toEqual(expect.objectContaining({ mergeConflictRefreshed: 0 }));
      expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    });

    it('warns and skips mergeability refresh when getPullRequestDetails fails', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'clean' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(err({
        code: 'API_ERROR' as const,
        message: 'rate limited',
      }));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ mergeConflictRefreshed: 0 }));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 10 }),
        expect.stringContaining('Failed to fetch PR details for mergeability refresh')
      );
      expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    });

    it('triggers conflict workflow when reconcile detects clean-to-conflicting transition', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'clean' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ number: 10, mergeable: false })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 1,
      }));
      // Conflict comment created
      expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalledTimes(1);
      // Task spawned
      expect(deps.codeTaskRepo.create).toHaveBeenCalledTimes(1);
      // Full summary upsert with workflow fields
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequestNumber: 10,
          mergeConflictStatus: 'conflicting',
          managedConflictCommentId: 12345,
          managedConflictTaskId: expect.any(String),
          managedConflictTaskOwnerUserId: 'user-1',
        }),
      );
    });

    it('triggers resolve workflow when reconcile detects conflicting-to-clean transition', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({
          pullRequestNumber: 10,
          state: 'open',
          mergeConflictStatus: 'conflicting',
          managedConflictCommentId: 999,
          managedConflictTaskId: 'task-old',
          managedConflictTaskOwnerUserId: 'user-1',
        }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ number: 10, mergeable: true })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 1,
      }));
      // Existing comment updated with "resolved" body
      expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenCalledTimes(1);
      expect(deps.gitHubPRClient.updateIssueComment).toHaveBeenCalledWith(
        'oauth-token',
        'intexuraos',
        'intexuraos',
        999,
        expect.stringContaining('resolved'),
      );
    });

    it('skips conflict workflow when per-summary access context is unavailable', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        // First summary has valid auth → used to get repo-level token
        createSummary({ pullRequestNumber: 9, state: 'open', mergeConflictStatus: 'conflicting' }),
        // Second summary has unknown author → per-summary access will fail
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'clean', authorLogin: 'unknown-user' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(9),
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: false })));
      // Resolve alice (PR #9) → ok, unknown-user (PR #10) → null
      deps.userServiceClient.resolveGitHubUsername.mockImplementation((login: string) =>
        login === 'alice'
          ? Promise.resolve(ok({ userId: 'user-1' }))
          : Promise.resolve(ok(null))
      );

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      // PR #9 stays conflicting (no transition) → no workflow
      // PR #10 transitions clean→conflicting but no access context → no workflow, status-only upsert
      expect(result).toEqual(expect.objectContaining({ conflictWorkflowsTriggered: 0 }));
      // Only the clean→conflicting transition triggers an upsert
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ pullRequestNumber: 10, mergeConflictStatus: 'conflicting' }),
      );
    });

    it('does not trigger workflow when status stays conflicting', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'conflicting' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: false })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({ conflictWorkflowsTriggered: 0 }));
      expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
      expect(deps.gitHubPRSummaryRepo.upsert).not.toHaveBeenCalled();
    });

    it('generates synthetic eventId for reconcile-triggered workflows', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: 'clean' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ number: 10, mergeable: false })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      await detector.reconcile(logger);

      expect(deps.codeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: expect.stringMatching(/^reconcile-\d+-pr\d+$/) }),
      );
    });

    it('performs status-only upsert when status changes but no workflow is needed (null to clean)', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'open', mergeConflictStatus: null }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: true })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 0,
      }));
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequestNumber: 10,
          mergeConflictStatus: 'clean',
          lastConflictCheckedAt: expect.any(Date),
        }),
      );
      // No workflow dispatched — no comment posted, no task created
      expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
      expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    });

    it('continues with default task resolution when resolveExistingConflictTask fails', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({
          pullRequestNumber: 10,
          state: 'open',
          mergeConflictStatus: 'clean',
          managedConflictTaskId: 'task-stale',
        }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: false })));
      // findById returns a non-NOT_FOUND error → resolveExistingConflictTask returns err
      deps.codeTaskRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'db failure' }));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      // Workflow still triggers with default task resolution
      expect(result).toEqual(expect.objectContaining({
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 1,
      }));
      expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalled();
    });

    it('refreshes mergeability for reopened PRs and triggers conflict workflow', async () => {
      const logger = createLogger();
      const deps = createDeps(logger);
      deps.gitHubPRSummaryRepo.findRecentlyActive.mockResolvedValue(ok([
        createSummary({ pullRequestNumber: 10, state: 'closed', mergeConflictStatus: 'clean' }),
      ]));
      deps.gitHubPRClient.listAllOpenPullRequests.mockResolvedValue(ok([
        createOpenPRListItem(10),
      ]));
      deps.gitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(createPRDetails({ mergeable: false })));

      const detector = createDetectMergeConflictsOnPush(deps as never);
      const result = await detector.reconcile(logger);

      expect(result).toEqual(expect.objectContaining({
        reopened: 1,
        mergeConflictRefreshed: 1,
        conflictWorkflowsTriggered: 1,
      }));
      // First upsert for state reopen, second for mergeability refresh + workflow
      expect(deps.gitHubPRSummaryRepo.upsert).toHaveBeenCalledTimes(2);
    });
  });
});
