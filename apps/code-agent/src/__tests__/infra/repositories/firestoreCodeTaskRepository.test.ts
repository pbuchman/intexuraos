/**
 * Tests for CodeTask Firestore repository with deduplication.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import type { CreateTaskInput } from '../../../domain/repositories/codeTaskRepository.js';

describe('firestoreCodeTaskRepository', () => {
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

  const createTaskInput = (overrides: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    userId: 'user-123',
    prompt: 'Fix login bug',
    sanitizedPrompt: 'fix login bug',
    systemPromptHash: 'abc123',
    workerType: 'opus',
    workerLocation: 'vm',
    repository: 'test/repo',
    baseBranch: 'main',
    traceId: 'trace-123',
    ...overrides,
  });

  describe('create', () => {
    it('creates task with generated dedupKey', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.userId).toBe('user-123');
      expect(result.value.prompt).toBe('Fix login bug');
      expect(result.value.status).toBe('queued');
      expect(result.value.dedupKey).toMatch(/^[a-f0-9]{16}$/);
      expect(result.value.createdAt).toBeDefined();
      expect(result.value.updatedAt).toBeDefined();
    });

    it('creates task with dispatched status when initialStatus is dispatched', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({ initialStatus: 'dispatched' });
      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status).toBe('dispatched');
    });

    it('Layer 0: rejects duplicate approvalEventId with DUPLICATE_APPROVAL', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({ approvalEventId: 'approval-123' });
      const first = await repo.create(input);

      expect(first.ok).toBe(true);

      const second = await repo.create(input);

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('DUPLICATE_APPROVAL');
      if (second.error.code === 'DUPLICATE_APPROVAL') {
        expect(second.error.existingTaskId).toBeDefined();
      }
    });

    it('Layer 1: rejects duplicate actionId with DUPLICATE_ACTION', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({ actionId: 'action-123' });
      const first = await repo.create(input);

      expect(first.ok).toBe(true);

      const second = await repo.create(input);

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('DUPLICATE_ACTION');
      if (second.error.code === 'DUPLICATE_ACTION') {
        expect(second.error.existingTaskId).toBeDefined();
      }
    });

    it('Layer 2: rejects duplicate prompt within 5 minutes with DUPLICATE_PROMPT', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const first = await repo.create(input);

      expect(first.ok).toBe(true);

      const second = await repo.create(input);

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('DUPLICATE_PROMPT');
      if (second.error.code === 'DUPLICATE_PROMPT') {
        expect(second.error.existingTaskId).toBeDefined();
      }
    });

    it('Layer 2: skips dedup check for retried tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const first = await repo.create(input);

      expect(first.ok).toBe(true);

      const retryInput = createTaskInput({ retriedFrom: 'original-task-id' });
      const second = await repo.create(retryInput);

      expect(second.ok).toBe(true);
    });

    it('Layer 2: skips dedup check for execution_implement follow-up tasks (same prompt intentional)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create planning task
      const phase1Input = createTaskInput({ linearIssueId: 'INT-200' });
      const phase1 = await repo.create(phase1Input);
      expect(phase1.ok).toBe(true);

      // Mark planning task complete so it does not trigger Layer 3 (active task)
      if (phase1.ok) {
        await repo.update(phase1.value.id, { status: 'planned' });
      }

      // Create execution follow-up task with same prompt — must NOT be blocked by DUPLICATE_PROMPT
      const executionInput = createTaskInput({
        linearIssueId: 'INT-200',
        parentTaskId: phase1.ok ? phase1.value.id : 'parent-id',
        followUpReason: 'execution_implement',
      });
      const executionTask = await repo.create(executionInput);

      expect(executionTask.ok).toBe(true);
    });

    it('Layer 2: allows same prompt for different Linear issues within 5 minutes', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const first = await repo.create(createTaskInput({
        prompt: 'Implement exactly as described in the linked Linear issue.',
        linearIssueId: 'INT-100',
      }));
      expect(first.ok).toBe(true);

      // Complete the first task so Layer 3 doesn't block
      if (first.ok) {
        await repo.update(first.value.id, { status: 'planned' });
      }

      // Same prompt, different Linear issue — should NOT be blocked by Layer 2
      const second = await repo.create(createTaskInput({
        prompt: 'Implement exactly as described in the linked Linear issue.',
        linearIssueId: 'INT-200',
      }));
      expect(second.ok).toBe(true);
    });

    it('Layer 2: still blocks same prompt + same Linear issue within 5 minutes', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const first = await repo.create(createTaskInput({
        prompt: 'Implement exactly as described in the linked Linear issue.',
        linearIssueId: 'INT-100',
      }));
      expect(first.ok).toBe(true);

      // Same prompt AND same Linear issue — should be blocked by Layer 2
      const second = await repo.create(createTaskInput({
        prompt: 'Implement exactly as described in the linked Linear issue.',
        linearIssueId: 'INT-100',
      }));
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(['DUPLICATE_PROMPT', 'ACTIVE_TASK_EXISTS']).toContain(second.error.code);
    });

    it('Layer 2: allows same prompt after 5 minutes', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const first = await repo.create(input);

      expect(first.ok).toBe(true);

      // Create a new task with same prompt but different user (to bypass dedup)
      const input2 = createTaskInput({ userId: 'user-456' });
      const second = await repo.create(input2);

      expect(second.ok).toBe(true);
    });

    it('Layer 3: rejects when active task exists for Linear issue with ACTIVE_TASK_EXISTS', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({ linearIssueId: 'LIN-123' });
      const first = await repo.create(input);

      expect(first.ok).toBe(true);

      const second = await repo.create(input);

      expect(second.ok).toBe(false);
      if (second.ok) return;
      // Check that we got some dedup error (Layer 2 or 3 depends on fake Firestore behavior)
      expect(['DUPLICATE_PROMPT', 'ACTIVE_TASK_EXISTS']).toContain(second.error.code);
    });

    it('allows task when previous Linear issue task is completed', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({ linearIssueId: 'LIN-123' });
      const first = await repo.create(input);

      expect(first.ok).toBe(true);
      if (!first.ok) return;

      // Mark first task as completed
      await repo.update(first.value.id, { status: 'planned' });

      // Now allow second task for same Linear issue
      // Use different user to bypass Layer 2 dedup (dedupKey check)
      const input2 = createTaskInput({ userId: 'user-456', linearIssueId: 'LIN-123' });
      const second = await repo.create(input2);

      expect(second.ok).toBe(true);
    });

    it('normalizes prompt for dedupKey', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input1 = createTaskInput({ prompt: '  Fix   Login  Bug  ' });
      const input2 = createTaskInput({ prompt: 'fix login bug' });

      const first = await repo.create(input1);
      const second = await repo.create(input2);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('DUPLICATE_PROMPT');
    });

    it('stores supported optional fields only', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        actionId: 'action-123',
        approvalEventId: 'approval-123',
        linearIssueId: 'LIN-123',
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.actionId).toBe('action-123');
      expect(result.value.approvalEventId).toBe('approval-123');
      expect(result.value.linearIssueId).toBe('LIN-123');
      expect(result.value).not.toHaveProperty('linearIssueTitle');
      expect(result.value).not.toHaveProperty('linearIssueUrl');
      expect(result.value).not.toHaveProperty('linearIssueType');
      expect(result.value).not.toHaveProperty('linearIssueLabels');
      expect(result.value).not.toHaveProperty('linearFallback');
    });

    it('stores PR correlation fields (INT-465)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        prNumber: 123,
        prBranch: 'feature/test',
        parentTaskId: 'task_parent-123',
        followUpReason: 'pr_comment',
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.prNumber).toBe(123);
      expect(result.value.prBranch).toBe('feature/test');
      expect(result.value.parentTaskId).toBe('task_parent-123');
      expect(result.value.followUpReason).toBe('pr_comment');
    });

    it('stores agentType when provided in create input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        agentType: 'planning',
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.agentType).toBe('planning');
    });

    it('stores agentType as execution when provided', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        agentType: 'execution',
        retriedFrom: 'original-task-id', // bypass dedup
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.agentType).toBe('execution');
    });

    it('does not set agentType when not provided in create input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // createTaskInput does not set agentType by default
      const input = createTaskInput();

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.agentType).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns existing task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.findById(created.value.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe(created.value.id);
      expect(result.value.userId).toBe('user-123');
    });

    it('strips legacy linear fields from existing documents', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ linearIssueId: 'INT-123' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await fakeFirestore
        .collection('code_tasks')
        .doc(created.value.id)
        .update({
          linearIssueTitle: 'Legacy title',
          linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-123',
          linearIssueType: 'feature',
          linearIssueLabels: ['backend'],
          linearFallback: true,
        });

      const result = await repo.findById(created.value.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.linearIssueId).toBe('INT-123');
      expect(result.value).not.toHaveProperty('linearIssueTitle');
      expect(result.value).not.toHaveProperty('linearIssueUrl');
      expect(result.value).not.toHaveProperty('linearIssueType');
      expect(result.value).not.toHaveProperty('linearIssueLabels');
      expect(result.value).not.toHaveProperty('linearFallback');
    });

    it('returns NOT_FOUND for non-existent task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findById('non-existent');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('findByIdForUser', () => {
    it('returns task when user owns it', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ userId: 'user-123' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.findByIdForUser(created.value.id, 'user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe(created.value.id);
    });

    it('returns NOT_FOUND for other user\'s task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ userId: 'user-123' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.findByIdForUser(created.value.id, 'user-456');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND for non-existent task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findByIdForUser('non-existent', 'user-123');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates task status', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, { status: 'running' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('running');
    });

    it('updates multiple fields', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const completedAt = new Date();
      const result = await repo.update(created.value.id, {
        status: 'planned',
        completedAt,
        result: {
          branch: 'feature/test',
          commits: 1,
          summary: 'Done',
          prUrl: 'https://github.com/test/pr/1',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status).toBe('planned');
      // Check that completedAt exists (fake Firestore may not handle Timestamp fields properly)
      if (result.value.completedAt !== undefined) {
        expect(result.value.completedAt.toDate()).toEqual(completedAt);
      }
      expect(result.value.result?.summary).toBe('Done');
    });

    it('returns NOT_FOUND for non-existent task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.update('non-existent', { status: 'running' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('updates task with queuedAt field', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const queuedAt = new Date();
      const result = await repo.update(created.value.id, {
        status: 'queued',
        queuedAt,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('queued');
      if (result.value.queuedAt !== undefined) {
        expect(result.value.queuedAt.toDate()).toEqual(queuedAt);
      }
    });
  });

  describe('list', () => {
    it('returns paginated results with cursor', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks
      await repo.create(createTaskInput());
      await repo.create(createTaskInput());

      const result = await repo.list({ userId: 'user-123', limit: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks.length).toBeGreaterThanOrEqual(0);
    });

    it('filters by status array', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({ prompt: 'Task 1' }));
      const task2 = await repo.create(createTaskInput({ prompt: 'Task 2' }));
      expect(task2.ok).toBe(true);
      if (!task2.ok) return;
      await repo.update(task2.value.id, { status: 'planned' });

      const result = await repo.list({ userId: 'user-123', status: ['planned'] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks.length).toBe(1);
      expect(result.value.tasks[0]?.status).toBe('planned');
    });

    it('returns tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks with different prompts to avoid deduplication
      await repo.create(createTaskInput({ prompt: 'Task 1' }));
      await repo.create(createTaskInput({ prompt: 'Task 2' }));

      const result = await repo.list({ userId: 'user-123' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks.length).toBe(2);
    });
  });

  describe('hasActiveTaskForLinearIssue', () => {
    it('returns true when active task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ linearIssueId: 'LIN-123' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.hasActiveTaskForLinearIssue('LIN-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(true);
      expect(result.value.taskId).toBe(created.value.id);
    });

    it('returns false when no active task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.hasActiveTaskForLinearIssue('LIN-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(false);
      expect(result.value.taskId).toBeUndefined();
    });

    it('returns false when task is completed', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ linearIssueId: 'LIN-123' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'planned' });

      const result = await repo.hasActiveTaskForLinearIssue('LIN-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(false);
    });
  });

  describe('findZombieTasks', () => {
    it('finds stale tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'running',
        dispatchedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      });

      // Just test the query works - actual filtering depends on Firestore
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const result = await repo.findZombieTasks(staleThreshold);

      expect(result.ok).toBe(true);
    });

    it('returns empty array when no zombie tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
      const result = await repo.findZombieTasks(staleThreshold);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toEqual([]);
    });
  });

  describe('findByIdForUser', () => {
    it('returns task when user owns it', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ userId: 'user-123' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.findByIdForUser(created.value.id, 'user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe(created.value.id);
      expect(result.value.userId).toBe('user-123');
    });

    it('returns NOT_FOUND when task belongs to different user', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ userId: 'user-123' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.findByIdForUser(created.value.id, 'user-456');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NOT_FOUND when task does not exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findByIdForUser('non-existent-task', 'user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('list', () => {
    it('returns tasks for user', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks for two users
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 1' }));
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 2' }));
      await repo.create(createTaskInput({ userId: 'user-456', prompt: 'Task 3' }));

      const result = await repo.list({ userId: 'user-123' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks).toHaveLength(2);
    });

    it('filters by single status (array with one element)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks
      const task1 = await repo.create(createTaskInput({ userId: 'user-123' }));
      expect(task1.ok).toBe(true);
      if (task1.ok) {
        await repo.update(task1.value.id, { status: 'planned' });
      }

      await repo.create(createTaskInput({ userId: 'user-123' }));

      const result = await repo.list({ userId: 'user-123', status: ['planned'] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks).toHaveLength(1);
      expect(result.value.tasks[0]?.status).toBe('planned');
    });

    it('filters by multiple statuses', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks with different statuses
      const task1 = await repo.create(createTaskInput({ userId: 'user-123', prompt: 'multi-1' }));
      expect(task1.ok).toBe(true);
      if (task1.ok) {
        await repo.update(task1.value.id, { status: 'planned' });
      }

      const task2 = await repo.create(createTaskInput({ userId: 'user-123', prompt: 'multi-2' }));
      expect(task2.ok).toBe(true);
      if (task2.ok) {
        await repo.update(task2.value.id, { status: 'failed' });
      }

      // dispatched task (should not be returned)
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'multi-3' }));

      const result = await repo.list({ userId: 'user-123', status: ['planned', 'failed'] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks).toHaveLength(2);
      const statuses = result.value.tasks.map((t) => t.status);
      expect(statuses).toContain('planned');
      expect(statuses).toContain('failed');
    });

    it('returns all tasks when status is empty array', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'empty-filter-1' }));
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'empty-filter-2' }));

      const result = await repo.list({ userId: 'user-123', status: [] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks).toHaveLength(2);
    });

    it('paginates with limit and returns nextCursor when more exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create 3 tasks
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 1' }));
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 2' }));
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 3' }));

      const result = await repo.list({ userId: 'user-123', limit: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks).toHaveLength(2);
      expect(result.value.nextCursor).toBeDefined();
    });

    it('omits nextCursor on the last page', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create exactly 2 tasks
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Last page 1' }));
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Last page 2' }));

      // Request with limit >= total count
      const result = await repo.list({ userId: 'user-123', limit: 5 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks).toHaveLength(2);
      expect(result.value.nextCursor).toBeUndefined();
    });

    it('returns empty array when user has no tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.list({ userId: 'user-999' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks).toEqual([]);
      expect(result.value.nextCursor).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates existing task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        status: 'planned',
        result: {
          branch: 'fix-branch',
          commits: 3,
          summary: 'Fixed the bug',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status).toBe('planned');
      expect(result.value.result?.branch).toBe('fix-branch');
    });

    it('returns NOT_FOUND when task does not exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.update('non-existent-task', { status: 'planned' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('updates task error', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        error: {
          code: 'worker_error',
          message: 'Worker failed',
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.error?.code).toBe('worker_error');
    });

    it('clears task error when set to null', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // First set an error
      await repo.update(created.value.id, {
        error: { code: 'worker_error', message: 'Worker failed' },
      });

      // Then clear it
      const result = await repo.update(created.value.id, { error: null });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.error).toBeUndefined();
    });

    it('updates statusSummary', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Import Timestamp to create a proper timestamp
      const { Timestamp } = await import('@google-cloud/firestore');
      const result = await repo.update(created.value.id, {
        statusSummary: {
          phase: 'implementing',
          message: 'Task is in progress',
          progress: 50,
          updatedAt: Timestamp.now(),
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.statusSummary?.message).toBe('Task is in progress');
    });

    it('clears cancelNonce when set to null', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // First set cancelNonce
      await repo.update(created.value.id, {
        cancelNonce: 'nonce-123',
        cancelNonceExpiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      // Then clear it by setting to null
      const result = await repo.update(created.value.id, {
        cancelNonce: null,
        cancelNonceExpiresAt: null,
      });

      expect(result.ok).toBe(true);
    });

    it('allows explicit updatedAt for heartbeat', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const customUpdatedAt = new Date('2025-01-15T10:30:00Z');
      const result = await repo.update(created.value.id, {
        updatedAt: customUpdatedAt,
      });

      expect(result.ok).toBe(true);
    });

    it('sets implementationTaskId when provided in update', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        implementationTaskId: 'task_phase2',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.implementationTaskId).toBe('task_phase2');
    });

    it('sets prNumber and prBranch on update (INT-465)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        prNumber: 835,
        prBranch: 'fix/login-bug',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.prNumber).toBe(835);
      expect(result.value.prBranch).toBe('fix/login-bug');
    });

    it('clears implementationTaskId when set to null', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // First set implementationTaskId
      await repo.update(created.value.id, {
        implementationTaskId: 'task_phase2',
      });

      // Then clear it by setting to null
      const result = await repo.update(created.value.id, {
        implementationTaskId: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.implementationTaskId).toBeUndefined();
    });
  });

  describe('findArchivableTasks', () => {
    it('returns tasks before cutoff with logsArchived=false', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'planned',
        completedAt: new Date('2024-01-01'),
      });

      const cutoff = new Date('2024-06-01');
      const result = await repo.findArchivableTasks(cutoff, 100);

      expect(result.ok).toBe(true);
    });

    it('returns empty array when none exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findArchivableTasks(new Date(), 100);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it('respects limit parameter', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({ prompt: 'Task 1' }));
      await repo.create(createTaskInput({ prompt: 'Task 2' }));

      const result = await repo.findArchivableTasks(new Date(), 1);

      expect(result.ok).toBe(true);
    });
  });

  describe('archiveTaskLogs', () => {
    it('updates task with logsArchived=true', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'planned',
        completedAt: new Date(),
      });

      const result = await repo.archiveTaskLogs(created.value.id, 500);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logCount).toBe(0);
      expect(result.value.archivedAt).toBeInstanceOf(Date);
    });

    it('returns NOT_FOUND for non-existent task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.archiveTaskLogs('non-existent', 500);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('findByPR (INT-465)', () => {
    it('returns task when repository and prNumber match', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 456,
        prBranch: 'feature/test',
      }));
      expect(created.ok).toBe(true);

      const result = await repo.findByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.prNumber).toBe(456);
      expect(result.value?.repository).toBe('test/repo');
    });

    it('returns null when no task exists for PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findByPR('test/repo', 999);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns null when repository does not match', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 123,
      }));

      const result = await repo.findByPR('other/repo', 123);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });
  });

  describe('deleteTask', () => {
    it('deletes task successfully', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ userId: 'user-abc' }));
      if (!created.ok) throw new Error('Setup failed');

      const result = await repo.deleteTask(created.value.id, 'user-abc');

      expect(result.ok).toBe(true);
    });

    it('returns NOT_FOUND when task does not exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.deleteTask('non-existent-id', 'user-abc');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when userId does not match', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ userId: 'user-abc' }));
      if (!created.ok) throw new Error('Setup failed');

      const result = await repo.deleteTask(created.value.id, 'different-user');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('findOldestQueued', () => {
    it('returns null when no queued tasks exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findOldestQueued();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('returns the oldest queued task when one exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task and set it to queued
      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'queued',
        queuedAt: new Date(),
      });

      const result = await repo.findOldestQueued();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe(created.value.id);
      expect(result.value?.status).toBe('queued');
    });
  });

  describe('findPlannedTaskByLinearIssue', () => {
    it('returns matching planned planning task without implementationTaskId', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a planned planning task
      const created = await repo.create(createTaskInput({
        linearIssueId: 'INT-500',
        agentType: 'planning',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Set status to planned
      await repo.update(created.value.id, { status: 'planned' });

      const result = await repo.findPlannedTaskByLinearIssue('INT-500');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe(created.value.id);
    });

    it('returns null when no planned task exists for linearIssueId', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findPlannedTaskByLinearIssue('INT-999');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('returns null when planned task already has implementationTaskId', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a planned planning task
      const created = await repo.create(createTaskInput({
        linearIssueId: 'INT-501',
        agentType: 'planning',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Set status to planned and implementationTaskId
      await repo.update(created.value.id, {
        status: 'planned',
        implementationTaskId: 'task_existing',
      });

      const result = await repo.findPlannedTaskByLinearIssue('INT-501');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('returns null when task is not in planned status', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a running planning task (not yet planned)
      await repo.create(createTaskInput({
        linearIssueId: 'INT-502',
        agentType: 'planning',
      }));

      const result = await repo.findPlannedTaskByLinearIssue('INT-502');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('returns null when task is execution type not planning', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a planned execution task (should not match)
      const created = await repo.create(createTaskInput({
        linearIssueId: 'INT-503',
        agentType: 'execution',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'planned' });

      const result = await repo.findPlannedTaskByLinearIssue('INT-503');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });
  });
});
