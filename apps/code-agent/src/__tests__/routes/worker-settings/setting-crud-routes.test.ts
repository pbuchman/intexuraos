/**
 * Focused smoke tests for the `settingCrudRoutes` sub-plugin.
 *
 * These tests verify the CRUD sub-plugin wires up under `buildServer` and
 * that each endpoint's happy path works. Exhaustive error-branch coverage
 * remains in `../workerSettingsRoutes.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import * as jose from 'jose';
import { resetFirestore } from '@intexuraos/infra-firestore';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../../server.js';
import { getServices, resetServices, setServices } from '../../../services.js';
import { createWorkerHealthProbe } from '../../../infra/services/workerHealthProbe.js';
import { setupTestServices } from '../../helpers/mockServices.js';
import { orchestratorHealthV2 } from '../../helpers/orchestratorHealth.js';

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
    vi.unstubAllGlobals();
  });

  it('GET /code/worker-settings returns an empty array for a new user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/worker-settings',
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
      url: '/worker-settings/workers',
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
      url: '/worker-settings/workers',
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
      url: '/worker-settings/workers/home-mac',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/worker-settings',
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

  describe('host worker types', () => {
    const headers = { Authorization: 'Bearer test-token' };
    const workerUrl = '/worker-settings/workers/home-mac';
    const current = { enabledWorkerTypes: ['auto', 'codex'], workerTypesRevision: 2 };
    const updated = { enabledWorkerTypes: ['codex'], workerTypesRevision: 3 };
    const payload = { enabledWorkerTypes: ['codex'], expectedRevision: 2, expectedRegistration: '' };

    beforeEach(async () => {
      const services = getServices();
      setServices({ ...services, workerHealthProbe: createWorkerHealthProbe() });
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'registered-client-id',
        cfAccessClientSecret: 'registered-cf-secret',
        dispatchSigningSecret: 'registered-dispatch-secret',
      });
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      payload.expectedRegistration = settings.json<{ data: { workers: [{ registrationKey: string }] } }>().data.workers[0].registrationKey;
    });

    it('rejects an edit prepared before this name was pointed to another host at the same revision', async () => {
      await getServices().workerSettingsRepo.updateWorker('test-user-id', 'home-mac', {
        url: 'https://replacement.example.com',
      });
      const transport = vi.fn().mockResolvedValue(Response.json(orchestratorHealthV2(current)));
      vi.stubGlobal('fetch', transport);
      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(409);
      expect(transport).not.toHaveBeenCalled();
    });

    it('updates the registered host with a route-bound signature and returns masked confirmed settings', async () => {
      const transport: typeof fetch = async (resource, init) => {
        const url = String(resource);
        const sent = new Headers(init?.headers);
        expect(sent.get('CF-Access-Client-Id')).toBe('registered-client-id');
        expect(sent.get('CF-Access-Client-Secret')).toBe('registered-cf-secret');
        if (init?.method === 'GET') {
          expect(url).toBe('https://mac.example.com/health');
          return Response.json(orchestratorHealthV2(current));
        }
        expect(url).toBe('https://mac.example.com/admin/worker-types');
        expect(init?.method).toBe('PUT');
        expect(init?.body).toBe('{"enabledWorkerTypes":["codex"],"expectedRevision":2}');
        const timestamp = sent.get('X-Dispatch-Timestamp');
        const nonce = sent.get('X-Dispatch-Nonce');
        expect(timestamp).toMatch(/^\d+$/u);
        expect(nonce).toMatch(/^[\da-f-]{36}$/u);
        const message = `PUT /admin/worker-types\n${String(timestamp)}.${String(nonce)}.${String(init?.body)}`;
        expect(sent.get('X-Dispatch-Signature')).toBe(
          createHmac('sha256', 'registered-dispatch-secret').update(message).digest('hex')
        );
        return Response.json({ ...updated, otherField: 'must not be exposed' });
      };
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ success: true, data: { updated: true, ...updated } });

      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ success: true, data: { workers: [{ ...updated }] } });
      expect(settings.body).not.toContain('registered-client-id');
      expect(settings.body).not.toContain('registered-cf-secret');
      expect(settings.body).not.toContain('registered-dispatch-secret');
      expect(settings.body).not.toContain('registrationId');
    });

    it.each([
      { enabledWorkerTypes: ['codex'], expectedRevision: 2, url: 'https://other.example.com' },
      { enabledWorkerTypes: ['codex'], expectedRevision: 2, dispatchSigningSecret: 'new-secret' },
      { enabledWorkerTypes: ['codex'], expectedRevision: 2, enabled: false },
      { enabledWorkerTypes: ['codex'], expectedRevision: 2, workerTypesRevision: 2 },
      { enabledWorkerTypes: ['codex', 'codex'], expectedRevision: 2 },
      { enabledWorkerTypes: ['future-worker'], expectedRevision: 2 },
      { enabledWorkerTypes: ['codex'] },
      { enabledWorkerTypes: ['codex'], expectedRevision: '2' },
      { workerTypesRevision: 2 },
    ])('rejects a mixed or malformed policy request %j', async (invalid) => {
      const transport = vi.fn();
      vi.stubGlobal('fetch', transport);
      const result = await app.inject({
        method: 'PATCH', url: workerUrl, headers, payload: { expectedRegistration: payload.expectedRegistration, ...invalid },
      });
      expect(result.statusCode).toBe(400);
      expect(transport).not.toHaveBeenCalled();
    });

    it('requires a user session before attempting to contact a worker', async () => {
      const transport = vi.fn();
      vi.stubGlobal('fetch', transport);
      const result = await app.inject({ method: 'PATCH', url: workerUrl, payload });
      expect(result.statusCode).toBe(401);
      expect(transport).not.toHaveBeenCalled();
    });

    it('requires a nonempty authenticated user identifier to edit policy', async () => {
      const transport = vi.fn();
      vi.stubGlobal('fetch', transport);
      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: '' },
        protectedHeader: new Uint8Array(),
      } as never);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(401);
      expect(transport).not.toHaveBeenCalled();
    });

    it('does not load or contact a worker registered by a different user', async () => {
      const transport = vi.fn();
      vi.stubGlobal('fetch', transport);
      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'different-user-id', email: 'other@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(404);
      expect(transport).not.toHaveBeenCalled();
    });

    it('rejects edits to legacy hosts which omit both policy fields', async () => {
      const transport = vi.fn().mockResolvedValueOnce(Response.json(orchestratorHealthV2()));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(400);
      expect(result.json()).toMatchObject({ error: { message: expect.stringMatching(/does not support/u) } });
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('keeps the last confirmed selection when neither the write nor a fresh read can be confirmed', async () => {
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)))
        .mockRejectedValue(new Error('unavailable'));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ data: { workers: [{ ...current }] } });
    });

    it('recognizes a committed edit when the write response is lost and fresh health confirms it', async () => {
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)))
        .mockRejectedValueOnce(new Error('connection closed'))
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(updated)));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ success: true, data: { updated: true, ...updated } });
    });

    it('reports conflicts while caching the newer policy reported by fresh health', async () => {
      const latest = { enabledWorkerTypes: ['opus'], workerTypesRevision: 3 };
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)))
        .mockResolvedValueOnce(Response.json({}, { status: 409 }))
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(latest)));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(409);
      expect(result.json()).toMatchObject({ error: { code: 'CONFLICT' } });
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ data: { workers: [{ ...latest }] } });
    });

    it('reports a host conflict even when the subsequent health check is unavailable', async () => {
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)))
        .mockResolvedValueOnce(Response.json({}, { status: 409 }))
        .mockResolvedValueOnce(Response.json({}, { status: 503 }));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(409);
      expect(result.json()).toMatchObject({ error: { code: 'CONFLICT' } });
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ data: { workers: [{ ...current }] } });
    });

    it('fails before contacting the host when the stored registration cannot be read', async () => {
      const { firestore } = getServices();
      await firestore.collection('code_worker_settings').doc('test-user-id').update({ workers: 'invalid data' });
      const transport = vi.fn();
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(500);
      expect(result.json()).toMatchObject({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to load worker settings' },
      });
      expect(transport).not.toHaveBeenCalled();
    });

    it('does not write to the host when the initial policy confirmation transaction fails', async () => {
      const transport = vi.fn().mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)));
      vi.stubGlobal('fetch', transport);
      const transaction = vi.spyOn(getServices().firestore, 'runTransaction')
        .mockRejectedValueOnce(new Error('Firestore temporarily unavailable'));

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      transaction.mockRestore();

      expect(result.statusCode).toBe(500);
      expect(result.json()).toMatchObject({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to confirm worker types' },
      });
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('rejects an update when the submitted revision is ahead of the host', async () => {
      const transport = vi.fn().mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({
        method: 'PATCH', url: workerUrl, headers, payload: { ...payload, expectedRevision: 3 },
      });

      expect(result.statusCode).toBe(409);
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('does not replay an edit with an old revision when the host has a different selection', async () => {
      const latest = { enabledWorkerTypes: ['opus'], workerTypesRevision: 3 };
      const transport = vi.fn().mockResolvedValueOnce(Response.json(orchestratorHealthV2(latest)));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(409);
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('confirms a repeat save after an earlier request applied the same selection', async () => {
      const transport = vi.fn().mockResolvedValueOnce(Response.json(orchestratorHealthV2(updated)));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ success: true, data: { updated: true, ...updated } });
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it('can disable all types using the initial revision', async () => {
      const emptyPolicy = { enabledWorkerTypes: [], workerTypesRevision: 1 };
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2({ ...current, workerTypesRevision: 0 })))
        .mockResolvedValueOnce(Response.json(emptyPolicy));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({
        method: 'PATCH', url: workerUrl, headers, payload: { ...payload, enabledWorkerTypes: [], expectedRevision: 0 },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ success: true, data: { updated: true, ...emptyPolicy } });
    });

    it('reports an unreachable host before making any write', async () => {
      const transport = vi.fn().mockRejectedValueOnce(new Error('offline'));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(503);
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it.each([
      { status: 404, returnedStatus: 400, message: /does not support/u },
      { status: 403, returnedStatus: 503, message: /registered credentials/u },
    ])('reports host rejection $status without applying the draft', async ({ status, returnedStatus, message }) => {
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)))
        .mockResolvedValueOnce(Response.json({}, { status }));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(returnedStatus);
      expect(result.json()).toMatchObject({ error: { message: expect.stringMatching(message) } });
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ data: { workers: [{ ...current }] } });
    });

    it('checks fresh health after a malformed write response', async () => {
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)))
        .mockResolvedValueOnce(Response.json({ ...updated, workerTypesRevision: '3' }))
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)));
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(503);
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ data: { workers: [{ ...current }] } });
    });

    it('discards a confirmed response when the endpoint changed while the request was in flight', async () => {
      const transport: typeof fetch = async (_resource, init) => {
        if (init?.method === 'GET') return Response.json(orchestratorHealthV2(current));
        await getServices().workerSettingsRepo.updateWorker('test-user-id', 'home-mac', {
          url: 'https://replacement.example.com',
        });
        return Response.json(updated);
      };
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(409);
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      const body = settings.json<{ data: { workers: unknown[] } }>();
      expect(body.data.workers[0]).toMatchObject({ url: 'https://replacement.example.com' });
      expect(body.data.workers[0]).not.toHaveProperty('workerTypesRevision');
    });

    it('rejects an acknowledgement superseded by a concurrent policy edit', async () => {
      const concurrent = { enabledWorkerTypes: ['opus'] as const, workerTypesRevision: 4 };
      const transport: typeof fetch = async (_resource, init) => {
        if (init?.method === 'GET') return Response.json(orchestratorHealthV2(current));
        const repo = getServices().workerSettingsRepo;
        const worker = await repo.getWorkerByName('test-user-id', 'home-mac');
        if (!worker.ok || worker.value === null) throw new Error('Missing worker fixture');
        await repo.confirmWorkerTypePolicy('test-user-id', worker.value, {
          enabledWorkerTypes: [...concurrent.enabledWorkerTypes],
          workerTypesRevision: concurrent.workerTypesRevision,
        });
        return Response.json(updated);
      };
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(409);
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ data: { workers: [{ ...concurrent }] } });
    });

    it('rejects a policy readback from a registration replaced after the host write failed', async () => {
      const transport = vi.fn()
        .mockResolvedValueOnce(Response.json(orchestratorHealthV2(current)))
        .mockResolvedValueOnce(Response.json({}, { status: 502 }))
        .mockImplementationOnce(async () => {
          await getServices().workerSettingsRepo.updateWorker('test-user-id', 'home-mac', {
            url: 'https://replacement.example.com',
          });
          return Response.json(orchestratorHealthV2(updated));
        });
      vi.stubGlobal('fetch', transport);

      const result = await app.inject({ method: 'PATCH', url: workerUrl, headers, payload });
      expect(result.statusCode).toBe(409);
      expect(result.json()).toMatchObject({ error: { message: expect.stringMatching(/registration changed/u) } });
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      const body = settings.json<{ data: { workers: unknown[] } }>();
      expect(body.data.workers[0]).toMatchObject({ url: 'https://replacement.example.com' });
      expect(body.data.workers[0]).not.toHaveProperty('workerTypesRevision');
    });

    it('projects current policy and safe auth status in refresh and cached status responses', async () => {
      const transport = vi.fn().mockResolvedValueOnce(Response.json(orchestratorHealthV2({
        ...updated,
        workerAuths: {
          claude: { status: 'disabled', authMode: null, message: 'private auth message', accessToken: 'private token' },
          codex: { status: 'active', authMode: 'chatgpt', refreshSupported: true },
        },
      })));
      vi.stubGlobal('fetch', transport);

      for (const [method, url] of [
        ['POST', '/workers/refresh-status'],
        ['GET', '/workers/status'],
      ] as const) {
        const status = await app.inject({ method, url, headers });
        expect(status.statusCode).toBe(200);
        expect(status.json()).toMatchObject({
          data: {
            workers: [{
              details: {
                ...updated,
                workerAuths: {
                  claude: { status: 'disabled', authMode: null },
                  codex: { status: 'active', authMode: 'chatgpt', refreshSupported: true },
                },
              },
            }],
          },
        });
        expect(status.body).not.toContain('private auth message');
        expect(status.body).not.toContain('private token');
      }
      const settings = await app.inject({ method: 'GET', url: '/worker-settings', headers });
      expect(settings.json()).toMatchObject({ data: { workers: [{ ...updated }] } });
    });
  });

  it('DELETE /code/worker-settings/workers/:name removes the worker', async () => {
    await app.inject({
      method: 'POST',
      url: '/worker-settings/workers',
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
      url: '/worker-settings/workers/home-mac',
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
      url: '/worker-settings/workers',
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
