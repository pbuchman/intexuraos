/**
 * Tests for fanOutChildTasks use case.
 *
 * INT-962: Auto fan-out for parent issues with code-task children.
 *
 * Test Requirements:
 * 1. Happy path: 2 children with code-task → 2 tasks created, parent marked implemented
 * 2. Children without code-task label → returns no_qualifying_children error
 * 3. fetchIssueTree fails → returns linear_unavailable error
 * 4. validateIssue fails → returns linear_unavailable error
 * 5. shouldFanOut utility: true when hasChildren=true and labels include code-task
 * 6. shouldFanOut utility: false when hasChildren=false
 * 7. shouldFanOut utility: false when labels don't include code-task
 * 8. All child task creations fail → returns internal_error
 * 9. Some child task creations fail → still succeeds with partial results
 * 10. Enqueue failure → task still created (best-effort)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import {
  fanOutChildTasks,
  shouldFanOut,
  type FanOutChildTasksDeps,
} from '../../../domain/usecases/fanOutChildTasks.js';
import type { IssueTreeNode } from '../../../domain/ports/linearAgentClient.js';

describe('fanOutChildTasks', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockLinearAgentClient: {
    validateIssue: ReturnType<typeof vi.fn>;
    fetchIssueTree: ReturnType<typeof vi.fn>;
  };
  let mockTaskEnqueueService: {
    enqueue: ReturnType<typeof vi.fn>;
  };

  const parentUuid = 'parent-uuid-123';
  const childNode1: IssueTreeNode = {
    id: 'child-uuid-1',
    identifier: 'INT-957',
    url: 'https://linear.app/pbuchman/issue/INT-957',
    parentId: parentUuid,
    labels: ['code-task'],
    assigneeId: null,
    state: 'Backlog',
  };
  const childNode2: IssueTreeNode = {
    id: 'child-uuid-2',
    identifier: 'INT-958',
    url: 'https://linear.app/pbuchman/issue/INT-958',
    parentId: parentUuid,
    labels: ['code-task', 'bug'],
    assigneeId: null,
    state: 'Backlog',
  };
  const nonCodeTaskChild: IssueTreeNode = {
    id: 'child-uuid-3',
    identifier: 'INT-959',
    url: 'https://linear.app/pbuchman/issue/INT-959',
    parentId: parentUuid,
    labels: ['feature'],
    assigneeId: null,
    state: 'Backlog',
  };
  const grandchild: IssueTreeNode = {
    id: 'grandchild-uuid-1',
    identifier: 'INT-960',
    url: 'https://linear.app/pbuchman/issue/INT-960',
    parentId: 'child-uuid-1', // not direct child of parent
    labels: ['code-task'],
    assigneeId: null,
    state: 'Backlog',
  };

  function createParentTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    return {
      id: 'task-parent-123',
      userId: 'user-456',
      traceId: 'trace-parent-789',
      prompt: 'Implement all sub-tasks',
      sanitizedPrompt: 'Implement all sub-tasks',
      systemPromptHash: 'hash-abc',
      workerType: 'auto',
      workerLocation: 'home-mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      status: 'queued',
      dedupKey: 'dedup-parent',
      callbackReceived: false,
      createdAt: now,
      updatedAt: now,
      linearIssueId: 'INT-956',
      agentType: 'execution',
      ...overrides,
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
      create: vi.fn(),
      update: vi.fn(),
    };

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      fetchIssueTree: vi.fn(),
    };

    mockTaskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 0 })),
    };
  });

  function createDeps(): FanOutChildTasksDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as FanOutChildTasksDeps['codeTaskRepo'],
      linearAgentClient: mockLinearAgentClient as unknown as FanOutChildTasksDeps['linearAgentClient'],
      taskEnqueueService: mockTaskEnqueueService as unknown as FanOutChildTasksDeps['taskEnqueueService'],
      orchestratorSecret: 'test-orchestrator-secret',
    };
  }

  describe('shouldFanOut', () => {
    it('returns true when hasChildren=true and labels include code-task', () => {
      expect(shouldFanOut(true, ['code-task', 'bug'])).toBe(true);
    });

    it('returns true with case-insensitive code-task label', () => {
      expect(shouldFanOut(true, ['CODE-TASK'])).toBe(true);
    });

    it('returns false when hasChildren=false', () => {
      expect(shouldFanOut(false, ['code-task'])).toBe(false);
    });

    it('returns false when labels do not include code-task', () => {
      expect(shouldFanOut(true, ['bug', 'feature'])).toBe(false);
    });

    it('returns false when both hasChildren=false and no code-task label', () => {
      expect(shouldFanOut(false, ['feature'])).toBe(false);
    });
  });

  describe('fanOutChildTasks', () => {
    it('creates child tasks for qualifying children and marks parent as implemented', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: 'https://linear.app', labels: ['code-task'], childCount: 2, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [childNode1, childNode2] }),
      );
      mockCodeTaskRepo.create.mockResolvedValue(ok(createParentTask({ id: 'child-task-1' })));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createParentTask({ status: 'implemented' })));

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.childTaskIds).toHaveLength(2);
        expect(result.value.parentTaskId).toBe('task-parent-123');
      }

      // Verify 2 child tasks were created
      expect(mockCodeTaskRepo.create).toHaveBeenCalledTimes(2);

      // Verify first child task creation args
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-456',
          sanitizedPrompt: 'INT-957',
          linearIssueId: 'INT-957',
          agentType: 'execution',
          initialStatus: 'queued',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          workerType: 'auto',
        }),
      );

      // Verify second child task creation args
      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sanitizedPrompt: 'INT-958',
          linearIssueId: 'INT-958',
        }),
      );

      // Verify both tasks were enqueued
      expect(mockTaskEnqueueService.enqueue).toHaveBeenCalledTimes(2);

      // Verify parent was marked as implemented
      expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-parent-123', expect.objectContaining({
        status: 'implemented',
        completedAt: expect.any(Date),
        result: expect.objectContaining({
          execution_outcome_label: 'implemented',
        }),
      }));
    });

    it('returns no_qualifying_children when children exist but none have code-task label', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 1, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [nonCodeTaskChild] }),
      );

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('no_qualifying_children');
      }
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });

    it('only fans out direct children, not grandchildren', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 2, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({
          root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' },
          descendants: [childNode1, grandchild],
        }),
      );
      mockCodeTaskRepo.create.mockResolvedValue(ok(createParentTask({ id: 'child-task-1' })));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createParentTask({ status: 'implemented' })));

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only childNode1 is a direct child; grandchild's parentId is child-uuid-1
        expect(result.value.childTaskIds).toHaveLength(1);
      }
      expect(mockCodeTaskRepo.create).toHaveBeenCalledTimes(1);
    });

    it('returns linear_unavailable when validateIssue fails', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Linear API is down' }),
      );

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('linear_unavailable');
      }
    });

    it('returns linear_unavailable when fetchIssueTree fails', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 2, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        err({ code: 'UNAVAILABLE', message: 'Tree fetch failed' }),
      );

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('linear_unavailable');
      }
    });

    it('returns internal_error when all child task creations fail', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 2, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [childNode1, childNode2] }),
      );
      mockCodeTaskRepo.create.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }),
      );

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('All child task creations failed');
      }
    });

    it('succeeds with partial results when some child task creations fail', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 2, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [childNode1, childNode2] }),
      );
      // First create succeeds, second fails
      mockCodeTaskRepo.create
        .mockResolvedValueOnce(ok(createParentTask({ id: 'child-task-1' })))
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Write failed' }));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createParentTask({ status: 'implemented' })));

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.childTaskIds).toHaveLength(1);
      }
    });

    it('still succeeds when enqueue fails (best-effort enqueue)', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 1, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [childNode1] }),
      );
      mockCodeTaskRepo.create.mockResolvedValue(ok(createParentTask({ id: 'child-task-1' })));
      mockTaskEnqueueService.enqueue.mockResolvedValue(err({ code: 'queue_full', message: 'Queue is full' }));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createParentTask({ status: 'implemented' })));

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.childTaskIds).toHaveLength(1);
      }
      // Verify warning was logged for enqueue failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ childTaskId: expect.any(String) }),
        'Fan-out: failed to enqueue child task (task remains queued)',
      );
    });

    it('still succeeds when parent update fails (best-effort parent update)', async () => {
      const parentTask = createParentTask();
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 1, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [childNode1] }),
      );
      mockCodeTaskRepo.create.mockResolvedValue(ok(createParentTask({ id: 'child-task-1' })));
      mockCodeTaskRepo.update.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Update failed' }));

      const result = await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.childTaskIds).toHaveLength(1);
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ parentTaskId: 'task-parent-123' }),
        'Fan-out: failed to mark parent task as implemented',
      );
    });

    it('uses "parent" fallback in prompt when parentTask has no linearIssueId', async () => {
      // Remove linearIssueId from parent — exercises parentTask.linearIssueId ?? 'parent'
      const parentTask = createParentTask();
      const parentRecord = parentTask as unknown as Record<string, unknown>;
      delete parentRecord['linearIssueId'];

      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 1, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [childNode1] }),
      );
      mockCodeTaskRepo.create.mockResolvedValue(ok(createParentTask({ id: 'child-task-1' })));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createParentTask({ status: 'implemented' })));

      await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('[Fan-out from parent]'),
        }),
      );
    });

    it('passes parent workerType, repository, and baseBranch to child tasks', async () => {
      const parentTask = createParentTask({
        prompt: 'Custom parent prompt',
        workerType: 'opus',
        repository: 'custom/repo',
        baseBranch: 'main',
      });
      mockLinearAgentClient.validateIssue.mockResolvedValue(
        ok({ id: parentUuid, identifier: 'INT-956', title: 'Parent', url: '', labels: ['code-task'], childCount: 1, parentId: null }),
      );
      mockLinearAgentClient.fetchIssueTree.mockResolvedValue(
        ok({ root: { id: parentUuid, identifier: 'INT-956', url: '', parentId: null, labels: ['code-task'], assigneeId: null, state: 'Backlog' }, descendants: [childNode1] }),
      );
      mockCodeTaskRepo.create.mockResolvedValue(ok(createParentTask({ id: 'child-task-1' })));
      mockCodeTaskRepo.update.mockResolvedValue(ok(createParentTask({ status: 'implemented' })));

      await fanOutChildTasks(createDeps(), {
        parentTask,
        userId: 'user-456',
        linearIssueId: 'INT-956',
      });

      expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('INT-957'),
          webhookSecret: expect.any(String),
          workerType: 'opus',
          repository: 'custom/repo',
          baseBranch: 'main',
        }),
      );
    });
  });
});
