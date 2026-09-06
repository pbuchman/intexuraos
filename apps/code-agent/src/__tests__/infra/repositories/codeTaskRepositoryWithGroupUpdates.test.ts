/**
 * Tests for codeTaskRepositoryWithGroupUpdates decorator.
 *
 * Verifies that the decorator:
 * - Calls the correct summary repo methods on create/update/deleteTask
 * - Does NOT call summary methods when inner operations fail
 * - Still returns success even if summary update throws
 * - Passes through all read methods unchanged
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type FirebaseFirestore from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput, UpdateTaskInput } from '../../../domain/repositories/codeTaskRepository.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import { withGroupUpdates } from '../../../infra/firestore/codeTaskRepositoryWithGroupUpdates.js';
import {
  createFakeTaskGroupSummaryRepository,
  type FakeTaskGroupSummaryRepository,
} from '../../fakes/fakeTaskGroupSummaryRepository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTimestamp(): Timestamp {
  return Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
}

function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    traceId: 'trace-1',
    userId: 'user-1',
    workerType: 'opus',
    workerLocation: 'home-mac',
    status: 'queued',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'fix the bug',
    systemPromptHash: 'abc123',
    repository: 'test/repo',
    baseBranch: 'main',
    createdAt: makeTimestamp(),
    updatedAt: makeTimestamp(),
    callbackReceived: false,
    dedupKey: 'deadbeef00000001',
    ...overrides,
  };
}

const NOT_FOUND_ERROR = { code: 'NOT_FOUND' as const, message: 'task not found' };
const FIRESTORE_ERROR = { code: 'FIRESTORE_ERROR' as const, message: 'firestore blew up' };

/**
 * Minimal fake inner CodeTaskRepository.
 * All methods are vi.fn() stubs that can be configured per test.
 */
function createFakeInnerRepo(): CodeTaskRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdForUser: vi.fn(),
    findByIdsForUser: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    hasActiveTaskForLinearIssue: vi.fn(),
    findZombieTasks: vi.fn(),
    countByUserToday: vi.fn(),
    findByPR: vi.fn(),
    findRecentTasksByPR: vi.fn(),
    findActiveReviewForPR: vi.fn(),
    hasDispatchedOrRunningForPR: vi.fn(),
    hasOtherDispatchedOrRunningForLinearIssue: vi.fn(),
    claimForDispatch: vi.fn(),
    rollbackDispatch: vi.fn(),
    findLatestExecutionTaskByPR: vi.fn(),
    findOriginTaskByPR: vi.fn(),
    findRecentTasksByLinearIssue: vi.fn(),
    findRecentRemediationForPR: vi.fn(),
    findPreservedPullRequestTask: vi.fn(),
    findLatestAskAgentTask: vi.fn(),
    deleteTask: vi.fn(),
    listQueuedByAge: vi.fn(),
    listQueued: vi.fn(),
    countQueued: vi.fn(),
    findPlannedTaskByLinearIssue: vi.fn(),
    listAllNonArchived: vi.fn(),
    listPendingExecutionMemoryPostRun: vi.fn(),
    listErroredExecutionMemoryPostRun: vi.fn(),
    listAllNonArchivedGlobal: vi.fn(),
    findAllNonArchived: vi.fn(),
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withGroupUpdates decorator', () => {
  let inner: CodeTaskRepository;
  let groupSummaryRepo: FakeTaskGroupSummaryRepository;
  let logger: Logger;
  let decorated: CodeTaskRepository;

  beforeEach(() => {
    inner = createFakeInnerRepo();
    groupSummaryRepo = createFakeTaskGroupSummaryRepository();
    logger = makeLogger();
    decorated = withGroupUpdates(inner, groupSummaryRepo, logger);
  });

  afterEach(() => {
    groupSummaryRepo.reset();
  });

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe('create()', () => {
    const baseInput: CreateTaskInput = {
      userId: 'user-1',
      prompt: 'Fix bug',
      sanitizedPrompt: 'fix bug',
      systemPromptHash: 'abc',
      workerType: 'opus',
      workerLocation: 'home-mac',
      repository: 'test/repo',
      baseBranch: 'main',
      traceId: 'trace-1',
    };

    it('calls inner.create and then updateAfterCreate on success', async () => {
      const task = makeTask();
      vi.mocked(inner.create).mockResolvedValue(ok(task));
      const updateAfterCreateSpy = vi.spyOn(groupSummaryRepo, 'updateAfterCreate');

      const result = await decorated.create(baseInput);

      expect(result).toEqual(ok(task));
      expect(inner.create).toHaveBeenCalledWith(baseInput, undefined);
      // fire-and-forget: flush microtasks so the void promise runs
      await Promise.resolve();
      expect(updateAfterCreateSpy).toHaveBeenCalledWith(task);
    });

    it('does NOT call updateAfterCreate when inner.create fails', async () => {
      vi.mocked(inner.create).mockResolvedValue(err(NOT_FOUND_ERROR));
      const updateAfterCreateSpy = vi.spyOn(groupSummaryRepo, 'updateAfterCreate');

      const result = await decorated.create(baseInput);

      expect(result.ok).toBe(false);
      await Promise.resolve();
      expect(updateAfterCreateSpy).not.toHaveBeenCalled();
    });

    it('still returns success even if summary update throws', async () => {
      const task = makeTask();
      vi.mocked(inner.create).mockResolvedValue(ok(task));
      vi.spyOn(groupSummaryRepo, 'updateAfterCreate').mockRejectedValue(new Error('Firestore unavailable'));

      const result = await decorated.create(baseInput);

      expect(result).toEqual(ok(task));
      // Let the fire-and-forget rejection settle; decorator should not propagate it
      await Promise.resolve();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Group summary update failed after create',
      );
    });

    it('does NOT call updateAfterCreate for ask_agent tasks', async () => {
      const askTask = makeTask({ agentType: 'ask_agent' });
      vi.mocked(inner.create).mockResolvedValue(ok(askTask));
      const updateAfterCreateSpy = vi.spyOn(groupSummaryRepo, 'updateAfterCreate');

      await decorated.create(baseInput);

      await Promise.resolve();
      expect(updateAfterCreateSpy).not.toHaveBeenCalled();
    });

    it('defers create-side group maintenance when the outer transaction is not committed yet', async () => {
      const task = makeTask();
      const transaction = {} as FirebaseFirestore.Transaction;
      vi.mocked(inner.create).mockResolvedValue(ok(task));
      const updateAfterCreateSpy = vi.spyOn(groupSummaryRepo, 'updateAfterCreate');

      const result = await decorated.create(baseInput, { transaction });

      expect(result).toEqual(ok(task));
      expect(inner.create).toHaveBeenCalledWith(baseInput, { transaction });
      await Promise.resolve();
      expect(updateAfterCreateSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------

  describe('update()', () => {
    it('reads old task, calls inner.update, then calls updateAfterStatusChange on status change', async () => {
      const oldTask = makeTask({ status: 'running' });
      const newTask = makeTask({ status: 'implemented' });
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      const result = await decorated.update('task-1', { status: 'implemented' });

      expect(result).toEqual(ok(newTask));
      expect(inner.findById).toHaveBeenCalledWith('task-1');
      expect(inner.update).toHaveBeenCalledWith('task-1', { status: 'implemented' }, undefined);
      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).toHaveBeenCalledWith(oldTask, newTask);
    });

    it('does NOT call findById or updateAfterStatusChange when status is not in input', async () => {
      const newTask = makeTask({ workerLocation: 'office-pc' });
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      const result = await decorated.update('task-1', { workerLocation: 'office-pc' });

      expect(result).toEqual(ok(newTask));
      expect(inner.findById).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).not.toHaveBeenCalled();
    });

    it('refreshes group summaries when merge-ready evidence changes without a status change', async () => {
      const oldTask = makeTask({
        id: 'task-review',
        status: 'reviewed',
        agentType: 'review',
        result: { needs_remediation: '0' },
      });
      const newTask = {
        ...oldTask,
        result: {
          ...oldTask.result,
          merge_ready: '1' as const,
          merge_ready_reason: 'review_no_remediation' as const,
        },
      };
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      const result = await decorated.update('task-review', {
        result: {
          ...newTask.result,
        },
      });

      expect(result).toEqual(ok(newTask));
      expect(inner.findById).toHaveBeenCalledWith('task-review');
      expect(inner.update).toHaveBeenCalledWith(
        'task-review',
        { result: newTask.result },
        undefined,
      );
      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).toHaveBeenCalledWith(oldTask, newTask);
    });

    it('refreshes group summaries when merge-ready invalidating evidence changes without a status change', async () => {
      const oldTask = makeTask({
        id: 'task-pull-request',
        status: 'implemented',
        agentType: 'pull_request',
        result: { prUrl: 'https://github.com/test/repo/pull/42' },
      });
      const newTask = {
        ...oldTask,
        result: {
          ...oldTask.result,
          pull_request_outcome_label: 'commits_pushed' as const,
        },
      };
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      const result = await decorated.update('task-pull-request', {
        result: {
          ...newTask.result,
        },
      });

      expect(result).toEqual(ok(newTask));
      expect(inner.findById).toHaveBeenCalledWith('task-pull-request');
      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).toHaveBeenCalledWith(oldTask, newTask);
    });

    it.each([
      {
        name: 'result.prUrl',
        input: { result: { prUrl: 'https://github.com/test/repo/pull/42' } },
      },
      { name: 'prNumber', input: { prNumber: 42 } },
      { name: 'implementationTaskId', input: { implementationTaskId: 'task-implementation' } },
      { name: 'fanOutChildTaskIds', input: { fanOutChildTaskIds: ['task-child'] } },
      { name: 'requiresReReview', input: { requiresReReview: false } },
    ])('refreshes summary-purpose metadata for $name without a lifecycle change', async ({ input }) => {
      const oldTask = makeTask({
        id: 'task-metadata',
        linearIssueId: 'INT-METADATA',
        status: 'implemented',
        statusChangedAt: Timestamp.fromDate(new Date('2026-07-27T10:00:00Z')),
      });
      const newTask = makeTask({
        ...oldTask,
        ...input,
        updatedAt: Timestamp.fromDate(new Date('2026-07-27T12:00:00Z')),
      });
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      await decorated.update('task-metadata', input as UpdateTaskInput);

      await vi.waitFor(() => {
        expect(updateAfterStatusChangeSpy).toHaveBeenCalledWith(oldTask, newTask);
      });
    });

    it('requests an authoritative group-scoped recompute after archiving', async () => {
      const oldTask = makeTask({
        id: 'task-B',
        linearIssueId: 'INT-ARCHIVE',
        agentType: 'execution',
        status: 'implemented',
        createdAt: Timestamp.fromDate(new Date('2026-07-27T09:00:00Z')),
      });
      const archivedTask = makeTask({
        ...oldTask,
        status: 'archived',
        statusChangedAt: Timestamp.fromDate(new Date('2026-07-27T12:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-07-27T12:00:00Z')),
      });
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(archivedTask));
      const recomputeSpy = vi.spyOn(groupSummaryRepo, 'recomputeGroupFromSource');

      await decorated.update('task-B', { status: 'archived' });

      await vi.waitFor(() => {
        expect(recomputeSpy).toHaveBeenCalledWith('user-1', 'INT-ARCHIVE');
      });
      expect(inner.listAllNonArchived).not.toHaveBeenCalled();
    });

    it('keeps all-archived summary semantics when no displayable task remains', async () => {
      const oldTask = makeTask({ id: 'task-only', linearIssueId: 'INT-ALL-ARCHIVED', status: 'implemented' });
      const archivedTask = makeTask({ ...oldTask, status: 'archived' });
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(archivedTask));
      const updateSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');
      const recomputeSpy = vi.spyOn(groupSummaryRepo, 'recomputeGroupFromSource');

      await decorated.update('task-only', { status: 'archived' });

      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledWith(oldTask, archivedTask));
      expect(recomputeSpy).toHaveBeenCalledWith('user-1', 'INT-ALL-ARCHIVED');
    });

    it.each([
      {
        field: 'prMergedAt' as const,
        terminalAt: new Date('2026-07-05T08:00:00.000Z'),
      },
      {
        field: 'prClosedAt' as const,
        terminalAt: new Date('2026-07-05T08:30:00.000Z'),
      },
    ])('refreshes group summaries when $field changes without a status change', async ({ field, terminalAt }) => {
      const oldTask = makeTask({
        id: 'task-terminal-pr',
        status: 'implemented',
        agentType: 'execution',
        prNumber: 2312,
        result: {
          merge_ready: '1',
          merge_ready_reason: 'remediation_already_completed',
        },
      });
      const newTask = {
        ...oldTask,
        [field]: Timestamp.fromDate(terminalAt),
      };
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      const result = await decorated.update('task-terminal-pr', { [field]: terminalAt });

      expect(result).toEqual(ok(newTask));
      expect(inner.findById).toHaveBeenCalledWith('task-terminal-pr');
      expect(inner.update).toHaveBeenCalledWith(
        'task-terminal-pr',
        { [field]: terminalAt },
        undefined,
      );
      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).toHaveBeenCalledWith(oldTask, newTask);
    });

    it('does NOT call updateAfterStatusChange when inner.update fails', async () => {
      const oldTask = makeTask({ status: 'running' });
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(err(FIRESTORE_ERROR));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      const result = await decorated.update('task-1', { status: 'failed' });

      expect(result.ok).toBe(false);
      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).not.toHaveBeenCalled();
    });

    it('still returns success even if summary update throws', async () => {
      const oldTask = makeTask({ status: 'running' });
      const newTask = makeTask({ status: 'implemented' });
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange').mockRejectedValue(new Error('boom'));

      const result = await decorated.update('task-1', { status: 'implemented' });

      expect(result).toEqual(ok(newTask));
      await Promise.resolve();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error), taskId: 'task-1' }),
        'Group summary update failed after status change',
      );
    });

    it('does NOT call updateAfterStatusChange for ask_agent tasks', async () => {
      const oldTask = makeTask({ agentType: 'ask_agent', status: 'running' });
      const newTask = makeTask({ agentType: 'ask_agent', status: 'reviewed' });
      vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      await decorated.update('task-1', { status: 'reviewed' });

      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).not.toHaveBeenCalled();
    });

    it('passes transaction options through and skips group summary side effects', async () => {
      const newTask = makeTask({ status: 'failed' });
      const transaction = {} as FirebaseFirestore.Transaction;
      vi.mocked(inner.update).mockResolvedValue(ok(newTask));
      const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

      const result = await decorated.update('task-1', { status: 'failed' }, { transaction });

      expect(result).toEqual(ok(newTask));
      expect(inner.findById).not.toHaveBeenCalled();
      expect(inner.update).toHaveBeenCalledWith('task-1', { status: 'failed' }, { transaction });
      await Promise.resolve();
      expect(updateAfterStatusChangeSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // deleteTask()
  // -------------------------------------------------------------------------

  describe('deleteTask()', () => {
    it('reads old task, calls inner.deleteTask, then calls updateAfterDelete on success', async () => {
      const task = makeTask();
      vi.mocked(inner.findByIdForUser).mockResolvedValue(ok(task));
      vi.mocked(inner.deleteTask).mockResolvedValue(ok(undefined));
      const updateAfterDeleteSpy = vi.spyOn(groupSummaryRepo, 'updateAfterDelete');

      const result = await decorated.deleteTask('task-1', 'user-1');

      expect(result).toEqual(ok(undefined));
      expect(inner.findByIdForUser).toHaveBeenCalledWith('task-1', 'user-1');
      expect(inner.deleteTask).toHaveBeenCalledWith('task-1', 'user-1');
      await Promise.resolve();
      expect(updateAfterDeleteSpy).toHaveBeenCalledWith(task);
    });

    it('requests an authoritative group-scoped recompute after delete', async () => {
      const deletedTask = makeTask({ id: 'task-B', linearIssueId: 'INT-DELETE', agentType: 'execution' });
      vi.mocked(inner.findByIdForUser).mockResolvedValue(ok(deletedTask));
      vi.mocked(inner.deleteTask).mockResolvedValue(ok(undefined));
      const recomputeSpy = vi.spyOn(groupSummaryRepo, 'recomputeGroupFromSource');

      await decorated.deleteTask('task-B', 'user-1');

      await vi.waitFor(() => {
        expect(recomputeSpy).toHaveBeenCalledWith('user-1', 'INT-DELETE');
      });
      expect(inner.listAllNonArchived).not.toHaveBeenCalled();
    });

    it('serializes same-group fire-and-forget maintenance so an earlier write cannot finish after delete', async () => {
      const task = makeTask({ id: 'task-B', linearIssueId: 'INT-SERIAL', status: 'running' });
      const updatedTask = makeTask({ ...task, status: 'implemented' });
      let releaseFirstUpdate: (() => void) | undefined;
      const firstUpdate = new Promise<void>((resolve) => {
        releaseFirstUpdate = resolve;
      });
      vi.mocked(inner.findById).mockResolvedValue(ok(task));
      vi.mocked(inner.update).mockResolvedValue(ok(updatedTask));
      vi.mocked(inner.findByIdForUser).mockResolvedValue(ok(updatedTask));
      vi.mocked(inner.deleteTask).mockResolvedValue(ok(undefined));
      vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange').mockReturnValue(firstUpdate);
      const deleteSummarySpy = vi.spyOn(groupSummaryRepo, 'updateAfterDelete');

      await decorated.update('task-B', { status: 'implemented' });
      await decorated.deleteTask('task-B', 'user-1');
      await Promise.resolve();
      expect(deleteSummarySpy).not.toHaveBeenCalled();

      releaseFirstUpdate?.();
      await vi.waitFor(() => expect(deleteSummarySpy).toHaveBeenCalledWith(updatedTask));
    });

    it('does NOT call updateAfterDelete when inner.deleteTask fails', async () => {
      const task = makeTask();
      vi.mocked(inner.findByIdForUser).mockResolvedValue(ok(task));
      vi.mocked(inner.deleteTask).mockResolvedValue(err(NOT_FOUND_ERROR));
      const updateAfterDeleteSpy = vi.spyOn(groupSummaryRepo, 'updateAfterDelete');

      const result = await decorated.deleteTask('task-1', 'user-1');

      expect(result.ok).toBe(false);
      await Promise.resolve();
      expect(updateAfterDeleteSpy).not.toHaveBeenCalled();
    });

    it('still returns success even if summary update throws', async () => {
      const task = makeTask();
      vi.mocked(inner.findByIdForUser).mockResolvedValue(ok(task));
      vi.mocked(inner.deleteTask).mockResolvedValue(ok(undefined));
      vi.spyOn(groupSummaryRepo, 'updateAfterDelete').mockRejectedValue(new Error('network timeout'));

      const result = await decorated.deleteTask('task-1', 'user-1');

      expect(result).toEqual(ok(undefined));
      await Promise.resolve();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error), taskId: 'task-1' }),
        'Group summary update failed after delete',
      );
    });

    it('does NOT call updateAfterDelete for ask_agent tasks', async () => {
      const askTask = makeTask({ agentType: 'ask_agent' });
      vi.mocked(inner.findByIdForUser).mockResolvedValue(ok(askTask));
      vi.mocked(inner.deleteTask).mockResolvedValue(ok(undefined));
      const updateAfterDeleteSpy = vi.spyOn(groupSummaryRepo, 'updateAfterDelete');

      const result = await decorated.deleteTask('task-1', 'user-1');

      expect(result).toEqual(ok(undefined));
      await Promise.resolve();
      expect(updateAfterDeleteSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Read methods pass through unchanged
  // -------------------------------------------------------------------------

  describe('read methods', () => {
    it('findById passes through to inner', async () => {
      const task = makeTask();
      vi.mocked(inner.findById).mockResolvedValue(ok(task));

      const result = await decorated.findById('task-1');

      expect(result).toEqual(ok(task));
      expect(inner.findById).toHaveBeenCalledWith('task-1');
    });

    it('findByIdForUser passes through to inner', async () => {
      const task = makeTask();
      vi.mocked(inner.findByIdForUser).mockResolvedValue(ok(task));

      const result = await decorated.findByIdForUser('task-1', 'user-1');

      expect(result).toEqual(ok(task));
      expect(inner.findByIdForUser).toHaveBeenCalledWith('task-1', 'user-1');
    });

    it('list passes through to inner', async () => {
      const listOutput = { tasks: [makeTask()] };
      vi.mocked(inner.list).mockResolvedValue(ok(listOutput));

      const result = await decorated.list({ userId: 'user-1' });

      expect(result).toEqual(ok(listOutput));
      expect(inner.list).toHaveBeenCalledWith({ userId: 'user-1' });
    });

    it('listAllNonArchived passes through to inner', async () => {
      const tasks = [makeTask()];
      vi.mocked(inner.listAllNonArchived).mockResolvedValue(ok(tasks));

      const result = await decorated.listAllNonArchived('user-1');

      expect(result).toEqual(ok(tasks));
      expect(inner.listAllNonArchived).toHaveBeenCalledWith('user-1');
    });
  });
});
