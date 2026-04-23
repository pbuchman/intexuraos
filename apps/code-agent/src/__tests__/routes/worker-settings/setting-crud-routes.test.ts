/**
 * Focused smoke tests for the `settingCrudRoutes` sub-plugin.
 *
 * These tests verify the CRUD sub-plugin wires up under `buildServer` and
 * that each endpoint's happy path works. Exhaustive error-branch coverage
 * remains in `../workerSettingsRoutes.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { resetFirestore } from '@intexuraos/infra-firestore';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../../server.js';
import { resetServices } from '../../../services.js';
import { setupTestServices } from '../../helpers/mockServices.js';

describe('settingCrudRoutes (sub-plugin)', () => {
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
  });

  it('GET /code/worker-settings returns an empty array for a new user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/code/worker-settings',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { workers: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.workers).toEqual([]);
  });

  it('POST /code/worker-settings/workers adds a worker', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/code/worker-settings/workers',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'real-id',
        cfAccessClientSecret: 'real-secret',
        dispatchSigningSecret: 'real-signing',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { added: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.added).toBe(true);
  });

  it('PATCH /code/worker-settings/workers/:name merges partial updates', async () => {
    await app.inject({
      method: 'POST',
      url: '/code/worker-settings/workers',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/code/worker-settings/workers/home-mac',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/code/worker-settings',
      headers: { Authorization: 'Bearer test-token' },
    });
    const getBody = JSON.parse(getResponse.body) as {
      success: boolean;
      data: { workers: { url: string; enabled: boolean }[] };
    };
    // Unchanged field preserved, changed field merged.
    expect(getBody.data.workers[0]?.url).toBe('https://mac.example.com');
    expect(getBody.data.workers[0]?.enabled).toBe(false);
  });

  it('DELETE /code/worker-settings/workers/:name removes the worker', async () => {
    await app.inject({
      method: 'POST',
      url: '/code/worker-settings/workers',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/code/worker-settings/workers/home-mac',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
  });

  it('POST /code/worker-settings/workers rejects invalid worker names', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/code/worker-settings/workers',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: {
        name: 'AB', // too short + uppercase
        url: 'https://example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
  });
});
