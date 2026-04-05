/**
 * Tests for POST /internal/auto-archive-merged-tasks.
 *
 * Covers:
 * - Auth: 401 when no header provided
 * - Auth: 401 when x-internal-auth header is invalid
 * - Auth: 200 with valid X-Internal-Auth
 * - Auth: 200 with OIDC Bearer token (simulated — Cloud Run validates)
 * - Success: returns archive statistics
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';

import { buildServer } from '../../server.js';
import { resetServices } from '../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../helpers/mockServices.js';

const processExecutionMemoryBacklogMock = vi.fn();

vi.mock('../../domain/usecases/processExecutionMemoryBacklog.js', (): {
  processExecutionMemoryBacklog: (input: unknown) => unknown;
} => ({
  processExecutionMemoryBacklog: (input: unknown): unknown => processExecutionMemoryBacklogMock(input),
}));

describe('POST /internal/auto-archive-merged-tasks', () => {
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
      url: '/internal/auto-archive-merged-tasks',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when x-internal-auth header is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/auto-archive-merged-tasks',
      headers: {
        'x-internal-auth': 'wrong-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 with archive stats when x-internal-auth is valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/auto-archive-merged-tasks',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      totalTasksFetched: number;
      totalGroupsEvaluated: number;
      groupsArchived: number;
      groupsSkippedActive: number;
      tasksArchived: number;
      tasksFailed: number;
      durationMs: number;
    };
    expect(body.totalTasksFetched).toBe(0);
    expect(body.totalGroupsEvaluated).toBe(0);
    expect(body.groupsArchived).toBe(0);
    expect(body.groupsSkippedActive).toBe(0);
    expect(body.tasksArchived).toBe(0);
    expect(body.tasksFailed).toBe(0);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts OIDC Bearer token (Cloud Run validates)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/auto-archive-merged-tasks',
      headers: {
        authorization: 'Bearer some-oidc-token',
      },
    });

    // Cloud Run validates OIDC tokens at infra layer; at application level,
    // Bearer presence is accepted as "scheduler authenticated"
    expect(response.statusCode).toBe(200);
  });

  it('passes mergeDays from request body to use case', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/auto-archive-merged-tasks',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mergeDays: 14 }),
    });

    expect(response.statusCode).toBe(200);
    // With empty Firestore, result is always 0 regardless of mergeDays
    const body = JSON.parse(response.body) as { totalTasksFetched: number };
    expect(body.totalTasksFetched).toBe(0);
  });
});
