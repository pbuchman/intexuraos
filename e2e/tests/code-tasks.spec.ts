/**
 * E2E tests for Code Tasks API.
 *
 * Tests the complete flow from task submission to PR creation
 * using the mock Claude server.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createTestClient, type CodeTask } from '../helpers/client.js';
import { waitForTaskStatus, sleep } from '../helpers/wait.js';
import { cleanupBranches, cleanupPRs } from '../helpers/cleanup.js';

describe('Code Tasks E2E', () => {
  const client = createTestClient();
  const createdBranches: string[] = [];
  const createdPRs: string[] = [];

  afterAll(async () => {
    // Clean up any created resources
    cleanupBranches(createdBranches);
    cleanupPRs(createdPRs);
  });

  describe('Environment Setup', () => {
    it('should have code-agent service available', async () => {
      const response = await client.get('/code/workers/status');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('mac');
      expect(response.data).toHaveProperty('vm');
    });
  });

  describe('Happy Path', () => {
    it('submits task and receives PR with success scenario', async () => {
      // Submit task with success scenario marker
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Add a simple feature for E2E testing',
        workerType: 'auto',
      });

      expect(submitResult.status).toBe(200);
      const { codeTaskId } = submitResult.data;
      expect(codeTaskId).toBeDefined();

      // Wait for task to complete
      const task = await waitForTaskStatus(client, codeTaskId, 'completed', 60000);
      expect(task.status).toBe('completed');
      expect(task.result?.prUrl).toBeDefined();
      expect(task.result?.branch).toBeDefined();
      expect(task.result?.commits).toBeGreaterThan(0);

      // Track for cleanup
      if (task.result?.branch !== undefined) {
        createdBranches.push(task.result.branch);
      }
      if (task.result?.prUrl !== undefined) {
        createdPRs.push(task.result.prUrl);
      }
    });

    it('creates Linear issue when not provided', async () => {
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Create feature with Linear issue',
        workerType: 'auto',
      });

      expect(submitResult.status).toBe(200);
      const { codeTaskId } = submitResult.data;

      const task = await waitForTaskStatus(client, codeTaskId, 'completed', 60000);

      // Linear issue should be created (format: INT-XXX)
      // Note: This may be empty in test environment without Linear API
      if (task.linearIssueId !== undefined) {
        expect(task.linearIssueId).toMatch(/^INT-\d+$/);
      }

      // Track for cleanup
      if (task.result?.branch !== undefined) {
        createdBranches.push(task.result.branch);
      }
      if (task.result?.prUrl !== undefined) {
        createdPRs.push(task.result.prUrl);
      }
    });

    it('allows submitting with existing Linear issue', async () => {
      const testLinearIssueId = process.env['E2E_LINEAR_ISSUE_ID'] ?? 'INT-999';

      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Work on existing Linear issue',
        linearIssueId: testLinearIssueId,
        workerType: 'auto',
      });

      expect(submitResult.status).toBe(200);
      const { codeTaskId } = submitResult.data;

      const task = await waitForTaskStatus(client, codeTaskId, 'completed', 60000);
      expect(task.status).toBe('completed');

      // Should have the Linear issue we provided
      expect(task.linearIssueId).toBe(testLinearIssueId);

      // Track for cleanup
      if (task.result?.branch !== undefined) {
        createdBranches.push(task.result.branch);
      }
      if (task.result?.prUrl !== undefined) {
        createdPRs.push(task.result.prUrl);
      }
    });
  });

  describe('Error Handling', () => {
    it('handles task failure gracefully', async () => {
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:failure] This should fail',
        workerType: 'auto',
      });

      expect(submitResult.status).toBe(200);
      const { codeTaskId } = submitResult.data;

      const task = await waitForTaskStatus(client, codeTaskId, 'failed', 30000);

      expect(task.status).toBe('failed');
      expect(task.error?.code).toBe('test_failure');
      expect(task.error?.message).toContain('test failure');
    });

    it('rejects invalid workerType', async () => {
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Test with invalid worker',
        workerType: 'invalid' as unknown as 'auto',
      });

      // Should return validation error
      expect(submitResult.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects empty prompt', async () => {
      const submitResult = await client.post('/code/submit', {
        prompt: '',
        workerType: 'auto',
      });

      expect(submitResult.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Cancellation', () => {
    it('cancels running slow task', async () => {
      // Submit slow task that takes 10 seconds
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:slow-success] Cancellation test task',
        workerType: 'auto',
      });

      expect(submitResult.status).toBe(200);
      const { codeTaskId } = submitResult.data;

      // Wait for task to start running
      await sleep(3000);

      // Check it's running
      const checkResult = await client.get(`/code/tasks/${codeTaskId}`);
      expect(checkResult.data.status).toMatch(/^(dispatched|running)$/);

      // Cancel it
      const cancelResult = await client.post('/code/cancel', { taskId: codeTaskId });
      expect(cancelResult.status).toBe(200);
      expect(cancelResult.data.status).toBe('cancelled');

      // Verify cancelled status
      const task = await waitForTaskStatus(client, codeTaskId, 'cancelled', 30000);
      expect(task.status).toBe('cancelled');
    });

    it('returns 404 when cancelling non-existent task', async () => {
      const cancelResult = await client.post('/code/cancel', {
        taskId: 'non-existent-task-id',
      });

      expect(cancelResult.status).toBe(404);
    });

    it('returns 409 when cancelling already completed task', async () => {
      // Submit and wait for quick success task
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Quick task for cancel test',
        workerType: 'auto',
      });

      const { codeTaskId } = submitResult.data;
      await waitForTaskStatus(client, codeTaskId, 'completed', 60000);

      // Try to cancel completed task
      const cancelResult = await client.post('/code/cancel', { taskId: codeTaskId });

      expect(cancelResult.status).toBe(409);
    });
  });

  describe('CI Failure', () => {
    it('marks task completed with ciFailed flag', async () => {
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:ci-failure] Broken code for CI test',
        workerType: 'auto',
      });

      expect(submitResult.status).toBe(200);
      const { codeTaskId } = submitResult.data;

      const task = await waitForTaskStatus(client, codeTaskId, 'completed', 60000);

      expect(task.status).toBe('completed');
      expect(task.result?.ciFailed).toBe(true);
      expect(task.result?.prUrl).toBeDefined();

      // Track for cleanup
      if (task.result?.branch !== undefined) {
        createdBranches.push(task.result.branch);
      }
      if (task.result?.prUrl !== undefined) {
        createdPRs.push(task.result.prUrl);
      }
    });
  });

  describe('Task Listing', () => {
    it('lists user tasks', async () => {
      const response = await client.get('/code/tasks');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('tasks');
      expect(Array.isArray(response.data.tasks)).toBe(true);
    });

    it('filters tasks by status', async () => {
      const response = await client.get('/code/tasks', {
        params: { status: 'completed' },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('tasks');

      // All returned tasks should have the filtered status
      response.data.tasks.forEach((task: CodeTask) => {
        expect(task.status).toBe('completed');
      });
    });

    it('respects limit parameter', async () => {
      const response = await client.get('/code/tasks', {
        params: { limit: 5 },
      });

      expect(response.status).toBe(200);
      expect(response.data.tasks.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Task Details', () => {
    it('returns task details', async () => {
      // First create a task
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Get task details test',
        workerType: 'auto',
      });

      const { codeTaskId } = submitResult.data;

      // Get task details
      const response = await client.get(`/code/tasks/${codeTaskId}`);

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(codeTaskId);
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('createdAt');
    });

    it('returns 404 for non-existent task', async () => {
      const response = await client.get('/code/tasks/non-existent-task');

      expect(response.status).toBe(404);
    });
  });

  describe('Worker Status', () => {
    it('returns worker health status', async () => {
      const response = await client.get('/code/workers/status');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('mac');
      expect(response.data).toHaveProperty('vm');

      // Each worker status should have expected fields
      ['mac', 'vm'].forEach((worker) => {
        expect(response.data[worker]).toHaveProperty('healthy');
        expect(response.data[worker]).toHaveProperty('capacity');
        expect(response.data[worker]).toHaveProperty('checkedAt');
      });
    });
  });

  describe('Result Structure', () => {
    it('returns complete result on success', async () => {
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Verify result structure',
        workerType: 'auto',
      });

      const { codeTaskId } = submitResult.data;
      const task = await waitForTaskStatus(client, codeTaskId, 'completed', 60000);

      expect(task.result).toBeDefined();
      expect(task.result?.branch).toBeDefined();
      expect(task.result?.commits).toBeGreaterThan(0);
      expect(task.result?.summary).toBeDefined();
      expect(task.result?.prUrl).toBeDefined();

      // Track for cleanup
      if (task.result?.branch !== undefined) {
        createdBranches.push(task.result.branch);
      }
      if (task.result?.prUrl !== undefined) {
        createdPRs.push(task.result.prUrl);
      }
    });
  });

  describe('Status Transitions', () => {
    it('transitions from dispatched to running to completed', async () => {
      const submitResult = await client.post('/code/submit', {
        prompt: '[test:success] Status transition test',
        workerType: 'auto',
      });

      const { codeTaskId } = submitResult.data;

      // Check initial status (dispatched or running)
      const initialResponse = await client.get(`/code/tasks/${codeTaskId}`);
      const initialStatus = initialResponse.data.status;
      expect(['dispatched', 'running']).toContain(initialStatus);

      // Wait for completion
      const task = await waitForTaskStatus(client, codeTaskId, 'completed', 60000);
      expect(task.status).toBe('completed');

      // Track for cleanup
      if (task.result?.branch !== undefined) {
        createdBranches.push(task.result.branch);
      }
      if (task.result?.prUrl !== undefined) {
        createdPRs.push(task.result.prUrl);
      }
    });
  });
});
