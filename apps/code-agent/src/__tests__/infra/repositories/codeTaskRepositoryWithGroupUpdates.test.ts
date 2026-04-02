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
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { CodeTaskRepository, CreateTaskInput } from '../../../domain/repositories/codeTaskRepository.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import { withGroupUpdates } from '../../../infra/repositories/codeTaskRepositoryWithGroupUpdates.js';
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
    update: vi.fn(),
    list: vi.fn(),
    hasActiveTaskForLinearIssue: vi.fn(),
    findZombieTasks: vi.fn(),
    countByUserToday: vi.fn(),
    findArchivableTasks: vi.fn(),
    archiveTaskLogs: vi.fn(),
    findByPR: vi.fn(),
    findActiveReviewForPR: vi.fn(),
    hasDispatchedOrRunningForPR: vi.fn(),
    findLatestExecutionTaskByPR: vi.fn(),
    findOriginTaskByPR: vi.fn(),
    findRecentTasksByLinearIssue: vi.fn(),
    findRecentRemediationForPR: vi.fn(),
    findPreservedPullRequestTask: vi.fn(),
    deleteTask: vi.fn(),
    listQueuedByAge: vi.fn(),
    listQueued: vi.fn(),
    countQueued: vi.fn(),
    findPlannedTaskByLinearIssue: vi.fn(),
    listAllNonArchived: vi.fn(),
    listPendingExecutionMemoryPostRun: vi.fn(),
    listAllNonArchivedGlobal: vi.fn(),
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
    const input: CreateTaskInput = {
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

      const result = await decorated.create(input);

      expect(result).toEqual(ok(task));
      expect(inner.create).toHaveBeenCalledWith(input, undefined);
      // fire-and-forget: flush microtasks so the void promise runs
      await Promise.resolve();
      expect(updateAfterCreateSpy).toHaveBeenCalledWith(task);
    });

    it('does NOT call updateAfterCreate when inner.create fails', async () => {
      vi.mocked(inner.create).mockResolvedValue(err(NOT_FOUND_ERROR));
      const updateAfterCreateSpy = vi.spyOn(groupSummaryRepo, 'updateAfterCreate');

      const result = await decorated.create(input);

      expect(result.ok).toBe(false);
      await Promise.resolve();
      expect(updateAfterCreateSpy).not.toHaveBeenCalled();
    });

    it('still returns success even if summary update throws', async () => {
      const task = makeTask();
      vi.mocked(inner.create).mockResolvedValue(ok(task));
      vi.spyOn(groupSummaryRepo, 'updateAfterCreate').mockRejectedValue(new Error('Firestore unavailable'));

      const result = await decorated.create(input);

      expect(result).toEqual(ok(task));
      // Let the fire-and-forget rejection settle; decorator should not propagate it
      await Promise.resolve();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Group summary update failed after create',
      );
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
      expect(inner.update).toHaveBeenCalledWith('task-1', { status: 'implemented' });
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
