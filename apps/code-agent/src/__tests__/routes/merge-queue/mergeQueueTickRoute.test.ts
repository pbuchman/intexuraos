/**
 * Tests for POST /internal/merge-queue/tick endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { buildServer } from '../../../server.js';
import { getServices, resetServices, setServices } from '../../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../../helpers/mockServices.js';
import { err } from '@intexuraos/common-core';

describe('POST /internal/merge-queue/tick', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    nock('http://actions-agent')
      .persist()
      .patch(/\/internal\/actions\/.*\/status/)
      .reply(200, { success: true });

    nock('http://linear-agent:8086')
      .persist()
      .post(/\/.*/)
      .reply(200, { success: true });

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

  it('should return 401 when no auth header is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-queue/tick',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 when invalid x-internal-auth header is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-queue/tick',
      headers: {
        'x-internal-auth': 'wrong-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 200 with empty results when auth valid via x-internal-auth and no active watches', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-queue/tick',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { results: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.results).toEqual([]);
  });

  it('should return 200 with results when auth valid via OIDC Bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-queue/tick',
      headers: {
        authorization: 'Bearer some-oidc-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { results: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.results).toEqual([]);
  });

  it('should return 500 when tick use case fails', async () => {
    const services = getServices();
    setServices({
      ...services,
      mergeQueueWatchRepo: {
        ...services.mergeQueueWatchRepo,
        findAllActive: vi.fn().mockResolvedValue(
          err({ code: 'INTERNAL' as never, message: 'Firestore connection lost' })
        ),
      },
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-queue/tick',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Firestore connection lost');
  });
});
