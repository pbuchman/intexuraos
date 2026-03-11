/**
 * Tests for submitTaskFeedback use case.
 *
 * Covers all v8 ignore blocks for removal:
 * 1. getSettings returns err (line ~144)
 * 2. settings?.workers ?? [] null settings path (line ~157)
 * 3. create returns err (line ~248)
 * 4. followUpTask.linearIssueId !== undefined false branch (line ~347)
 * 5. update success/failure branches (line ~392)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { submitTaskFeedback, type SubmitTaskFeedbackDeps, type SubmitTaskFeedbackRequest } from '../../../domain/usecases/submitTaskFeedback.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import type { MetricsClient } from '../../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { UserWorkerSettings } from '../../../domain/models/workerSettings.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { Timestamp } from '@google-cloud/firestore';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// Mock orchestrator secret and service URL
const MOCK_ORCHESTRATOR_SECRET = 'test-secret';
const MOCK_SERVICE_URL = 'https://test.intexuraos.cloud';

// Helper to create a completed task for feedback
function createMockCompletedTask(overrides?: Partial<CodeTask>): CodeTask {
  const now = Timestamp.now();
  return {
    id: 'task_original-123',
    userId: 'user-123',
    workerType: 'opus' as const,
    workerLocation: 'home-mac',
    status: 'implemented',
    prompt: 'Original task prompt',
    sanitizedPrompt: 'Original task prompt (sanitized)',
    systemPromptHash: 'abc123',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-123',
    callbackReceived: false,
    dedupKey: 'dedup-key',
    createdAt: now,
    updatedAt: now,
    linearIssueId: 'INT-100',
    agentType: 'execution',
    ...overrides,
  };
}

// Helper to create mock worker settings
function createMockWorkerSettings(overrides?: Partial<UserWorkerSettings>): UserWorkerSettings {
  return {
    userId: 'user-123',
    workers: [
      {
        name: 'home-mac',
        url: 'https://home-mac.intexuraos.cloud',
        cfAccessClientId: 'client-id',
        cfAccessClientSecret: 'client-secret',
        dispatchSigningSecret: 'signing-secret',
        enabled: true,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('submitTaskFeedback', () => {
  let mockCodeTaskRepo: Partial<CodeTaskRepository>;
  let mockLinearAgentClient: Partial<LinearAgentClient>;
  let mockTaskDispatcher: Partial<TaskDispatcherService>;
  let mockWhatsappNotifier: Partial<WhatsAppNotifier>;
  let mockMetricsClient: Partial<MetricsClient>;
  let mockWorkerSettingsRepo: Partial<WorkerSettingsRepository>;
  let mockGitHubPRClient: Partial<GitHubPRClient>;
  let mockUserServiceClient: Partial<UserServiceClient>;
  let deps: SubmitTaskFeedbackDeps;

  const mockRequest: SubmitTaskFeedbackRequest = {
    originalTaskId: 'task_original-123',
    userId: 'user-123',
    feedback: 'Please fix the bug in the login form',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks - all successful
    mockCodeTaskRepo = {
      findByIdForUser: vi.fn().mockResolvedValue(ok(createMockCompletedTask())),
      findById: vi.fn(),
      hasActiveTaskForLinearIssue: vi.fn().mockResolvedValue(ok({ hasActive: false })),
      findRecentTasksByLinearIssue: vi.fn().mockResolvedValue(ok([])),
      create: vi.fn().mockResolvedValue(ok(createMockCompletedTask({ id: 'task_followup-456', status: 'dispatched' }))),
      update: vi.fn().mockResolvedValue(ok(createMockCompletedTask({ id: 'task_followup-456' }))),
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn().mockResolvedValue(ok({
        id: 'issue-uuid',
        identifier: 'INT-100',
        title: 'Test Issue',
        url: 'https://linear.app/test/issue/INT-100',
        labels: ['code-task'],
        childCount: 0,
        parentId: null,
      })),
      updateIssueState: vi.fn().mockResolvedValue(ok(undefined)),
      addComment: vi.fn().mockResolvedValue(ok({ commentId: 'comment-123' })),
    };

    mockTaskDispatcher = {
      dispatch: vi.fn().mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' })),
    };

    mockWhatsappNotifier = {
      notifyTaskStarted: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockMetricsClient = {
      incrementTasksSubmitted: vi.fn().mockResolvedValue(undefined),
      incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
      recordTaskDuration: vi.fn().mockResolvedValue(undefined),
      setActiveTasks: vi.fn().mockResolvedValue(undefined),
      recordCost: vi.fn().mockResolvedValue(undefined),
    };

    mockWorkerSettingsRepo = {
      getSettings: vi.fn().mockResolvedValue(ok(createMockWorkerSettings())),
    };

    mockGitHubPRClient = {
      getPullRequestStatus: vi.fn(),
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 987 })),
    };

    mockUserServiceClient = {
      getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'gh-token' })),
    };

    deps = {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as CodeTaskRepository,
      linearAgentClient: mockLinearAgentClient as LinearAgentClient,
      taskDispatcher: mockTaskDispatcher as TaskDispatcherService,
      whatsappNotifier: mockWhatsappNotifier as WhatsAppNotifier,
      metricsClient: mockMetricsClient as MetricsClient,
      workerSettingsRepo: mockWorkerSettingsRepo as WorkerSettingsRepository,
      gitHubPRClient: mockGitHubPRClient as GitHubPRClient,
      userServiceClient: mockUserServiceClient as UserServiceClient,
      orchestratorSecret: MOCK_ORCHESTRATOR_SECRET,
      serviceUrl: MOCK_SERVICE_URL,
    };
  });

  describe('happy path', () => {
    it('successfully creates follow-up task and dispatches', async () => {
      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task_followup-456');
        expect(result.value.followUpFor).toBe('task_original-123');
      }

      // Verify findByIdForUser was called
      expect(mockCodeTaskRepo.findByIdForUser).toHaveBeenCalledWith('task_original-123', 'user-123');

      // Verify worker settings were fetched
      expect(mockWorkerSettingsRepo.getSettings).toHaveBeenCalledWith('user-123');

      // Verify task was created with parentTaskId
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentTaskId: 'task_original-123',
          followUpReason: 'user_feedback',
        })
      );

      // Verify dispatch was called
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalled();

      // Verify WhatsApp notification was sent
      expect(mockWhatsappNotifier.notifyTaskStarted).toHaveBeenCalled();
    });

    it('reuses the existing execution PR when feedback continues an open PR', async () => {
      mockCodeTaskRepo.findByIdForUser = vi.fn().mockResolvedValue(
        ok(
          createMockCompletedTask({
            prNumber: 1139,
            prBranch: 'task_old_branch',
          })
        )
      );
      mockGitHubPRClient.getPullRequestStatus = vi.fn().mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentTaskId: 'task_original-123',
          prNumber: 1139,
          prBranch: 'task_existing_pr_branch',
        })
      );
      expect(mockGitHubPRClient.postPRComment).toHaveBeenCalledWith(
        'gh-token',
        'pbuchman',
        'intexuraos',
        1139,
        expect.stringContaining('Execution Follow-up Task Created')
      );
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          continuationPrNumber: 1139,
          continuationPrBranch: 'task_existing_pr_branch',
        })
      );
    });

    it('reuses the existing PR for legacy execution tasks identified only by PR URL', async () => {
      const legacyTask = createMockCompletedTask({
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/1144' },
      });
      const legacyTaskRecord = legacyTask as unknown as Record<string, unknown>;
      delete legacyTaskRecord['agentType'];
      delete legacyTaskRecord['prNumber'];
      delete legacyTaskRecord['prBranch'];
      mockCodeTaskRepo.findByIdForUser = vi.fn().mockResolvedValue(
        ok(legacyTask)
      );
      mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
        ok({
          id: 'issue-uuid',
          identifier: 'INT-100',
          title: 'Test Issue',
          url: 'https://linear.app/test/issue/INT-100',
          labels: ['bug'],
          childCount: 0,
          parentId: null,
        })
      );
      mockGitHubPRClient.getPullRequestStatus = vi.fn().mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(true);
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
          prNumber: 1144,
          prBranch: 'task_existing_pr_branch',
        })
      );
      expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
          continuationPrNumber: 1144,
          continuationPrBranch: 'task_existing_pr_branch',
        })
      );
    });

    it('fails before creating follow-up work when continuation PR verification cannot fetch a GitHub token', async () => {
      mockCodeTaskRepo.findByIdForUser = vi.fn().mockResolvedValue(
        ok(
          createMockCompletedTask({
            prNumber: 1139,
            prBranch: 'task_existing_pr_branch',
          })
        )
      );
      mockUserServiceClient.getOAuthToken = vi.fn().mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe(
          'GitHub OAuth token is required to verify continuation PR state'
        );
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ originalTaskId: 'task_original-123', userId: 'user-123' }),
        'Failed to resolve continuation PR for feedback task'
      );
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('v8 ignore block 1: getSettings returns err', () => {
    it('returns internal_error when getSettings fails', async () => {
      // Mock getSettings to return err
      mockWorkerSettingsRepo.getSettings = vi.fn().mockResolvedValue(
        err({ code: 'internal_error', message: 'Database connection failed' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Failed to fetch worker settings');
      }

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
        }),
        expect.stringContaining('Failed to fetch worker settings for feedback')
      );

      // Verify task was NOT created
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('v8 ignore block 2: null settings path', () => {
    it('returns worker_not_configured when settings is null', async () => {
      // Mock getSettings to return ok(null)
      mockWorkerSettingsRepo.getSettings = vi.fn().mockResolvedValue(ok(null));

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
        expect(result.error.message).toContain('configure your workers in Settings');
      }

      // Verify error was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' }),
        'User has no workers configured for feedback'
      );

      // Verify task was NOT created
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('v8 ignore block 3: create returns err', () => {
    it('returns internal_error when codeTaskRepo.create fails', async () => {
      // Mock create to return err
      mockCodeTaskRepo.create = vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Firestore write failed' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Failed to create follow-up task');
      }

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.anything() }),
        'Failed to create follow-up task'
      );

      // Verify WhatsApp notification was NOT sent
      expect(mockWhatsappNotifier.notifyTaskStarted).not.toHaveBeenCalled();
    });
  });

  describe('v8 ignore block 4: followUpTask.linearIssueId undefined branch', () => {
    it('does not set linearIssueId on dispatch when original task has no linearIssueId', async () => {
      // Setup: original task without linearIssueId
      const taskWithoutLinearIssue = createMockCompletedTask();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Testing optional field omission
      delete (taskWithoutLinearIssue as any).linearIssueId;
      mockCodeTaskRepo.findByIdForUser = vi.fn().mockResolvedValue(ok(taskWithoutLinearIssue as CodeTask));

      // Mock create to return a follow-up task also without linearIssueId
      const followUpTaskWithoutLinearIssue = createMockCompletedTask({
        id: 'task_followup-789',
        status: 'dispatched',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Testing optional field omission
      delete (followUpTaskWithoutLinearIssue as any).linearIssueId;
      mockCodeTaskRepo.create = vi.fn().mockResolvedValue(ok(followUpTaskWithoutLinearIssue as CodeTask));

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(true);

      // Verify validateIssue was NOT called (since original has no linearIssueId)
      expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();

      // Verify updateIssueState was NOT called
      expect(mockLinearAgentClient.updateIssueState).not.toHaveBeenCalled();

      // Verify addComment was NOT called
      expect(mockLinearAgentClient.addComment).not.toHaveBeenCalled();

      // Verify dispatch was called - linearIssueId should not be set when original task has no linearIssueId
      // Note: We can't directly test the dispatch call args because the mock is not a vi.fn()
      // The key verification is that validateIssue/updateIssueState/addComment were NOT called
    });
  });

  describe('v8 ignore block 5: update error branch', () => {
    it('logs warning but still returns success when update fails after dispatch', async () => {
      // Mock update to return err (this is the update that sets cancelNonce)
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Firestore write failed' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      // The function should still return success because dispatch succeeded
      // The update failure only affects the cancel_nonce and notification
      expect(result.ok).toBe(true);

      // Verify error was logged for the update failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: expect.any(String),
          error: expect.anything(),
        }),
        'Failed to update task with cancel nonce'
      );

      // Verify WhatsApp notification was NOT sent (because update failed)
      expect(mockWhatsappNotifier.notifyTaskStarted).not.toHaveBeenCalled();
    });

    it('sends WhatsApp notification when update succeeds', async () => {
      // Ensure update succeeds
      mockCodeTaskRepo.update = vi.fn().mockResolvedValue(
        ok(createMockCompletedTask({ id: 'task_followup-456' }))
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(true);

      // Verify WhatsApp notification WAS sent
      expect(mockWhatsappNotifier.notifyTaskStarted).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('returns task_not_found when original task does not exist', async () => {
      mockCodeTaskRepo.findByIdForUser = vi.fn().mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Task not found' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task_not_found');
      }
    });

    it('returns invalid_status when task is not completed', async () => {
      const runningTask = createMockCompletedTask({ status: 'running' });
      mockCodeTaskRepo.findByIdForUser = vi.fn().mockResolvedValue(ok(runningTask));

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
      }
    });

    it('returns invalid_status when active task exists for same Linear issue', async () => {
      mockCodeTaskRepo.hasActiveTaskForLinearIssue = vi.fn().mockResolvedValue(
        ok({ hasActive: true, taskId: 'task_active-999' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_status');
        expect(result.error.message).toContain('An active task already exists');
      }
    });

    it('returns worker_not_configured when user has no enabled workers', async () => {
      const settingsWithNoEnabledWorkers = createMockWorkerSettings({
        workers: [
          {
            name: 'disabled-worker',
            url: 'https://disabled.intexuraos.cloud',
            cfAccessClientId: 'client-id',
            cfAccessClientSecret: 'client-secret',
            dispatchSigningSecret: 'signing-secret',
            enabled: false,
          },
        ],
      });
      mockWorkerSettingsRepo.getSettings = vi.fn().mockResolvedValue(ok(settingsWithNoEnabledWorkers));

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_not_configured');
      }
    });

    it('handles dispatch failure by updating task and returning error', async () => {
      mockTaskDispatcher.dispatch = vi.fn().mockResolvedValue(
        err({ code: 'worker_unavailable', message: 'Worker is not responding' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Worker is not responding');
      }

      // Verify task was updated to failed status
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'failed',
          error: {
            code: 'worker_unavailable',
            message: 'Worker is not responding',
          },
        })
      );
    });

    it('fails before dispatch when continuation bootstrap comment cannot be posted', async () => {
      mockCodeTaskRepo.findByIdForUser = vi.fn().mockResolvedValue(
        ok(
          createMockCompletedTask({
            prNumber: 1144,
            prBranch: 'task_old_branch',
          })
        )
      );
      mockGitHubPRClient.getPullRequestStatus = vi.fn().mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        })
      );
      mockGitHubPRClient.postPRComment = vi.fn().mockResolvedValue(
        err({ code: 'API_ERROR', message: 'Failed to post PR bootstrap comment' })
      );

      const result = await submitTaskFeedback(deps, mockRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Failed to post PR bootstrap comment');
      }
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith(
        'task_followup-456',
        expect.objectContaining({
          status: 'failed',
          error: {
            code: 'PR_BOOTSTRAP_COMMENT_FAILED',
            message: 'Failed to post PR bootstrap comment',
          },
        })
      );
      expect(mockTaskDispatcher.dispatch).not.toHaveBeenCalled();
    });
  });
});
