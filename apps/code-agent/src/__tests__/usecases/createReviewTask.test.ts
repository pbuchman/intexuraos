/**
 * Tests for createReviewTask use case.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { UserLookupService } from '../../domain/ports/userLookupService.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createReviewTask, type CreateReviewTaskDeps } from '../../domain/usecases/createReviewTask.js';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createFakeLinearAgentClient(): LinearAgentClient {
  return {
    createIssue: vi.fn().mockResolvedValue(ok({
      issueId: 'issue-id-300',
      issueIdentifier: 'INT-300',
      issueTitle: 'Created issue',
      issueUrl: 'https://linear.app/INT-300',
    })),
    updateIssueState: vi.fn().mockResolvedValue(ok(undefined)),
    validateIssue: vi.fn().mockResolvedValue(ok(undefined)),
    generateTitle: vi.fn().mockResolvedValue(ok({ title: 'Generated', issueType: 'feature' as const })),
    addComment: vi.fn().mockResolvedValue(ok({ commentId: 'c-1' })),
    getIssueTree: vi.fn().mockResolvedValue(ok({ root: { id: '1', identifier: 'INT-1', url: '', parentId: null, labels: [], assigneeId: null, state: 'backlog' }, descendants: [] })),
    getIssueForDisplay: vi.fn().mockResolvedValue(ok(null)),
  } as unknown as LinearAgentClient;
}

function createFakeDeps(overrides: Partial<CreateReviewTaskDeps> = {}): CreateReviewTaskDeps {
  return {
    logger: createFakeLogger(),
    codeTaskRepo: {
      create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      findById: vi.fn().mockResolvedValue(ok(null)),
      findByUser: vi.fn().mockResolvedValue(ok([])),
      update: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as CodeTaskRepository,
    userLookupService: {
      resolveByGitHubUsername: vi.fn().mockResolvedValue(ok({
        userId: 'user-1',
        worker: {
          name: 'worker-1',
          url: 'https://worker.example.com',
          cfAccessClientId: 'cf-id',
          cfAccessClientSecret: 'cf-secret',
          dispatchSigningSecret: 'dispatch-secret',
          workerType: 'auto' as const,
          enabled: true,
        },
      })),
    } as unknown as UserLookupService,
    taskDispatcher: {
      dispatch: vi.fn().mockResolvedValue(ok({
        dispatched: true,
        workerLocation: 'worker-1',
      })),
    } as unknown as TaskDispatcherService,
    linearAgentClient: createFakeLinearAgentClient(),
    orchestratorSecret: 'test-secret',
    serviceUrl: 'https://code-agent.example.com',
    ...overrides,
  };
}

describe('createReviewTask', () => {
  it('creates task with agentType review and dispatches', async () => {
    const deps = createFakeDeps();
    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality', 'security'],
      eventId: 'evt-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskId).toBe('task-review-1');
    }

    expect(deps.taskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'review',
        systemPromptHash: 'review-auto',
        webhookUrl: 'https://code-agent.example.com/internal/webhooks/task-complete',
      })
    );
  });

  it('does not include pr-comment label', async () => {
    const deps = createFakeDeps();
    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-2',
    });

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      const dispatchRequest = dispatchCall[0];
      expect(dispatchRequest.linearIssueLabels).not.toContain('pr-comment');
    }
  });

  it('includes review types in prompt', async () => {
    const deps = createFakeDeps();
    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality', 'security', 'architecture'],
      eventId: 'evt-3',
    });

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      const dispatchRequest = dispatchCall[0];
      expect(dispatchRequest.prompt).toContain('code_quality');
      expect(dispatchRequest.prompt).toContain('security');
      expect(dispatchRequest.prompt).toContain('architecture');
    }
  });

  it('returns error when user lookup fails', async () => {
    const deps = createFakeDeps({
      userLookupService: {
        resolveByGitHubUsername: vi.fn().mockResolvedValue(
          err({ code: 'USER_NOT_FOUND' as const, message: 'Unknown user' })
        ),
      } as unknown as UserLookupService,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'unknown',
      reviewTypes: ['code_quality'],
      eventId: 'evt-4',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('user_not_found');
    }
  });

  it('returns task_creation_failed when codeTaskRepo.create fails', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(
          err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
        ),
      } as unknown as CodeTaskRepository,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-6',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_creation_failed');
    }
  });

  it('returns no_workers_configured when user lookup returns NO_ENABLED_WORKER', async () => {
    const deps = createFakeDeps({
      userLookupService: {
        resolveByGitHubUsername: vi.fn().mockResolvedValue(
          err({ code: 'NO_ENABLED_WORKER' as const, message: 'No workers enabled for user' })
        ),
      } as unknown as UserLookupService,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-7',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no_workers_configured');
    }
  });

  it('uses provided baseBranch instead of default main', async () => {
    const deps = createFakeDeps();
    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-8',
      baseBranch: 'development',
    });

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
    expect(createCall).toBeDefined();
    if (createCall !== undefined) {
      expect(createCall[0].baseBranch).toBe('development');
    }

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      expect(dispatchCall[0].baseBranch).toBe('development');
    }
  });

  it('returns error when dispatch fails', async () => {
    const deps = createFakeDeps({
      taskDispatcher: {
        dispatch: vi.fn().mockResolvedValue(
          err({ code: 'QUEUE_FULL' as const, message: 'Queue full' })
        ),
      } as unknown as TaskDispatcherService,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-5',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('dispatch_failed');
    }
  });

  describe('Linear issue linking', () => {
    it('copies linearIssueId from existing PR task', async () => {
      const deps = createFakeDeps({
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
          findByPR: vi.fn().mockResolvedValue(ok({ id: 'task-existing', linearIssueId: 'INT-100' })),
          findById: vi.fn().mockResolvedValue(ok(null)),
          findByUser: vi.fn().mockResolvedValue(ok([])),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
      });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-1',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-100');
      }
    });

    it('extracts linearIssueId from PR title', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-2',
        prTitle: '[INT-200] Fix bug',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-200');
      }
      expect(deps.linearAgentClient?.createIssue).not.toHaveBeenCalled();
    });

    it('creates new Linear issue when no existing task and no title match', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-3',
        prTitle: 'Fix bug',
      });

      expect(deps.linearAgentClient?.createIssue).toHaveBeenCalledWith({
        userId: 'user-1',
        title: 'Fix bug',
        description: 'Automated PR review for PR #42 in intexuraos/intexuraos',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-300');
      }
    });

    it('proceeds without linearIssueId when linearAgentClient not provided', async () => {
      const { linearAgentClient: _removed, ...depsWithout } = createFakeDeps();
      const deps = depsWithout as CreateReviewTaskDeps;

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-4',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBeUndefined();
      }
    });

    it('proceeds without linearIssueId when findByPR and createIssue both fail', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.createIssue).mockResolvedValue(
        err({ code: 'UNAVAILABLE' as const, message: 'Service down' })
      );
      const deps = createFakeDeps({
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
          findByPR: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR' as const, message: 'DB error' })),
          findById: vi.fn().mockResolvedValue(ok(null)),
          findByUser: vi.fn().mockResolvedValue(ok([])),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
        linearAgentClient,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-5',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBeUndefined();
      }
    });

    it('proceeds without linearIssueId when resolveLinearIssueId throws', async () => {
      const deps = createFakeDeps({
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
          findByPR: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
          findById: vi.fn().mockResolvedValue(ok(null)),
          findByUser: vi.fn().mockResolvedValue(ok([])),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-6',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBeUndefined();
      }
    });

    it('uses fallback title when prTitle not provided', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-7',
      });

      expect(deps.linearAgentClient?.createIssue).toHaveBeenCalledWith({
        userId: 'user-1',
        title: 'Review PR #42 in intexuraos/intexuraos',
        description: 'Automated PR review for PR #42 in intexuraos/intexuraos',
      });
    });
  });
});
