/**
 * Tests for PATCH /internal/tasks/:id/remediation-status.
 *
 * Covers:
 * - Auth: 401 when no header / invalid header
 * - Validation: 400 when requiresReReview is not a boolean
 * - Validation: 404 when task doesn't exist
 * - Validation: 403 when task agentType is not remediation
 * - Validation: 403 when X-Task-Id header doesn't match
 * - Success: 200 for requiresReReview true
 * - Success: 200 for requiresReReview false
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { err } from '@intexuraos/common-core';

import { buildServer } from '../../server.js';
import { getServices, resetServices, setServices } from '../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../helpers/mockServices.js';
import type { CodeTask } from '../../domain/models/codeTask.js';

describe('PATCH /internal/tasks/:id/remediation-status', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    nock('http://actions-agent').persist().patch(/\/internal\/actions\/.*\/status/).reply(200, { success: true });
    nock('http://linear-agent:8086').persist().post(/\/.*/).reply(200, { success: true });

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';

    setupTestServices();
    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  async function createRemediationTask(): Promise<CodeTask> {
    const { codeTaskRepo } = getServices();
    const result = await codeTaskRepo.create({
      userId: 'user-1',
      prompt: 'Fix the CI failure',
      sanitizedPrompt: 'Fix the CI failure',
      systemPromptHash: 'hash-1',
      workerType: 'qwen',
      workerLocation: 'home-mac',
      repository: 'intexuraos/test',
      baseBranch: 'main',
      traceId: 'trace-1',
      agentType: 'remediation',
    });
    if (!result.ok) {
      throw new Error(`Failed to create task: ${result.error.message}`);
    }
    return result.value;
  }

  async function createPlanningTask(): Promise<CodeTask> {
    const { codeTaskRepo } = getServices();
    const result = await codeTaskRepo.create({
      userId: 'user-1',
      prompt: 'Plan the feature',
      sanitizedPrompt: 'Plan the feature',
      systemPromptHash: 'hash-2',
      workerType: 'qwen',
      workerLocation: 'home-mac',
      repository: 'intexuraos/test',
      baseBranch: 'main',
      traceId: 'trace-2',
      agentType: 'planning',
    });
    if (!result.ok) {
      throw new Error(`Failed to create task: ${result.error.message}`);
    }
    return result.value;
  }

  // --- Auth ---

  it('returns 401 when no auth header is provided', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/internal/tasks/task_123/remediation-status',
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when x-internal-auth header is invalid', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/internal/tasks/task_123/remediation-status',
      headers: {
        'x-internal-auth': 'wrong-token',
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // --- Body validation ---

  it('returns 400 when requiresReReview is not a boolean', async () => {
    const task = await createRemediationTask();

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': task.id,
      },
      payload: { requiresReReview: 'yes' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 when requiresReReview is missing', async () => {
    const task = await createRemediationTask();

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': task.id,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  // --- Task validation ---

  it('returns 404 when task does not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/internal/tasks/nonexistent-task/remediation-status',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': 'nonexistent-task',
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 when findById encounters a Firestore error', async () => {
    const task = await createRemediationTask();
    const services = getServices();

    const failingRepo = {
      ...services.codeTaskRepo,
      findById: vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
      ),
    };
    setServices({ ...services, codeTaskRepo: failingRepo });

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': task.id,
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 403 when task agentType is not remediation', async () => {
    const task = await createPlanningTask();

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': task.id,
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when X-Task-Id header does not match the task ID', async () => {
    const task = await createRemediationTask();

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': 'some-other-task-id',
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when X-Task-Id header is missing', async () => {
    const task = await createRemediationTask();

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // --- Success ---

  it('returns 200 and updates requiresReReview to true', async () => {
    const task = await createRemediationTask();

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': task.id,
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify the update persisted
    const { codeTaskRepo } = getServices();
    const updated = await codeTaskRepo.findById(task.id);
    if (!updated.ok) {
      throw new Error('Task should exist');
    }
    expect(updated.value.requiresReReview).toBe(true);
  });

  it('returns 200 and updates requiresReReview to false', async () => {
    const task = await createRemediationTask();

    // First set it to true
    const { codeTaskRepo } = getServices();
    await codeTaskRepo.update(task.id, { requiresReReview: true });

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': task.id,
      },
      payload: { requiresReReview: false },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify the update persisted
    const updated = await codeTaskRepo.findById(task.id);
    if (!updated.ok) {
      throw new Error('Task should exist');
    }
    expect(updated.value.requiresReReview).toBe(false);
  });

  // --- Error handling ---

  it('returns 500 when codeTaskRepo.update fails', async () => {
    const task = await createRemediationTask();
    const services = getServices();

    // Replace the repo's update method with one that returns an error
    const failingRepo = {
      ...services.codeTaskRepo,
      update: vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore write failed' })
      ),
    };
    setServices({ ...services, codeTaskRepo: failingRepo });

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/tasks/${task.id}/remediation-status`,
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-task-id': task.id,
      },
      payload: { requiresReReview: true },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
