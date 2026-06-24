/**
 * Tests for the cleanup sub-plugin (INT-1433 refactor of internalRoutes.ts).
 *
 * These tests focus on prune-stale behavior to demonstrate that the split
 * route file wires through to the use case correctly. The broader cleanup
 * endpoint coverage continues to live in `internalRoutes.test.ts` and
 * `internalRoutes.autoArchiveMergedTasks.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { ok } from '@intexuraos/common-core';

import { buildServer } from '../../../server.js';
import { getServices, resetServices, setServices } from '../../../services.js';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { setupTestServices } from '../../helpers/mockServices.js';

const pruneStaleMemoriesMock = vi.fn();

// `vi.mock` replaces the whole module, so the factory must return every export
// that any route in the sub-plugin imports — otherwise those imports resolve to
// `undefined`. These tests only drive the `pruneStaleMemories` path; the other
// two exports are stubbed to no-op spies so the module surface stays complete.
vi.mock('../../../domain/usecases/processExecutionMemoryBacklog.js', (): {
  processExecutionMemoryBacklog: (input: unknown) => unknown;
  sweepErroredApplications: (input: unknown) => unknown;
  pruneStaleMemories: (deps: unknown, options: unknown) => unknown;
} => ({
  processExecutionMemoryBacklog: (): unknown => undefined,
  sweepErroredApplications: (): unknown => undefined,
  pruneStaleMemories: (deps: unknown, options: unknown): unknown => pruneStaleMemoriesMock(deps, options),
}));

describe('cleanupRoutes (internal) via buildServer — prune-stale slice', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    nock('http://intex-agent').persist().patch(/\/internal\/actions\/.*\/status/).reply(200, { success: true });
    nock('http://linear-agent:8086').persist().post(/\/.*/).reply(200, { success: true });

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';
    process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'] = 'true';

    setupTestServices();
    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
    pruneStaleMemoriesMock.mockReset();
  });

  it('passes maxAgeDays through and returns archived count > 0', async () => {
    const services = getServices();
    setServices({ ...services, executionMemoryRepo: {} as never });
    pruneStaleMemoriesMock.mockResolvedValue(ok({ archived: 3, skipped: 0 }));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/execution-memory/prune-stale',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { maxAgeDays: 7 },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { archived: number; skipped: number } };
    expect(body.success).toBe(true);
    expect(body.data.archived).toBe(3);
    expect(pruneStaleMemoriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ logger: expect.anything() }),
      { maxAgeDays: 7 },
    );
  });

  it('passes dryRun through to the use case', async () => {
    const services = getServices();
    setServices({ ...services, executionMemoryRepo: {} as never });
    pruneStaleMemoriesMock.mockResolvedValue(ok({ archived: 0, skipped: 0 }));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/execution-memory/prune-stale',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: { dryRun: true },
    });

    expect(response.statusCode).toBe(200);
    expect(pruneStaleMemoriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ logger: expect.anything() }),
      { dryRun: true },
    );
  });
});
