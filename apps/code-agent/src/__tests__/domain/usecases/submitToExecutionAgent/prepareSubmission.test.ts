/**
 * Tests for prepareSubmission — the context-gathering / validation phase
 * of the submitToExecutionAgent workflow.
 *
 * Covers:
 *  - Happy path: a valid planning task yields a prepared submission.
 *  - Request validation: missing originalTaskId / userId throws with the
 *    missing field name (so call sites fail fast instead of executing a
 *    malformed lookup).
 *  - A complex parent yields a prepared submission with a `complex` block
 *    containing live direct children.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../../domain/models/codeTask.js';
import {
  prepareSubmission,
  type PrepareSubmissionDeps,
} from '../../../../domain/usecases/submitToExecutionAgent/prepareSubmission.js';

describe('prepareSubmission', () => {
  const userId = 'user_123';
  const originalTaskId = 'task_original';
  const linearIssueId = 'INT-100';

  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findByIdForUser: ReturnType<typeof vi.fn>;
    findPlannedTaskByLinearIssue: ReturnType<typeof vi.fn>;
    hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    validateIssue: ReturnType<typeof vi.fn>;
    fetchDirectChildrenLive: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: { getSettings: ReturnType<typeof vi.fn> };
  let mockGitHubPRClient: {
    getPullRequestStatus: ReturnType<typeof vi.fn>;
    mergePullRequest: ReturnType<typeof vi.fn>;
  };
  let mockUserServiceClient: { getOAuthToken: ReturnType<typeof vi.fn> };

  function createMockTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    const task: CodeTask = {
      id: originalTaskId,
      userId,
      traceId: 'trace-abc',
      prompt: 'Implement feature X',
      sanitizedPrompt: 'Implement feature X',
      systemPromptHash: 'hash123',
      workerType: 'auto',
      workerLocation: 'home-dev',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'planned',
      agentType: 'planning',
      dedupKey: 'dedup-abc',
      callbackReceived: true,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      linearIssueId,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        (task as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return task;
  }

  function createDeps(): PrepareSubmissionDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as PrepareSubmissionDeps['codeTaskRepo'],
      linearAgentClient: mockLinearAgentClient as unknown as PrepareSubmissionDeps['linearAgentClient'],
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as PrepareSubmissionDeps['workerSettingsRepo'],
      gitHubPRClient: mockGitHubPRClient as unknown as PrepareSubmissionDeps['gitHubPRClient'],
      userServiceClient: mockUserServiceClient as unknown as PrepareSubmissionDeps['userServiceClient'],
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
      findByIdForUser: vi.fn(),
      findPlannedTaskByLinearIssue: vi.fn(),
      hasActiveTaskForLinearIssue: vi.fn().mockResolvedValue(ok({ hasActive: false })),
    };
    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      fetchDirectChildrenLive: vi.fn(),
    };
    mockWorkerSettingsRepo = { getSettings: vi.fn() };
    mockGitHubPRClient = {
      getPullRequestStatus: vi.fn(),
      mergePullRequest: vi.fn(),
    };
    mockUserServiceClient = { getOAuthToken: vi.fn() };
  });

  it('builds a prepared submission when context is complete', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(
      ok({
        workers: [{ name: 'home-dev', url: 'x', enabled: true, cfAccessClientId: 'a', cfAccessClientSecret: 'b', dispatchSigningSecret: 'c' }],
      }),
    );
    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: linearIssueId,
        identifier: linearIssueId,
        title: 'Feature',
        url: `https://linear.app/x/${linearIssueId}`,
        labels: ['code-task'],
        childCount: 0,
        parentId: null,
      }),
    );

    const result = await prepareSubmission(createDeps(), { originalTaskId, userId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.planningTask.id).toBe(originalTaskId);
      expect(result.value.linearIssueId).toBe(linearIssueId);
      expect(result.value.effectiveWorkerType).toBe('auto');
      expect(result.value.complex).toBeUndefined();
    }
  });

  it('uses defaultExecutionWorkerType when request workerType is auto', async () => {
    const task = createMockTask();
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(
      ok({
        workers: [{ name: 'home-dev', url: 'x', enabled: true, cfAccessClientId: 'a', cfAccessClientSecret: 'b', dispatchSigningSecret: 'c' }],
        defaultExecutionWorkerType: 'codex',
      }),
    );
    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: linearIssueId,
        identifier: linearIssueId,
        title: 'Feature',
        url: `https://linear.app/x/${linearIssueId}`,
        labels: ['code-task'],
        childCount: 0,
        parentId: null,
      }),
    );

    const result = await prepareSubmission(createDeps(), {
      originalTaskId,
      userId,
      workerType: 'auto',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.effectiveWorkerType).toBe('codex');
    }
  });

  it('throws with missing field names when originalTaskId is absent', async () => {
    await expect(
      prepareSubmission(createDeps(), { originalTaskId: '', userId }),
    ).rejects.toThrow(/originalTaskId/);
  });

  it('throws with missing field names when userId is absent', async () => {
    await expect(
      prepareSubmission(createDeps(), { originalTaskId, userId: '' }),
    ).rejects.toThrow(/userId/);
  });

  it('throws listing both missing fields when both are absent', async () => {
    await expect(
      prepareSubmission(createDeps(), { originalTaskId: '', userId: '' }),
    ).rejects.toThrow(/originalTaskId.*userId|userId.*originalTaskId/);
  });

  it('returns task_not_found error when the task repo lookup fails', async () => {
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(err({ code: 'NOT_FOUND', message: 'missing' }));

    const result = await prepareSubmission(createDeps(), { originalTaskId, userId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('task_not_found');
  });

  it('attaches a complex context with live direct children when the parent has complex-task label', async () => {
    const task = createMockTask();
    const validatedUuid = 'linear-uuid-parent';
    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(task));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(
      ok({
        workers: [{ name: 'home-dev', url: 'x', enabled: true, cfAccessClientId: 'a', cfAccessClientSecret: 'b', dispatchSigningSecret: 'c' }],
      }),
    );
    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: validatedUuid,
        identifier: linearIssueId,
        title: 'Feature',
        url: `https://linear.app/x/${linearIssueId}`,
        labels: ['complex-task'],
        childCount: 2,
        parentId: null,
      }),
    );
    mockLinearAgentClient.fetchDirectChildrenLive.mockResolvedValue(
      ok([
        { id: 'c1', identifier: 'INT-101', url: 'u1', parentId: validatedUuid, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
        { id: 'c2', identifier: 'INT-102', url: 'u2', parentId: validatedUuid, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
      ]),
    );

    const result = await prepareSubmission(createDeps(), { originalTaskId, userId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.complex).toBeDefined();
      expect(result.value.complex?.validatedIssueUuid).toBe(validatedUuid);
      expect(result.value.complex?.directChildren).toHaveLength(2);
    }
  });
});
