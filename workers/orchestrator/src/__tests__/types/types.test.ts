/**
 * Tests for orchestrator type definitions.
 * These tests validate that type definitions are correctly structured
 * and can be instantiated/used as expected.
 */

import { describe, it, expect } from 'vitest';
import type {
  CreateTaskRequest,
  HealthResponse,
} from '../../types/api.js';
import type { OrchestratorConfig } from '../../types/config.js';
import type {
  OrchestratorState,
  OrchestratorStatus,
  TaskState,
  TaskStatus,
} from '../../types/state.js';
import type { Task } from '../../types/task.js';

describe('Orchestrator Types', () => {
  describe('API Types', () => {
    it('validates CreateTaskRequest structure', () => {
      const request: CreateTaskRequest = {
        taskId: 'test-123',
        workerType: 'opus',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      expect(request.taskId).toBe('test-123');
      expect(request.workerType).toBe('opus');
    });

    it('validates CreateTaskRequest with optional fields', () => {
      const request: CreateTaskRequest = {
        taskId: 'test-456',
        workerType: 'auto',
        prompt: 'Test',
        repository: 'intexuraos/intexuraos-2',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Test issue',
        slug: 'test-slug',
        actionId: 'action-789',
      };

      expect(request.repository).toBe('intexuraos/intexuraos-2');
      expect(request.linearIssueId).toBe('INT-123');
    });

    it('validates HealthResponse structure', () => {
      const health: HealthResponse = {
        status: 'healthy',
        capacity: 5,
        running: 2,
        available: 3,
        githubTokenExpiresAt: null,
      };

      expect(health.status).toBe('healthy');
      expect(health.available).toBe(3);
    });
  });

  describe('Config Types', () => {
    it('validates OrchestratorConfig structure', () => {
      const config: OrchestratorConfig = {
        port: 8100,
        capacity: 5,
        taskTimeoutMs: 7200000,
        stateFilePath: '/tmp/state.json',
        worktreeBasePath: '/tmp/worktrees',
        logBasePath: '/tmp/logs',
        githubAppId: 'test-app-id',
        githubAppPrivateKeyPath: '/tmp/key.pem',
        githubInstallationId: 'test-installation-id',
        dispatchSecret: 'test-secret',
      };

      expect(config.capacity).toBe(5);
      expect(config.taskTimeoutMs).toBe(7200000);
    });
  });

  describe('State Types', () => {
    it('validates TaskState structure', () => {
      const taskState: TaskState = {
        id: 'task-123',
        status: 'running',
        workerType: 'opus',
        prompt: 'Test prompt',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      expect(taskState.status).toBe('running');
      expect(taskState.id).toBe('task-123');
    });

    it('validates OrchestratorState structure', () => {
      const state: OrchestratorState = {
        tasks: {},
        githubToken: null,
        pendingWebhooks: [],
      };

      expect(state.tasks).toEqual({});
      expect(state.githubToken).toBeNull();
    });

    it('validates all TaskStatus values', () => {
      const statuses: TaskStatus[] = ['pending', 'running', 'completed', 'failed'];

      expect(statuses).toHaveLength(4);
      expect(statuses).toContain('running');
      expect(statuses).toContain('failed');
    });

    it('validates all OrchestratorStatus values', () => {
      const statuses: OrchestratorStatus[] = ['healthy', 'degraded', 'unhealthy'];

      expect(statuses).toHaveLength(3);
      expect(statuses).toContain('healthy');
    });
  });

  describe('Task Types', () => {
    it('validates Task structure', () => {
      const task: Task = {
        id: 'task-123',
        status: 'pending',
        workerType: 'opus',
        prompt: 'Test prompt',
        repository: 'intexuraos/intexuraos-2',
        branch: 'feature/test',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      expect(task.id).toBe('task-123');
      expect(task.status).toBe('pending');
    });

    it('validates Task with all optional fields', () => {
      const task: Task = {
        id: 'task-456',
        status: 'running',
        workerType: 'auto',
        prompt: 'Full test prompt',
        repository: 'intexuraos/intexuraos-2',
        baseBranch: 'main',
        branch: 'feature/test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        actionId: 'action-123',
        linearIssueId: 'INT-456',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        startedAt: '2025-01-01T00:01:00.000Z',
        completedAt: null,
        error: null,
      };

      expect(task.linearIssueId).toBe('INT-456');
      expect(task.startedAt).toBe('2025-01-01T00:01:00.000Z');
    });
  });
});
