/**
 * Tests for notification filter routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, type ServiceContainer, setServices } from '../services.js';
import {
  FakeNotificationFiltersRepository,
  FakeNotificationRepository,
  FakeSignatureConnectionRepository,
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

const TEST_USER_ID = 'user-123';
const MOCK_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

describe('Filter Routes', () => {
  let app: FastifyInstance;
  let fakeFiltersRepo: FakeNotificationFiltersRepository;

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    fakeFiltersRepo = new FakeNotificationFiltersRepository();

    const services: ServiceContainer = {
      signatureConnectionRepository: new FakeSignatureConnectionRepository(),
      notificationRepository: new FakeNotificationRepository(),
      notificationFiltersRepository: fakeFiltersRepo,
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /notifications/filters', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications/filters',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns empty filters for new user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications/filters',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { userId: string; options: { app: string[]; device: string[]; source: string[] } };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(TEST_USER_ID);
      expect(body.data.options.app).toEqual([]);
      expect(body.data.options.device).toEqual([]);
      expect(body.data.options.source).toEqual([]);
    });

    it('returns existing filters for user', async () => {
      await fakeFiltersRepo.addOption(TEST_USER_ID, 'app', 'com.whatsapp');
      await fakeFiltersRepo.addOption(TEST_USER_ID, 'device', 'Pixel 7');
      await fakeFiltersRepo.addSavedFilter(TEST_USER_ID, { name: 'Work', app: ['com.gmail'] });

      const response = await app.inject({
        method: 'GET',
        url: '/notifications/filters',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          options: { app: string[]; device: string[] };
          savedFilters: { name: string; app?: string[] }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.options.app).toContain('com.whatsapp');
      expect(body.data.options.device).toContain('Pixel 7');
      expect(body.data.savedFilters).toHaveLength(1);
      expect(body.data.savedFilters[0]?.name).toBe('Work');
    });

    it('returns 500 on repository failure', async () => {
      fakeFiltersRepo.setFail(true);

      const response = await app.inject({
        method: 'GET',
        url: '/notifications/filters',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /notifications/filters/saved', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/filters/saved',
        payload: { name: 'Test Filter' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates saved filter with name only', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Work Emails' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { id: string; name: string; createdAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Work Emails');
      expect(body.data.id).toBeDefined();
      expect(body.data.createdAt).toBeDefined();
    });

    it('creates saved filter with all optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: {
          name: 'Work Emails',
          app: ['com.google.android.gm'],
          device: ['Pixel 7'],
          source: 'mail',
          title: 'meeting',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          name: string;
          app?: string[];
          device?: string[];
          source?: string;
          title?: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Work Emails');
      expect(body.data.app).toEqual(['com.google.android.gm']);
      expect(body.data.device).toEqual(['Pixel 7']);
      expect(body.data.source).toBe('mail');
      expect(body.data.title).toBe('meeting');
    });

    it('returns 400 when name is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { app: ['com.whatsapp'] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 on repository failure', async () => {
      fakeFiltersRepo.setFail(true);

      const response = await app.inject({
        method: 'POST',
        url: '/notifications/filters/saved',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
        payload: { name: 'Test Filter' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /notifications/filters/saved/:id', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/filters/saved/filter-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('deletes existing saved filter', async () => {
      const saveResult = await fakeFiltersRepo.addSavedFilter(TEST_USER_ID, {
        name: 'Test Filter',
      });
      const filterId = saveResult.ok ? saveResult.value.id : '';

      const response = await app.inject({
        method: 'DELETE',
        url: `/notifications/filters/saved/${filterId}`,
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 404 when filter not found', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/filters/saved/nonexistent-filter-id',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 on repository failure', async () => {
      await fakeFiltersRepo.addSavedFilter(TEST_USER_ID, { name: 'Test Filter' });
      fakeFiltersRepo.setFail(true);

      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/filters/saved/some-filter-id',
        headers: {
          authorization: `Bearer ${MOCK_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
