/**
 * Tests for createRemediationTask use case (INT-1087).
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { UserLookupService } from '../../domain/ports/userLookupService.js';
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import { createRemediationTask, type CreateRemediationTaskDeps, type CreateRemediationTaskRequest } from '../../domain/usecases/createRemediationTask.js';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createFakeTaskEnqueueService(): TaskEnqueueService {
  return {
    enqueue: vi.fn().mockResolvedValue(ok({
      taskId: 'task-remediation-1',
      queuePosition: 1,
    })),
  };
}

function createFakeWorkerSettingsRepo(overrides?: Partial<WorkerSettingsRepository>): WorkerSettingsRepository {
  return {
    getSettings: vi.fn().mockResolvedValue(ok(null)),
    saveSettings: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  } as unknown as WorkerSettingsRepository;
}

function createFakeDeps(overrides: Partial<CreateRemediationTaskDeps> = {}): CreateRemediationTaskDeps {
  return {
    logger: createFakeLogger(),
    codeTaskRepo: {
      create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok(null)),
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
    taskEnqueueService: createFakeTaskEnqueueService(),
    workerSettingsRepo: createFakeWorkerSettingsRepo(),
    orchestratorSecret: 'test-secret',
    automationLog: {
      record: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function createDefaultRequest(overrides: Partial<CreateRemediationTaskRequest> = {}): CreateRemediationTaskRequest {
  return {
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    senderLogin: 'alice',
    workerType: 'opus',
    eventId: 'event-123',
    ...overrides,
  };
}

describe('createRemediationTask', () => {
  it('creates a remediation task with agentType=remediation', async () => {
    const deps = createFakeDeps();
    const request = createDefaultRequest();

    const result = await createRemediationTask(deps, request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.taskId).toBe('task-remediation-1');
    expect(result.value.workerType).toBe('opus');

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall).toBeDefined();
    expect(createCall?.agentType).toBe('remediation');
    expect(createCall?.workerType).toBe('opus');
    expect(createCall?.prNumber).toBe(42);
  });

  it('prompt does not contain pre-loaded review findings sections', async () => {
    const deps = createFakeDeps();
    // Even if caller somehow passes extra fields, they must not appear in the prompt.
    // The type no longer accepts these fields; cast to verify runtime behaviour.
    const request = createDefaultRequest() as CreateRemediationTaskRequest & {
      reviewBody?: string;
      inlineComments?: { path: string; line: number; body: string }[];
      triggerComment?: { body: string; author: string };
    };
    request.reviewBody = 'Some review body that must NOT appear';
    request.inlineComments = [{ path: 'src/foo.ts', line: 1, body: 'Inline comment that must NOT appear' }];
    request.triggerComment = { body: 'Trigger comment that must NOT appear', author: 'alice' };

    await createRemediationTask(deps, request as CreateRemediationTaskRequest);

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.prompt).not.toContain('### Review Findings');
    expect(createCall?.prompt).not.toContain('### Inline Comments');
    expect(createCall?.prompt).not.toContain('Some review body that must NOT appear');
    expect(createCall?.prompt).not.toContain('Inline comment that must NOT appear');
    expect(createCall?.prompt).not.toContain('Trigger comment that must NOT appear');
  });

  it('links to existing execution task Linear issue when found', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok({ id: 'task-exec-1', linearIssueId: 'INT-500' })),
      } as unknown as CodeTaskRepository,
    });

    await createRemediationTask(deps, createDefaultRequest());

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.linearIssueId).toBe('INT-500');
  });

  it('copies prBranch from the existing execution task when found', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(
          ok({ id: 'task-exec-1', linearIssueId: 'INT-500', prBranch: 'feature/existing-pr' }),
        ),
      } as unknown as CodeTaskRepository,
    });

    await createRemediationTask(deps, createDefaultRequest());

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.prBranch).toBe('feature/existing-pr');
  });

  it('creates task without linearIssueId when no execution task exists', async () => {
    const deps = createFakeDeps();
    // findLatestExecutionTaskByPR returns null (default)

    await createRemediationTask(deps, createDefaultRequest());

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.linearIssueId).toBeUndefined();
  });

  it('returns user_not_found when user resolution fails', async () => {
    const deps = createFakeDeps({
      userLookupService: {
        resolveByGitHubUsername: vi.fn().mockResolvedValue(
          err({ code: 'NOT_FOUND', message: 'User not found' })
        ),
      } as unknown as UserLookupService,
    });

    const result = await createRemediationTask(deps, createDefaultRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('user_not_found');
  });

  it('returns no_workers_configured when user has no workers', async () => {
    const deps = createFakeDeps({
      userLookupService: {
        resolveByGitHubUsername: vi.fn().mockResolvedValue(
          err({ code: 'NO_ENABLED_WORKER', message: 'No workers' })
        ),
      } as unknown as UserLookupService,
    });

    const result = await createRemediationTask(deps, createDefaultRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no_workers_configured');
  });

  it('returns task_creation_failed when repo.create fails', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      } as unknown as CodeTaskRepository,
    });

    const result = await createRemediationTask(deps, createDefaultRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('task_creation_failed');
  });

  it('returns queue_full when enqueue service is full', async () => {
    const deps = createFakeDeps({
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(err({ code: 'queue_full', message: 'Queue is full' })),
      },
    });

    const result = await createRemediationTask(deps, createDefaultRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('queue_full');
  });

  it('returns internal_error when enqueue service fails with non-queue-full error', async () => {
    const deps = createFakeDeps({
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(err({ code: 'internal_error', message: 'Dispatch unavailable' })),
      },
    });

    const result = await createRemediationTask(deps, createDefaultRequest());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal_error');
  });

  it('uses systemPromptHash remediation-auto', async () => {
    const deps = createFakeDeps();

    await createRemediationTask(deps, createDefaultRequest());

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.systemPromptHash).toBe('remediation-auto');
  });

  it('does not perform review dedup — no findActiveReviewForPR call', async () => {
    const findActiveReviewForPR = vi.fn();
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
        findActiveReviewForPR,
      } as unknown as CodeTaskRepository,
    });

    await createRemediationTask(deps, createDefaultRequest());

    // Should NOT call findActiveReviewForPR (no dedup for remediation)
    expect(findActiveReviewForPR).not.toHaveBeenCalled();
  });

  it('uses baseBranch from request when provided', async () => {
    const deps = createFakeDeps();

    await createRemediationTask(deps, createDefaultRequest({ baseBranch: 'release/v2' }));

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.baseBranch).toBe('release/v2');
  });

  it('defaults baseBranch to main when not provided', async () => {
    const deps = createFakeDeps();

    await createRemediationTask(deps, createDefaultRequest());

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.baseBranch).toBe('main');
  });

  it('records automation log on successful dispatch', async () => {
    const deps = createFakeDeps();

    await createRemediationTask(deps, createDefaultRequest());

    expect(deps.automationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
      expect.objectContaining({
        type: 'task_dispatched',
        agentType: 'remediation',
      }),
      'user-1',
    );
  });

  it('returns success when automation log recording fails after dispatch', async () => {
    const deps = createFakeDeps({
      automationLog: {
        record: vi.fn().mockRejectedValue(new Error('automation down')),
      },
    });

    const result = await createRemediationTask(deps, createDefaultRequest());

    expect(result.ok).toBe(true);
    await Promise.resolve();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        taskId: 'task-remediation-1',
      }),
      'Failed to record automation log for remediation task dispatch',
    );
  });

  it('continues when findLatestExecutionTaskByPR fails for Linear issue linking', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'timeout' })),
      } as unknown as CodeTaskRepository,
    });

    const result = await createRemediationTask(deps, createDefaultRequest());

    // Should succeed even though Linear linking failed
    expect(result.ok).toBe(true);
  });

  it('passes linearIssueId from request when explicitly provided', async () => {
    const deps = createFakeDeps();

    await createRemediationTask(deps, createDefaultRequest({ linearIssueId: 'INT-999' }));

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.linearIssueId).toBe('INT-999');
  });

  it('continues when PR continuation lookup fails for an explicit linearIssueId', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi
          .fn()
          .mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'timeout' })),
      } as unknown as CodeTaskRepository,
    });

    const result = await createRemediationTask(
      deps,
      createDefaultRequest({ linearIssueId: 'INT-999' }),
    );

    expect(result.ok).toBe(true);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }),
        prNumber: 42,
      }),
      'Failed to look up existing execution task for remediation PR continuation',
    );
  });

  it('uses user default worker type when request workerType is auto', async () => {
    const deps = createFakeDeps({
      workerSettingsRepo: createFakeWorkerSettingsRepo({
        getSettings: vi.fn().mockResolvedValue(ok({
          defaultRemediationWorkerType: 'sonnet',
          workers: [],
        })),
      }),
    });

    const result = await createRemediationTask(deps, createDefaultRequest({ workerType: 'auto' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workerType).toBe('sonnet');

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.workerType).toBe('sonnet');
  });

  it('uses prBranch from request when findLatestExecutionTaskByPR returns null', async () => {
    const deps = createFakeDeps();
    // findLatestExecutionTaskByPR returns null (default)

    await createRemediationTask(deps, createDefaultRequest({ prBranch: 'feature/from-request' }));

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.prBranch).toBe('feature/from-request');
  });

  it('prefers prBranch from execution task lookup over request.prBranch', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(
          ok({ id: 'task-exec-1', linearIssueId: 'INT-500', prBranch: 'feature/from-lookup' }),
        ),
      } as unknown as CodeTaskRepository,
    });

    await createRemediationTask(deps, createDefaultRequest({ prBranch: 'feature/from-request' }));

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.prBranch).toBe('feature/from-lookup');
  });

  it('uses prBranch from request when execution task lookup has no prBranch', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(
          ok({ id: 'task-exec-1', linearIssueId: 'INT-500' }),
        ),
      } as unknown as CodeTaskRepository,
    });

    await createRemediationTask(deps, createDefaultRequest({ prBranch: 'feature/from-request' }));

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.prBranch).toBe('feature/from-request');
  });

  it('uses prBranch from request when findLatestExecutionTaskByPR fails', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-remediation-1' })),
        findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'timeout' })),
      } as unknown as CodeTaskRepository,
    });

    await createRemediationTask(deps, createDefaultRequest({ prBranch: 'feature/from-request' }));

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.prBranch).toBe('feature/from-request');
  });

  it('keeps explicit workerType when not auto', async () => {
    const deps = createFakeDeps({
      workerSettingsRepo: createFakeWorkerSettingsRepo({
        getSettings: vi.fn().mockResolvedValue(ok({
          defaultRemediationWorkerType: 'sonnet',
          workers: [],
        })),
      }),
    });

    const result = await createRemediationTask(deps, createDefaultRequest({ workerType: 'opus' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workerType).toBe('opus');
  });

  it('falls back to auto when user has no default worker type setting', async () => {
    const deps = createFakeDeps({
      workerSettingsRepo: createFakeWorkerSettingsRepo({
        getSettings: vi.fn().mockResolvedValue(ok(null)),
      }),
    });

    const result = await createRemediationTask(deps, createDefaultRequest({ workerType: 'auto' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workerType).toBe('auto');
  });
});
