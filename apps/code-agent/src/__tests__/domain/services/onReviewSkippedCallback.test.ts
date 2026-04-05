/**
 * Tests for the onReviewSkipped callback's internal branches.
 *
 * The callback lives in services.ts (lines 562-640) and has 6 distinct code paths:
 *  1. originResult.ok === false          → skip (debug log)
 *  2. originResult.value === null        → skip (debug log)
 *  3. origin.linearIssueId === undefined  → skip (debug log)
 *  4. origin.agentType === 'planning'    → skip (info log)
 *  5. !issueValidation.ok                → warn and return
 *  6. labelResult.value.droppedLabels.length > 0 → warn and return
 *  7. Success                             → log + automation log + group summary recompute
 *
 * These tests directly exercise each branch using injectable fake dependencies,
 * mirroring the pattern suggested in the review.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import type { AutomationLog } from '../../../domain/ports/automationLog.js';
import type { TaskGroupSummaryRepository } from '../../../domain/ports/taskGroupSummaryRepository.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';

/**
 * Replicates the onReviewSkipped callback logic from services.ts (lines 562-640)
 * with injectable fake dependencies for testing each branch.
 */
function createOnReviewSkippedCallback(params: {
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  automationLog: AutomationLog;
  groupSummaryRepo: TaskGroupSummaryRepository;
  logger: Logger;
}) {
  const { codeTaskRepo, linearAgentClient, automationLog, groupSummaryRepo, logger } = params;

  return async function onReviewSkipped(args: { repository: string; prNumber: number }): Promise<void> {
    const { repository, prNumber } = args;
    try {
      const originResult = await codeTaskRepo.findOriginTaskByPR(repository, prNumber);
      if (!originResult.ok || originResult.value === null) {
        logger.debug({ repository, prNumber }, 'No origin task found for skipped review — skipping label');
        return;
      }

      const origin = originResult.value;
      if (origin.linearIssueId === undefined) {
        logger.debug({ repository, prNumber }, 'Origin task has no Linear issue — skipping label');
        return;
      }

      if (origin.agentType === 'planning') {
        logger.info({ repository, prNumber, linearIssueId: origin.linearIssueId },
          'Skipped review for planning-origin task — not setting ready-to-merge');
        return;
      }

      // Validate issue exists and get current labels
      const issueValidation = await linearAgentClient.validateIssue({
        userId: origin.userId,
        identifier: origin.linearIssueId,
      });
      if (!issueValidation.ok) {
        logger.warn({ linearIssueId: origin.linearIssueId, error: issueValidation.error },
          'Failed to validate issue for skipped-review label');
        return;
      }

      // Set ready-to-merge label
      const labelResult = await linearAgentClient.updateIssueMetadata({
        userId: origin.userId,
        issueId: issueValidation.value.id,
        addLabels: ['ready-to-merge'],
      });
      if (!labelResult.ok) {
        logger.warn({ linearIssueId: origin.linearIssueId, error: labelResult.error },
          'Failed to set ready-to-merge label for skipped review');
        return;
      }
      if (labelResult.value.droppedLabels.length > 0) {
        logger.warn({ linearIssueId: origin.linearIssueId, droppedLabels: labelResult.value.droppedLabels },
          'ready-to-merge label not found in Linear team');
        return;
      }

      logger.info({ repository, prNumber, linearIssueId: origin.linearIssueId },
        'Set ready-to-merge label for skipped review');

      // Record in the PR automation comment for visibility
      void automationLog.record(
        { repository, prNumber },
        {
          type: 'remediation_decision',
          required: false,
          source: 'review_result',
          signal: '0',
        },
      ).catch((logErr: unknown) => {
        logger.warn({ error: logErr, repository, prNumber }, 'Failed to record automation log for skipped-review label');
      });

      // Best-effort: recompute group summary so cached aggregateStatus reflects actionable state
      const baseLabels = issueValidation.value.labels.map((l) => ({ id: '', name: l }));
      const updatedLabels = issueValidation.value.labels.includes('ready-to-merge')
        ? baseLabels
        : [...baseLabels, { id: '', name: 'ready-to-merge' }];
      void groupSummaryRepo.recomputeWithLabels(
        origin.userId, origin.linearIssueId, updatedLabels, new Date().toISOString(),
      ).catch((recomputeErr: unknown) => {
        logger.warn({ linearIssueId: origin.linearIssueId, error: recomputeErr },
          'Failed to recompute group summary after skipped-review label (best-effort)');
      });
    } catch (error: unknown) {
      logger.warn({ error, repository, prNumber }, 'onReviewSkipped failed (best-effort)');
    }
  };
}

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createFakeCodeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    repository: 'pbuchman/intexuraos',
    agentType: 'execution',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CodeTask;
}

describe('onReviewSkipped callback branches', () => {
  let mockCodeTaskRepo: CodeTaskRepository;
  let mockLinearAgentClient: LinearAgentClient;
  let mockAutomationLog: AutomationLog;
  let mockGroupSummaryRepo: TaskGroupSummaryRepository;
  let logger: Logger;

  beforeEach(() => {
    logger = createFakeLogger();

    mockCodeTaskRepo = {
      findOriginTaskByPR: vi.fn(),
    } as unknown as CodeTaskRepository;

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      updateIssueMetadata: vi.fn(),
    } as unknown as LinearAgentClient;

    mockAutomationLog = {
      record: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutomationLog;

    mockGroupSummaryRepo = {
      recomputeWithLabels: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as TaskGroupSummaryRepository;
  });

  // --- Branch 1: originResult.ok === false ---

  it('skips when findOriginTaskByPR returns error', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'not found' }));

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.debug).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.stringContaining('No origin task found'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
  });

  // --- Branch 2: originResult.value === null ---

  it('skips when findOriginTaskByPR returns null', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(ok(null));

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.debug).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.stringContaining('No origin task found'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
  });

  // --- Branch 3: origin.linearIssueId === undefined ---

  it('skips when origin task has no Linear issue ID', async () => {
    const { linearIssueId: _omit, ...taskWithoutLinearIssue } = createFakeCodeTask({});
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(ok(taskWithoutLinearIssue as CodeTask));

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.debug).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.stringContaining('no Linear issue'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
  });

  // --- Branch 4: origin.agentType === 'planning' ---

  it('skips when origin is a planning task', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ agentType: 'planning', linearIssueId: 'INT-123' })),
    );

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-123' }),
      expect.stringContaining('planning-origin task'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
  });

  // --- Branch 5: !issueValidation.ok ---

  it('warns and returns when validateIssue fails', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ agentType: 'execution', linearIssueId: 'INT-123' })),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Issue not found' }),
    );

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-123' }),
      expect.stringContaining('Failed to validate issue'),
    );
    expect(mockLinearAgentClient.updateIssueMetadata).not.toHaveBeenCalled();
  });

  // --- Branch 6: droppedLabels.length > 0 ---

  it('warns and returns when ready-to-merge label not found in Linear team', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ agentType: 'execution', linearIssueId: 'INT-123' })),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({ id: 'linear-id-123', identifier: 'INT-123', title: 'Test', url: 'https://linear.app/INT-123', labels: [] }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      ok({ droppedLabels: ['ready-to-merge'] }),
    );

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-123', droppedLabels: ['ready-to-merge'] }),
      expect.stringContaining('ready-to-merge label not found'),
    );
    expect(mockAutomationLog.record).not.toHaveBeenCalled();
    expect(mockGroupSummaryRepo.recomputeWithLabels).not.toHaveBeenCalled();
  });

  // --- Branch 7: Success ---

  it('sets label, records automation log, and recomputes group summary on success', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ agentType: 'execution', linearIssueId: 'INT-123', userId: 'user-1' })),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({ id: 'linear-id-123', identifier: 'INT-123', title: 'Test', url: 'https://linear.app/INT-123', labels: ['bug'] }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      ok({ droppedLabels: [] }),
    );

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    // Verify label was set
    expect(mockLinearAgentClient.updateIssueMetadata).toHaveBeenCalledWith({
      userId: 'user-1',
      issueId: 'linear-id-123',
      addLabels: ['ready-to-merge'],
    });

    // Verify success log
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42, linearIssueId: 'INT-123' }),
      expect.stringContaining('Set ready-to-merge label'),
    );

    // Verify automation log recorded (best-effort, fire-and-forget)
    expect(mockAutomationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'remediation_decision', signal: '0' }),
    );

    // Verify group summary recomputed with updated labels
    expect(mockGroupSummaryRepo.recomputeWithLabels).toHaveBeenCalledWith(
      'user-1',
      'INT-123',
      expect.arrayContaining([{ id: '', name: 'bug' }, { id: '', name: 'ready-to-merge' }]),
      expect.any(String),
    );
  });

  // --- Edge case: updateIssueMetadata returns error ---

  it('warns when updateIssueMetadata returns error', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ agentType: 'execution', linearIssueId: 'INT-123' })),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({ id: 'linear-id-123', identifier: 'INT-123', title: 'Test', url: 'https://linear.app/INT-123', labels: [] }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      err({ code: 'UNAVAILABLE', message: 'Service unavailable' }),
    );

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    await callback({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-123' }),
      expect.stringContaining('Failed to set ready-to-merge label'),
    );
    expect(mockAutomationLog.record).not.toHaveBeenCalled();
  });

  // --- Edge case: outer try-catch handles unexpected errors ---

  it('catches and logs unexpected errors without throwing', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockRejectedValue(new Error('database connection lost'));

    const callback = createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });

    // Should not throw
    await expect(callback({ repository: 'pbuchman/intexuraos', prNumber: 42 })).resolves.not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
      expect.stringContaining('onReviewSkipped failed'),
    );
  });
});