/**
 * Tests for the task-admin sub-plugin (INT-1433 refactor of internalRoutes.ts).
 *
 * Existing dispatch-metadata tests live in `internalDispatchMetadata.test.ts` and
 * continue to cover the full handler behavior end-to-end. These tests lock in the
 * minimum guarantees the new route file must satisfy:
 *   - 401 when no auth on GET /internal/tasks/:taskId/dispatch-metadata
 *   - 200 with admin view when task exists and x-internal-auth is valid.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';

import { buildServer } from '../../../server.js';
import { getServices, resetServices } from '../../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../../helpers/mockServices.js';

describe('taskAdminRoutes (internal) via buildServer', () => {
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

  it('returns 401 for GET /internal/tasks/:taskId/dispatch-metadata without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/tasks/task_anything/dispatch-metadata',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with dispatch metadata for an existing task with x-internal-auth', async () => {
    const { codeTaskRepo } = getServices();
    const created = await codeTaskRepo.create({
      userId: 'user-1',
      prompt: 'Do the thing',
      sanitizedPrompt: 'Do the thing',
      systemPromptHash: 'hash-1',
      workerType: 'qwen',
      workerLocation: 'home-mac',
      repository: 'intexuraos/test',
      baseBranch: 'main',
      traceId: 'trace-1',
      agentType: 'execution',
      linearIssueId: 'INT-1',
    });
    if (!created.ok) {
      throw new Error(`Failed to create task: ${created.error.message}`);
    }

    const response = await app.inject({
      method: 'GET',
      url: `/internal/tasks/${created.value.id}/dispatch-metadata`,
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      taskId: string;
      prompt: string;
      repository: string;
      webhookUrl: string;
    };
    expect(body.taskId).toBe(created.value.id);
    expect(body.prompt).toBe('Do the thing');
    expect(body.repository).toBe('intexuraos/test');
    expect(body.webhookUrl).toBe('http://localhost:8080/internal/webhooks/task-complete');
  });
});
