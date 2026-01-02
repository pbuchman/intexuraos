import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import nock from 'nock';
import { buildServer } from '../server.js';
import { setServices, resetServices, setServiceConfig } from '../services.js';
import { FakeDataSourceRepository } from './fakes.js';
import { ok } from '@intexuraos/common-core';

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue(ok('Generated Test Title')),
  })),
}));

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader === 'Bearer valid-token') {
        return { userId: 'user-123' };
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

describe('dataSourceRoutes', () => {
  let fakeRepo: FakeDataSourceRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    fakeRepo = new FakeDataSourceRepository();
    setServices({ dataSourceRepository: fakeRepo });
    setServiceConfig({
      userServiceUrl: 'http://localhost:8110',
      internalAuthToken: 'test-token',
    });
    nock.cleanAll();
  });

  afterEach(() => {
    resetServices();
    fakeRepo.clear();
  });

  describe('POST /data-sources', () => {
    it('creates a new data source', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Test Data Source',
          content: 'This is test content.',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Test Data Source');
      expect(body.data.content).toBe('This is test content.');
      expect(body.data.userId).toBe('user-123');
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources',
        payload: {
          title: 'Test',
          content: 'Content',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('validates required fields', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Test',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeRepo.setFailNextCreate(true);

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Test',
          content: 'Content',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /data-sources', () => {
    it('lists data sources for user', async () => {
      const app = await buildServer();

      await fakeRepo.create('user-123', {
        title: 'Source 1',
        content: 'Content 1',
      });
      await fakeRepo.create('user-123', {
        title: 'Source 2',
        content: 'Content 2',
      });
      await fakeRepo.create('other-user', {
        title: 'Other',
        content: 'Other content',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/data-sources',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('returns empty array when no data sources', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/data-sources',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toEqual([]);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeRepo.setFailNextList(true);

      const response = await app.inject({
        method: 'GET',
        url: '/data-sources',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /data-sources/:id', () => {
    it('gets a data source by id', async () => {
      const app = await buildServer();

      const createResult = await fakeRepo.create('user-123', {
        title: 'Test',
        content: 'Content',
      });
      const dataSource = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/data-sources/${dataSource?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe('Test');
    });

    it('returns 404 for non-existent data source', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/data-sources/non-existent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for other users data source', async () => {
      const app = await buildServer();

      const createResult = await fakeRepo.create('other-user', {
        title: 'Test',
        content: 'Content',
      });
      const dataSource = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/data-sources/${dataSource?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /data-sources/:id', () => {
    it('updates a data source', async () => {
      const app = await buildServer();

      const createResult = await fakeRepo.create('user-123', {
        title: 'Original',
        content: 'Original content',
      });
      const dataSource = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/data-sources/${dataSource?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Updated',
          content: 'Updated content',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe('Updated');
      expect(body.data.content).toBe('Updated content');
    });

    it('allows partial updates', async () => {
      const app = await buildServer();

      const createResult = await fakeRepo.create('user-123', {
        title: 'Original',
        content: 'Original content',
      });
      const dataSource = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/data-sources/${dataSource?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'New Title',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe('New Title');
      expect(body.data.content).toBe('Original content');
    });

    it('returns 404 for non-existent data source', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'PUT',
        url: '/data-sources/non-existent',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Updated',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /data-sources/:id', () => {
    it('deletes a data source', async () => {
      const app = await buildServer();

      const createResult = await fakeRepo.create('user-123', {
        title: 'To Delete',
        content: 'Content',
      });
      const dataSource = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'DELETE',
        url: `/data-sources/${dataSource?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeRepo.getAll()).toHaveLength(0);
    });

    it('returns 404 for non-existent data source', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/data-sources/non-existent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /data-sources/generate-title', () => {
    it('generates a title from content', async () => {
      const app = await buildServer();

      nock('http://localhost:8110')
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { google: 'fake-api-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources/generate-title',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          content: 'This is some test content about machine learning.',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBeDefined();
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources/generate-title',
        payload: {
          content: 'Some content',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 503 when user has no Gemini API key', async () => {
      const app = await buildServer();

      nock('http://localhost:8110')
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { google: null });

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources/generate-title',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          content: 'Some content',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('validates required content field', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources/generate-title',
        headers: { authorization: 'Bearer valid-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('handles user service errors', async () => {
      const app = await buildServer();

      nock('http://localhost:8110')
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500);

      const response = await app.inject({
        method: 'POST',
        url: '/data-sources/generate-title',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          content: 'Some content',
        },
      });

      expect(response.statusCode).toBe(502);
    });
  });
});
