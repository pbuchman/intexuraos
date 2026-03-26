/**
 * Tests for POST /internal/merge-conflicts/reconcile.
 *
 * Covers:
 * - Auth: 401 when no header provided
 * - Auth: 401 when x-internal-auth header is invalid
 * - Auth: 200 with { accepted: true } when x-internal-auth is valid
 * - Auth: 200 with { accepted: true } when OIDC Bearer token is provided
 * - Reconcile runs asynchronously (fire-and-forget)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { ok, err } from '@intexuraos/common-core';

import { buildServer } from '../../server.js';
import { getServices, resetServices, setServices } from '../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../helpers/mockServices.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';

const processExecutionMemoryBacklogMock = vi.fn();

vi.mock('../../domain/usecases/processExecutionMemoryBacklog.js', (): {
  processExecutionMemoryBacklog: (input: unknown) => unknown;
} => ({
  processExecutionMemoryBacklog: (input: unknown): unknown => processExecutionMemoryBacklogMock(input),
}));

describe('POST /internal/merge-conflicts/reconcile', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    // Suppress outbound HTTP calls made by actions-agent/linear-agent clients
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
    processExecutionMemoryBacklogMock.mockReset();
  });

  it('returns 401 when no auth header is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when x-internal-auth header is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
      headers: {
        'x-internal-auth': 'wrong-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with reconcile stats when x-internal-auth is valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { processed: number; closed: number; reopened: number; skipped: number; error: number };
    expect(body.processed).toBe(0);
    expect(body.closed).toBe(0);
    expect(body.reopened).toBe(0);
  });

  // Application-level OIDC token validation is intentionally absent: Cloud Run
  // validates the OIDC token at the infrastructure layer before requests reach
  // this handler. See authenticateInternalScheduler for the full security note.
  it('returns 200 with reconcile stats when authenticated via OIDC Bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
      headers: {
        authorization: 'Bearer fake-oidc-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { processed: number };
    expect(body.processed).toBe(0);
  });

  it('awaits reconcile and returns its result', async () => {
    const services = getServices();

    const reconcileSpy = vi.fn().mockResolvedValue({
      processed: 3,
      closed: 1,
      reopened: 1,
      mergeConflictRefreshed: 0,
      conflictWorkflowsTriggered: 0,
      skipped: 1,
      error: 0,
    });

    setServices({
      ...services,
      mergeConflictDetector: {
        ...services.mergeConflictDetector,
        reconcile: reconcileSpy,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { processed: number; closed: number; reopened: number };
    expect(body.processed).toBe(3);
    expect(body.closed).toBe(1);
    expect(body.reopened).toBe(1);
    expect(reconcileSpy).toHaveBeenCalledOnce();
  });
});

describe('GET /internal/linear/issue-context/:identifier', () => {
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

  it('returns 401 when no auth header is provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/linear/issue-context/INT-100',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with issue context when linear-agent succeeds', async () => {
    const services = getServices();

    const mockClient: LinearAgentClient = {
      ...services.linearAgentClient,
      async getIssueContext() {
        return ok({
          description: 'Plan document: docs/plans/2026-03-20-test.md',
          comments: [{ body: 'a comment', createdAt: '2026-03-20T10:00:00Z' }],
        });
      },
    };

    setServices({ ...services, linearAgentClient: mockClient });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/linear/issue-context/INT-100',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      description: string | null;
      comments: { body: string; createdAt: string }[];
      planDocumentPath: string | null;
    };
    expect(body.description).toBe('Plan document: docs/plans/2026-03-20-test.md');
    expect(body.comments).toHaveLength(1);
    expect(body.planDocumentPath).toBe('docs/plans/2026-03-20-test.md');
  });

  it('returns 404 when issue is not found', async () => {
    const services = getServices();

    const mockClient: LinearAgentClient = {
      ...services.linearAgentClient,
      async getIssueContext() {
        return err({ code: 'NOT_FOUND' as const, message: 'Not found' });
      },
    };

    setServices({ ...services, linearAgentClient: mockClient });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/linear/issue-context/INT-999',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 with planDocumentPath null when no plan reference', async () => {
    const services = getServices();

    const mockClient: LinearAgentClient = {
      ...services.linearAgentClient,
      async getIssueContext() {
        return ok({
          description: 'Just a normal description',
          comments: [],
        });
      },
    };

    setServices({ ...services, linearAgentClient: mockClient });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/linear/issue-context/INT-200',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      description: string | null;
      planDocumentPath: string | null;
    };
    expect(body.description).toBe('Just a normal description');
    expect(body.planDocumentPath).toBeNull();
  });

  it('returns 502 when linear-agent is unavailable', async () => {
    const services = getServices();

    const mockClient: LinearAgentClient = {
      ...services.linearAgentClient,
      async getIssueContext() {
        return err({ code: 'UNAVAILABLE' as const, message: 'Service down' });
      },
    };

    setServices({ ...services, linearAgentClient: mockClient });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/linear/issue-context/INT-ERR',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(502);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DOWNSTREAM_ERROR');
  });
});

describe('POST /internal/execution-memory/process', () => {
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
    processExecutionMemoryBacklogMock.mockReset();
  });

  it('returns 401 when no auth header is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/execution-memory/process',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns backlog processor stats when internal auth is valid', async () => {
    processExecutionMemoryBacklogMock.mockResolvedValue(ok({
      claimed: 2,
      completed: 1,
      skipped: 1,
      errored: 0,
      taskIds: ['task-1', 'task-2'],
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/execution-memory/process',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        limit: 2,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(processExecutionMemoryBacklogMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 2,
    }));
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      data: {
        claimed: 2,
        completed: 1,
        skipped: 1,
        errored: 0,
        taskIds: ['task-1', 'task-2'],
      },
      diagnostics: expect.objectContaining({
        requestId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    });
  });

  it('returns 500 with the default limit when optional execution-memory clients are unavailable', async () => {
    const services = getServices();
    const {
      executionMemoryEvaluatorClient: _evaluatorClient,
      executionMemoryDistillerClient: _distillerClient,
      executionMemoryEmbeddingClient: _embeddingClient,
      ...servicesWithoutOptionalClients
    } = services;
    setServices(servicesWithoutOptionalClients);
    processExecutionMemoryBacklogMock.mockResolvedValue(err({ message: 'processor failed' }));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/execution-memory/process',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(500);
    expect(processExecutionMemoryBacklogMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
    }));
    const input = processExecutionMemoryBacklogMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).not.toHaveProperty('evaluatorClient');
    expect(input).not.toHaveProperty('distillerClient');
    expect(input).not.toHaveProperty('embeddingClient');
  });
});
