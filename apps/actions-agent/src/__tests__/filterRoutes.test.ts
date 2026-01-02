/**
 * Tests for action filter routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeActionServiceClient,
  FakeResearchServiceClient,
  FakeNotificationSender,
  FakeActionRepository,
  FakeActionFiltersRepository,
  FakeActionEventPublisher,
  createFakeServices,
} from './fakes.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization as string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const payloadBase64 = token.split('.')[1];
          if (payloadBase64 !== undefined) {
            const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString()) as {
              sub?: string;
            };
            if (payload.sub !== undefined) {
              return { userId: payload.sub };
            }
          }
        } catch {
          /* Invalid token format */
        }
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';
const TEST_USER_ID = 'user-123';
const MOCK_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

describe('Action Filter Routes', () => {
  let app: FastifyInstance;
  let fakeFiltersRepo: FakeActionFiltersRepository;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://example.auth.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://example.auth.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'test-audience';

    fakeFiltersRepo = new FakeActionFiltersRepository();

    setServices(
      createFakeServices({
        actionServiceClient: new FakeActionServiceClient(),
        researchServiceClient: new FakeResearchServiceClient(),
        notificationSender: new FakeNotificationSender(),
        actionRepository: new FakeActionRepository(),
        actionFiltersRepository: fakeFiltersRepo,
        actionEventPublisher: new FakeActionEventPublisher(),
      })
    );

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /actions/filters', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/actions/filters',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns empty filters for new user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/actions/filters',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { userId: string; options: { status: string[]; type: string[] }; savedFilters: [] };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(TEST_USER_ID);
      expect(body.data.options.status).toEqual([]);
      expect(body.data.options.type).toEqual([]);
      expect(body.data.savedFilters).toEqual([]);
    });

    it('returns existing filters for user', async () => {
      await fakeFiltersRepo.addOption(TEST_USER_ID, 'status', 'pending');
      await fakeFiltersRepo.addOption(TEST_USER_ID, 'type', 'research');
      await fakeFiltersRepo.addSavedFilter(TEST_USER_ID, {
        name: 'Active Research',
        status: 'pending',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/actions/filters',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          options: { status: string[]; type: string[] };
          savedFilters: { name: string; status?: string }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.options.status).toContain('pending');
      expect(body.data.options.type).toContain('research');
      expect(body.data.savedFilters).toHaveLength(1);
      expect(body.data.savedFilters[0]?.name).toBe('Active Research');
      expect(body.data.savedFilters[0]?.status).toBe('pending');
    });

    it('returns 500 when repository throws', async () => {
      fakeFiltersRepo.setFail(true);

      const response = await app.inject({
        method: 'GET',
        url: '/actions/filters',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /actions/filters/saved', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        payload: { name: 'Test Filter' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates saved filter with name only', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'My Actions' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { id: string; name: string; createdAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('My Actions');
      expect(body.data.id).toBeDefined();
      expect(body.data.createdAt).toBeDefined();
    });

    it('creates saved filter with status', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Pending Items', status: 'pending' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { name: string; status: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Pending Items');
      expect(body.data.status).toBe('pending');
    });

    it('creates saved filter with type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Research Only', type: 'research' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { name: string; type: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Research Only');
      expect(body.data.type).toBe('research');
    });

    it('creates saved filter with status and type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Active Research', status: 'pending', type: 'research' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { name: string; status: string; type: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Active Research');
      expect(body.data.status).toBe('pending');
      expect(body.data.type).toBe('research');
    });

    it('returns 400 when name is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { status: 'pending' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when name is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when status is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Test', status: 'invalid_status' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when type is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Test', type: 'invalid_type' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 on repository failure', async () => {
      fakeFiltersRepo.setFail(true);

      const response = await app.inject({
        method: 'POST',
        url: '/actions/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Test Filter' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /actions/filters/saved/:id', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/actions/filters/saved/filter-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('deletes existing saved filter', async () => {
      const savedFilter = await fakeFiltersRepo.addSavedFilter(TEST_USER_ID, {
        name: 'Test Filter',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/actions/filters/saved/${savedFilter.id}`,
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 404 when filter not found', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/actions/filters/saved/nonexistent-filter-id',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when user has no filter data', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/actions/filters/saved/any-filter-id',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 on repository failure', async () => {
      await fakeFiltersRepo.addSavedFilter(TEST_USER_ID, { name: 'Test Filter' });
      fakeFiltersRepo.setFail(true);

      const response = await app.inject({
        method: 'DELETE',
        url: '/actions/filters/saved/some-filter-id',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
