/**
 * Tests for the diagnostic sub-plugin (INT-1433 refactor of internalRoutes.ts).
 *
 * Focused on happy-path: returns diagnostic payload when linear-agent succeeds.
 * 401/404/502 paths continue to be covered by `internalRoutes.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { ok } from '@intexuraos/common-core';

import { buildServer } from '../../../server.js';
import { getServices, resetServices, setServices } from '../../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../../helpers/mockServices.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';

describe('diagnosticRoutes (internal) via buildServer', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
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

  it('returns the diagnostic payload when linear-agent succeeds', async () => {
    const services = getServices();
    const mockClient: LinearAgentClient = {
      ...services.linearAgentClient,
      async getIssueContext() {
        return ok({
          description: 'See plan document: docs/plans/2026-04-22-example.md for details.',
          comments: [{ body: 'first', createdAt: '2026-04-22T10:00:00Z' }],
        });
      },
    };

    setServices({ ...services, linearAgentClient: mockClient });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/linear/issue-context/INT-42',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      description: string | null;
      comments: { body: string; createdAt: string }[];
      planDocumentPath: string | null;
    };
    expect(body.description).toContain('plan document');
    expect(body.comments).toHaveLength(1);
    expect(body.planDocumentPath).toBe('docs/plans/2026-04-22-example.md');
  });
});
