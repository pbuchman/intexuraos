/**
 * Tests for GET /internal/tasks/:taskId/dispatch-metadata.
 *
 * Covers:
 * - Auth: 401 when no header provided
 * - Auth: 401 when x-internal-auth header is invalid
 * - 404 for unknown task
 * - 404 when findById returns a Firestore error
 * - 200 with dispatch metadata fields for known task
 * - 200 with null optional fields when not set on the task
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { err } from '@intexuraos/common-core';

import { buildServer } from '../../server.js';
import { getServices, resetServices, setServices } from '../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../helpers/mockServices.js';
import type { CodeTask } from '../../domain/models/codeTask.js';

describe('GET /internal/tasks/:taskId/dispatch-metadata', () => {
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

  async function createTask(): Promise<CodeTask> {
    const { codeTaskRepo } = getServices();
    const result = await codeTaskRepo.create({
      userId: 'user-1',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'hash-1',
      workerType: 'qwen',
      workerLocation: 'home-mac',
      repository: 'intexuraos/test',
      baseBranch: 'main',
      traceId: 'trace-1',
      agentType: 'execution',
      linearIssueId: 'INT-999',
      webhookSecret: 'secret-abc',
      prNumber: 42,
    });
    if (!result.ok) {
      throw new Error(`Failed to create task: ${result.error.message}`);
    }
    return result.value;
  }

  // --- Auth ---

  it('returns 401 when no auth header is provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/tasks/task_unknown/dispatch-metadata',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when x-internal-auth header is invalid', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/tasks/task_unknown/dispatch-metadata',
      headers: { 'x-internal-auth': 'wrong-token' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // --- 404 ---

  it('returns 404 when findById returns a Firestore error', async () => {
    const services = getServices();
    const failingRepo = {
      ...services.codeTaskRepo,
      findById: vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
      ),
    };
    setServices({ ...services, codeTaskRepo: failingRepo });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/tasks/task_unknown/dispatch-metadata',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for unknown task', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/tasks/task_unknown/dispatch-metadata',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  // --- Success ---

  it('returns 200 with dispatch metadata for a known task', async () => {
    const task = await createTask();

    const response = await app.inject({
      method: 'GET',
      url: `/internal/tasks/${task.id}/dispatch-metadata`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);

    interface DispatchMetadata {
      taskId: string;
      prompt: string;
      repository: string;
      baseBranch: string;
      agentType: string | null;
      workerType: string;
      linearIssueId: string | null;
      webhookSecret: string | null;
      prNumber: number | null;
    }

    const body = JSON.parse(response.body) as DispatchMetadata;
    expect(body.taskId).toBe(task.id);
    expect(body.prompt).toBe('Fix the bug');
    expect(body.repository).toBe('intexuraos/test');
    expect(body.baseBranch).toBe('main');
    expect(body.agentType).toBe('execution');
    expect(body.workerType).toBe('qwen');
    expect(body.linearIssueId).toBe('INT-999');
    expect(body.webhookSecret).toBe('secret-abc');
    expect(body.prNumber).toBe(42);
  });

  it('returns null for optional fields when not set on the task', async () => {
    const { codeTaskRepo } = getServices();
    const result = await codeTaskRepo.create({
      userId: 'user-1',
      prompt: 'Minimal task',
      sanitizedPrompt: 'Minimal task',
      systemPromptHash: 'hash-2',
      workerType: 'qwen',
      workerLocation: 'home-mac',
      repository: 'intexuraos/minimal',
      baseBranch: 'development',
      traceId: 'trace-2',
      // no agentType, linearIssueId, webhookSecret, prNumber
    });
    if (!result.ok) {
      throw new Error(`Failed to create task: ${result.error.message}`);
    }
    const task = result.value;

    const response = await app.inject({
      method: 'GET',
      url: `/internal/tasks/${task.id}/dispatch-metadata`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);

    interface DispatchMetadata {
      taskId: string;
      agentType: string | null;
      linearIssueId: string | null;
      webhookSecret: string | null;
      prNumber: number | null;
    }

    const body = JSON.parse(response.body) as DispatchMetadata;
    expect(body.taskId).toBe(task.id);
    expect(body.agentType).toBeNull();
    expect(body.linearIssueId).toBeNull();
    expect(body.webhookSecret).toBeNull();
    expect(body.prNumber).toBeNull();
  });
});
