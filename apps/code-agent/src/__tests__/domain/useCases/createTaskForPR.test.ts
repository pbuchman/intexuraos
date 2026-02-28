/**
 * Tests for createTaskForPR use case.
 *
 * Validates creating a task from a PR comment, including:
 * - User resolution from GitHub username
 * - Transaction guard with document-level locking
 * - Task creation and dispatch
 * - Linear issue creation
 * - Error handling for failures
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import {
  createTaskForPR,
  type CreateTaskForPRDeps,
  type CreateTaskForPRRequest,
} from '../../../domain/usecases/createTaskForPR.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';

describe('createTaskForPR', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findByPR: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockUserLookupService: {
    resolveUserFromGitHubUsername: ReturnType<typeof vi.fn>;
  };
  let mockLinearIssueService: {
    ensureIssueExists: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    dispatch: ReturnType<typeof vi.fn>;
  };
  let mockFirestore: {
    runTransaction: ReturnType<typeof vi.fn>;
    doc: ReturnType<typeof vi.fn>;
  };
  let mockTransaction: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };

  const repository = 'pbuchman/intexuraos';
  const prNumber = 42;
  const senderLogin = 'testuser';
  const comment = 'Please fix this bug';
  const eventId = 'event-123';
  const userId = 'user_123';

  const mockWorker = {
    name: 'home-dev',
    url: 'https://worker.local',
    enabled: true,
    cfAccessClientId: 'client-id',
    cfAccessClientSecret: 'client-secret',
    dispatchSigningSecret: 'signing-secret',
  };

  const mockExistingTask: CodeTask = {
    id: 'task_existing',
    userId,
    traceId: 'trace-existing',
    prompt: 'Existing task',
    sanitizedPrompt: 'Existing task',
    systemPromptHash: 'hash123',
    workerType: 'auto',
    workerLocation: 'home-dev',
    repository,
    baseBranch: 'main',
    status: 'dispatched',
    agentType: 'execution',
    actionId: `pr-comment/${repository}/${String(prNumber)}/old-event`,
    approvalEventId: 'old-event',
    prNumber,
    callbackReceived: true,
    dedupKey: 'dedup-existing',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  function createDeps(): CreateTaskForPRDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as CreateTaskForPRDeps['codeTaskRepo'],
      userLookupService: mockUserLookupService as unknown as CreateTaskForPRDeps['userLookupService'],
      linearIssueService: mockLinearIssueService as unknown as CreateTaskForPRDeps['linearIssueService'],
      taskDispatcher: mockTaskDispatcher as unknown as CreateTaskForPRDeps['taskDispatcher'],
      orchestratorSecret: 'test-orchestrator-secret',
      serviceUrl: 'https://code-agent.test.local',
      firestore: mockFirestore as unknown as CreateTaskForPRDeps['firestore'],
    };
  }

  function createRequest(overrides: Partial<Pick<CreateTaskForPRRequest, 'prTitle' | 'workerType'>> = {}): CreateTaskForPRRequest {
    return {
      repository,
      prNumber,
      senderLogin,
      comment,
      eventId,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockCodeTaskRepo = {
      findByPR: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    mockUserLookupService = {
      resolveUserFromGitHubUsername: vi.fn(),
    };

    mockLinearIssueService = {
      ensureIssueExists: vi.fn(),
    };

    mockTaskDispatcher = {
      dispatch: vi.fn(),
    };

    mockTransaction = {
      get: vi.fn(),
      set: vi.fn(),
    };

    mockFirestore = {
      runTransaction: vi.fn(async (fn) => fn(mockTransaction)),
      doc: vi.fn(() => ({ path: 'pr_task_locks/test' })),
    };
  });

  describe('user resolution', () => {
    it('returns user_not_found when GitHub username has no matching worker settings', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(ok(null));

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('user_not_found');
      expect(result.error.message).toContain(senderLogin);
    });

    it('returns user_not_found when userLookupService errors', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        err({ code: 'user_not_found', message: 'User not found' })
      );

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('user_not_found');
    });
  });

  describe('task creation', () => {
    it('creates and dispatches task when no existing task for PR', async () => {
      // Setup mocks for happy path
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      // Lock document doesn't exist
      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockResolvedValue({
        linearIssueId: 'INT-100',
        linearIssueTitle: 'PR #42 comment: Please fix this bug',
        linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-100',
        linearFallback: false,
      });

      let createdTaskId: string | undefined;
      mockCodeTaskRepo.create.mockImplementation(async (input) => {
        createdTaskId = input.id;
        return ok({ ...mockExistingTask, id: input.id });
      });

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );

      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));

      const result = await createTaskForPR(createDeps(), createRequest({ prTitle: 'Fix bug in auth' }));

      if (!result.ok) {
        throw new Error('Expected success result: ' + result.error.message);
      }
      expect(result.value.taskId).toBe(createdTaskId);

      // Verify dispatch was called
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: createdTaskId,
          repository,
          baseBranch: 'main',
          workerType: 'auto',
        })
      );

      // Verify task was updated with worker location
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        createdTaskId,
        expect.objectContaining({ workerLocation: 'home-dev' })
      );
    });

    it('returns existing taskId when lock document exists', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      // Lock document exists - task was already created
      mockTransaction.get.mockResolvedValue({
        exists: true,
        data: () => ({ taskId: 'task_existing', repository, prNumber }),
      });

      const result = await createTaskForPR(createDeps(), createRequest());

      if (!result.ok) {
        throw new Error('Expected success result');
      }
      expect(result.value.taskId).toBe('task_existing');

      // Verify task was NOT created
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();

      // Verify dispatch was NOT called
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('marks task as failed when dispatch fails', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockResolvedValue({
        linearIssueId: 'INT-100',
        linearIssueTitle: 'PR #42 comment: Please fix this bug',
        linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-100',
        linearFallback: false,
      });

      let createdTaskId: string | undefined;
      mockCodeTaskRepo.create.mockImplementation(async (input) => {
        createdTaskId = input.id;
        return ok({ ...mockExistingTask, id: input.id });
      });

      // Dispatch fails
      mockTaskDispatcher.dispatch.mockResolvedValue(
        err({ code: 'dispatch_failed', message: 'Worker unavailable' })
      );

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('task_creation_failed');
      expect(result.error.message).toContain('dispatch failed');

      // Verify task was marked as failed
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        createdTaskId,
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: 'dispatch_failed',
          }),
        })
      );
    });
  });

  describe('prompt building', () => {
    it('builds prompt with resume preamble including PR number and instructions', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockResolvedValue({
        linearIssueId: 'INT-100',
        linearIssueTitle: 'Test Issue',
        linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-100',
        linearFallback: false,
      });

      let capturedPrompt: string | undefined;
      mockCodeTaskRepo.create.mockImplementation(async (input) => {
        capturedPrompt = input.prompt;
        return ok({ ...mockExistingTask, id: input.id });
      });

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );

      await createTaskForPR(createDeps(), createRequest());

      expect(capturedPrompt).toContain('[PR Comment Task]');
      expect(capturedPrompt).toContain(`PR #${String(prNumber)}`);
      expect(capturedPrompt).toContain('gh pr view');
      expect(capturedPrompt).toContain(comment);
    });
  });

  describe('Linear issue', () => {
    it('creates task even when Linear issue creation falls back', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      // Linear falls back
      mockLinearIssueService.ensureIssueExists.mockResolvedValue({
        linearIssueTitle: 'PR #42 comment: Please fix this bug',
        linearFallback: true,
      });

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );

      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));

      const result = await createTaskForPR(createDeps(), createRequest());

      if (!result.ok) {
        throw new Error('Expected success result');
      }
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalled();
    });

    it('uses prTitle for Linear issue when available', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      let capturedLinearIssueId: string | undefined;
      mockLinearIssueService.ensureIssueExists.mockImplementation(async (input) => {
        capturedLinearIssueId = input.linearIssueId;
        return {
          linearIssueId: input.linearIssueId,
          linearIssueTitle: input.taskPrompt,
          linearFallback: false,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        };
      });

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );

      await createTaskForPR(createDeps(), createRequest({ prTitle: '[INT-500] Fix auth bug' }));

      expect(capturedLinearIssueId).toBe('INT-500');
    });

    it('extracts INT-XXX from PR title and validates existing issue', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      let capturedLinearIssueId: string | undefined;
      mockLinearIssueService.ensureIssueExists.mockImplementation(async (input) => {
        capturedLinearIssueId = input.linearIssueId;
        return {
          linearIssueId: 'INT-500',
          linearIssueTitle: 'Fix auth bug',
          linearFallback: false,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        };
      });

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );

      await createTaskForPR(createDeps(), createRequest({ prTitle: 'Fix auth [INT-500]' }));

      expect(capturedLinearIssueId).toBe('INT-500');
    });

    it('passes pr-comment label in dispatch when creating new issue', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockImplementation(async () => ({
        linearIssueTitle: 'Test issue',
        linearFallback: false,
        linearIssueLabels: [],
        hasChildren: false,
      }));

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      let capturedLabels: string[] = [];
      mockTaskDispatcher.dispatch.mockImplementation(async (input) => {
        capturedLabels = input.linearIssueLabels;
        return ok({ dispatched: true, workerLocation: 'home-dev' });
      });

      await createTaskForPR(createDeps(), createRequest({ prTitle: 'My PR Title' }));

      expect(capturedLabels).toContain('pr-comment');
      expect(capturedLabels).toContain('code-task');
    });

    it('preserves pr-comment label when already present in existing issue labels', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockImplementation(async () => ({
        linearIssueId: 'INT-500',
        linearIssueTitle: 'Existing issue',
        linearFallback: false,
        linearIssueLabels: ['code-task', 'pr-comment'],
        hasChildren: false,
      }));

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      let capturedLabels: string[] = [];
      mockTaskDispatcher.dispatch.mockImplementation(async (input) => {
        capturedLabels = input.linearIssueLabels;
        return ok({ dispatched: true, workerLocation: 'home-dev' });
      });

      await createTaskForPR(createDeps(), createRequest({ prTitle: '[INT-500] Fix bug' }));

      expect(capturedLabels).toEqual(['code-task', 'pr-comment']);
    });

    it('uses real labels from existing issue when INT-XXX found', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockImplementation(async () => ({
        linearIssueId: 'INT-500',
        linearIssueTitle: 'Existing issue',
        linearFallback: false,
        linearIssueLabels: ['code-task', 'backend'],
        hasChildren: false,
      }));

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      let capturedLabels: string[] = [];
      mockTaskDispatcher.dispatch.mockImplementation(async (input) => {
        capturedLabels = input.linearIssueLabels;
        return ok({ dispatched: true, workerLocation: 'home-dev' });
      });

      await createTaskForPR(createDeps(), createRequest({ prTitle: '[INT-500] Fix bug' }));

      expect(capturedLabels).toEqual(['code-task', 'backend', 'pr-comment']);
    });
  });

  describe('workerType selection', () => {
    function setupFullHappyPath(): void {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: (): undefined => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockResolvedValue({
        linearIssueId: 'INT-100',
        linearIssueTitle: 'Test Issue',
        linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-100',
        linearFallback: false,
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      });

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );

      mockCodeTaskRepo.update.mockResolvedValue(ok(undefined));
    }

    it('dispatches with explicit workerType when provided', async () => {
      setupFullHappyPath();

      let capturedWorkerType: string | undefined;
      mockTaskDispatcher.dispatch.mockImplementation(async (input: { workerType: string }) => {
        capturedWorkerType = input.workerType;
        return ok({ dispatched: true, workerLocation: 'home-dev' });
      });

      let capturedCreateWorkerType: string | undefined;
      mockCodeTaskRepo.create.mockImplementation(async (input: { id: string; workerType: string }) => {
        capturedCreateWorkerType = input.workerType;
        return ok({ ...mockExistingTask, id: input.id });
      });

      const result = await createTaskForPR(createDeps(), createRequest({ workerType: 'sonnet' }));

      if (!result.ok) {
        throw new Error('Expected success result: ' + result.error.message);
      }
      expect(capturedWorkerType).toBe('sonnet');
      expect(capturedCreateWorkerType).toBe('sonnet');
    });

    it('defaults to auto when workerType is omitted', async () => {
      setupFullHappyPath();

      let capturedWorkerType: string | undefined;
      mockTaskDispatcher.dispatch.mockImplementation(async (input: { workerType: string }) => {
        capturedWorkerType = input.workerType;
        return ok({ dispatched: true, workerLocation: 'home-dev' });
      });

      const result = await createTaskForPR(createDeps(), createRequest());

      if (!result.ok) {
        throw new Error('Expected success result: ' + result.error.message);
      }
      expect(capturedWorkerType).toBe('auto');
    });

    it('returns invalid_worker_type for unsupported workerType', async () => {
      const result = await createTaskForPR(
        createDeps(),
        createRequest({ workerType: 'unsupported' as never })
      );

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('invalid_worker_type');
      expect(result.error.message).toContain('unsupported');
    });
  });

  describe('error handling', () => {
    function setupHappyPathMocks(): void {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: false,
        data: () => undefined,
      });

      mockLinearIssueService.ensureIssueExists.mockResolvedValue({
        linearIssueId: 'INT-100',
        linearIssueTitle: 'Test Issue',
        linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-100',
        linearFallback: false,
      });

      mockCodeTaskRepo.create.mockResolvedValue(
        ok({ ...mockExistingTask, id: 'task_new' })
      );

      mockTaskDispatcher.dispatch.mockResolvedValue(
        ok({ dispatched: true, workerLocation: 'home-dev' })
      );
    }

    it('returns task_creation_failed when lock document has missing taskId', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: true,
        data: () => ({}),
      });

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('task_creation_failed');
      expect(result.error.message).toContain('taskId is missing');
    });

    it('returns task_creation_failed when lock document has empty taskId', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockTransaction.get.mockResolvedValue({
        exists: true,
        data: () => ({ taskId: '' }),
      });

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('task_creation_failed');
    });

    it('returns task_creation_failed when codeTaskRepo.create fails', async () => {
      setupHappyPathMocks();

      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'WRITE_FAILED', message: 'Firestore write failed' })
      );

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('task_creation_failed');
      expect(result.error.message).toContain('Firestore write failed');
    });

    it('returns internal_error when transaction throws', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockFirestore.runTransaction.mockRejectedValue(new Error('Firestore unavailable'));

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toContain('Firestore unavailable');
    });

    it('propagates error when transaction callback returns err result', async () => {
      mockUserLookupService.resolveUserFromGitHubUsername.mockResolvedValue(
        ok({ userId, worker: mockWorker })
      );

      mockFirestore.runTransaction.mockResolvedValue(
        err({ code: 'task_creation_failed', message: 'Lock document exists but taskId is missing' })
      );

      const result = await createTaskForPR(createDeps(), createRequest());

      if (result.ok) {
        throw new Error('Expected error result');
      }
      expect(result.error.code).toBe('task_creation_failed');
    });
  });
});
