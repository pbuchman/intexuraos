/**
 * Tests for orchestrator type definitions.
 * These tests validate that type definitions are correctly structured
 * and can be instantiated/used as expected.
 */

import { describe, it, expect } from 'vitest';
import type { CreateTaskRequest, HealthResponse } from '../../types/api.js';
import type { OrchestratorConfig } from '../../types/config.js';
import type { OrchestratorState, OrchestratorStatus } from '../../types/state.js';
import type { Task, TaskStatus } from '../../types/task.js';

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
        status: 'ready',
        capacity: 5,
        running: 2,
        available: 3,
        githubTokenExpiresAt: null,
      };

      expect(health.status).toBe('ready');
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
      const statuses: TaskStatus[] = [
        'queued',
        'running',
        'completed',
        'failed',
        'interrupted',
        'cancelled',
      ];

      expect(statuses).toHaveLength(6);
      expect(statuses).toContain('running');
      expect(statuses).toContain('failed');
    });

    it('validates all OrchestratorStatus values', () => {
      const statuses: OrchestratorStatus[] = [
        'initializing',
        'recovering',
        'ready',
        'degraded',
        'auth_degraded',
        'shutting_down',
      ];

      expect(statuses).toHaveLength(6);
      expect(statuses).toContain('ready');
    });
  });

  describe('Task Types', () => {
    it('validates Task structure', () => {
      const task: Task = {
        taskId: 'task-123',
        status: 'queued',
        workerType: 'opus',
        prompt: 'Test prompt',
        repository: 'intexuraos/intexuraos-2',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        tmuxSession: 'session-123',
        worktreePath: '/tmp/worktrees/task-123',
        startedAt: '2025-01-01T00:00:00.000Z',
      };

      expect(task.taskId).toBe('task-123');
      expect(task.status).toBe('queued');
    });

    it('validates Task with all optional fields', () => {
      const task: Task = {
        taskId: 'task-456',
        status: 'running',
        workerType: 'auto',
        prompt: 'Full test prompt',
        repository: 'intexuraos/intexuraos-2',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        tmuxSession: 'session-456',
        worktreePath: '/tmp/worktrees/task-456',
        startedAt: '2025-01-01T00:00:00.000Z',
        actionId: 'action-123',
        linearIssueId: 'INT-456',
        linearIssueTitle: 'Test issue',
        slug: 'test-slug',
        completedAt: '2025-01-01T00:30:00.000Z',
      };

      expect(task.linearIssueId).toBe('INT-456');
      expect(task.startedAt).toBe('2025-01-01T00:00:00.000Z');
    });
  });
});
