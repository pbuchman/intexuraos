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
import { createTaskGroupSummaryFirestoreRepository as createRepository } from '../../../infra/firestore/taskGroupSummaryFirestoreRepository.js';
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

  function createIncrementalRepository(
    deps: { firestore: Firestore; logger: Logger },
  ): ReturnType<typeof createRepository> {
    return createRepository({ ...deps, authoritativeTaskReads: false });
  }

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
      statusChangedAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  describe('updateAfterCreate', () => {
    it('creates summary doc for new group', async () => {
      const repo = createIncrementalRepository({
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
        statusChangedAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(doc.exists).toBe(true);
      expect(doc.get('userId')).toBe('user-1');
      expect(doc.get('groupKey')).toBe('INT-100');
      expect(doc.get('linearIssueId')).toBe('INT-100');
      expect(doc.get('linearIssueNumber')).toBe(100);
      expect(doc.get('linearIssueSortKey')).toBe(100);
      expect(doc.get('taskCount')).toBe(1);
      expect(doc.get('activeTaskCount')).toBe(0);
      expect(doc.get('latestTaskId')).toBe('task-1');
      expect(doc.get('latestTaskCreatedAt')).toEqual(now);
      expect(doc.get('latestTaskUpdatedAt')).toEqual(now);
      expect(doc.get('hasCompletedPlanning')).toBe(true);
      expect(doc.get('agentTypesPresent')).toContain('planning');
    });

    it('increments existing group summary', async () => {
      const repo = createIncrementalRepository({
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
      expect(doc.get('linearIssueNumber')).toBe(100);
      expect(doc.get('linearIssueSortKey')).toBe(100);
      const agentTypes = doc.get('agentTypesPresent') as string[];
      expect(agentTypes).toContain('planning');
      expect(agentTypes).toContain('execution');
    });

    it('does not let reordered creates regress attempt identity or lifecycle activity', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const createdA = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const createdB = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const lifecycleA = Timestamp.fromDate(new Date('2026-07-27T12:00:00Z'));
      const lifecycleB = Timestamp.fromDate(new Date('2026-07-27T11:00:00Z'));

      await repo.updateAfterCreate(makeTask({
        id: 'task-B', linearIssueId: 'INT-ORDER', status: 'implemented',
        createdAt: createdB, statusChangedAt: lifecycleB, updatedAt: lifecycleB,
      }));
      await repo.updateAfterCreate(makeTask({
        id: 'task-A', linearIssueId: 'INT-ORDER', status: 'failed',
        createdAt: createdA, statusChangedAt: lifecycleA,
        updatedAt: Timestamp.fromDate(new Date('2026-07-27T13:00:00Z')),
      }));

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ORDER').get();
      expect(doc.get('taskCount')).toBe(2);
      expect(doc.get('latestTaskId')).toBe('task-B');
      expect(doc.get('latestTaskStatus')).toBe('implemented');
      expect(doc.get('latestTaskCreatedAt')).toEqual(createdB);
      expect(doc.get('latestTaskUpdatedAt')).toEqual(lifecycleA);
    });

    it('is idempotent when the same create maintenance callback is retried', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const task = makeTask({ id: 'task-retry', linearIssueId: 'INT-RETRY', status: 'running' });

      await repo.updateAfterCreate(task);
      await repo.updateAfterCreate(task);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-RETRY').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(summary.get('taskCount')).toBe(1);
      expect(summary.get('activeTaskCount')).toBe(1);
      expect(counts.get('totalGroups')).toBe(1);
      expect(counts.get('active')).toBe(1);
    });

    it('does not resurrect a deleted task from a delayed create callback', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const staleCreate = makeTask({ id: 'task-deleted', linearIssueId: 'INT-DELAYED-DELETE' });

      await repo.updateAfterCreate(staleCreate);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DELAYED-DELETE').get();
      expect(summary.exists).toBe(false);
    });

    it('does not resurrect an archived task from a delayed create callback', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const staleCreate = makeTask({ id: 'task-archived-late', linearIssueId: 'INT-DELAYED-ARCHIVE' });
      const archived = { ...staleCreate, status: 'archived' as const };
      fakeFirestore.seedCollection('code_tasks', [
        { id: archived.id, data: archived as unknown as Record<string, unknown> },
      ]);

      await repo.updateAfterCreate(staleCreate);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-DELAYED-ARCHIVE').get();
      expect(summary.exists).toBe(false);
    });

    it('repairs legacy ownership before duplicate create callbacks without inflating tasks or counts', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const createdAt = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const labelsUpdatedAt = Timestamp.fromDate(new Date('2026-07-27T09:30:00Z'));
      const task = makeTask({
        id: 'task-legacy-create',
        userId: 'user-legacy-create',
        linearIssueId: 'INT-LEGACY-CREATE',
        agentType: 'execution',
        status: 'running',
        createdAt,
        statusChangedAt: createdAt,
        updatedAt: createdAt,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: task.id, data: task as unknown as Record<string, unknown> },
      ]);
      await fakeFirestore.collection('task_group_summaries').doc('user-legacy-create_INT-LEGACY-CREATE').set({
        userId: 'user-legacy-create',
        linearIssueId: 'INT-LEGACY-CREATE',
        groupKey: 'INT-LEGACY-CREATE',
        taskCount: 1,
        activeTaskCount: 1,
        latestTaskStatus: 'running',
        latestTaskUpdatedAt: createdAt,
        agentTypesPresent: ['execution'],
        hasCompletedPlanning: false,
        hasCompletedExecution: false,
        hasCompletedExecutionAgent: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: createdAt,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'active',
        hasImplementationReadyLabel: true,
        hasMergeReadyLabel: false,
        labelsUpdatedAt,
        isImportant: true,
        updatedAt: createdAt,
      });
      await fakeFirestore.collection('user_group_counts').doc('user-legacy-create').set({
        userId: 'user-legacy-create',
        active: 1,
        needsAction: 0,
        done: 0,
        failed: 0,
        archived: 0,
        totalGroups: 1,
        updatedAt: createdAt,
      });

      await repo.updateAfterCreate(task);
      await repo.updateAfterCreate(task);

      const summary = await fakeFirestore.collection('task_group_summaries')
        .doc('user-legacy-create_INT-LEGACY-CREATE').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-legacy-create').get();
      expect(summary.get('taskIds')).toEqual(['task-legacy-create']);
      expect(summary.get('taskStatusById')).toEqual({ 'task-legacy-create': 'running' });
      expect(summary.get('taskCount')).toBe(1);
      expect(summary.get('activeTaskCount')).toBe(1);
      expect(summary.get('latestTaskId')).toBe('task-legacy-create');
      expect(summary.get('hasImplementationReadyLabel')).toBe(true);
      expect(summary.get('hasMergeReadyLabel')).toBe(false);
      expect(summary.get('labelsUpdatedAt')).toEqual(labelsUpdatedAt);
      expect(summary.get('isImportant')).toBe(true);
      expect(counts.get('totalGroups')).toBe(1);
      expect(counts.get('active')).toBe(1);
    });

    it('rebuilds an archived shell from visible source tasks when a failed retry revives it', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const archivedAt = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const retryAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const labelsUpdatedAt = Timestamp.fromDate(new Date('2026-07-27T09:30:00Z'));
      const archivedTask = makeTask({
        id: 'task-archived-evidence',
        userId: 'user-revive',
        linearIssueId: 'INT-REVIVE-EVIDENCE',
        agentType: 'review',
        status: 'archived',
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/1801',
          merge_ready: '1',
          merge_ready_reason: 'review_no_remediation',
          needs_remediation: '0',
        },
        prNumber: 1801,
        implementationTaskId: 'task-old-implementation',
        createdAt: archivedAt,
        statusChangedAt: archivedAt,
        updatedAt: archivedAt,
      });
      const failedRetry = makeTask({
        id: 'task-failed-retry',
        userId: 'user-revive',
        linearIssueId: 'INT-REVIVE-EVIDENCE',
        agentType: 'execution',
        status: 'failed',
        createdAt: retryAt,
        statusChangedAt: retryAt,
        updatedAt: retryAt,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: archivedTask.id, data: archivedTask as unknown as Record<string, unknown> },
        { id: failedRetry.id, data: failedRetry as unknown as Record<string, unknown> },
      ]);
      await fakeFirestore.collection('task_group_summaries').doc('user-revive_INT-REVIVE-EVIDENCE').set({
        userId: 'user-revive',
        linearIssueId: 'INT-REVIVE-EVIDENCE',
        groupKey: 'INT-REVIVE-EVIDENCE',
        taskCount: 0,
        taskIds: [],
        taskStatusById: {},
        taskLifecycleAtById: {},
        activeTaskCount: 0,
        latestTaskId: archivedTask.id,
        latestTaskCreatedAt: archivedAt,
        latestTaskStatus: 'archived',
        latestTaskUpdatedAt: archivedAt,
        latestLifecycleTaskId: archivedTask.id,
        agentTypesPresent: ['review'],
        hasCompletedPlanning: true,
        hasCompletedExecution: true,
        hasCompletedExecutionAgent: true,
        hasImplementationTaskId: true,
        hasPrUrl: true,
        prNumber: 1801,
        latestMergeReadyEvidence: true,
        latestMergeReadyReason: 'review_no_remediation',
        latestMergeReadyUpdatedAt: archivedAt,
        latestMergeReadyDecisionAt: archivedAt,
        latestMergeReadyDecisionTaskId: archivedTask.id,
        latestReviewNeedsRemediation: false,
        latestReviewUpdatedAt: archivedAt,
        latestReviewTaskId: archivedTask.id,
        representativePrUpdatedAt: archivedAt,
        representativePrTaskId: archivedTask.id,
        oldestTaskCreatedAt: archivedAt,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'archived',
        hasImplementationReadyLabel: true,
        hasMergeReadyLabel: true,
        labelsUpdatedAt,
        isImportant: true,
        updatedAt: archivedAt,
      });
      await fakeFirestore.collection('user_group_counts').doc('user-revive').set({
        userId: 'user-revive',
        active: 0,
        needsAction: 0,
        done: 0,
        failed: 0,
        archived: 1,
        totalGroups: 1,
        updatedAt: archivedAt,
      });

      await repo.updateAfterCreate(failedRetry);

      const summary = await fakeFirestore.collection('task_group_summaries')
        .doc('user-revive_INT-REVIVE-EVIDENCE').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-revive').get();
      expect(summary.get('taskIds')).toEqual(['task-failed-retry']);
      expect(summary.get('taskCount')).toBe(1);
      expect(summary.get('activeTaskCount')).toBe(0);
      expect(summary.get('latestTaskId')).toBe('task-failed-retry');
      expect(summary.get('latestTaskStatus')).toBe('failed');
      expect(summary.get('aggregateStatus')).toBe('failed');
      expect(summary.get('hasPrUrl')).toBe(false);
      expect(summary.get('prNumber')).toBeNull();
      expect(summary.get('representativePrTaskId')).toBeNull();
      expect(summary.get('latestMergeReadyEvidence')).toBe(false);
      expect(summary.get('latestMergeReadyReason')).toBeNull();
      expect(summary.get('latestReviewNeedsRemediation')).toBeNull();
      expect(summary.get('latestReviewTaskId')).toBeNull();
      expect(summary.get('hasCompletedPlanning')).toBe(false);
      expect(summary.get('hasCompletedExecution')).toBe(false);
      expect(summary.get('hasCompletedExecutionAgent')).toBe(false);
      expect(summary.get('hasImplementationTaskId')).toBe(false);
      expect(summary.get('hasImplementationReadyLabel')).toBe(true);
      expect(summary.get('hasMergeReadyLabel')).toBe(true);
      expect(summary.get('labelsUpdatedAt')).toEqual(labelsUpdatedAt);
      expect(summary.get('isImportant')).toBe(true);
      expect(counts.get('archived')).toBe(0);
      expect(counts.get('failed')).toBe(1);
      expect(counts.get('totalGroups')).toBe(1);
    });

    it('sets activeTaskCount when task is active', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('does not set hasCompletedExecution for review agent with reviewed status', async () => {
      const repo = createIncrementalRepository({
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
      expect(doc.get('hasCompletedExecution')).toBe(false);
    });

    it('sets hasCompletedExecutionAgent when execution agent created with implemented status', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-ea-exec1',
        linearIssueId: 'INT-EAEXEC1',
        agentType: 'execution',
        status: 'implemented',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);
      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-EAEXEC1').get();
      expect(doc.get('hasCompletedExecutionAgent')).toBe(true);
    });

    it('does not set hasCompletedExecutionAgent for pull_request agent with implemented status', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-ea-pr1',
        linearIssueId: 'INT-EAPR1',
        agentType: 'pull_request',
        status: 'implemented',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);
      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-EAPR1').get();
      expect(doc.get('hasCompletedExecutionAgent')).toBe(false);
    });

    it('does not set hasCompletedExecutionAgent for review agent with reviewed status', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-ea-rev1',
        linearIssueId: 'INT-EAREV1',
        agentType: 'review',
        status: 'reviewed',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);
      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-EAREV1').get();
      expect(doc.get('hasCompletedExecutionAgent')).toBe(false);
    });

    it('does not increment taskCount when archived task added to existing group', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('updates existingGroup: sets hasPrUrl without prNumber when prUrl set but prNumber absent', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-PRUNONUM',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      const task2 = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-PRUNONUM',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/99' },
        // prNumber intentionally absent — exercises false branch of `if (task.prNumber !== undefined)`
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task1);
      await repo.updateAfterCreate(task2);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-PRUNONUM').get();
      expect(doc.get('hasPrUrl')).toBe(true);
      // prNumber stays null since task2 has no prNumber
      expect(doc.get('prNumber')).toBeNull();
    });

    it('updates existingGroup: updates latestReviewNeedsRemediation', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('reverts archived group to active when new non-archived task is created in it', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task1 = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-REVIVE',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      // Step 1: create group
      await repo.updateAfterCreate(task1);

      // Step 2: archive the only task → group becomes aggregateStatus: 'archived'
      const archivedTask = { ...task1, status: 'archived' as const, updatedAt: Timestamp.now() };
      await repo.updateAfterStatusChange(task1, archivedTask);

      const afterArchive = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REVIVE').get();
      expect(afterArchive.get('aggregateStatus')).toBe('archived');

      const countsAfterArchive = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfterArchive.get('archived')).toBe(1);

      // Step 3: create a new non-archived task in the same group
      const newTask = makeTask({
        id: 'task-2',
        linearIssueId: 'INT-REVIVE',
        status: 'queued',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await repo.updateAfterCreate(newTask);

      // Step 4: summary should no longer be archived
      const afterRevive = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REVIVE').get();
      expect(afterRevive.exists).toBe(true);
      expect(afterRevive.get('aggregateStatus')).not.toBe('archived');
      expect(afterRevive.get('taskCount')).toBe(1);

      // Step 5: user counts should reflect the group is no longer archived
      const countsAfterRevive = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfterRevive.get('archived')).toBe(0);
      expect(countsAfterRevive.get('totalGroups')).toBe(1);
    });

    it('repairs missing linear sort fields when a legacy summary receives a new task', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      await fakeFirestore.collection('task_group_summaries').doc('user-legacy_INT-1606').set({
        userId: 'user-legacy',
        linearIssueId: 'INT-1606',
        groupKey: 'INT-1606',
        taskCount: 1,
        activeTaskCount: 0,
        latestTaskStatus: 'planned',
        latestTaskUpdatedAt: now,
        agentTypesPresent: ['planning'],
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasCompletedExecutionAgent: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: now,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'needs-action',
        updatedAt: now,
      });

      await fakeFirestore.collection('user_group_counts').doc('user-legacy').set({
        userId: 'user-legacy',
        active: 0,
        needsAction: 1,
        done: 0,
        failed: 0,
        archived: 0,
        totalGroups: 1,
        updatedAt: now,
      });

      await repo.updateAfterCreate(makeTask({
        id: 'task-legacy-2',
        userId: 'user-legacy',
        linearIssueId: 'INT-1606',
        status: 'implemented',
        agentType: 'execution',
        createdAt: now,
        updatedAt: now,
      }));

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-legacy_INT-1606').get();
      expect(doc.get('linearIssueNumber')).toBe(1606);
      expect(doc.get('linearIssueSortKey')).toBe(1606);
    });
  });

  describe('updateAfterStatusChange', () => {
    it('repairs internally inconsistent ownership counts before applying a status callback', async () => {
      const incrementalRepo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const createdAt = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const lifecycleAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const failedTask = makeTask({
        id: 'task-inconsistent-owner',
        userId: 'user-inconsistent-owner',
        linearIssueId: 'INT-INCONSISTENT-OWNER',
        agentType: 'execution',
        status: 'failed',
        createdAt,
        statusChangedAt: createdAt,
        updatedAt: createdAt,
      });
      const runningTask = {
        ...failedTask,
        status: 'running' as const,
        statusChangedAt: lifecycleAt,
        updatedAt: lifecycleAt,
      };
      await incrementalRepo.updateAfterCreate(failedTask);
      await fakeFirestore.collection('task_group_summaries')
        .doc('user-inconsistent-owner_INT-INCONSISTENT-OWNER')
        .update({
          taskCount: 2,
          hasPrUrl: true,
          prNumber: 1951,
          representativePrUpdatedAt: createdAt,
          representativePrTaskId: 'task-removed-pr-owner',
        });
      fakeFirestore.seedCollection('code_tasks', [
        { id: runningTask.id, data: runningTask as unknown as Record<string, unknown> },
      ]);

      await repo.updateAfterStatusChange(failedTask, runningTask);

      const summary = await fakeFirestore.collection('task_group_summaries')
        .doc('user-inconsistent-owner_INT-INCONSISTENT-OWNER').get();
      expect(summary.get('taskIds')).toEqual(['task-inconsistent-owner']);
      expect(summary.get('taskCount')).toBe(1);
      expect(summary.get('activeTaskCount')).toBe(1);
      expect(summary.get('hasPrUrl')).toBe(false);
      expect(summary.get('prNumber')).toBeNull();
      expect(summary.get('representativePrTaskId')).toBeNull();
    });

    it('repairs ownership timestamps that differ only below millisecond precision', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const createdAt = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const persistedLifecycleAt = new Timestamp(1_785_146_400, 123_456_701);
      const staleOwnedLifecycleAt = new Timestamp(1_785_146_400, 123_456_700);
      expect(persistedLifecycleAt.toMillis()).toBe(staleOwnedLifecycleAt.toMillis());
      const oldTask = makeTask({
        id: 'task-nanosecond-owner',
        userId: 'user-nanosecond-owner',
        linearIssueId: 'INT-NANOSECOND-OWNER',
        agentType: 'execution',
        status: 'failed',
        createdAt,
        statusChangedAt: staleOwnedLifecycleAt,
        updatedAt: staleOwnedLifecycleAt,
      });
      const persistedTask = {
        ...oldTask,
        status: 'running' as const,
        statusChangedAt: persistedLifecycleAt,
        updatedAt: persistedLifecycleAt,
      };
      fakeFirestore.seedCollection('code_tasks', [
        { id: persistedTask.id, data: persistedTask as unknown as Record<string, unknown> },
      ]);
      await fakeFirestore.collection('task_group_summaries').doc('user-nanosecond-owner_INT-NANOSECOND-OWNER').set({
        userId: 'user-nanosecond-owner',
        linearIssueId: 'INT-NANOSECOND-OWNER',
        groupKey: 'INT-NANOSECOND-OWNER',
        taskCount: 1,
        taskIds: [persistedTask.id],
        taskStatusById: { [persistedTask.id]: 'failed' },
        taskLifecycleAtById: { [persistedTask.id]: staleOwnedLifecycleAt },
        activeTaskCount: 0,
        latestTaskId: persistedTask.id,
        latestTaskCreatedAt: createdAt,
        latestTaskStatus: 'failed',
        latestTaskUpdatedAt: persistedLifecycleAt,
        latestLifecycleTaskId: persistedTask.id,
        agentTypesPresent: ['execution'],
        hasCompletedPlanning: false,
        hasCompletedExecution: false,
        hasCompletedExecutionAgent: false,
        hasImplementationTaskId: false,
        hasPrUrl: true,
        prNumber: 1901,
        representativePrUpdatedAt: createdAt,
        representativePrTaskId: 'task-removed-pr-owner',
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: createdAt,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'failed',
        updatedAt: persistedLifecycleAt,
      });
      await fakeFirestore.collection('user_group_counts').doc('user-nanosecond-owner').set({
        userId: 'user-nanosecond-owner',
        active: 0,
        needsAction: 0,
        done: 0,
        failed: 1,
        archived: 0,
        totalGroups: 1,
        updatedAt: persistedLifecycleAt,
      });

      await repo.updateAfterStatusChange(oldTask, persistedTask);

      const summary = await fakeFirestore.collection('task_group_summaries')
        .doc('user-nanosecond-owner_INT-NANOSECOND-OWNER').get();
      expect(summary.get('taskLifecycleAtById')).toEqual({
        [persistedTask.id]: persistedLifecycleAt,
      });
      expect(summary.get('hasPrUrl')).toBe(false);
      expect(summary.get('prNumber')).toBeNull();
      expect(summary.get('representativePrTaskId')).toBeNull();
    });

    it('repairs missing legacy ownership before an older status-before-create callback', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const olderCreatedAt = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const newerCreatedAt = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const olderLifecycleAt = Timestamp.fromDate(new Date('2026-07-27T11:00:00Z'));
      const labelsUpdatedAt = Timestamp.fromDate(new Date('2026-07-27T10:30:00Z'));
      const oldCallbackTask = makeTask({
        id: 'task-older',
        userId: 'user-legacy-status',
        linearIssueId: 'INT-LEGACY-STATUS',
        agentType: 'execution',
        status: 'failed',
        createdAt: olderCreatedAt,
        statusChangedAt: olderCreatedAt,
        updatedAt: olderCreatedAt,
      });
      const persistedOlderTask = {
        ...oldCallbackTask,
        status: 'running' as const,
        statusChangedAt: olderLifecycleAt,
        updatedAt: olderLifecycleAt,
      };
      const newerTask = makeTask({
        id: 'task-newer',
        userId: 'user-legacy-status',
        linearIssueId: 'INT-LEGACY-STATUS',
        agentType: 'planning',
        status: 'planned',
        createdAt: newerCreatedAt,
        statusChangedAt: newerCreatedAt,
        updatedAt: newerCreatedAt,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: persistedOlderTask.id, data: persistedOlderTask as unknown as Record<string, unknown> },
        { id: newerTask.id, data: newerTask as unknown as Record<string, unknown> },
      ]);
      await fakeFirestore.collection('task_group_summaries').doc('user-legacy-status_INT-LEGACY-STATUS').set({
        userId: 'user-legacy-status',
        linearIssueId: 'INT-LEGACY-STATUS',
        groupKey: 'INT-LEGACY-STATUS',
        taskCount: 1,
        activeTaskCount: 0,
        latestTaskStatus: 'planned',
        latestTaskUpdatedAt: newerCreatedAt,
        agentTypesPresent: ['planning'],
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasCompletedExecutionAgent: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: newerCreatedAt,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'needs-action',
        hasImplementationReadyLabel: true,
        hasMergeReadyLabel: true,
        labelsUpdatedAt,
        isImportant: true,
        updatedAt: newerCreatedAt,
      });
      await fakeFirestore.collection('user_group_counts').doc('user-legacy-status').set({
        userId: 'user-legacy-status',
        active: 0,
        needsAction: 1,
        done: 0,
        failed: 0,
        archived: 0,
        totalGroups: 1,
        updatedAt: newerCreatedAt,
      });

      await repo.updateAfterStatusChange(oldCallbackTask, persistedOlderTask);

      const summary = await fakeFirestore.collection('task_group_summaries')
        .doc('user-legacy-status_INT-LEGACY-STATUS').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-legacy-status').get();
      expect(summary.get('taskIds')).toEqual(['task-older', 'task-newer']);
      expect(summary.get('taskStatusById')).toEqual({
        'task-older': 'running',
        'task-newer': 'planned',
      });
      expect(summary.get('taskCount')).toBe(2);
      expect(summary.get('activeTaskCount')).toBe(1);
      expect(summary.get('latestTaskId')).toBe('task-newer');
      expect(summary.get('latestTaskCreatedAt')).toEqual(newerCreatedAt);
      expect(summary.get('latestTaskStatus')).toBe('planned');
      expect(summary.get('latestTaskUpdatedAt')).toEqual(olderLifecycleAt);
      expect(summary.get('latestLifecycleTaskId')).toBe('task-older');
      expect(summary.get('hasImplementationReadyLabel')).toBe(true);
      expect(summary.get('hasMergeReadyLabel')).toBe(true);
      expect(summary.get('labelsUpdatedAt')).toEqual(labelsUpdatedAt);
      expect(summary.get('isImportant')).toBe(true);
      expect(counts.get('active')).toBe(1);
      expect(counts.get('needsAction')).toBe(0);
      expect(counts.get('totalGroups')).toBe(1);
    });

    it('repairs status-before-create ordering from the current persisted task', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const queued = makeTask({
        id: 'task-status-first', linearIssueId: 'INT-STATUS-FIRST', status: 'queued',
        createdAt: t1, statusChangedAt: t1, updatedAt: t1,
      });
      const running = { ...queued, status: 'running' as const, statusChangedAt: t2, updatedAt: t2 };
      fakeFirestore.seedCollection('code_tasks', [
        { id: running.id, data: running as unknown as Record<string, unknown> },
      ]);

      await repo.updateAfterStatusChange(queued, running);
      await repo.updateAfterCreate(queued);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-STATUS-FIRST').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(summary.get('taskIds')).toEqual(['task-status-first']);
      expect(summary.get('taskCount')).toBe(1);
      expect(summary.get('activeTaskCount')).toBe(1);
      expect(summary.get('latestTaskStatus')).toBe('running');
      expect(summary.get('latestTaskUpdatedAt')).toEqual(t2);
      expect(counts.get('totalGroups')).toBe(1);
      expect(counts.get('active')).toBe(1);
    });

    it('repairs archived-status-before-create without double-counting retries', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const queued = makeTask({
        id: 'task-archive-first', linearIssueId: 'INT-ARCHIVE-FIRST', status: 'queued',
        agentType: 'review',
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/1606',
          merge_ready: '1',
          merge_ready_reason: 'review_no_remediation',
          needs_remediation: '0',
        },
        prNumber: 1606,
        implementationTaskId: 'task-implementation',
        createdAt: t1, statusChangedAt: t1, updatedAt: t1,
      });
      const archived = { ...queued, status: 'archived' as const, statusChangedAt: t2, updatedAt: t2 };
      fakeFirestore.seedCollection('code_tasks', [
        { id: archived.id, data: archived as unknown as Record<string, unknown> },
      ]);

      await repo.updateAfterStatusChange(queued, archived);
      await repo.updateAfterCreate(queued);
      await repo.updateAfterStatusChange(queued, archived);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ARCHIVE-FIRST').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(summary.get('taskCount')).toBe(0);
      expect(summary.get('taskIds')).toEqual([]);
      expect(summary.get('latestTaskId')).toBe('task-archive-first');
      expect(summary.get('latestTaskStatus')).toBe('archived');
      expect(summary.get('latestTaskUpdatedAt')).toEqual(t2);
      expect(summary.get('aggregateStatus')).toBe('archived');
      expect(summary.get('hasPrUrl')).toBe(true);
      expect(summary.get('prNumber')).toBe(1606);
      expect(summary.get('representativePrUpdatedAt')).toEqual(t2);
      expect(summary.get('representativePrTaskId')).toBe('task-archive-first');
      expect(summary.get('latestMergeReadyEvidence')).toBe(true);
      expect(summary.get('latestMergeReadyReason')).toBe('review_no_remediation');
      expect(summary.get('latestMergeReadyUpdatedAt')).toEqual(t2);
      expect(summary.get('latestMergeReadyDecisionAt')).toEqual(t2);
      expect(summary.get('latestMergeReadyDecisionTaskId')).toBe('task-archive-first');
      expect(summary.get('latestReviewNeedsRemediation')).toBe(false);
      expect(summary.get('latestReviewUpdatedAt')).toEqual(t2);
      expect(summary.get('latestReviewTaskId')).toBe('task-archive-first');
      expect(summary.get('hasImplementationTaskId')).toBe(true);
      expect(summary.get('hasCompletedPlanning')).toBe(false);
      expect(summary.get('hasCompletedExecution')).toBe(false);
      expect(summary.get('hasCompletedExecutionAgent')).toBe(false);
      expect(counts.get('totalGroups')).toBe(1);
      expect(counts.get('archived')).toBe(1);
    });

    it('ignores status callbacks whose authoritative source task is missing or excluded', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const missing = makeTask({
        id: 'task-missing-source', linearIssueId: 'INT-MISSING-SOURCE', status: 'queued',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      await repo.updateAfterStatusChange(missing, { ...missing, status: 'running' });

      const excluded = makeTask({
        id: 'task-excluded-source', linearIssueId: 'INT-EXCLUDED-SOURCE', agentType: 'ask_agent', status: 'running',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: excluded.id, data: excluded as unknown as Record<string, unknown> },
      ]);
      await repo.updateAfterStatusChange(
        { ...excluded, agentType: 'planning', status: 'queued' },
        { ...excluded, agentType: 'planning' },
      );

      expect((await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-MISSING-SOURCE').get()).exists)
        .toBe(false);
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-EXCLUDED-SOURCE').get()).exists)
        .toBe(false);
    });

    it('repairs an existing incomplete summary and preserves user-owned flags and counts', async () => {
      const localRepo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const running = makeTask({
        id: 'task-existing', linearIssueId: 'INT-REPAIR-EXISTING', agentType: 'execution', status: 'running',
        createdAt: t1, statusChangedAt: t1, updatedAt: t1,
      });
      await localRepo.updateAfterCreate(running);
      await localRepo.recomputeWithLabels(
        'user-1',
        'INT-REPAIR-EXISTING',
        [
          { id: 'ready-implementation', name: 'ready-to-implement' },
          { id: 'ready-merge', name: 'ready-to-merge' },
        ],
        '2026-07-27T09:30:00.000Z',
      );
      await localRepo.setImportant('user-1', 'INT-REPAIR-EXISTING', true);

      const plannedExisting = {
        ...running,
        agentType: 'planning' as const,
        status: 'planned' as const,
        statusChangedAt: t2,
        updatedAt: t2,
      };
      const newTask = makeTask({
        id: 'task-new', linearIssueId: 'INT-REPAIR-EXISTING', agentType: 'planning', status: 'planned',
        createdAt: t2, statusChangedAt: t2, updatedAt: t2,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: plannedExisting.id, data: plannedExisting as unknown as Record<string, unknown> },
        { id: newTask.id, data: newTask as unknown as Record<string, unknown> },
      ]);

      await repo.updateAfterStatusChange({ ...newTask, status: 'queued' }, newTask);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REPAIR-EXISTING').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(summary.get('taskIds')).toEqual(['task-existing', 'task-new']);
      expect(summary.get('hasImplementationReadyLabel')).toBe(true);
      expect(summary.get('hasMergeReadyLabel')).toBe(true);
      expect(summary.get('labelsUpdatedAt')).toEqual(Timestamp.fromDate(new Date('2026-07-27T09:30:00.000Z')));
      expect(summary.get('isImportant')).toBe(true);
      expect(summary.get('aggregateStatus')).toBe('needs-action');
      expect(counts.get('active')).toBe(0);
      expect(counts.get('needsAction')).toBe(1);
    });

    it('repairs an existing incomplete summary without inventing flags or changing stable counts', async () => {
      const localRepo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const existing = makeTask({
        id: 'task-stable-existing', linearIssueId: 'INT-REPAIR-STABLE', agentType: 'planning', status: 'planned',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      const added = makeTask({
        id: 'task-stable-added', linearIssueId: 'INT-REPAIR-STABLE', agentType: 'planning', status: 'planned',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      await localRepo.updateAfterCreate(existing);
      fakeFirestore.seedCollection('code_tasks', [
        { id: existing.id, data: existing as unknown as Record<string, unknown> },
        { id: added.id, data: added as unknown as Record<string, unknown> },
      ]);

      await repo.updateAfterStatusChange({ ...added, status: 'queued' }, added);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-REPAIR-STABLE').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(summary.get('taskIds')).toEqual(['task-stable-existing', 'task-stable-added']);
      expect(summary.get('hasImplementationReadyLabel')).toBeUndefined();
      expect(summary.get('hasMergeReadyLabel')).toBeUndefined();
      expect(summary.get('labelsUpdatedAt')).toBeUndefined();
      expect(summary.get('isImportant')).toBeUndefined();
      expect(counts.get('totalGroups')).toBe(1);
      expect(counts.get('needsAction')).toBe(1);
    });

    it('rebuilds the remaining all-archived group after one archived task is hard-deleted', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const executionTask = makeTask({
        id: 'task-archived-execution',
        linearIssueId: 'INT-ARCHIVED-PAIR',
        agentType: 'execution',
        status: 'archived',
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/1701',
          execution_outcome_label: 'implemented',
        },
        prNumber: 1701,
        implementationTaskId: 'task-child',
        createdAt: t1,
        statusChangedAt: t2,
        updatedAt: t2,
      });
      const planningTask = makeTask({
        id: 'task-archived-planning',
        linearIssueId: 'INT-ARCHIVED-PAIR',
        agentType: 'planning',
        status: 'archived',
        result: { planning_outcome_label: 'planned' },
        createdAt: t2,
        statusChangedAt: t2,
        updatedAt: t2,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: executionTask.id, data: executionTask as unknown as Record<string, unknown> },
        { id: planningTask.id, data: planningTask as unknown as Record<string, unknown> },
      ]);

      await repo.recomputeGroupFromSource('user-1', 'INT-ARCHIVED-PAIR');
      await fakeFirestore.collection('code_tasks').doc(planningTask.id).delete();
      await repo.updateAfterDelete(planningTask);
      await repo.recomputeGroupFromSource('user-1', 'INT-ARCHIVED-PAIR');

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ARCHIVED-PAIR').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(summary.exists).toBe(true);
      expect(summary.get('aggregateStatus')).toBe('archived');
      expect(summary.get('taskCount')).toBe(0);
      expect(summary.get('latestTaskId')).toBe('task-archived-execution');
      expect(summary.get('hasCompletedPlanning')).toBe(false);
      expect(summary.get('hasCompletedExecution')).toBe(true);
      expect(summary.get('hasCompletedExecutionAgent')).toBe(true);
      expect(summary.get('hasImplementationTaskId')).toBe(true);
      expect(summary.get('hasPrUrl')).toBe(true);
      expect(summary.get('prNumber')).toBe(1701);
      expect(summary.get('representativePrTaskId')).toBe('task-archived-execution');
      expect(counts.get('totalGroups')).toBe(1);
      expect(counts.get('archived')).toBe(1);
    });


    it('updates activeTaskCount on status transition (active -> done)', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('is idempotent when the same inactive-to-active transition is retried', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const oldTask = makeTask({
        id: 'task-active-retry', linearIssueId: 'INT-ACTIVE-RETRY', status: 'planned',
        createdAt: t1, statusChangedAt: t1, updatedAt: t1,
      });
      const newTask = { ...oldTask, status: 'running' as const, statusChangedAt: t2, updatedAt: t2 };

      await repo.updateAfterCreate(oldTask);
      await repo.updateAfterStatusChange(oldTask, newTask);
      await repo.updateAfterStatusChange(oldTask, newTask);

      const summary = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ACTIVE-RETRY').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(summary.get('activeTaskCount')).toBe(1);
      expect(counts.get('active')).toBe(1);
      expect(counts.get('totalGroups')).toBe(1);
    });

    it('updates aggregateStatus when transitioning from active to done', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('preserves summary with archived status when last task archived', async () => {
      const repo = createIncrementalRepository({
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

      // Summary doc should still exist with aggregateStatus = 'archived'
      const afterDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-400').get();
      expect(afterDoc.exists).toBe(true);
      expect(afterDoc.get('aggregateStatus')).toBe('archived');
      // taskCount decremented to 0
      expect(afterDoc.get('taskCount')).toBe(0);

      // user counts: done -> 0, archived -> 1, totalGroups stays at 1
      const countsDoc = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsDoc.get('done')).toBe(0);
      expect(countsDoc.get('archived')).toBe(1);
      expect(countsDoc.get('totalGroups')).toBe(1);
    });

    it('logs warning when summary doc not found', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('does not set hasCompletedExecution when review task reviewed', async () => {
      const repo = createIncrementalRepository({
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
      expect(doc.get('hasCompletedExecution')).toBe(false);
    });

    it('sets hasImplementationTaskId on status change', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('updates representative status even when technical updatedAt is older', async () => {
      const repo = createIncrementalRepository({
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
      expect(doc.get('latestTaskStatus')).toBe('failed');
    });

    it('does not update counts when aggregateStatus does not change', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('does not set hasCompletedExecution when review agent transitions to reviewed', async () => {
      const repo = createIncrementalRepository({
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
      expect(doc.get('hasCompletedExecution')).toBe(false);
    });

    it('sets hasCompletedExecutionAgent when execution agent transitions to implemented on status change', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-ea-sc1',
        linearIssueId: 'INT-EASC1',
        agentType: 'execution',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const oldTask = { ...task };
      const newTask = { ...task, status: 'implemented' as const };
      await repo.updateAfterStatusChange(oldTask, newTask);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-EASC1').get();
      expect(doc.get('hasCompletedExecutionAgent')).toBe(true);
    });

    it('sets hasPrUrl without prNumber when prUrl present but prNumber absent', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('decrements failed count when last task in failed group is archived', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      // Create a group where latestTaskStatus = 'failed' → aggregateStatus = 'failed'
      const task = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-FAILARCH',
        status: 'failed',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const countsBefore = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsBefore.get('failed')).toBe(1);
      expect(countsBefore.get('totalGroups')).toBe(1);

      // Archive the only task → summary preserved with 'archived' status, group count stays at 1
      const archivedTask = { ...task, status: 'archived' as const };
      await repo.updateAfterStatusChange(task, archivedTask);

      const summaryDoc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-FAILARCH').get();
      expect(summaryDoc.exists).toBe(true);
      expect(summaryDoc.get('aggregateStatus')).toBe('archived');

      const countsAfter = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfter.get('failed')).toBe(0);
      expect(countsAfter.get('archived')).toBe(1);
      expect(countsAfter.get('totalGroups')).toBe(1);
    });
  });

  describe('updateAfterDelete', () => {
    it('decrements task count', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({ id: 'nonexistent', linearIssueId: 'INT-NONE', status: 'planned', createdAt: now, updatedAt: now });

      // Should not throw
      await expect(repo.updateAfterDelete(task)).resolves.toBeUndefined();
    });

    it('decrements activeTaskCount when deleting an active task', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('deletes summary and clears archived count when archived task in fully-archived group is hard-deleted', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-ARCHDEL',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      // Step 1: create the group
      await repo.updateAfterCreate(task);

      // Step 2: archive the only task → group becomes aggregateStatus: 'archived'
      const archivedTask = { ...task, status: 'archived' as const, updatedAt: Timestamp.now() };
      await repo.updateAfterStatusChange(task, archivedTask);

      const afterArchive = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ARCHDEL').get();
      expect(afterArchive.exists).toBe(true);
      expect(afterArchive.get('aggregateStatus')).toBe('archived');
      expect(afterArchive.get('taskCount')).toBe(0);

      const countsAfterArchive = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfterArchive.get('archived')).toBe(1);
      expect(countsAfterArchive.get('totalGroups')).toBe(1);

      // Step 3: hard-delete the archived task
      await repo.updateAfterDelete(archivedTask);

      // Step 4: summary doc should be deleted (group gone)
      const afterDelete = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-ARCHDEL').get();
      expect(afterDelete.exists).toBe(false);

      // Step 5: user counts should reflect no groups remain
      const countsAfterDelete = await fakeFirestore.collection('user_group_counts').doc('user-1').get();
      expect(countsAfterDelete.get('archived')).toBe(0);
      expect(countsAfterDelete.get('totalGroups')).toBe(0);
    });
  });

  describe('getUserGroupCounts', () => {
    it('returns zeros for nonexistent user', async () => {
      const repo = createIncrementalRepository({
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
      expect(result.value.archived).toBe(0);
    });

    it('returns archived: 0 when no archived groups exist', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-1',
        linearIssueId: 'INT-NOARCH',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });

      await repo.updateAfterCreate(task);

      const result = await repo.getUserGroupCounts('user-1');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.archived).toBe(0);
    });

    it('returns stored counts', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
            linearIssueNumber: 1,
            linearIssueSortKey: 1,
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
            linearIssueNumber: 2,
            linearIssueSortKey: 2,
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
      const repo = createIncrementalRepository({
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
          linearIssueNumber: Number(linearIssueId.replace('INT-', '')),
          linearIssueSortKey: Number(linearIssueId.replace('INT-', '')),
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

    it('uses a bounded Firestore query for linear-id pagination', async () => {
      const now = Timestamp.fromDate(new Date('2026-05-06T00:00:00Z'));
      const makeDoc = (id: string, issueNumber: number): { id: string; data: () => Record<string, unknown> } => ({
        id,
        data: (): Record<string, unknown> => ({
          userId: 'user-1',
          groupKey: id.replace('user-1_', ''),
          linearIssueId: `INT-${String(issueNumber)}`,
          linearIssueNumber: issueNumber,
          linearIssueSortKey: issueNumber,
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
        }),
      });
      const query = {
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn(),
        get: vi.fn(),
      };
      query.where.mockReturnValue(query);
      query.orderBy.mockReturnValue(query);
      query.limit.mockReturnValue(query);
      query.get.mockResolvedValue({
        docs: [
          makeDoc('user-1_INT-30', 30),
          makeDoc('user-1_INT-20', 20),
          makeDoc('user-1_INT-10', 10),
        ],
      });
      const firestore = {
        collection: vi.fn().mockReturnValue(query),
      };
      const repo = createIncrementalRepository({
        firestore: firestore as unknown as Firestore,
        logger,
      });

      const result = await repo.listGroupSummaries({
        userId: 'user-1',
        sortBy: 'linear-id',
        limit: 2,
      });

      expect(result.ok).toBe(true);
      expect(query.orderBy).toHaveBeenCalledWith('linearIssueSortKey', 'desc');
      expect(query.orderBy).toHaveBeenCalledWith('latestTaskUpdatedAt', 'desc');
      expect(query.limit).toHaveBeenCalledWith(3);
      expect(query.get).toHaveBeenCalledTimes(1);
    });

    it('paginates backfilled summaries by linear-id numerically', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.fromDate(new Date('2026-05-06T00:00:00Z'));
      const later = Timestamp.fromDate(new Date('2026-05-06T01:00:00Z'));

      const makeSummaryDoc = (
        groupKey: string,
        linearIssueId: string | null,
        latestTaskUpdatedAt: Timestamp,
        sortFields?: { linearIssueNumber: number | null; linearIssueSortKey: number },
      ): { id: string; data: Record<string, unknown> } => ({
        id: `user-1_${groupKey}`,
        data: {
          userId: 'user-1',
          groupKey,
          linearIssueId,
          ...(sortFields ?? {}),
          taskCount: 1,
          activeTaskCount: 0,
          latestTaskStatus: 'planned',
          latestTaskUpdatedAt,
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
        makeSummaryDoc('INT-999', 'INT-999', now, { linearIssueNumber: 999, linearIssueSortKey: 999 }),
        makeSummaryDoc('INT-1601', 'INT-1601', now, { linearIssueNumber: 1601, linearIssueSortKey: 1601 }),
        makeSummaryDoc('INT-1601-newer', 'INT-1601', later, { linearIssueNumber: 1601, linearIssueSortKey: 1601 }),
        makeSummaryDoc('standalone_task-1', null, later, { linearIssueNumber: null, linearIssueSortKey: Number.MAX_SAFE_INTEGER }),
      ]);

      const page1 = await repo.listGroupSummaries({
        userId: 'user-1',
        sortBy: 'linear-id',
        limit: 2,
      });

      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.value.summaries.map((summary) => summary.groupKey)).toEqual([
        'standalone_task-1',
        'INT-1601-newer',
      ]);
      expect(page1.value.nextCursor).toBeDefined();

      const page2 = await repo.listGroupSummaries({
        userId: 'user-1',
        sortBy: 'linear-id',
        limit: 2,
        ...(page1.value.nextCursor !== undefined ? { cursor: page1.value.nextCursor } : {}),
      });

      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      // FakeFirestore now honors DocumentSnapshot cursors for multi-order pagination.
      expect(page2.value.summaries.map((summary) => summary.groupKey)).toEqual([
        'INT-1601',
        'INT-999',
      ]);
      expect(page2.value.nextCursor).toBeUndefined();
    });

    it('accepts existing document cursors for non-linear sorts', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const makeSummaryDoc = (groupKey: string, prNumber: number): { id: string; data: Record<string, unknown> } => ({
        id: `user-1_${groupKey}`,
        data: {
          userId: 'user-1',
          groupKey,
          linearIssueId: groupKey,
          linearIssueNumber: Number(groupKey.replace('INT-', '')),
          linearIssueSortKey: Number(groupKey.replace('INT-', '')),
          taskCount: 1,
          activeTaskCount: 0,
          latestTaskStatus: 'planned',
          latestTaskUpdatedAt: now,
          agentTypesPresent: ['planning'],
          hasCompletedPlanning: true,
          hasCompletedExecution: false,
          hasImplementationTaskId: false,
          hasPrUrl: true,
          prNumber,
          latestReviewNeedsRemediation: null,
          oldestTaskCreatedAt: now,
          mostRecentDispatchedAt: null,
          aggregateStatus: 'done',
          updatedAt: now,
        },
      });

      fakeFirestore.seedCollection('task_group_summaries', [
        makeSummaryDoc('INT-1', 10),
        makeSummaryDoc('INT-2', 20),
        makeSummaryDoc('INT-3', 30),
      ]);

      const page1 = await repo.listGroupSummaries({
        userId: 'user-1',
        sortBy: 'pr-number',
        limit: 1,
      });

      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.value.summaries.map((summary) => summary.groupKey)).toEqual(['INT-3']);
      expect(page1.value.nextCursor).toBeDefined();

      const page2 = await repo.listGroupSummaries({
        userId: 'user-1',
        sortBy: 'pr-number',
        limit: 5,
        ...(page1.value.nextCursor !== undefined ? { cursor: page1.value.nextCursor } : {}),
      });

      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      // FakeFirestore now honors DocumentSnapshot cursors for non-linear sorts as well.
      expect(page2.value.summaries.map((summary) => summary.groupKey)).toEqual(['INT-2', 'INT-1']);
      expect(page2.value.nextCursor).toBeUndefined();
    });

    it('ignores missing document cursors for non-linear sorts', async () => {
      const repo = createIncrementalRepository({
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
            linearIssueNumber: 1,
            linearIssueSortKey: 1,
            taskCount: 1,
            activeTaskCount: 0,
            latestTaskStatus: 'planned',
            latestTaskUpdatedAt: now,
            agentTypesPresent: ['planning'],
            hasCompletedPlanning: true,
            hasCompletedExecution: false,
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

      const missingCursor = Buffer.from('user-1_missing', 'utf-8').toString('base64');
      const result = await repo.listGroupSummaries({
        userId: 'user-1',
        sortBy: 'pr-number',
        limit: 10,
        cursor: missingCursor,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries.map((summary) => summary.groupKey)).toEqual(['INT-1']);
    });

    it('returns all results when no statusFilter provided', async () => {
      const repo = createIncrementalRepository({
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
        sortBy: 'last-updated',
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries).toHaveLength(1);
    });

    it('sorts by pr-number', async () => {
      const repo = createIncrementalRepository({
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

    it('sorts by dispatched', async () => {
      const repo = createIncrementalRepository({
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
        sortBy: 'dispatched',
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.summaries).toHaveLength(1);
    });

    it('handles cursor that does not match a document', async () => {
      const repo = createIncrementalRepository({
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
            linearIssueNumber: null,
            linearIssueSortKey: Number.MAX_SAFE_INTEGER,
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
      const repo = createIncrementalRepository({
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
          linearIssueNumber: null,
          linearIssueSortKey: Number.MAX_SAFE_INTEGER,
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

  describe('getSummary', () => {
    it('returns null when the summary document does not exist', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.getSummary('missing-user', 'INT-404');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns an existing summary document', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-321').set({
        userId: 'user-1',
        linearIssueId: 'INT-321',
        groupKey: 'INT-321',
        linearIssueNumber: 321,
        linearIssueSortKey: 321,
        taskCount: 1,
        activeTaskCount: 0,
        latestTaskStatus: 'planned',
        latestTaskUpdatedAt: now,
        agentTypesPresent: ['planning'],
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasCompletedExecutionAgent: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: now,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'needs-action',
        updatedAt: now,
      });

      const result = await repo.getSummary('user-1', 'INT-321');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({
          userId: 'user-1',
          groupKey: 'INT-321',
          linearIssueId: 'INT-321',
          linearIssueNumber: 321,
          linearIssueSortKey: 321,
          aggregateStatus: 'needs-action',
        });
      }
    });
  });

  describe('recomputeGroupFromTasks', () => {
    it('loads standalone source tasks exactly and rejects missing or mismatched source documents', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const valid = makeTask({
        id: 'standalone-valid', userId: 'user-source', status: 'planned',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      const wrongUser = makeTask({
        id: 'standalone-wrong-user', userId: 'other-user', status: 'planned',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      const askAgent = makeTask({
        id: 'standalone-ask', userId: 'user-source', agentType: 'ask_agent', status: 'planned',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      const movedToLinear = makeTask({
        id: 'standalone-moved', userId: 'user-source', linearIssueId: 'INT-MOVED', status: 'planned',
        createdAt: now, statusChangedAt: now, updatedAt: now,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: valid.id, data: valid as unknown as Record<string, unknown> },
        { id: wrongUser.id, data: wrongUser as unknown as Record<string, unknown> },
        { id: askAgent.id, data: askAgent as unknown as Record<string, unknown> },
        { id: movedToLinear.id, data: movedToLinear as unknown as Record<string, unknown> },
      ]);

      await repo.recomputeGroupFromSource('user-source', 'standalone_standalone-valid');
      await repo.recomputeGroupFromSource('user-source', 'standalone_missing');
      await repo.recomputeGroupFromSource('user-source', 'standalone_standalone-wrong-user');
      await repo.recomputeGroupFromSource('user-source', 'standalone_standalone-ask');
      await repo.recomputeGroupFromSource('user-source', 'standalone_standalone-moved');

      expect((await fakeFirestore.collection('task_group_summaries').doc('user-source_standalone_standalone-valid').get()).exists)
        .toBe(true);
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-source_standalone_missing').get()).exists)
        .toBe(false);
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-source_standalone_standalone-wrong-user').get()).exists)
        .toBe(false);
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-source_standalone_standalone-ask').get()).exists)
        .toBe(false);
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-source_standalone_standalone-moved').get()).exists)
        .toBe(false);
    });

    it('deletes a stale summary and decrements counts exactly once when authoritative source is empty', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      await fakeFirestore.collection('task_group_summaries').doc('user-empty-source_INT-EMPTY-SOURCE').set({
        userId: 'user-empty-source',
        linearIssueId: 'INT-EMPTY-SOURCE',
        groupKey: 'INT-EMPTY-SOURCE',
        taskCount: 1,
        taskIds: ['task-gone'],
        taskStatusById: { 'task-gone': 'running' },
        taskLifecycleAtById: { 'task-gone': now },
        activeTaskCount: 1,
        latestTaskId: 'task-gone',
        latestTaskCreatedAt: now,
        latestTaskStatus: 'running',
        latestTaskUpdatedAt: now,
        latestLifecycleTaskId: 'task-gone',
        agentTypesPresent: ['execution'],
        hasCompletedPlanning: false,
        hasCompletedExecution: false,
        hasCompletedExecutionAgent: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: now,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'active',
        updatedAt: now,
      });
      await fakeFirestore.collection('user_group_counts').doc('user-empty-source').set({
        userId: 'user-empty-source',
        active: 1,
        needsAction: 0,
        done: 0,
        failed: 0,
        archived: 0,
        totalGroups: 1,
        updatedAt: now,
      });

      await repo.recomputeGroupFromSource('user-empty-source', 'INT-EMPTY-SOURCE');
      await repo.recomputeGroupFromSource('user-empty-source', 'INT-EMPTY-SOURCE');

      const summary = await fakeFirestore.collection('task_group_summaries')
        .doc('user-empty-source_INT-EMPTY-SOURCE').get();
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-empty-source').get();
      expect(summary.exists).toBe(false);
      expect(counts.get('active')).toBe(0);
      expect(counts.get('totalGroups')).toBe(0);
    });

    it('builds summary from task array', async () => {
      const repo = createIncrementalRepository({
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
      expect(doc.get('linearIssueNumber')).toBe(700);
      expect(doc.get('linearIssueSortKey')).toBe(700);
    });

    it('does nothing when tasks array is empty', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.recomputeGroupFromTasks('user-3', 'INT-EMPTY', []);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-3_INT-EMPTY').get();
      expect(doc.exists).toBe(false);
    });

    it('does nothing when all tasks are archived', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('sets implementationTaskId flag when any task has fanOutChildTaskIds', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-fanout',
        userId: 'user-4',
        linearIssueId: 'INT-FANOUTRC',
        status: 'planned',
        fanOutChildTaskIds: ['task-child-1', 'task-child-2'],
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-FANOUTRC', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-FANOUTRC').get();
      expect(doc.get('hasImplementationTaskId')).toBe(true);
    });

    it('sets hasCompletedExecution for execution agent with reviewed status', async () => {
      const repo = createIncrementalRepository({
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

    it('does not set hasCompletedExecution for review-only reviewed tasks', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-review-only',
        userId: 'user-4',
        linearIssueId: 'INT-REVONLY',
        agentType: 'review',
        status: 'reviewed',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-REVONLY', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-REVONLY').get();
      expect(doc.get('hasCompletedExecution')).toBe(false);
      expect(doc.get('aggregateStatus')).toBe('done');
    });

    it('sets hasCompletedExecution for pull_request tasks with implemented status', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-pr-impl',
        userId: 'user-4',
        linearIssueId: 'INT-PREXEC',
        agentType: 'pull_request',
        status: 'implemented',
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/900' },
        prNumber: 900,
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-PREXEC', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-PREXEC').get();
      expect(doc.get('hasCompletedExecution')).toBe(true);
    });

    it('sets hasCompletedExecutionAgent for execution agent with reviewed status in recomputeGroupFromTasks', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-ea-rc1',
        userId: 'user-4',
        linearIssueId: 'INT-EARC1',
        agentType: 'execution',
        status: 'reviewed',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-EARC1', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-EARC1').get();
      expect(doc.get('hasCompletedExecutionAgent')).toBe(true);
    });

    it('does not set hasCompletedExecutionAgent for pull_request agent in recomputeGroupFromTasks', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();

      const task = makeTask({
        id: 'task-ea-prc1',
        userId: 'user-4',
        linearIssueId: 'INT-EAPRC1',
        agentType: 'pull_request',
        status: 'implemented',
        createdAt: now,
        updatedAt: now,
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-EAPRC1', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-EAPRC1').get();
      expect(doc.get('hasCompletedExecutionAgent')).toBe(false);
    });

    it('sets latestReviewNeedsRemediation from review task result (no-remediation)', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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

    it('preserves importance, label flags, and labelsUpdatedAt when recomputing from tasks', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const labelsUpdatedAtIso = '2026-02-01T00:00:00.000Z';
      const task = makeTask({
        id: 'task-lbl-preserve',
        userId: 'user-4',
        linearIssueId: 'INT-LBLPRESERVE',
        agentType: 'planning',
        status: 'planned',
        createdAt: Timestamp.fromDate(new Date('2026-02-02T00:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-02-02T00:00:00Z')),
      });
      await repo.updateAfterCreate(task);
      await repo.recomputeWithLabels(
        'user-4',
        'INT-LBLPRESERVE',
        [
          { id: 'label-1', name: 'ready-to-implement' },
          { id: 'label-2', name: 'ready-to-merge' },
        ],
        labelsUpdatedAtIso,
      );
      await repo.setImportant('user-4', 'INT-LBLPRESERVE', true);

      const summaryRef = fakeFirestore.collection('task_group_summaries').doc('user-4_INT-LBLPRESERVE');
      await repo.recomputeGroupFromTasks('user-4', 'INT-LBLPRESERVE', [task]);
      await repo.recomputeWithLabels(
        'user-4',
        'INT-LBLPRESERVE',
        [{ id: 'label-3', name: 'bug' }],
        '2026-01-01T00:00:00.000Z',
      );

      const doc = await summaryRef.get();
      expect(doc.get('hasImplementationReadyLabel')).toBe(true);
      expect(doc.get('hasMergeReadyLabel')).toBe(true);
      expect(doc.get('isImportant')).toBe(true);
      expect(doc.get('aggregateStatus')).toBe('needs-action');
    });

    it('keeps authoritative archive recompute when an older callback arrives afterward', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const t3 = Timestamp.fromDate(new Date('2026-07-27T11:00:00Z'));
      const remaining = makeTask({
        id: 'task-A', userId: 'user-4', linearIssueId: 'INT-OUT-OF-ORDER',
        agentType: 'planning', status: 'planned', createdAt: t1, statusChangedAt: t1, updatedAt: t1,
      });
      const removed = makeTask({
        id: 'task-B', userId: 'user-4', linearIssueId: 'INT-OUT-OF-ORDER',
        agentType: 'execution', status: 'implemented', createdAt: t2, statusChangedAt: t2, updatedAt: t2,
        result: { prUrl: 'https://github.com/org/repo/pull/42' }, prNumber: 42,
      });
      const archived = { ...removed, status: 'archived' as const, statusChangedAt: t3, updatedAt: t3 };

      await repo.updateAfterCreate(remaining);
      await repo.updateAfterCreate(removed);
      await repo.updateAfterStatusChange(removed, archived);
      await repo.recomputeGroupFromTasks('user-4', 'INT-OUT-OF-ORDER', [remaining]);
      await repo.updateAfterStatusChange(
        removed,
        { ...removed, result: { ...removed.result, merge_ready: '1', merge_ready_reason: 'review_skipped' } },
      );

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-OUT-OF-ORDER').get();
      expect(doc.get('taskIds')).toEqual(['task-A']);
      expect(doc.get('latestTaskId')).toBe('task-A');
      expect(doc.get('latestTaskStatus')).toBe('planned');
      expect(doc.get('hasPrUrl')).toBe(false);
      expect(doc.get('latestMergeReadyEvidence')).toBe(false);
      expect(doc.get('taskCount')).toBe(1);
    });

    it('uses current Firestore tasks instead of a stale recompute callback snapshot', async () => {
      const repo = createRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const t1 = Timestamp.fromDate(new Date('2026-07-27T09:00:00Z'));
      const t2 = Timestamp.fromDate(new Date('2026-07-27T10:00:00Z'));
      const taskA = makeTask({
        id: 'task-A', userId: 'user-4', linearIssueId: 'INT-AUTHORITATIVE',
        status: 'planned', createdAt: t1, statusChangedAt: t1, updatedAt: t1,
      });
      const taskB = makeTask({
        id: 'task-B', userId: 'user-4', linearIssueId: 'INT-AUTHORITATIVE',
        status: 'implemented', createdAt: t2, statusChangedAt: t2, updatedAt: t2,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: taskA.id, data: taskA as unknown as Record<string, unknown> },
        { id: taskB.id, data: taskB as unknown as Record<string, unknown> },
      ]);

      await repo.recomputeGroupFromTasks('user-4', 'INT-AUTHORITATIVE', [taskA]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-AUTHORITATIVE').get();
      expect(doc.get('taskIds')).toEqual(['task-A', 'task-B']);
      expect(doc.get('taskCount')).toBe(2);
      expect(doc.get('latestTaskId')).toBe('task-B');
      expect(doc.get('latestTaskStatus')).toBe('implemented');
    });

    it('does not invent label fields when recomputing a summary that has never been label-hydrated', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const task = makeTask({
        id: 'task-no-labels',
        userId: 'user-4',
        linearIssueId: 'INT-NOLABELS',
        agentType: 'planning',
        status: 'planned',
        createdAt: Timestamp.fromDate(new Date('2026-02-03T00:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-02-03T00:00:00Z')),
      });

      await repo.updateAfterCreate(task);
      await repo.recomputeGroupFromTasks('user-4', 'INT-NOLABELS', [task]);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-4_INT-NOLABELS').get();
      expect(doc.get('hasImplementationReadyLabel')).toBeUndefined();
      expect(doc.get('hasMergeReadyLabel')).toBeUndefined();
      expect(doc.get('labelsUpdatedAt')).toBeUndefined();
    });

    it('does not update counts when recomputeGroupFromTasks keeps the same aggregateStatus', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const task = makeTask({
        id: 'task-count-stable',
        userId: 'user-4',
        linearIssueId: 'INT-COUNTSTABLE',
        agentType: 'planning',
        status: 'planned',
        createdAt: Timestamp.fromDate(new Date('2026-02-04T00:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-02-04T00:00:00Z')),
      });

      await repo.updateAfterCreate(task);
      const beforeCounts = await fakeFirestore.collection('user_group_counts').doc('user-4').get();
      await repo.recomputeGroupFromTasks('user-4', 'INT-COUNTSTABLE', [task]);
      const afterCounts = await fakeFirestore.collection('user_group_counts').doc('user-4').get();

      expect(afterCounts.get('needsAction')).toBe(beforeCounts.get('needsAction'));
      expect(afterCounts.get('done')).toBe(beforeCounts.get('done'));
    });

    it('updates counts when recomputeGroupFromTasks changes aggregateStatus on an existing summary', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const planningTask = makeTask({
        id: 'task-count-change-plan',
        userId: 'user-4',
        linearIssueId: 'INT-COUNTCHANGE',
        agentType: 'planning',
        status: 'planned',
        createdAt: Timestamp.fromDate(new Date('2026-02-05T00:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-02-05T00:00:00Z')),
      });

      await repo.updateAfterCreate(planningTask);

      const executionTask = makeTask({
        id: 'task-count-change-exec',
        userId: 'user-4',
        linearIssueId: 'INT-COUNTCHANGE',
        agentType: 'execution',
        status: 'implemented',
        createdAt: Timestamp.fromDate(new Date('2026-02-06T00:00:00Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-02-06T00:00:00Z')),
      });

      await repo.recomputeGroupFromTasks('user-4', 'INT-COUNTCHANGE', [executionTask]);

      const countsDoc = await fakeFirestore.collection('user_group_counts').doc('user-4').get();
      expect(countsDoc.get('needsAction')).toBe(0);
      // Execution agent completed with no review yet → 'active' (rule 1b keeps group active until review clears)
      expect(countsDoc.get('active')).toBe(1);
    });

    it('does not update mostRecentDispatchedAt with earlier timestamp', async () => {
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      const repo = createIncrementalRepository({
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
      expect(doc.get('linearIssueNumber')).toBeNull();
      expect(doc.get('linearIssueSortKey')).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('prNumber is null when prUrl present but prNumber is undefined', async () => {
      const repo = createIncrementalRepository({
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

    it('sets prNumber from the newest task that has prUrl', async () => {
      const repo = createIncrementalRepository({
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
      // Newest task with prUrl wins so older plan PR state cannot poison the execution PR.
      expect(doc.get('prNumber')).toBe(20);
    });
  });

  describe('recomputeWithLabels', () => {
    it('returns NOT_FOUND when no group summary exists', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.recomputeWithLabels('user-1', 'INT-999', [], '2026-03-01T00:00:00.000Z');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('stores label flags on the summary doc', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-label-1',
        userId: 'user-lbl',
        linearIssueId: 'INT-LBL',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);

      const result = await repo.recomputeWithLabels('user-lbl', 'INT-LBL', [
        { id: 'label-1', name: 'ready-to-implement' },
      ], '2026-03-01T00:00:00.000Z');
      expect(result.ok).toBe(true);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-lbl_INT-LBL').get();
      expect(doc.get('hasImplementationReadyLabel')).toBe(true);
      expect(doc.get('hasMergeReadyLabel')).toBe(false);
      expect(doc.get('labelsUpdatedAt')).toBeDefined();
    });

    it('rejects stale label writes and preserves existing label state', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const initialTs = Timestamp.fromDate(new Date('2026-03-01T00:00:00Z'));
      const staleTs = '2026-02-01T00:00:00.000Z';
      const freshTs = '2026-03-02T00:00:00.000Z';
      const task = makeTask({
        id: 'task-label-stale',
        userId: 'user-stale',
        linearIssueId: 'INT-STALE',
        agentType: 'planning',
        status: 'planned',
        createdAt: initialTs,
        updatedAt: initialTs,
      });
      await repo.updateAfterCreate(task);

      const first = await repo.recomputeWithLabels('user-stale', 'INT-STALE', [
        { id: 'label-1', name: 'ready-to-implement' },
      ], freshTs);
      expect(first.ok).toBe(true);

      const beforeDoc = await fakeFirestore.collection('task_group_summaries').doc('user-stale_INT-STALE').get();
      const beforeLabelsUpdatedAt = beforeDoc.get('labelsUpdatedAt');

      const stale = await repo.recomputeWithLabels('user-stale', 'INT-STALE', [
        { id: 'label-2', name: 'ready-to-merge' },
      ], staleTs);
      expect(stale.ok).toBe(true);

      const afterDoc = await fakeFirestore.collection('task_group_summaries').doc('user-stale_INT-STALE').get();
      expect(afterDoc.get('hasImplementationReadyLabel')).toBe(true);
      expect(afterDoc.get('hasMergeReadyLabel')).toBe(false);
      expect(afterDoc.get('labelsUpdatedAt')).toEqual(beforeLabelsUpdatedAt);
    });

    it('accepts newer label writes and updates labelsUpdatedAt', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const initialTs = Timestamp.fromDate(new Date('2026-03-01T00:00:00Z'));
      const task = makeTask({
        id: 'task-label-fresh',
        userId: 'user-fresh',
        linearIssueId: 'INT-FRESH',
        agentType: 'planning',
        status: 'planned',
        createdAt: initialTs,
        updatedAt: initialTs,
      });
      await repo.updateAfterCreate(task);

      const first = await repo.recomputeWithLabels('user-fresh', 'INT-FRESH', [
        { id: 'label-1', name: 'some-other-label' },
      ], '2026-03-01T01:00:00.000Z');
      expect(first.ok).toBe(true);

      const second = await repo.recomputeWithLabels('user-fresh', 'INT-FRESH', [
        { id: 'label-2', name: 'ready-to-merge' },
      ], '2026-03-01T02:00:00.000Z');
      expect(second.ok).toBe(true);

      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-fresh_INT-FRESH').get();
      expect(doc.get('hasImplementationReadyLabel')).toBe(false);
      expect(doc.get('hasMergeReadyLabel')).toBe(true);
      expect(doc.get('labelsUpdatedAt')).toBeDefined();
    });

    it('initializes labelsUpdatedAt for legacy docs that already have label flags', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const summaryRef = fakeFirestore.collection('task_group_summaries').doc('user-legacy_INT-LEGACY');
      const updatedAt = Timestamp.fromDate(new Date('2026-03-03T00:00:00Z'));
      await summaryRef.set({
        userId: 'user-legacy',
        linearIssueId: 'INT-LEGACY',
        groupKey: 'INT-LEGACY',
        taskCount: 1,
        activeTaskCount: 0,
        latestTaskStatus: 'planned',
        latestTaskUpdatedAt: updatedAt,
        agentTypesPresent: ['planning'],
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: updatedAt,
        mostRecentDispatchedAt: null,
        hasImplementationReadyLabel: true,
        hasMergeReadyLabel: false,
        aggregateStatus: 'needs-action',
        updatedAt,
      });

      const result = await repo.recomputeWithLabels(
        'user-legacy',
        'INT-LEGACY',
        [{ id: 'label-2', name: 'ready-to-merge' }],
        '2026-03-02T00:00:00.000Z',
      );

      expect(result.ok).toBe(true);
      const doc = await summaryRef.get();
      expect(doc.get('hasImplementationReadyLabel')).toBe(false);
      expect(doc.get('hasMergeReadyLabel')).toBe(true);
      expect(doc.get('labelsUpdatedAt')).toBeDefined();
    });

    it('updates aggregateStatus when label changes status from needs-action to done', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      // A planning-completed group: was needs-action (pessimistic default)
      const task = makeTask({
        id: 'task-label-2',
        userId: 'user-lbl2',
        linearIssueId: 'INT-LBL2',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);

      // Confirm initial status is needs-action (pessimistic: no label info yet)
      const beforeDoc = await fakeFirestore.collection('task_group_summaries').doc('user-lbl2_INT-LBL2').get();
      expect(beforeDoc.get('aggregateStatus')).toBe('needs-action');

      // Now recompute with empty labels (no ready-to-implement) → should become done
      const result = await repo.recomputeWithLabels('user-lbl2', 'INT-LBL2', [
        { id: 'label-x', name: 'some-other-label' },
      ], '2026-03-01T00:00:00.000Z');
      expect(result.ok).toBe(true);

      const afterDoc = await fakeFirestore.collection('task_group_summaries').doc('user-lbl2_INT-LBL2').get();
      expect(afterDoc.get('aggregateStatus')).toBe('done');
      expect(afterDoc.get('hasImplementationReadyLabel')).toBe(false);
    });

    it('updates user_group_counts when aggregateStatus changes', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-label-3',
        userId: 'user-lbl3',
        linearIssueId: 'INT-LBL3',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);

      // Confirm initial counts: needsAction=1 (pessimistic default when no label info)
      const beforeCounts = await fakeFirestore.collection('user_group_counts').doc('user-lbl3').get();
      expect(beforeCounts.get('needsAction')).toBe(1);
      expect(beforeCounts.get('done')).toBe(0);

      // Recompute with a non-implementation label present → hasImplementationReadyLabel returns false → status becomes done
      await repo.recomputeWithLabels('user-lbl3', 'INT-LBL3', [
        { id: 'label-bug', name: 'bug' },
      ], '2026-03-01T00:00:00.000Z');

      const afterCounts = await fakeFirestore.collection('user_group_counts').doc('user-lbl3').get();
      expect(afterCounts.get('needsAction')).toBe(0);
      expect(afterCounts.get('done')).toBe(1);
    });

    it('does not update counts when aggregateStatus does not change', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      const task = makeTask({
        id: 'task-label-4',
        userId: 'user-lbl4',
        linearIssueId: 'INT-LBL4',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);

      // Recompute with ready-to-implement label → status stays needs-action
      await repo.recomputeWithLabels('user-lbl4', 'INT-LBL4', [
        { id: 'label-rti', name: 'ready-to-implement' },
      ], '2026-03-01T00:00:00.000Z');

      const countsDoc = await fakeFirestore.collection('user_group_counts').doc('user-lbl4').get();
      expect(countsDoc.get('needsAction')).toBe(1);
      expect(countsDoc.get('done')).toBe(0);
    });

    it('preserves archived status and does not change counts for fully-archived groups', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const now = Timestamp.now();
      // Create a task, then archive it so the group becomes archived
      const task = makeTask({
        id: 'task-archived-lbl',
        userId: 'user-archived',
        linearIssueId: 'INT-ARCH',
        agentType: 'planning',
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      });
      await repo.updateAfterCreate(task);
      // Archive the task → group becomes archived (taskCount goes to 0)
      await repo.updateAfterStatusChange(task, { ...task, status: 'archived' });

      // Confirm archived state and counts
      const beforeDoc = await fakeFirestore.collection('task_group_summaries').doc('user-archived_INT-ARCH').get();
      expect(beforeDoc.get('aggregateStatus')).toBe('archived');
      const beforeCounts = await fakeFirestore.collection('user_group_counts').doc('user-archived').get();
      expect(beforeCounts.get('archived')).toBe(1);
      expect(beforeCounts.get('done')).toBe(0);

      // Recompute with labels — should NOT flip to 'done'
      const result = await repo.recomputeWithLabels('user-archived', 'INT-ARCH', [
        { id: 'label-rti', name: 'ready-to-implement' },
      ], '2026-04-01T00:00:00.000Z');
      expect(result.ok).toBe(true);

      // Status must still be archived
      const afterDoc = await fakeFirestore.collection('task_group_summaries').doc('user-archived_INT-ARCH').get();
      expect(afterDoc.get('aggregateStatus')).toBe('archived');
      // Counts must not have changed
      const afterCounts = await fakeFirestore.collection('user_group_counts').doc('user-archived').get();
      expect(afterCounts.get('archived')).toBe(1);
      expect(afterCounts.get('done')).toBe(0);
    });
  });

  describe('setImportant', () => {
    it('marks a group as important', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const task = makeTask({ userId: 'user-1', linearIssueId: 'INT-100', status: 'planned', agentType: 'planning' });
      await repo.updateAfterCreate(task);
      const result = await repo.setImportant('user-1', 'INT-100', true);
      expect(result.ok).toBe(true);
      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(doc.data()?.['isImportant']).toBe(true);
    });

    it('unmarks a group as important', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const task = makeTask({ userId: 'user-1', linearIssueId: 'INT-100', status: 'planned', agentType: 'planning' });
      await repo.updateAfterCreate(task);
      await repo.setImportant('user-1', 'INT-100', true);
      const result = await repo.setImportant('user-1', 'INT-100', false);
      expect(result.ok).toBe(true);
      const doc = await fakeFirestore.collection('task_group_summaries').doc('user-1_INT-100').get();
      expect(doc.data()?.['isImportant']).toBeUndefined();
    });

    it('returns NOT_FOUND for non-existent group', async () => {
      const repo = createIncrementalRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const result = await repo.setImportant('user-1', 'nonexistent', true);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('removeAskOnlyOrphan', () => {
    const at = Timestamp.fromDate(new Date('2026-07-27T09:00:00.000Z'));

    async function seedOrphan(
      userId: string,
      groupKey: string,
      aggregateStatus: 'active' | 'done' = 'done',
    ): Promise<void> {
      await fakeFirestore.collection('task_group_summaries').doc(`${userId}_${groupKey}`).set({
        userId,
        linearIssueId: groupKey,
        groupKey,
        taskCount: 1,
        activeTaskCount: aggregateStatus === 'active' ? 1 : 0,
        latestTaskStatus: aggregateStatus === 'active' ? 'running' : 'planned',
        latestTaskUpdatedAt: at,
        agentTypesPresent: ['ask_agent'],
        hasCompletedPlanning: false,
        hasCompletedExecution: false,
        hasCompletedExecutionAgent: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: at,
        mostRecentDispatchedAt: null,
        aggregateStatus,
        updatedAt: at,
      });
      await fakeFirestore.collection('user_group_counts').doc(userId).set({
        userId,
        active: aggregateStatus === 'active' ? 1 : 0,
        needsAction: 0,
        done: aggregateStatus === 'done' ? 1 : 0,
        failed: 0,
        archived: 0,
        totalGroups: 1,
        updatedAt: at,
      });
    }

    it('deletes a summary and corrects counts exactly once only after proving an exact ask-only source', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const askTask = makeTask({
        id: 'ask-exact',
        userId: 'user-ask',
        linearIssueId: 'INT-ASK-ONLY',
        agentType: 'ask_agent',
        status: 'archived',
      });
      const wrongUserTask = makeTask({
        id: 'ask-other-user',
        userId: 'other-user',
        linearIssueId: 'INT-ASK-ONLY',
        agentType: 'execution',
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: askTask.id, data: askTask as unknown as Record<string, unknown> },
        { id: wrongUserTask.id, data: wrongUserTask as unknown as Record<string, unknown> },
      ]);
      await seedOrphan('user-ask', 'INT-ASK-ONLY');

      const first = await repo.removeAskOnlyOrphan('user-ask', 'INT-ASK-ONLY');
      const second = await repo.removeAskOnlyOrphan('user-ask', 'INT-ASK-ONLY');

      expect(first).toEqual({ ok: true, value: 'removed' });
      expect(second).toEqual({ ok: true, value: 'summary_missing' });
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-ask_INT-ASK-ONLY').get()).exists)
        .toBe(false);
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-ask').get();
      expect(counts.get('done')).toBe(0);
      expect(counts.get('totalGroups')).toBe(0);
    });

    it('leaves mixed and malformed exact source groups untouched', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const askTask = makeTask({
        id: 'ask-mixed', userId: 'user-mixed', linearIssueId: 'INT-MIXED', agentType: 'ask_agent',
      });
      const executionTask = makeTask({
        id: 'execution-mixed', userId: 'user-mixed', linearIssueId: 'INT-MIXED', agentType: 'execution',
      });
      const malformedStandalone = makeTask({
        id: 'malformed-standalone', userId: 'wrong-user', agentType: 'ask_agent',
      });
      const malformedLinear = makeTask({
        id: 'malformed-linear', userId: 'user-malformed-linear', linearIssueId: 'INT-MALFORMED-LINEAR',
        agentType: 'ask_agent', createdAt: null as never,
      });
      const malformedCanonical = makeTask({
        id: 'malformed-canonical', userId: 'user-malformed-canonical',
        linearIssueId: 'INT-MALFORMED-CANONICAL', agentType: 'ask_agent',
        statusChangedAt: null as never,
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: askTask.id, data: askTask as unknown as Record<string, unknown> },
        { id: executionTask.id, data: executionTask as unknown as Record<string, unknown> },
        { id: malformedStandalone.id, data: malformedStandalone as unknown as Record<string, unknown> },
        { id: malformedLinear.id, data: malformedLinear as unknown as Record<string, unknown> },
        { id: malformedCanonical.id, data: malformedCanonical as unknown as Record<string, unknown> },
      ]);
      await seedOrphan('user-mixed', 'INT-MIXED', 'active');
      await seedOrphan('user-malformed', 'standalone_malformed-standalone');
      await seedOrphan('user-malformed-linear', 'INT-MALFORMED-LINEAR');
      await seedOrphan('user-malformed-canonical', 'INT-MALFORMED-CANONICAL');

      const mixed = await repo.removeAskOnlyOrphan('user-mixed', 'INT-MIXED');
      const malformed = await repo.removeAskOnlyOrphan('user-malformed', 'standalone_malformed-standalone');
      const malformedLinearResult = await repo.removeAskOnlyOrphan(
        'user-malformed-linear',
        'INT-MALFORMED-LINEAR',
      );
      const malformedCanonicalResult = await repo.removeAskOnlyOrphan(
        'user-malformed-canonical',
        'INT-MALFORMED-CANONICAL',
      );

      expect(mixed).toEqual({ ok: true, value: 'source_not_ask_only' });
      expect(malformed).toEqual({ ok: true, value: 'source_invalid' });
      expect(malformedLinearResult).toEqual({ ok: true, value: 'source_invalid' });
      expect(malformedCanonicalResult).toEqual({ ok: true, value: 'source_invalid' });
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-mixed_INT-MIXED').get()).exists)
        .toBe(true);
      expect((await fakeFirestore.collection('task_group_summaries')
        .doc('user-malformed_standalone_malformed-standalone').get()).exists).toBe(true);
    });

    it('reports an empty exact source as unknown and never deletes it', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      await seedOrphan('user-unknown', 'INT-UNKNOWN');

      const result = await repo.removeAskOnlyOrphan('user-unknown', 'INT-UNKNOWN');

      expect(result).toEqual({ ok: true, value: 'source_unknown' });
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-unknown_INT-UNKNOWN').get()).exists)
        .toBe(true);
    });

    it('re-proves ask-only state inside the transaction so a concurrent non-ask task blocks deletion', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const askTask = makeTask({
        id: 'ask-race', userId: 'user-race', linearIssueId: 'INT-RACE', agentType: 'ask_agent',
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: askTask.id, data: askTask as unknown as Record<string, unknown> },
      ]);
      await seedOrphan('user-race', 'INT-RACE');
      const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
      vi.spyOn(fakeFirestore, 'runTransaction').mockImplementationOnce(async (callback) => {
        const executionTask = makeTask({
          id: 'execution-race', userId: 'user-race', linearIssueId: 'INT-RACE', agentType: 'execution',
        });
        await fakeFirestore.collection('code_tasks').doc(executionTask.id)
          .set(executionTask as unknown as Record<string, unknown>);
        return await originalRunTransaction(callback);
      });

      const result = await repo.removeAskOnlyOrphan('user-race', 'INT-RACE');

      expect(result).toEqual({ ok: true, value: 'source_not_ask_only' });
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-race_INT-RACE').get()).exists)
        .toBe(true);
    });

    it('re-proves the full counts vector against physical summaries before ask-only deletion', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const askTask = makeTask({
        id: 'ask-ledger-race', userId: 'user-ledger-race', linearIssueId: 'INT-ASK-LEDGER',
        agentType: 'ask_agent', status: 'archived',
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: askTask.id, data: askTask as unknown as Record<string, unknown> },
      ]);
      await seedOrphan('user-ledger-race', 'INT-ASK-LEDGER');
      await fakeFirestore.collection('task_group_summaries').doc('user-ledger-race_INT-OTHER').set({
        userId: 'user-ledger-race', groupKey: 'INT-OTHER', aggregateStatus: 'active', updatedAt: at,
      });
      await fakeFirestore.collection('user_group_counts').doc('user-ledger-race').update({
        active: 1, done: 1, totalGroups: 2,
      });
      const originalRunTransaction = fakeFirestore.runTransaction.bind(fakeFirestore);
      vi.spyOn(fakeFirestore, 'runTransaction').mockImplementationOnce(async (callback) => {
        await fakeFirestore.collection('user_group_counts').doc('user-ledger-race').update({
          active: 0, done: 2, totalGroups: 2,
        });
        return await originalRunTransaction(callback);
      });

      const result = await repo.removeAskOnlyOrphan('user-ledger-race', 'INT-ASK-LEDGER');

      expect(result).toEqual({ ok: true, value: 'counts_invalid' });
      expect((await fakeFirestore.collection('task_group_summaries')
        .doc('user-ledger-race_INT-ASK-LEDGER').get()).exists).toBe(true);
      expect((await fakeFirestore.collection('user_group_counts').doc('user-ledger-race').get()).data())
        .toMatchObject({ active: 0, done: 2, totalGroups: 2 });
    });

    it('rejects ask-only deletion when another physical summary for the user is malformed', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const askTask = makeTask({
        id: 'ask-malformed-ledger', userId: 'user-malformed-ledger',
        linearIssueId: 'INT-ASK-MALFORMED-LEDGER', agentType: 'ask_agent', status: 'archived',
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: askTask.id, data: askTask as unknown as Record<string, unknown> },
      ]);
      await seedOrphan('user-malformed-ledger', 'INT-ASK-MALFORMED-LEDGER');
      await fakeFirestore.collection('task_group_summaries')
        .doc('user-malformed-ledger_INT-MALFORMED').set({
          userId: 'user-malformed-ledger', groupKey: 'INT-MALFORMED', aggregateStatus: 'mystery',
          updatedAt: at,
        });

      const result = await repo.removeAskOnlyOrphan(
        'user-malformed-ledger',
        'INT-ASK-MALFORMED-LEDGER',
      );

      expect(result).toEqual({ ok: true, value: 'counts_invalid' });
      expect((await fakeFirestore.collection('task_group_summaries')
        .doc('user-malformed-ledger_INT-ASK-MALFORMED-LEDGER').get()).exists).toBe(true);
    });

    it('handles an exact standalone ask-only source safely', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const task = makeTask({
        id: 'ask-standalone', userId: 'user-standalone-ask', agentType: 'ask_agent', status: 'archived',
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: task.id, data: task as unknown as Record<string, unknown> },
      ]);
      await fakeFirestore.collection('task_group_summaries')
        .doc('user-standalone-ask_standalone_ask-standalone').set({
          userId: 'user-standalone-ask',
          groupKey: 'standalone_ask-standalone',
          linearIssueId: null,
          aggregateStatus: 'done',
          updatedAt: at,
        });
      await fakeFirestore.collection('user_group_counts').doc('user-standalone-ask').set({
        userId: 'user-standalone-ask', active: 0, needsAction: 0, done: 1, failed: 0, archived: 0,
        totalGroups: 1, updatedAt: at,
      });

      const removed = await repo.removeAskOnlyOrphan('user-standalone-ask', 'standalone_ask-standalone');
      const unknown = await repo.removeAskOnlyOrphan('user-standalone-ask', 'standalone_missing');

      expect(removed).toEqual({ ok: true, value: 'removed' });
      expect(unknown).toEqual({ ok: true, value: 'source_unknown' });
      const counts = await fakeFirestore.collection('user_group_counts').doc('user-standalone-ask').get();
      expect(counts.get('done')).toBe(0);
      expect(counts.get('totalGroups')).toBe(0);
    });

    it('does not guess user counts when the counts document is missing', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const task = makeTask({
        id: 'ask-missing-counts', userId: 'user-missing-counts', linearIssueId: 'INT-MISSING-COUNTS',
        agentType: 'ask_agent', status: 'archived',
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: task.id, data: task as unknown as Record<string, unknown> },
      ]);
      await fakeFirestore.collection('task_group_summaries').doc('user-missing-counts_INT-MISSING-COUNTS').set({
        userId: 'user-missing-counts', groupKey: 'INT-MISSING-COUNTS',
        aggregateStatus: 'done', updatedAt: at,
      });

      const result = await repo.removeAskOnlyOrphan('user-missing-counts', 'INT-MISSING-COUNTS');

      expect(result).toEqual({ ok: true, value: 'counts_invalid' });
      expect((await fakeFirestore.collection('task_group_summaries')
        .doc('user-missing-counts_INT-MISSING-COUNTS').get()).exists).toBe(true);
    });

    it.each([
      ['summary_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('task_group_summaries').doc('user-invalid_INT-INVALID').update({
          isImportant: 'yes',
        });
      }],
      ['summary_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('task_group_summaries').doc('user-invalid_INT-INVALID').update({
          labelsUpdatedAt: null,
        });
      }],
      ['summary_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('task_group_summaries').doc('user-invalid_INT-INVALID').update({
          userId: 'other-user',
        });
      }],
      ['summary_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('task_group_summaries').doc('user-invalid_INT-INVALID').update({
          aggregateStatus: 'mystery',
        });
      }],
      ['counts_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('user_group_counts').doc('user-invalid').update({
          totalGroups: -1,
        });
      }],
      ['counts_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('user_group_counts').doc('user-invalid').update({
          done: -1,
          totalGroups: 0,
        });
      }],
      ['counts_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('user_group_counts').doc('user-invalid').update({
          totalGroups: 2,
        });
      }],
      ['counts_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('user_group_counts').doc('user-invalid').update({
          active: Number.MAX_SAFE_INTEGER,
          done: Number.MAX_SAFE_INTEGER,
          totalGroups: Number.MAX_SAFE_INTEGER,
        });
      }],
      ['counts_invalid', async (): Promise<void> => {
        await fakeFirestore.collection('user_group_counts').doc('user-invalid').update({
          userId: 'other-user',
        });
      }],
    ])('leaves invalid persisted user state untouched with %s', async (expectedOutcome, mutate) => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      const task = makeTask({
        id: 'ask-invalid', userId: 'user-invalid', linearIssueId: 'INT-INVALID',
        agentType: 'ask_agent', status: 'archived',
      });
      fakeFirestore.seedCollection('code_tasks', [
        { id: task.id, data: task as unknown as Record<string, unknown> },
      ]);
      await seedOrphan('user-invalid', 'INT-INVALID');
      await mutate();

      const result = await repo.removeAskOnlyOrphan('user-invalid', 'INT-INVALID');

      expect(result).toEqual({ ok: true, value: expectedOutcome });
      expect((await fakeFirestore.collection('task_group_summaries').doc('user-invalid_INT-INVALID').get()).exists)
        .toBe(true);
    });

    it('returns FIRESTORE_ERROR instead of throwing when orphan verification fails', async () => {
      const repo = createRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
      fakeFirestore.configure({ errorToThrow: new Error('verification failed') });

      const result = await repo.removeAskOnlyOrphan('user-error', 'INT-ERROR');

      expect(result).toEqual({
        ok: false,
        error: { code: 'FIRESTORE_ERROR', message: 'verification failed' },
      });
    });
  });
});
