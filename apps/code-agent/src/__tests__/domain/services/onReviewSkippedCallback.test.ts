/**
 * Tests for `onReviewSkippedCallback.ts` — the factory that creates the
 * `onReviewSkipped` callback for `UnifiedEvaluatorDeps`.
 *
 * The callback fires when LLM triage skips a PR review (e.g. documentation-only
 * change). It finds the origin task, validates it is an execution (not planning)
 * task, sets the `ready-to-merge` label on the Linear issue, records an
 * automation log entry, and recomputes the group summary.
 *
 * Tests cover each distinct code path:
 *  1. originResult.ok === false          → skip (debug log)
 *  2. originResult.value === null        → skip (debug log)
 *  3. origin.linearIssueId === undefined → skip (debug log)
 *  4. origin.agentType === 'planning'    → skip (info log)
 *  5. !issueValidation.ok                → warn and return
 *  6. labelResult.value.droppedLabels.length > 0 → warn and return
 *  7. Success                             → log + automation log + group summary recompute
 *  8. updateIssueMetadata returns error  → warn and return
 *  9. Unexpected error in try/catch       → warn and return
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import type { AutomationLog } from '../../../domain/ports/automationLog.js';
import type { TaskGroupSummaryRepository } from '../../../domain/ports/taskGroupSummaryRepository.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import { createOnReviewSkippedCallback } from '../../../domain/services/onReviewSkippedCallback.js';

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

  // --- Branch 7b: Success (ready-to-merge already present — no duplicate) ---

  it('does not duplicate ready-to-merge label when already present on success', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ agentType: 'execution', linearIssueId: 'INT-123', userId: 'user-1' })),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({ id: 'linear-id-123', identifier: 'INT-123', title: 'Test', url: 'https://linear.app/INT-123', labels: ['ready-to-merge'] }),
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

    // Verify group summary recomputed WITHOUT duplicating ready-to-merge
    expect(mockGroupSummaryRepo.recomputeWithLabels).toHaveBeenCalledWith(
      'user-1',
      'INT-123',
      [{ id: '', name: 'ready-to-merge' }], // no duplicate
      expect.any(String),
    );
  });

  // --- Branch 8: updateIssueMetadata returns error ---

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

  // --- Branch 9: outer try-catch handles unexpected errors ---

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