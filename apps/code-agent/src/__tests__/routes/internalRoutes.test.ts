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
import { getServices, resetServices, setServices } from '../../services.js';
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
