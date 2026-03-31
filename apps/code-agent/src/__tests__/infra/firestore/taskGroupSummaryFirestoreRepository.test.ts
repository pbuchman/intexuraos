/**
 * Tests for TaskGroupSummary Firestore repository.
 * Test-first development: Tests written before implementation.
 *
 * Note: FakeTransaction does not implement FieldValue.increment.
 * Counter updates use direct read-compute-write inside transactions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createTaskGroupSummaryFirestoreRepository } from '../../../infra/firestore/taskGroupSummaryFirestoreRepository.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';

describe('taskGroupSummaryFirestoreRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    resetFirestore();
  });

  function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    return {
      id: 'task-1',
      traceId: 'trace-1',
      userId: 'user-1',
      workerType: 'sonnet',
      workerLocation: 'home-dev',
      status: 'planned',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'abc123',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      dedupKey: 'abc123',
      callbackReceived: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  describe('updateAfterCreate', () => {
    it('creates summary doc for new group', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-1',
        userId: 'user-1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('userId')).toBe('user-1');
      expect(doc.get('groupKey')).toBe('INT-100');
      expect(doc.get('linearIssueId')).toBe('INT-100');
      expect(doc.get('taskCount')).toBe(1);
      expect(doc.get('activeTaskCount')).toBe(0);
      expect(doc.get('hasCompletedPlanning')).toBe(true);
      expect(doc.get('agentTypesPresent')).toContain('planning');
    });

    it('increments existing group summary', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-100',
        agentType: 'execution',
        status: 'implemented',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(doc.get('taskCount')).toBe(2);
      expect(doc.get('hasCompletedExecution')).toBe(true);
      const agentTypes = doc.get('agentTypesPresent') as string[];
      expect(agentTypes).toContain('planning');
      expect(agentTypes).toContain('execution');
    });

    it('sets activeTaskCount when task is active', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-100',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(doc.get('activeTaskCount')).toBe(1);
      expect(doc.get('aggregateStatus')).toBe('active');
    });

    it('updates user_group_counts with new group', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const countsDoc = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsDoc.exists).toBe(true);
      expect(countsDoc.get('totalGroups')).toBe(1);
    });

    it('uses standalone key when no linearIssueId', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-standalone',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore
        .collection('task_group_summaries')
        .doc('user-1_standalone_task-standalone')
        .get();
      expect(doc.exists).toBe(true);
      expect(doc.get('linearIssueId')).toBeNull();
    });
  });

  describe('updateAfterStatusChange', () => {
    it('updates activeTaskCount on status transition (active -> done)', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const oldTask = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-100',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });
      const newTask = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(oldTask);

      const beforeDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(beforeDoc.get('activeTaskCount')).toBe(1);

      await repo.updateAfterStatusChange(oldTask, newTask);

      const afterDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(afterDoc.get('activeTaskCount')).toBe(0);
    });

    it('updates aggregateStatus when transitioning from active to done', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const oldTask = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-200',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });
      const newTask = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-200',
        status: 'failed',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(oldTask);
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-200').get();
      expect(doc.get('aggregateStatus')).toBe('failed');
      expect(doc.get('latestTaskStatus')).toBe('failed');
    });

    it('handles archive: decrements taskCount', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-300',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-300',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const oldTask = { ...task1, status: 'planned' as const };
      const archivedTask = { ...task1, status: 'archived' as const };
      await repo.updateAfterStatusChange(oldTask, archivedTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-300').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('taskCount')).toBe(1);
    });

    it('deletes summary when last task archived', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-400',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const beforeDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-400').get();
      expect(beforeDoc.exists).toBe(true);

      const archivedTask = { ...task, status: 'archived' as const };
      await repo.updateAfterStatusChange(task, archivedTask);

      const afterDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-400').get();
      expect(afterDoc.exists).toBe(false);
    });

    it('logs warning when summary doc not found', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const oldTask = makeTask({ id: 'task-x', linearIssueId: 'INT-MISSING', status: 'running', createdAt: now, updatedAt: now });
      const newTask = makeTask({ id: 'task-x', linearIssueId: 'INT-MISSING', status: 'planned', createdAt: now, updatedAt: now });

      await repo.updateAfterStatusChange(oldTask, newTask);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ groupKey: 'INT-MISSING' }),
        expect.stringContaining('summary doc not found')
      );
    });
  });

  describe('updateAfterDelete', () => {
    it('decrements task count', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-500',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-500',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      await repo.updateAfterDelete(task1);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-500').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('taskCount')).toBe(1);
    });

    it('deletes summary when last task removed', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-600',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const beforeDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-600').get();
      expect(beforeDoc.exists).toBe(true);

      await repo.updateAfterDelete(task);

      const afterDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-600').get();
      expect(afterDoc.exists).toBe(false);
    });

    it('does nothing when summary does not exist', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({ id: 'nonexistent', linearIssueId: 'INT-NONE', status: 'planned', createdAt: now, updatedAt: now });

      // Should not throw
      await expect(repo.updateAfterDelete(task)).resolves.toBeUndefined();
    });
  });

  describe('getUserGroupCounts', () => {
    it('returns zeros for nonexistent user', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.getUserGroupCounts('nonexistent-user');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totalGroups).toBe(0);
      expect(result.value.active).toBe(0);
      expect(result.value.needsAction).toBe(0);
      expect(result.value.done).toBe(0);
      expect(result.value.failed).toBe(0);
    });

    it('returns stored counts', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      fakeFirestore.seedCollection('user_group_counts', [{
        id: 'user-counts',
        data: {
          userId: 'user-counts',
          active: 3,
          needsAction: 2,
          done: 10,
          failed: 1,
          totalGroups: 16,
          updatedAt: now,
        },
      }]);

      const result = await repo.getUserGroupCounts('user-counts');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.active).toBe(3);
      expect(result.value.needsAction).toBe(2);
      expect(result.value.done).toBe(10);
      expect(result.value.failed).toBe(1);
      expect(result.value.totalGroups).toBe(16);
    });
  });

  describe('listGroupSummaries', () => {
    it('returns filtered results by aggregateStatus', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      fakeFirestore.seedCollection('task_group_summaries', [
        {
          id: 'user-1_INT-1',
          data: {
            userId: 'user-1',
            groupKey: 'INT-1',
            linearIssueId: 'INT-1',
            taskCount: 1,
            activeTaskCount: 1,
            latestTaskStatus: 'running',
            latestTaskUpdatedAt: now,
            agentTypesPresent: ['execution'],
            hasCompletedPlanning: false,
            hasCompletedExecution: false,
            hasImplementationTaskId: false,
            hasPrUrl: false,
            prNumber: null,
            latestReviewNeedsRemediation: null,
            oldestTaskCreatedAt: now,
            mostRecentDispatchedAt: now,
            aggregateStatus: 'active',
            updatedAt: now,
          },
        },
        {
          id: 'user-1_INT-2',
          data: {
            userId: 'user-1',
            groupKey: 'INT-2',
            linearIssueId: 'INT-2',
            taskCount: 1,
            activeTaskCount: 0,
            latestTaskStatus: 'failed',
            latestTaskUpdatedAt: now,
            agentTypesPresent: ['execution'],
            hasCompletedPlanning: false,
            hasCompletedExecution: false,
            hasImplementationTaskId: false,
            hasPrUrl: false,
            prNumber: null,
            latestReviewNeedsRemediation: null,
            oldestTaskCreatedAt: now,
            mostRecentDispatchedAt: null,
            aggregateStatus: 'failed',
            updatedAt: now,
          },
        },
      ]);

      const result = await repo.listGroupSummaries({
        userId: 'user-1',
        statusFilter: ['active'],
        sortBy: 'linear-id',
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries).toHaveLength(1);
      expect(result.value.summaries[0]?.groupKey).toBe('INT-1');
    });

    it('respects limit and returns nextCursor', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const makeSummaryDoc = (groupKey: string, linearIssueId: string): { id: string; data: Record<string, unknown> } => ({
        id: `user-1_${groupKey}`,
        data: {
          userId: 'user-1',
          groupKey,
          linearIssueId,
          taskCount: 1,
          activeTaskCount: 0,
          latestTaskStatus: 'planned',
          latestTaskUpdatedAt: now,
          agentTypesPresent: ['planning'],
          hasCompletedPlanning: true,
          hasCompletedExecution: false,
          hasImplementationTaskId: false,
          hasPrUrl: false,
          prNumber: null,
          latestReviewNeedsRemediation: null,
          oldestTaskCreatedAt: now,
          mostRecentDispatchedAt: null,
          aggregateStatus: 'done',
          updatedAt: now,
        },
      });

      fakeFirestore.seedCollection('task_group_summaries', [
        makeSummaryDoc('INT-10', 'INT-10'),
        makeSummaryDoc('INT-20', 'INT-20'),
        makeSummaryDoc('INT-30', 'INT-30'),
      ]);

      const result = await repo.listGroupSummaries({
        userId: 'user-1',
        sortBy: 'linear-id',
        limit: 2,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries).toHaveLength(2);
      expect(result.value.nextCursor).toBeDefined();
    });

    it('returns all results when no statusFilter provided', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      fakeFirestore.seedCollection('task_group_summaries', [
        {
          id: 'user-2_INT-A',
          data: {
            userId: 'user-2',
            groupKey: 'INT-A',
            linearIssueId: 'INT-A',
            taskCount: 1,
            activeTaskCount: 0,
            latestTaskStatus: 'planned',
            latestTaskUpdatedAt: now,
            agentTypesPresent: ['planning'],
            hasCompletedPlanning: true,
            hasCompletedExecution: false,
            hasImplementationTaskId: false,
            hasPrUrl: false,
            prNumber: null,
            latestReviewNeedsRemediation: null,
            oldestTaskCreatedAt: now,
            mostRecentDispatchedAt: null,
            aggregateStatus: 'needs-action',
            updatedAt: now,
          },
        },
      ]);

      const result = await repo.listGroupSummaries({
        userId: 'user-2',
        sortBy: 'created-time',
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries).toHaveLength(1);
    });
  });

  describe('recomputeGroupFromTasks', () => {
    it('builds summary from task array', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));

      const task1 = makeTask({
        id: 'task-1',
        userId: 'user-3',
        linearIssueId: 'INT-700',
        agentType: 'planning',
        status: 'planned',
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-2',
        userId: 'user-3',
        linearIssueId: 'INT-700',
        agentType: 'execution',
        status: 'implemented',
        createdAt: t2,
        updatedAt: t2,
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
        prNumber: 42,
      });

      await repo.recomputeGroupFromTasks('user-3', 'INT-700', [task1, task2]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-700').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('taskCount')).toBe(2);
      expect(doc.get('hasCompletedPlanning')).toBe(true);
      expect(doc.get('hasCompletedExecution')).toBe(true);
      expect(doc.get('hasPrUrl')).toBe(true);
      expect(doc.get('prNumber')).toBe(42);
      expect(doc.get('userId')).toBe('user-3');
      expect(doc.get('groupKey')).toBe('INT-700');
    });

    it('does nothing when tasks array is empty', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.recomputeGroupFromTasks('user-3', 'INT-EMPTY', []);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-EMPTY').get();
      expect(doc.exists).toBe(false);
    });

    it('does nothing when all tasks are archived', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-archived',
        userId: 'user-3',
        linearIssueId: 'INT-ARCHIVED',
        status: 'archived',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-3', 'INT-ARCHIVED', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-ARCHIVED').get();
      expect(doc.exists).toBe(false);
    });

    it('correctly sets aggregateStatus for active tasks', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-running',
        userId: 'user-3',
        linearIssueId: 'INT-RUNNING',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-3', 'INT-RUNNING', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-RUNNING').get();
      expect(doc.get('aggregateStatus')).toBe('active');
      expect(doc.get('activeTaskCount')).toBe(1);
    });
  });
});
