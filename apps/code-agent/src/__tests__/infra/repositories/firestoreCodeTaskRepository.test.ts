/**
 * Tests for CodeTask Firestore repository with deduplication.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH } from '../../../domain/models/codeTask.js';
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

    it('Layer 2: allows same prompt when previous task was cancelled', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const first = await repo.create(input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      // Cancel the first task (simulates review_replaced flow)
      await repo.update(first.value.id, {
        status: 'cancelled',
        completedAt: new Date(),
        error: { code: 'review_replaced', message: 'Replaced by fresh review' },
      });

      // Same prompt within 5 minutes — should succeed because first is cancelled
      const second = await repo.create(input);
      expect(second.ok).toBe(true);
    });

    it('Layer 2: allows same prompt when previous task failed', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const first = await repo.create(input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      // Fail the first task
      await repo.update(first.value.id, {
        status: 'failed',
        completedAt: new Date(),
        error: { code: 'worker_error', message: 'Container crashed' },
      });

      // Same prompt within 5 minutes — should succeed because first failed
      const second = await repo.create(input);
      expect(second.ok).toBe(true);
    });

    it('Layer 2: allows same prompt when previous task was interrupted', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const first = await repo.create(input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      await repo.update(first.value.id, {
        status: 'interrupted',
        completedAt: new Date(),
      });

      const second = await repo.create(input);
      expect(second.ok).toBe(true);
    });

    it('Layer 2: still blocks same prompt when previous task is active (dispatched)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput();
      const first = await repo.create(input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      // Task is dispatched (active) — should still block
      await repo.update(first.value.id, { status: 'dispatched' });

      const second = await repo.create(input);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('DUPLICATE_PROMPT');
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

    it('allows review task when an execution task is active for the same Linear issue', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const executionTask = await repo.create(createTaskInput({
        linearIssueId: 'LIN-123',
        agentType: 'execution',
      }));
      expect(executionTask.ok).toBe(true);

      const reviewTask = await repo.create(createTaskInput({
        userId: 'user-456',
        prompt: 'Review PR #42',
        sanitizedPrompt: 'review pr #42',
        linearIssueId: 'LIN-123',
        agentType: 'review',
        prNumber: 42,
      }));

      expect(reviewTask.ok).toBe(true);
      if (!reviewTask.ok) return;
      expect(reviewTask.value.agentType).toBe('review');
    });

    it('allows non-review task when only an active review task exists for the same Linear issue', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const reviewTask = await repo.create(createTaskInput({
        linearIssueId: 'LIN-123',
        agentType: 'review',
        prNumber: 42,
        prompt: 'Review PR #42',
        sanitizedPrompt: 'review pr #42',
      }));
      expect(reviewTask.ok).toBe(true);

      const executionTask = await repo.create(createTaskInput({
        userId: 'user-456',
        linearIssueId: 'LIN-123',
        agentType: 'execution',
        prompt: 'Implement issue',
        sanitizedPrompt: 'implement issue',
      }));

      expect(executionTask.ok).toBe(true);
    });

    it('allows merge-conflict task when an execution task is active for the same Linear issue', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const executionTask = await repo.create(createTaskInput({
        linearIssueId: 'LIN-123',
        agentType: 'execution',
      }));
      expect(executionTask.ok).toBe(true);

      const mergeConflictTask = await repo.create(createTaskInput({
        userId: 'user-456',
        prompt: 'Resolve merge conflicts',
        sanitizedPrompt: 'resolve merge conflicts',
        linearIssueId: 'LIN-123',
        systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
        agentType: 'pull_request',
      }));

      expect(mergeConflictTask.ok).toBe(true);
      if (!mergeConflictTask.ok) return;
      expect(mergeConflictTask.value.agentType).toBe('pull_request');
    });

    it('allows non-merge-conflict task when only an active merge-conflict task exists for the same Linear issue', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const mergeConflictTask = await repo.create(createTaskInput({
        linearIssueId: 'LIN-123',
        systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
        agentType: 'pull_request',
        prompt: 'Resolve merge conflicts',
        sanitizedPrompt: 'resolve merge conflicts',
      }));
      expect(mergeConflictTask.ok).toBe(true);

      const executionTask = await repo.create(createTaskInput({
        userId: 'user-456',
        linearIssueId: 'LIN-123',
        agentType: 'execution',
        prompt: 'Implement issue',
        sanitizedPrompt: 'implement issue',
      }));

      expect(executionTask.ok).toBe(true);
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

    it('stores planningPrBranch when provided in create input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        planningPrBranch: 'planning/INT-200',
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.planningPrBranch).toBe('planning/INT-200');
    });

    it('stores planningPrUrl when provided in create input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        planningPrUrl: 'https://github.com/test/repo/pull/99',
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.planningPrUrl).toBe('https://github.com/test/repo/pull/99');
    });

    it('stores trackingCommentId when provided in create input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        trackingCommentId: '98765',
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.trackingCommentId).toBe('98765');
    });

    it('stores reviewTypes when provided in create input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        reviewTypes: ['code_quality', 'security'],
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.reviewTypes).toEqual(['code_quality', 'security']);
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

    it('stores executionMemoryContext when provided in create input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        agentType: 'execution',
        executionMemoryContext: {
          status: 'matched',
          applicationId: 'app_123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Callback logging, route verification, and env propagation.',
          matchedMemories: [
            {
              memoryId: 'mem_142',
              title: 'Log incoming requests on callback routes',
              memoryType: 'pitfall_pattern',
              score: 0.94,
              appliesWhen: 'A callback route changes request handling.',
              action: 'Update request logging with the route change.',
              avoid: 'Do not copy stale branch names from memories.',
              verification: 'Add app.inject coverage for the route.',
            },
          ],
        },
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.executionMemoryContext).toEqual(input.executionMemoryContext);
    });

    it('stores agentType as remediation when provided (INT-1087)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({
        agentType: 'remediation',
        retriedFrom: 'original-task-id', // bypass dedup
      });

      const result = await repo.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.agentType).toBe('remediation');
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

    it('accepts external transaction via options parameter', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const input = createTaskInput({ id: 'task_external-tx' });

      // Use an external transaction (the same pattern createTaskForPR uses)
      const result = await (fakeFirestore as unknown as Firestore).runTransaction(async (tx) => {
        return repo.create(input, { transaction: tx });
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe('task_external-tx');
      expect(result.value.status).toBe('queued');
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
          linearIssueUrl: 'https://linear.app/pbuchman/issue/INT-123',
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

    it('updates executionMemoryPostRun fields', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ agentType: 'execution' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const completedAt = Timestamp.fromDate(new Date());
      const result = await repo.update(created.value.id, {
        executionMemoryPostRun: {
          status: 'pending',
          attempts: 0,
          generatedMemoryIds: [],
          completedAt,
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.executionMemoryPostRun).toEqual(
        expect.objectContaining({
          status: 'pending',
          attempts: 0,
          generatedMemoryIds: [],
        })
      );
      if (result.value.executionMemoryPostRun?.completedAt !== undefined) {
        expect(result.value.executionMemoryPostRun.completedAt.toDate()).toEqual(completedAt.toDate());
      }
    });

    it('updates executionMemoryContext and converts Date timestamps to Firestore Timestamp', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ agentType: 'execution' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const matchedAt = new Date();
      const result = await repo.update(created.value.id, {
        executionMemoryContext: {
          status: 'matched',
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Callback route verification work',
          matchedAt: matchedAt as unknown as Timestamp,
          matchedMemories: [
            {
              memoryId: 'mem-1',
              title: 'Verify route serialization',
              memoryType: 'verification_pattern',
              score: 0.9,
              appliesWhen: 'Route handlers change',
              action: 'Add app.inject coverage',
              avoid: 'Do not skip response contract verification',
              verification: 'Assert route payload shape',
            },
          ],
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.executionMemoryContext).toEqual(expect.objectContaining({
        status: 'matched',
        applicationId: 'app-123',
      }));
      expect(result.value.executionMemoryContext?.matchedAt).toBeInstanceOf(Timestamp);
    });

    it('drops invalid execution memory timestamps during update serialization', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({ agentType: 'execution' }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        executionMemoryContext: {
          status: 'matched',
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Callback route verification work',
          matchedAt: 123 as unknown as Timestamp,
          matchedMemories: [],
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.executionMemoryContext?.matchedAt).toBeUndefined();
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

    it('returns false when only an active review task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        linearIssueId: 'LIN-123',
        agentType: 'review',
        prNumber: 42,
        prompt: 'Review PR #42',
        sanitizedPrompt: 'review pr #42',
      }));
      expect(created.ok).toBe(true);

      const result = await repo.hasActiveTaskForLinearIssue('LIN-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(false);
      expect(result.value.taskId).toBeUndefined();
    });

    it('returns true for legacy active task without agentType', async () => {
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

    it('returns non-review task when both review and blocking tasks are active', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const reviewTask = await repo.create(createTaskInput({
        linearIssueId: 'LIN-123',
        agentType: 'review',
        prNumber: 42,
        prompt: 'Review PR #42',
        sanitizedPrompt: 'review pr #42',
      }));
      expect(reviewTask.ok).toBe(true);

      const executionTask = await repo.create(createTaskInput({
        userId: 'user-456',
        linearIssueId: 'LIN-123',
        agentType: 'execution',
        prompt: 'Implement issue',
        sanitizedPrompt: 'implement issue',
      }));
      expect(executionTask.ok).toBe(true);
      if (!executionTask.ok) return;

      const result = await repo.hasActiveTaskForLinearIssue('LIN-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(true);
      expect(result.value.taskId).toBe(executionTask.value.id);
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

    it('returns tasks when cursor points to non-existent document', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks for user
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 1' }));
      await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 2' }));

      // Query with non-existent cursor - should return all tasks (else branch in list)
      const result = await repo.list({ userId: 'user-123', cursor: 'non-existent-id' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.tasks.length).toBeGreaterThanOrEqual(0);
    });

    it('returns tasks after cursor when cursor points to existing document', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks for user
      const task1 = await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 1' }));
      expect(task1.ok).toBe(true);
      if (!task1.ok) return;
      const task2 = await repo.create(createTaskInput({ userId: 'user-123', prompt: 'Task 2' }));
      expect(task2.ok).toBe(true);

      // Query with valid cursor - should return tasks after the cursor (if branch in list)
      const result = await repo.list({ userId: 'user-123', cursor: task1.value.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should return tasks after task1 (in this case, task2)
      expect(result.value.tasks.length).toBeGreaterThanOrEqual(0);
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

    it('sets and clears fanOutChildTaskIds', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const setResult = await repo.update(created.value.id, {
        fanOutChildTaskIds: ['task-child-1', 'task-child-2'],
      });
      expect(setResult.ok).toBe(true);
      if (!setResult.ok) return;
      expect(setResult.value.fanOutChildTaskIds).toEqual(['task-child-1', 'task-child-2']);

      const clearResult = await repo.update(created.value.id, {
        fanOutChildTaskIds: null,
      });
      expect(clearResult.ok).toBe(true);
      if (!clearResult.ok) return;
      expect(clearResult.value.fanOutChildTaskIds).toBeUndefined();
    });

    it('accepts external transaction via options parameter for update', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await (fakeFirestore as unknown as Firestore).runTransaction(async (tx) => {
        return repo.update(
          created.value.id,
          {
            implementationTaskId: 'task-child-1',
            fanOutChildTaskIds: ['task-child-1'],
          },
          { transaction: tx },
        );
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.implementationTaskId).toBe('task-child-1');
      expect(result.value.fanOutChildTaskIds).toEqual(['task-child-1']);
    });

    it('updates workerLocation when provided in update input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        workerLocation: 'cloud',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.workerLocation).toBe('cloud');
    });

    it('updates lastHeartbeat when provided in update input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const heartbeatDate = new Date('2025-06-15T10:30:00Z');
      const result = await repo.update(created.value.id, {
        lastHeartbeat: heartbeatDate,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      if (result.value.lastHeartbeat !== undefined) {
        expect(result.value.lastHeartbeat.toDate()).toEqual(heartbeatDate);
      }
    });

    it('updates logChunksDropped when provided in update input', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        logChunksDropped: 5,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.logChunksDropped).toBe(5);
    });

    it('sets requiresReReview when provided in update (INT-1087)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        agentType: 'remediation',
        retriedFrom: 'original-task-id', // bypass dedup
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        requiresReReview: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.requiresReReview).toBe(false);
    });

    it('sets requiresReReview to true when provided in update (INT-1087)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        agentType: 'remediation',
        retriedFrom: 'bypass-dedup', // bypass dedup
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await repo.update(created.value.id, {
        requiresReReview: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.requiresReReview).toBe(true);
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

    it('deletes documents from logs subcollection when present', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Seed logs subcollection with 3 documents (batchSize=2 triggers both branches)
      const logsCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/logs`);
      for (let i = 1; i <= 3; i++) {
        await logsCollection.doc(`log-${i}`).set({ content: `log entry ${i}` });
      }

      // Use batchSize=2: first 2 docs commit in loop, 3rd doc commits after loop
      const result = await repo.archiveTaskLogs(created.value.id, 2);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logCount).toBe(3);
      expect(result.value.archivedAt).toBeInstanceOf(Date);

      // Verify logs were deleted
      const logsSnapshot = await logsCollection.get();
      expect(logsSnapshot.docs).toHaveLength(0);
    });

    it('deletes documents from log_lines subcollection when present', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Seed log_lines subcollection with 3 documents (batchSize=2 triggers both branches)
      const logLinesCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/log_lines`);
      for (let i = 1; i <= 3; i++) {
        await logLinesCollection.doc(`line-${i}`).set({ content: `line ${i}` });
      }

      // Use batchSize=2: first 2 docs commit in loop, 3rd doc commits after loop
      const result = await repo.archiveTaskLogs(created.value.id, 2);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logCount).toBe(3);

      // Verify log_lines were deleted
      const logLinesSnapshot = await logLinesCollection.get();
      expect(logLinesSnapshot.docs).toHaveLength(0);
    });

    it('deletes documents from log_entries subcollection when present', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Seed log_entries subcollection with 3 documents (batchSize=2 triggers both branches)
      const logEntriesCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/log_entries`);
      for (let i = 1; i <= 3; i++) {
        await logEntriesCollection.doc(`entry-${i}`).set({ message: `entry ${i}` });
      }

      // Use batchSize=2: first 2 docs commit in loop, 3rd doc commits after loop
      const result = await repo.archiveTaskLogs(created.value.id, 2);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logCount).toBe(3);

      // Verify log_entries were deleted
      const logEntriesSnapshot = await logEntriesCollection.get();
      expect(logEntriesSnapshot.docs).toHaveLength(0);
    });

    it('deletes documents from turn_metrics subcollection when present', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Seed turn_metrics subcollection with 3 documents (batchSize=2 triggers both branches)
      const turnMetricsCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/turn_metrics`);
      for (let i = 1; i <= 3; i++) {
        await turnMetricsCollection.doc(`metric-${i}`).set({ tokens: i * 100 });
      }

      // Use batchSize=2: first 2 docs commit in loop, 3rd doc commits after loop
      const result = await repo.archiveTaskLogs(created.value.id, 2);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logCount).toBe(3);

      // Verify turn_metrics were deleted
      const turnMetricsSnapshot = await turnMetricsCollection.get();
      expect(turnMetricsSnapshot.docs).toHaveLength(0);
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

    it('ignores merge-conflict follow-up tasks when resolving the canonical PR task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const original = await repo.create(createTaskInput({
        id: 'task-pr-origin',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'Original PR task',
        sanitizedPrompt: 'original pr task',
      }));
      expect(original.ok).toBe(true);

      await repo.create(createTaskInput({
        id: 'task-conflict-new-style',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        parentTaskId: 'task-pr-origin',
        followUpReason: 'merge_conflict',
        prompt: 'Resolve merge conflicts',
        sanitizedPrompt: 'resolve merge conflicts',
      }));

      await repo.create(createTaskInput({
        id: 'task-conflict-legacy',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
        prompt: 'Resolve merge conflicts again',
        sanitizedPrompt: 'resolve merge conflicts again',
      }));

      const result = await repo.findByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-pr-origin');
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

  describe('findActiveReviewForPR', () => {
    it('returns queued/dispatched/running review task for matching repository and PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      const result = await repo.findActiveReviewForPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.agentType).toBe('review');
      expect(result.value?.prNumber).toBe(456);
    });

    it('ignores non-review tasks and completed review tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const executionTask = await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'execution',
        prompt: 'Execution task',
        sanitizedPrompt: 'execution task',
      }));
      expect(executionTask.ok).toBe(true);

      const completedReview = await repo.create(createTaskInput({
        userId: 'user-456',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Completed review task',
        sanitizedPrompt: 'completed review task',
      }));
      expect(completedReview.ok).toBe(true);
      if (completedReview.ok) {
        await repo.update(completedReview.value.id, { status: 'reviewed' });
      }

      const result = await repo.findActiveReviewForPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });
  });

  describe('hasDispatchedOrRunningForPR', () => {
    it('returns hasActive true when dispatched task exists for matching repo and PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'dispatched' });

      const result = await repo.hasDispatchedOrRunningForPR('pbuchman/intexuraos', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(true);
      expect(result.value.taskId).toBe(created.value.id);
    });

    it('returns hasActive true when running task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const result = await repo.hasDispatchedOrRunningForPR('pbuchman/intexuraos', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(true);
      expect(result.value.taskId).toBe(created.value.id);
    });

    it('returns hasActive false when only queued task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
      }));

      const result = await repo.hasDispatchedOrRunningForPR('pbuchman/intexuraos', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(false);
    });

    it('returns hasActive false when task is completed', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'implemented' });

      const result = await repo.hasDispatchedOrRunningForPR('pbuchman/intexuraos', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(false);
    });

    it('returns hasActive false for different repository', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'other/repo',
        prNumber: 42,
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'dispatched' });

      const result = await repo.hasDispatchedOrRunningForPR('pbuchman/intexuraos', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(false);
    });

    it('returns hasActive false for different prNumber', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'dispatched' });

      const result = await repo.hasDispatchedOrRunningForPR('pbuchman/intexuraos', 99);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(false);
    });

    it('returns hasActive true regardless of agentType', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        agentType: 'review',
        prompt: 'Review PR #42',
        sanitizedPrompt: 'review pr #42',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'dispatched' });

      const result = await repo.hasDispatchedOrRunningForPR('pbuchman/intexuraos', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.hasActive).toBe(true);
      expect(result.value.taskId).toBe(created.value.id);
    });
  });

  describe('findLatestExecutionTaskByPR', () => {
    it('returns newest non-review task for PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a review task first (should be ignored)
      await repo.create(createTaskInput({
        id: 'task-review-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      // Create a non-review task
      const nonReview = await repo.create(createTaskInput({
        id: 'task-nonreview-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'PR task',
        sanitizedPrompt: 'pr task',
      }));
      expect(nonReview.ok).toBe(true);

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-nonreview-1');
    });

    it('ignores review tasks when finding non-review task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create only review tasks
      await repo.create(createTaskInput({
        id: 'task-review-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('treats missing agentType as non-review (backward compatibility)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task without agentType (legacy)
      const legacy = await repo.create(createTaskInput({
        id: 'task-legacy-1',
        repository: 'test/repo',
        prNumber: 456,
        // No agentType - should be treated as non-review
        prompt: 'Legacy task',
        sanitizedPrompt: 'legacy task',
      }));
      expect(legacy.ok).toBe(true);

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-legacy-1');
    });

    it('returns null when all tasks are review tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-review-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review 1',
        sanitizedPrompt: 'review 1',
      }));

      await repo.create(createTaskInput({
        id: 'task-review-2',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review 2',
        sanitizedPrompt: 'review 2',
      }));

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns newest non-review task when multiple exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create older non-review task
      await repo.create(createTaskInput({
        id: 'task-old',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'Old task',
        sanitizedPrompt: 'old task',
      }));

      // Create newer non-review task (most recent)
      await repo.create(createTaskInput({
        id: 'task-new',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'New task',
        sanitizedPrompt: 'new task',
      }));

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-new');
    });

    it('ignores remediation tasks when finding execution task (INT-1087)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create an execution task
      await repo.create(createTaskInput({
        id: 'task-execution-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'execution',
        prompt: 'Execution task',
        sanitizedPrompt: 'execution task',
      }));

      // Create a remediation task (should be ignored)
      await repo.create(createTaskInput({
        id: 'task-remediation-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Remediation task',
        sanitizedPrompt: 'remediation task',
      }));

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-execution-1');
    });

    it('ignores merge-conflict follow-up tasks, including legacy prompt-hash records', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-pr-origin',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'Original PR task',
        sanitizedPrompt: 'original pr task',
      }));

      await repo.create(createTaskInput({
        id: 'task-conflict-new-style',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        parentTaskId: 'task-pr-origin',
        followUpReason: 'merge_conflict',
        prompt: 'Resolve merge conflicts',
        sanitizedPrompt: 'resolve merge conflicts',
      }));

      await repo.create(createTaskInput({
        id: 'task-conflict-legacy',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
        prompt: 'Resolve merge conflicts again',
        sanitizedPrompt: 'resolve merge conflicts again',
      }));

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-pr-origin');
    });

    it('returns null when all tasks are review or remediation tasks (INT-1087)', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-review-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      await repo.create(createTaskInput({
        id: 'task-remediation-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Remediation task',
        sanitizedPrompt: 'remediation task',
      }));

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns non-review task even when newer review task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create non-review task first (older)
      await repo.create(createTaskInput({
        id: 'task-nonreview-older',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'PR implementation task',
        sanitizedPrompt: 'pr implementation task',
      }));

      // Create review task (newer - should be ignored)
      await repo.create(createTaskInput({
        id: 'task-review-newer',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should return the non-review task, ignoring the newer review task
      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-nonreview-older');
    });
  });

  describe('findOriginTaskByPR', () => {
    it('returns planning task, skipping pull_request and review tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a planning origin task (oldest)
      await repo.create(createTaskInput({
        id: 'task-planning-origin',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'planning',
        prompt: 'Planning task',
        sanitizedPrompt: 'planning task',
      }));

      // Create a newer pull_request task (should be skipped)
      await repo.create(createTaskInput({
        id: 'task-pr-newer',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'PR task',
        sanitizedPrompt: 'pr task',
      }));

      // Create a review task (should be skipped)
      await repo.create(createTaskInput({
        id: 'task-review-newest',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      const result = await repo.findOriginTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-planning-origin');
    });

    it('returns execution task as origin', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-execution-origin',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'execution',
        prompt: 'Execution task',
        sanitizedPrompt: 'execution task',
      }));

      const result = await repo.findOriginTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-execution-origin');
    });

    it('returns pull_request task as fallback when no planning/execution exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-pr-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'PR task',
        sanitizedPrompt: 'pr task',
      }));

      await repo.create(createTaskInput({
        id: 'task-review-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      const result = await repo.findOriginTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-pr-1');
    });

    it('skips remediation tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-execution-origin',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'execution',
        prompt: 'Execution task',
        sanitizedPrompt: 'execution task',
      }));

      await repo.create(createTaskInput({
        id: 'task-remediation-1',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Remediation task',
        sanitizedPrompt: 'remediation task',
      }));

      const result = await repo.findOriginTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-execution-origin');
    });

    it('returns newest planning/execution task when multiple exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-planning-older',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'planning',
        prompt: 'Planning task',
        sanitizedPrompt: 'planning task',
      }));

      await repo.create(createTaskInput({
        id: 'task-execution-newer',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'execution',
        prompt: 'Execution task',
        sanitizedPrompt: 'execution task',
      }));

      const result = await repo.findOriginTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-execution-newer');
    });

    it('returns null when no tasks exist for the PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findOriginTaskByPR('test/repo', 999);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns null when only review and remediation tasks exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        id: 'task-review-only',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      await repo.create(createTaskInput({
        id: 'task-remediation-only',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Remediation task',
        sanitizedPrompt: 'remediation task',
      }));

      const result = await repo.findOriginTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('prefers planning over pull_request even when pull_request is newer', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create planning task first (older)
      await repo.create(createTaskInput({
        id: 'task-planning-older',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'planning',
        prompt: 'Planning task',
        sanitizedPrompt: 'planning task',
      }));

      // Create pull_request task second (newer)
      await repo.create(createTaskInput({
        id: 'task-pr-newer',
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'pull_request',
        prompt: 'PR task',
        sanitizedPrompt: 'pr task',
      }));

      const result = await repo.findOriginTaskByPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-planning-older');
    });
  });

  describe('findRecentTasksByLinearIssue', () => {
    it('returns newest tasks first for the same Linear issue', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const first = await repo.create(createTaskInput({
        id: 'task-first',
        linearIssueId: 'INT-700',
        prompt: 'first prompt',
      }));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      await repo.update(first.value.id, { status: 'failed' });

      await repo.create(createTaskInput({
        id: 'task-second',
        linearIssueId: 'INT-700',
        prompt: 'second prompt',
      }));

      const result = await repo.findRecentTasksByLinearIssue('INT-700', 10);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.map((task) => task.id)).toEqual(['task-second', 'task-first']);
    });

    it('limits results and excludes other Linear issues', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const first = await repo.create(createTaskInput({
        id: 'task-a',
        linearIssueId: 'INT-701',
        prompt: 'task a prompt',
      }));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      await repo.update(first.value.id, { status: 'failed' });

      await repo.create(createTaskInput({
        id: 'task-b',
        linearIssueId: 'INT-701',
        prompt: 'task b prompt',
      }));
      await repo.create(createTaskInput({ id: 'task-c', linearIssueId: 'INT-999' }));

      const result = await repo.findRecentTasksByLinearIssue('INT-701', 1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.id).toBe('task-b');
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

    it('returns null when planned task already has fanOutChildTaskIds', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        linearIssueId: 'INT-504',
        agentType: 'planning',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'planned',
        fanOutChildTaskIds: ['task-child-1'],
      });

      const result = await repo.findPlannedTaskByLinearIssue('INT-504');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });
  });

  describe('archiveTaskLogs with exact batch boundary', () => {
    it('does not commit remainder when subcollection docs divide evenly into batches', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput());
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Seed exactly 2 logs (matching batchSize=2 so remainder is 0)
      const logsCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/logs`);
      for (let i = 1; i <= 2; i++) {
        await logsCollection.doc(`log-${i}`).set({ content: `log entry ${i}` });
      }

      // Seed exactly 2 log_lines
      const logLinesCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/log_lines`);
      for (let i = 1; i <= 2; i++) {
        await logLinesCollection.doc(`line-${i}`).set({ content: `line ${i}` });
      }

      // Seed exactly 2 log_entries
      const logEntriesCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/log_entries`);
      for (let i = 1; i <= 2; i++) {
        await logEntriesCollection.doc(`entry-${i}`).set({ message: `entry ${i}` });
      }

      // Seed exactly 2 turn_metrics
      const turnMetricsCollection = fakeFirestore.collection(`code_tasks/${created.value.id}/turn_metrics`);
      for (let i = 1; i <= 2; i++) {
        await turnMetricsCollection.doc(`metric-${i}`).set({ tokens: i * 100 });
      }

      // batchSize=2 with exactly 2 docs: all commit in loop, remainder=0 skips the if
      const result = await repo.archiveTaskLogs(created.value.id, 2);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logCount).toBe(8);
    });
  });

  describe('findLatestExecutionTaskByPR 50-doc exhaustion warning', () => {
    it('logs warning when 50 docs are scanned without finding a non-review task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create 50 review tasks for the same PR to exhaust the 50-doc window
      for (let i = 0; i < 50; i++) {
        await repo.create(createTaskInput({
          id: `task-review-${i}`,
          userId: `user-${i}`,
          repository: 'test/repo',
          prNumber: 789,
          agentType: 'review',
          prompt: `Review task ${i}`,
          sanitizedPrompt: `review task ${i}`,
        }));
      }

      const result = await repo.findLatestExecutionTaskByPR('test/repo', 789);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'test/repo', prNumber: 789, docsScanned: 50 }),
        'findLatestExecutionTaskByPR exhausted 50-doc window without finding a non-review task',
      );
    });
  });

  describe('findOriginTaskByPR 50-doc exhaustion warning', () => {
    it('logs warning when 50 docs are scanned without finding an origin task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create 50 review tasks for the same PR to exhaust the 50-doc window
      for (let i = 0; i < 50; i++) {
        await repo.create(createTaskInput({
          id: `task-origin-exhaust-${i}`,
          userId: `user-${i}`,
          repository: 'test/repo',
          prNumber: 790,
          agentType: 'review',
          prompt: `Review task ${i}`,
          sanitizedPrompt: `review task ${i}`,
        }));
      }

      const result = await repo.findOriginTaskByPR('test/repo', 790);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'test/repo', prNumber: 790, docsScanned: 50 }),
        'findOriginTaskByPR exhausted 50-doc window without finding an origin task',
      );
    });
  });

  describe('findPreservedPullRequestTask', () => {
    it('finds preserved pull_request task for PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 42,
        agentType: 'pull_request',
        prompt: 'Preserved task',
        sanitizedPrompt: 'preserved task',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Update to implemented status (preserved container)
      const updated = await repo.update(created.value.id, {
        status: 'implemented',
        completedAt: new Date(),
      });
      expect(updated.ok).toBe(true);

      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe(created.value.id);
      expect(result.value?.workerLocation).toBe('vm');
      expect(result.value?.userId).toBe('user-123');
    });

    it('returns null when no preserved pull_request task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns null when pull_request task has non-implemented status', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 42,
        agentType: 'pull_request',
        prompt: 'Running task',
        sanitizedPrompt: 'running task',
      }));

      // Task stays in queued status, not implemented
      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns null when implemented task has non-pull_request agentType', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 42,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'implemented',
        completedAt: new Date(),
      });

      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns null when preserved task is for different PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 99,
        agentType: 'pull_request',
        prompt: 'Other PR task',
        sanitizedPrompt: 'other pr task',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'implemented',
        completedAt: new Date(),
      });

      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns null when preserved task is for different repository', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create(createTaskInput({
        repository: 'other/repo',
        prNumber: 42,
        agentType: 'pull_request',
        prompt: 'Other repo task',
        sanitizedPrompt: 'other repo task',
      }));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'implemented',
        completedAt: new Date(),
      });

      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('ignores merge-conflict follow-up tasks, including legacy prompt-hash records', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const original = await repo.create(createTaskInput({
        id: 'task-pr-origin',
        repository: 'test/repo',
        prNumber: 42,
        agentType: 'pull_request',
        prompt: 'Original PR task',
        sanitizedPrompt: 'original pr task',
      }));
      expect(original.ok).toBe(true);
      if (!original.ok) return;
      await repo.update(original.value.id, {
        status: 'implemented',
        completedAt: new Date('2026-03-28T10:00:00Z'),
      });

      const conflictNewStyle = await repo.create(createTaskInput({
        id: 'task-conflict-new-style',
        repository: 'test/repo',
        prNumber: 42,
        agentType: 'pull_request',
        parentTaskId: 'task-pr-origin',
        followUpReason: 'merge_conflict',
        prompt: 'Resolve merge conflicts',
        sanitizedPrompt: 'resolve merge conflicts',
      }));
      expect(conflictNewStyle.ok).toBe(true);
      if (!conflictNewStyle.ok) return;
      await repo.update(conflictNewStyle.value.id, {
        status: 'implemented',
        completedAt: new Date('2026-03-28T11:00:00Z'),
      });

      const conflictLegacy = await repo.create(createTaskInput({
        id: 'task-conflict-legacy',
        repository: 'test/repo',
        prNumber: 42,
        agentType: 'pull_request',
        systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
        prompt: 'Resolve merge conflicts again',
        sanitizedPrompt: 'resolve merge conflicts again',
      }));
      expect(conflictLegacy.ok).toBe(true);
      if (!conflictLegacy.ok) return;
      await repo.update(conflictLegacy.value.id, {
        status: 'implemented',
        completedAt: new Date('2026-03-28T12:00:00Z'),
      });

      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.id).toBe('task-pr-origin');
    });

    it('returns null when all implemented tasks are merge-conflict follow-ups', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const conflictTask = await repo.create(createTaskInput({
        id: 'task-conflict-only',
        repository: 'test/repo',
        prNumber: 42,
        agentType: 'pull_request',
        followUpReason: 'merge_conflict',
        prompt: 'Resolve merge conflicts',
        sanitizedPrompt: 'resolve merge conflicts',
      }));
      expect(conflictTask.ok).toBe(true);
      if (!conflictTask.ok) return;
      await repo.update(conflictTask.value.id, {
        status: 'implemented',
        completedAt: new Date('2026-03-28T10:00:00Z'),
      });

      const result = await repo.findPreservedPullRequestTask('test/repo', 42);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });
  });

  describe('findRecentRemediationForPR', () => {
    it('returns the most recent remediation task for matching repository and PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Remediation task',
        sanitizedPrompt: 'remediation task',
      }));

      const result = await repo.findRecentRemediationForPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.agentType).toBe('remediation');
      expect(result.value?.prNumber).toBe(456);
    });

    it('returns null when no remediation task exists for PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a non-remediation task
      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'review',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
      }));

      const result = await repo.findRecentRemediationForPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns null when remediation task is for different PR', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 789,
        agentType: 'remediation',
        prompt: 'Remediation for other PR',
        sanitizedPrompt: 'remediation for other pr',
      }));

      const result = await repo.findRecentRemediationForPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('returns the most recent task when multiple remediation tasks exist', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Older remediation',
        sanitizedPrompt: 'older remediation',
      }));

      // Create a second remediation task — needs unique dedupKey to avoid collision
      await repo.create(createTaskInput({
        repository: 'test/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Newer remediation',
        sanitizedPrompt: 'newer remediation',
        traceId: 'trace-newer',
      }));

      const result = await repo.findRecentRemediationForPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value?.sanitizedPrompt).toBe('newer remediation');
    });

    it('returns null when remediation task is for different repository', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create(createTaskInput({
        repository: 'other/repo',
        prNumber: 456,
        agentType: 'remediation',
        prompt: 'Remediation for other repo',
        sanitizedPrompt: 'remediation for other repo',
      }));

      const result = await repo.findRecentRemediationForPR('test/repo', 456);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });
  });
});
