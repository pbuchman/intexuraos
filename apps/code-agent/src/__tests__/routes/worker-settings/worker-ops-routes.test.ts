/**
 * Focused smoke tests for the `workerOpsRoutes` sub-plugin.
 *
 * Covers the two per-worker operational endpoints:
 * - POST /code/worker-settings/workers/:name/test (connectivity probe)
 * - PUT  /code/worker-settings/priority         (reorder)
 *
 * Exhaustive error-branch coverage lives in `../workerSettingsRoutes.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import * as jose from 'jose';
import { resetFirestore } from '@intexuraos/infra-firestore';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../../server.js';
import { getServices, resetServices } from '../../../services.js';
import { setupTestServices } from '../../helpers/mockServices.js';

describe('workerOpsRoutes (sub-plugin)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    setupTestServices();
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  it('POST /code/worker-settings/workers/:name/test reports success when /health is 200', async () => {
    const { workerSettingsRepo } = getServices();
    await workerSettingsRepo.addWorker('test-user-id', {
      name: 'home-mac',
      url: 'https://mac-worker.example.com',
      cfAccessClientId: 'id',
      cfAccessClientSecret: 'secret',
      dispatchSigningSecret: 'signing',
    });

    nock('https://mac-worker.example.com').get('/health').reply(200, {
      status: 'ready',
      capacity: 2,
      running: 0,
      available: 2,
      workerAuths: {},
      providerApiKeys: {},
      dockerHealthy: true,
      diskHealthy: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/worker-settings/workers/home-mac/test',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { testStatus: string; testMessage: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.testStatus).toBe('success');
    expect(body.data.testMessage).toBe('Connection successful');
  });

  it('POST /code/worker-settings/workers/:name/test reports failure for legacy /health contract', async () => {
    const { workerSettingsRepo } = getServices();
    await workerSettingsRepo.addWorker('test-user-id', {
      name: 'home-mac',
      url: 'https://mac-worker.example.com',
      cfAccessClientId: 'id',
      cfAccessClientSecret: 'secret',
      dispatchSigningSecret: 'signing',
    });

    nock('https://mac-worker.example.com').get('/health').reply(200, {
      status: 'ready',
      capacity: 2,
      running: 0,
      available: 2,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/worker-settings/workers/home-mac/test',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { testStatus: string; testMessage: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.testStatus).toBe('failure');
    expect(body.data.testMessage).toBe(
      'Health response missing worker capability details: workerAuths, providerApiKeys, dockerHealthy, diskHealthy'
    );
  });

  it('POST /code/worker-settings/workers/:name/test returns 404 for unknown worker', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/worker-settings/workers/nonexistent/test',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('PUT /code/worker-settings/priority reorders workers', async () => {
    const { workerSettingsRepo } = getServices();
    await workerSettingsRepo.addWorker('test-user-id', {
      name: 'home-mac',
      url: 'https://mac.example.com',
      cfAccessClientId: 'id1',
      cfAccessClientSecret: 'secret1',
      dispatchSigningSecret: 'signing1',
    });
    await workerSettingsRepo.addWorker('test-user-id', {
      name: 'office-pc',
      url: 'https://office.example.com',
      cfAccessClientId: 'id2',
      cfAccessClientSecret: 'secret2',
      dispatchSigningSecret: 'signing2',
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/worker-settings/priority',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: { workerNames: ['office-pc', 'home-mac'] },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { reordered: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.reordered).toBe(true);
  });
});
