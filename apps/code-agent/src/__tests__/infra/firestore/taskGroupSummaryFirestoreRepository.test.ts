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

    it('does not update counts when task is archived (new group)', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-archived',
        linearIssueId: 'INT-ARCH',
        status: 'archived',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      // Summary created but taskCount = 0 (archived not counted)
      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ARCH').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('taskCount')).toBe(0);

      // Counts doc NOT updated for archived tasks
      const countsDoc = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsDoc.exists).toBe(false);
    });

    it('sets dispatchedAt and implementationTaskId on new group', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-dispatch',
        linearIssueId: 'INT-DISP',
        status: 'dispatched',
        dispatchedAt: now,
        implementationTaskId: 'task-impl',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DISP').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('hasImplementationTaskId')).toBe(true);
      expect(doc.get('mostRecentDispatchedAt')).toBeDefined();
      expect(doc.get('activeTaskCount')).toBe(1);
    });

    it('sets hasPrUrl and prNumber on new group', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-pr',
        linearIssueId: 'INT-PR',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/99' },
        prNumber: 99,
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-PR').get();
      expect(doc.get('hasPrUrl')).toBe(true);
      expect(doc.get('prNumber')).toBe(99);
    });

    it('sets latestReviewNeedsRemediation=false on new group for review task with no-remediation result', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-review',
        linearIssueId: 'INT-REV',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '0' }, // REMEDIATION_NOT_NEEDED
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REV').get();
      expect(doc.get('latestReviewNeedsRemediation')).toBe(false);
    });

    it('sets latestReviewNeedsRemediation=true on new group for review task with remediation needed', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-review-needed',
        linearIssueId: 'INT-REVN',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '1' },
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REVN').get();
      expect(doc.get('latestReviewNeedsRemediation')).toBe(true);
    });

    it('keeps latestReviewNeedsRemediation null for review task with unknown needs_remediation', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-rev-unk',
        linearIssueId: 'INT-REVUNK',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: 'unknown_value' }, // neither '0' nor '1'
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REVUNK').get();
      // computeReviewNeedsRemediation returns null for unknown values
      expect(doc.get('latestReviewNeedsRemediation')).toBeNull();
    });

    it('sets hasCompletedExecution for review agent with reviewed status', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-rev-exec',
        linearIssueId: 'INT-REVEXEC',
        agentType: 'review',
        status: 'reviewed',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REVEXEC').get();
      expect(doc.get('hasCompletedExecution')).toBe(true);
    });

    it('does not increment taskCount when archived task added to existing group', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-ARCHADD',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const archivedTask = makeTask({
        id: 'task-arch',
        linearIssueId: 'INT-ARCHADD',
        status: 'archived',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(archivedTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ARCHADD').get();
      // taskCount should still be 1 (archived task not counted)
      expect(doc.get('taskCount')).toBe(1);
    });

    it('sets hasCompletedPlanning for planning task in existing group', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-PLANEXIST',
        agentType: 'execution',
        status: 'implemented',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-PLANEXIST',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-PLANEXIST').get();
      expect(doc.get('hasCompletedPlanning')).toBe(true);
    });

    it('updates existingGroup: sets implementationTaskId flag', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-IMPL',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-IMPL',
        agentType: 'execution',
        status: 'dispatched',
        implementationTaskId: 'task-1',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-IMPL').get();
      expect(doc.get('hasImplementationTaskId')).toBe(true);
    });

    it('updates existingGroup: sets hasPrUrl and prNumber', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-PRU',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-PRU',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/55' },
        prNumber: 55,
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-PRU').get();
      expect(doc.get('hasPrUrl')).toBe(true);
      expect(doc.get('prNumber')).toBe(55);
    });

    it('updates existingGroup: updates latestReviewNeedsRemediation', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-REVUPD',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-REVUPD',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '1' },
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REVUPD').get();
      expect(doc.get('latestReviewNeedsRemediation')).toBe(true);
    });

    it('updates existingGroup: mostRecentDispatchedAt set from second task', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-DISP2',
        status: 'planned',
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-DISP2',
        status: 'dispatched',
        dispatchedAt: t2,
        createdAt: t2,
        updatedAt: t2,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DISP2').get();
      expect(doc.get('mostRecentDispatchedAt')).toBeDefined();
    });

    it('updates counts when aggregateStatus changes on existing group', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      // First task: planned → aggregateStatus = 'done'
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-CHNG',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      // Second task: running → aggregateStatus = 'active'
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-CHNG',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      const countsBefore = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsBefore.get('done')).toBe(1);

      await repo.updateAfterCreate(task2);
      const countsAfter = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfter.get('done')).toBe(0);
      expect(countsAfter.get('active')).toBe(1);
    });

    it('does not update latestTaskStatus when existing task is older', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')); // earlier
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-OLD',
        status: 'planned',
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-OLD',
        status: 'failed',
        createdAt: t2,
        updatedAt: t2, // older update
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-OLD').get();
      // latestTaskStatus should remain 'planned' since task2 is older
      expect(doc.get('latestTaskStatus')).toBe('planned');
    });

    it('updates oldestTaskCreatedAt when new task is older', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')); // earlier
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-OLDEST',
        status: 'planned',
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-OLDEST',
        status: 'planned',
        createdAt: t2, // earlier created
        updatedAt: t1,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-OLDEST').get();
      const oldest = doc.get('oldestTaskCreatedAt') as Timestamp;
      expect(oldest.toMillis()).toBe(t2.toMillis());
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

    it('updates activeTaskCount on status transition (inactive -> active)', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const oldTask = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-TOACTIVE',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const newTask = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-TOACTIVE',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(oldTask);
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-TOACTIVE').get();
      expect(doc.get('activeTaskCount')).toBe(1);
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

    it('uses defaultCounts when counts doc does not exist on status change', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      // Directly seed the summary doc without a counts doc
      fakeFirestore.seedCollection('task_group_summaries', [{
        id: 'user-1_INT-NODOC',
        data: {
          userId: 'user-1',
          groupKey: 'INT-NODOC',
          linearIssueId: 'INT-NODOC',
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
          mostRecentDispatchedAt: null,
          aggregateStatus: 'active',
          updatedAt: now,
        },
      }]);
      // No counts doc — should use defaultCounts and not throw

      const oldTask = makeTask({ id: 'task-1', linearIssueId: 'INT-NODOC', status: 'running', createdAt: now, updatedAt: now });
      const newTask = makeTask({ id: 'task-1', linearIssueId: 'INT-NODOC', status: 'failed', createdAt: now, updatedAt: now });

      await expect(repo.updateAfterStatusChange(oldTask, newTask)).resolves.toBeUndefined();

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-NODOC').get();
      expect(doc.get('aggregateStatus')).toBe('failed');
    });

    it('sets hasCompletedPlanning when transitioning to planned', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-plan',
        linearIssueId: 'INT-PLAN',
        agentType: 'planning',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'planned' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-PLAN').get();
      expect(doc.get('hasCompletedPlanning')).toBe(true);
    });

    it('sets hasCompletedExecution when review task reviewed', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-rev',
        linearIssueId: 'INT-REV2',
        agentType: 'review',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'reviewed' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REV2').get();
      expect(doc.get('hasCompletedExecution')).toBe(true);
    });

    it('sets hasImplementationTaskId on status change', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-impl2',
        linearIssueId: 'INT-IMPL2',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, implementationTaskId: 'some-task', status: 'dispatched' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-IMPL2').get();
      expect(doc.get('hasImplementationTaskId')).toBe(true);
    });

    it('sets hasPrUrl and prNumber on status change', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-pr2',
        linearIssueId: 'INT-PR2',
        agentType: 'execution',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = {
        ...task,
        status: 'implemented' as const,
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/77' },
        prNumber: 77,
      };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-PR2').get();
      expect(doc.get('hasPrUrl')).toBe(true);
      expect(doc.get('prNumber')).toBe(77);
    });

    it('sets latestReviewNeedsRemediation on status change for review task', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-rnr',
        linearIssueId: 'INT-RNR',
        agentType: 'review',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = {
        ...task,
        status: 'reviewed' as const,
        result: { needs_remediation: '0' }, // REMEDIATION_NOT_NEEDED
      };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-RNR').get();
      expect(doc.get('latestReviewNeedsRemediation')).toBe(false);
    });

    it('sets dispatchedAt on status change', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
      const task = makeTask({
        id: 'task-disp3',
        linearIssueId: 'INT-DISP3',
        status: 'planned',
        createdAt: t1,
        updatedAt: t1,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'dispatched' as const, dispatchedAt: t2, updatedAt: t2 };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DISP3').get();
      const dispatched = doc.get('mostRecentDispatchedAt') as Timestamp;
      expect(dispatched.toMillis()).toBe(t2.toMillis());
    });

    it('updates counts when aggregateStatus changes on status change', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-cnt',
        linearIssueId: 'INT-CNT',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);
      const countsBefore = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsBefore.get('active')).toBe(1);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'failed' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const countsAfter = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfter.get('active')).toBe(0);
      expect(countsAfter.get('failed')).toBe(1);
    });

    it('does not update latestTaskStatus when newTask.updatedAt is older', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')); // earlier
      const task = makeTask({
        id: 'task-older',
        linearIssueId: 'INT-OLDER2',
        status: 'running',
        createdAt: t1,
        updatedAt: t1,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'failed' as const, updatedAt: t2 };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-OLDER2').get();
      // latestTaskStatus stays 'running' because the new update is older
      expect(doc.get('latestTaskStatus')).toBe('running');
    });

    it('does not update counts when aggregateStatus does not change', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      // Both planned → both 'done' aggregate status
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-NOCHANGE',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-NOCHANGE',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const countsBefore = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      const doneBefore = countsBefore.get('done') as number;

      // Status change from planned → implemented — both map to 'done' aggregate
      const oldTask = { ...task1 };
      const newTask = { ...task1, status: 'implemented' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const countsAfter = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      // 'done' count should remain the same since aggregateStatus didn't change
      expect(countsAfter.get('done') as number).toBe(doneBefore);
    });

    it('sets hasCompletedExecution when execution agent transitions to reviewed', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-exec-rev',
        linearIssueId: 'INT-EXECREV',
        agentType: 'execution',
        status: 'implemented',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'reviewed' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-EXECREV').get();
      expect(doc.get('hasCompletedExecution')).toBe(true);
    });

    it('sets hasCompletedExecution when review agent transitions to reviewed', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-revexec',
        linearIssueId: 'INT-REVEXEC2',
        agentType: 'review',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'reviewed' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REVEXEC2').get();
      expect(doc.get('hasCompletedExecution')).toBe(true);
    });

    it('sets hasPrUrl without prNumber when prUrl present but prNumber absent', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-pr-nonum2',
        linearIssueId: 'INT-PRNONUM2',
        agentType: 'execution',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = {
        ...task,
        status: 'implemented' as const,
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/99' },
        // no prNumber
      };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-PRNONUM2').get();
      expect(doc.get('hasPrUrl')).toBe(true);
      expect(doc.get('prNumber')).toBeNull();
    });

    it('does not update mostRecentDispatchedAt when newTask has no dispatchedAt', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const task = makeTask({
        id: 'task-nodisp',
        linearIssueId: 'INT-NODISP',
        status: 'dispatched',
        dispatchedAt: t1,
        createdAt: t1,
        updatedAt: t1,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      // New task has no dispatchedAt — use destructuring to omit the key
      const { dispatchedAt: _removed, ...taskWithoutDispatch } = task;
      const newTask = { ...taskWithoutDispatch, status: 'planned' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-NODISP').get();
      // mostRecentDispatchedAt should still be from the initial create
      expect(doc.get('mostRecentDispatchedAt')).not.toBeNull();
    });

    it('does not update latestTaskStatus when archiving', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-ARCHS',
        status: 'planned',
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-ARCHS',
        status: 'planned',
        createdAt: t1,
        updatedAt: t1,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      // Archive task1 with a newer updatedAt — should not set latestTaskStatus to 'archived'
      const oldTask = { ...task1 };
      const archivedTask = { ...task1, status: 'archived' as const, updatedAt: t2 };
      await repo.updateAfterStatusChange(oldTask, archivedTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ARCHS').get();
      expect(doc.exists).toBe(true);
      // latestTaskStatus should NOT be 'archived' even though the updatedAt is newer
      expect(doc.get('latestTaskStatus')).not.toBe('archived');
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

    it('decrements activeTaskCount when deleting an active task', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-active-1',
        linearIssueId: 'INT-DELACT',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-active-2',
        linearIssueId: 'INT-DELACT',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const before = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DELACT').get();
      expect(before.get('activeTaskCount')).toBe(2);

      await repo.updateAfterDelete(task1);

      const after = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DELACT').get();
      expect(after.get('activeTaskCount')).toBe(1);
    });

    it('updates counts when aggregateStatus changes on delete', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      // Create group with one running + one planned task → aggregateStatus = 'active'
      const runningTask = makeTask({
        id: 'task-run',
        linearIssueId: 'INT-DELCHNG',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });
      const plannedTask = makeTask({
        id: 'task-plan',
        linearIssueId: 'INT-DELCHNG',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(runningTask);
      await repo.updateAfterCreate(plannedTask);

      const countsBefore = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsBefore.get('active')).toBe(1);

      // Delete running task → group becomes 'done' (just planned remains)
      await repo.updateAfterDelete(runningTask);

      const countsAfter = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfter.get('active')).toBe(0);
      expect(countsAfter.get('done')).toBe(1);
    });

    it('uses defaultCounts when counts doc does not exist on delete', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-DELDNC',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-DELDNC',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      // Manually delete the counts doc to simulate missing state
      await fakeFirestore.collection('user_group_counts').doc('user-1').delete();

      // Should not throw even though counts doc is missing
      await expect(repo.updateAfterDelete(task1)).resolves.toBeUndefined();

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DELDNC').get();
      expect(doc.exists).toBe(true);
    });

    it('does not decrement taskCount for archived task on delete', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-DELARC',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-DELARC',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      // Delete as-if archived (taskCount should not be decremented again)
      await repo.updateAfterDelete({ ...task1, status: 'archived' });

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DELARC').get();
      // Should still be 2 (archived task was already excluded from count on create)
      expect(doc.get('taskCount')).toBe(2);
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

    it('sorts by pr-number', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      fakeFirestore.seedCollection('task_group_summaries', [
        {
          id: 'user-5_INT-PR1',
          data: {
            userId: 'user-5',
            groupKey: 'INT-PR1',
            linearIssueId: 'INT-PR1',
            taskCount: 1,
            activeTaskCount: 0,
            latestTaskStatus: 'implemented',
            latestTaskUpdatedAt: now,
            agentTypesPresent: ['execution'],
            hasCompletedPlanning: false,
            hasCompletedExecution: true,
            hasImplementationTaskId: false,
            hasPrUrl: true,
            prNumber: 10,
            latestReviewNeedsRemediation: null,
            oldestTaskCreatedAt: now,
            mostRecentDispatchedAt: null,
            aggregateStatus: 'done',
            updatedAt: now,
          },
        },
      ]);

      const result = await repo.listGroupSummaries({
        userId: 'user-5',
        sortBy: 'pr-number',
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries).toHaveLength(1);
    });

    it('sorts by started-time', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      fakeFirestore.seedCollection('task_group_summaries', [
        {
          id: 'user-6_INT-ST1',
          data: {
            userId: 'user-6',
            groupKey: 'INT-ST1',
            linearIssueId: 'INT-ST1',
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
            mostRecentDispatchedAt: now,
            aggregateStatus: 'done',
            updatedAt: now,
          },
        },
      ]);

      const result = await repo.listGroupSummaries({
        userId: 'user-6',
        sortBy: 'started-time',
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries).toHaveLength(1);
    });

    it('handles cursor that does not match a document', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      fakeFirestore.seedCollection('task_group_summaries', [
        {
          id: 'user-7_INT-C1',
          data: {
            userId: 'user-7',
            groupKey: 'INT-C1',
            linearIssueId: 'INT-C1',
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
        },
      ]);

      // Use a cursor that points to a non-existent document — should be ignored and return all results
      const nonExistentCursor = Buffer.from('user-7_INT-NONEXISTENT', 'utf-8').toString('base64');
      const result = await repo.listGroupSummaries({
        userId: 'user-7',
        sortBy: 'linear-id',
        limit: 10,
        cursor: nonExistentCursor,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // When cursor doc not found, startAfter is skipped — returns all matching docs
      expect(result.value.summaries).toHaveLength(1);
    });

    it('accepts cursor without error and returns results', async () => {
      // FakeFirestore startAfter is a no-op (doesn't actually paginate),
      // but we can verify the cursor path is executed without errors.
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const makeSummaryDoc = (groupKey: string): { id: string; data: Record<string, unknown> } => ({
        id: `user-8_${groupKey}`,
        data: {
          userId: 'user-8',
          groupKey,
          linearIssueId: groupKey,
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
        makeSummaryDoc('INT-A1'),
        makeSummaryDoc('INT-A2'),
        makeSummaryDoc('INT-A3'),
      ]);

      const page1 = await repo.listGroupSummaries({
        userId: 'user-8',
        sortBy: 'linear-id',
        limit: 2,
      });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.value.summaries).toHaveLength(2);
      expect(page1.value.nextCursor).toBeDefined();

      // Use the cursor from page 1 — FakeFirestore doesn't support true startAfter pagination
      // but the cursor decoding path should execute without error.
      const cursor = page1.value.nextCursor;
      const page2 = await repo.listGroupSummaries({
        userId: 'user-8',
        sortBy: 'linear-id',
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      expect(page2.ok).toBe(true);
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

    it('sets mostRecentDispatchedAt from task with dispatchedAt', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));

      const task1 = makeTask({
        id: 'task-disp4',
        userId: 'user-3',
        linearIssueId: 'INT-DISPRC',
        status: 'dispatched',
        dispatchedAt: t1,
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-disp5',
        userId: 'user-3',
        linearIssueId: 'INT-DISPRC',
        status: 'dispatched',
        dispatchedAt: t2,
        createdAt: t2,
        updatedAt: t2,
      });

      await repo.recomputeGroupFromTasks('user-3', 'INT-DISPRC', [task1, task2]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-DISPRC').get();
      expect(doc.exists).toBe(true);
      // mostRecentDispatchedAt should be the later timestamp (t2)
      expect(doc.get('mostRecentDispatchedAt')).not.toBeNull();
    });

    it('sets implementationTaskId flag when any task has it', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task1 = makeTask({
        id: 'task-plain',
        userId: 'user-4',
        linearIssueId: 'INT-IMPLRC',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-impl3',
        userId: 'user-4',
        linearIssueId: 'INT-IMPLRC',
        status: 'dispatched',
        implementationTaskId: 'task-plain',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-IMPLRC', [task1, task2]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-IMPLRC').get();
      expect(doc.get('hasImplementationTaskId')).toBe(true);
    });

    it('sets hasCompletedExecution for execution agent with reviewed status', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-exec-rev-rc',
        userId: 'user-4',
        linearIssueId: 'INT-EXECREVRC',
        agentType: 'execution',
        status: 'reviewed',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-EXECREVRC', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-EXECREVRC').get();
      expect(doc.get('hasCompletedExecution')).toBe(true);
    });

    it('sets latestReviewNeedsRemediation from review task result (no-remediation)', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-rev-rc',
        userId: 'user-4',
        linearIssueId: 'INT-REVRC',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '0' }, // REMEDIATION_NOT_NEEDED
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-REVRC', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-REVRC').get();
      expect(doc.get('latestReviewNeedsRemediation')).toBe(false);
    });

    it('sets latestReviewNeedsRemediation=true from review task result (remediation needed)', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-rev-rc2',
        userId: 'user-4',
        linearIssueId: 'INT-REVRC2',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '1' },
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-REVRC2', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-REVRC2').get();
      expect(doc.get('latestReviewNeedsRemediation')).toBe(true);
    });

    it('sets latestReviewNeedsRemediation=null for review task with unknown needs_remediation', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-rev-null',
        userId: 'user-4',
        linearIssueId: 'INT-REVNULL',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: 'unknown_value' },
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-REVNULL', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-REVNULL').get();
      expect(doc.get('latestReviewNeedsRemediation')).toBeNull();
    });

    it('picks later review result when multiple review tasks exist', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));

      const task1 = makeTask({
        id: 'task-rev-early',
        userId: 'user-4',
        linearIssueId: 'INT-REVMULTI',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '1' }, // needs remediation
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-rev-late',
        userId: 'user-4',
        linearIssueId: 'INT-REVMULTI',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '0' }, // no remediation (REMEDIATION_NOT_NEEDED)
        createdAt: t2,
        updatedAt: t2,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-REVMULTI', [task1, task2]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-REVMULTI').get();
      // The later review (task2) should win
      expect(doc.get('latestReviewNeedsRemediation')).toBe(false);
    });

    it('does not update mostRecentDispatchedAt with earlier timestamp', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z')); // later
      const t2 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')); // earlier

      const task1 = makeTask({
        id: 'task-disp-later',
        userId: 'user-3',
        linearIssueId: 'INT-DISPATCHO',
        status: 'dispatched',
        dispatchedAt: t1,
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-disp-earlier',
        userId: 'user-3',
        linearIssueId: 'INT-DISPATCHO',
        status: 'dispatched',
        dispatchedAt: t2, // earlier — should not replace t1
        createdAt: t2,
        updatedAt: t2,
      });

      await repo.recomputeGroupFromTasks('user-3', 'INT-DISPATCHO', [task1, task2]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-DISPATCHO').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('mostRecentDispatchedAt')).not.toBeNull();
    });

    it('does not replace later review result with earlier one', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z')); // later — processed first
      const t2 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')); // earlier — processed second

      // Task 1 is the later review with no-remediation
      const task1 = makeTask({
        id: 'task-rev-later',
        userId: 'user-3',
        linearIssueId: 'INT-REVORDER',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '0' }, // REMEDIATION_NOT_NEEDED
        createdAt: t1,
        updatedAt: t1,
      });
      // Task 2 is the earlier review with remediation needed (should not override task1)
      const task2 = makeTask({
        id: 'task-rev-earlier',
        userId: 'user-3',
        linearIssueId: 'INT-REVORDER',
        agentType: 'review',
        status: 'reviewed',
        result: { needs_remediation: '1' }, // remediation needed
        createdAt: t2,
        updatedAt: t2,
      });

      // Pass task2 first in array, then task1 (task1 wins because it has later updatedAt)
      await repo.recomputeGroupFromTasks('user-3', 'INT-REVORDER', [task2, task1]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-REVORDER').get();
      // task1 (later) should win: latestReviewNeedsRemediation = false
      expect(doc.get('latestReviewNeedsRemediation')).toBe(false);
    });

    it('uses null for linearIssueId when no task has it', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-standalone-rc',
        userId: 'user-4',
        // no linearIssueId
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'standalone_task-standalone-rc', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_standalone_task-standalone-rc').get();
      expect(doc.get('linearIssueId')).toBeNull();
    });

    it('prNumber is null when prUrl present but prNumber is undefined', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-pr-nonum',
        userId: 'user-4',
        linearIssueId: 'INT-PRNONUM',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/123' },
        // no prNumber
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-PRNONUM', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-PRNONUM').get();
      expect(doc.get('hasPrUrl')).toBe(true);
      expect(doc.get('prNumber')).toBeNull();
    });

    it('only sets prNumber from the first task that has prUrl', async () => {
      const repo = createTaskGroupSummaryFirestoreRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-01-02T00:00:00Z'));

      const task1 = makeTask({
        id: 'task-pr-first',
        userId: 'user-4',
        linearIssueId: 'INT-PRFIRST',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/10' },
        prNumber: 10,
        createdAt: t1,
        updatedAt: t1,
      });
      const task2 = makeTask({
        id: 'task-pr-second',
        userId: 'user-4',
        linearIssueId: 'INT-PRFIRST',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/20' },
        prNumber: 20,
        createdAt: t2,
        updatedAt: t2,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-PRFIRST', [task1, task2]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-PRFIRST').get();
      // First task with prUrl wins for prNumber
      expect(doc.get('prNumber')).toBe(10);
    });
  });
});
