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

import { buildServer } from '../../server.js';
import { getServices, resetServices } from '../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../helpers/mockServices.js';

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

  it('returns 200 with accepted:true when x-internal-auth is valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { accepted: boolean };
    expect(body.accepted).toBe(true);
  });

  it('returns 200 with accepted:true when authenticated via OIDC Bearer token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
      headers: {
        authorization: 'Bearer fake-oidc-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { accepted: boolean };
    expect(body.accepted).toBe(true);
  });

  it('calls mergeConflictDetector.reconcile asynchronously after responding', async () => {
    const services = getServices();

    let resolveFn!: () => void;
    const waitForReconcile = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });

    const reconcileSpy = vi.fn().mockImplementation(async () => {
      resolveFn();
      return { checked: 3 };
    });

    // Override the reconcile spy via setServices so the route picks it up
    getServices().mergeConflictDetector = {
      ...services.mergeConflictDetector,
      reconcile: reconcileSpy,
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/merge-conflicts/reconcile',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    // Response is immediate (fire-and-forget)
    expect(response.statusCode).toBe(200);

    // Wait for the async reconcile to complete before asserting
    await waitForReconcile;
    expect(reconcileSpy).toHaveBeenCalledOnce();
  });
});
