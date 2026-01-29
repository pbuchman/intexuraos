/**
 * Tests for page preview endpoint (/internal/notion/users/:userId/pages/:pageId/preview)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { FakeConnectionRepository, MockNotionApiAdapter } from './fakes.js';
import type { FastifyInstance } from 'fastify';

describe('GET /internal/notion/users/:userId/pages/:pageId/preview', () => {
  let app: FastifyInstance;
  let fakeRepo: FakeConnectionRepository;
  let mockNotionApi: MockNotionApiAdapter;
  const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

  beforeEach(async () => {
    // Set environment variable for internal auth
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;

    fakeRepo = new FakeConnectionRepository();
    mockNotionApi = new MockNotionApiAdapter();
    setServices({ connectionRepository: fakeRepo, notionApi: mockNotionApi });
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    mockNotionApi.clear();
  });

  const validHeaders = { 'x-internal-auth': TEST_INTERNAL_TOKEN };

  describe('authentication', () => {
    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/page123/preview',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Internal-Auth header is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/page123/preview',
        headers: { 'x-internal-auth': 'wrong-key' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('user connection validation', () => {
    it('returns 404 when user has no Notion connection', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/page123/preview',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('User has no active Notion connection');
    });

    it('returns 404 when user connection exists but is disconnected', async () => {
      fakeRepo.setConnection('user123', {
        connected: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/page123/preview',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('User has no active Notion connection');
    });
  });

  describe('page preview fetch', () => {
    beforeEach(() => {
      // Set up connected user with token
      fakeRepo.setConnection('user123', {
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
      fakeRepo.setToken('user123', 'secret_token123');
    });

    it('returns 200 with page title and url on success', async () => {
      mockNotionApi.setPage('page123', 'My Research Page', 'Sample content');

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/page123/preview',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { title: string; url: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('My Research Page');
      expect(body.data.url).toBe('https://notion.so/page123');
    });

    it('returns 404 when page is not found in Notion', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/nonexistent/preview',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Page not found or not accessible');
    });

    it('returns 404 when page is marked as inaccessible', async () => {
      mockNotionApi.setPageInaccessible('inaccessible-page');

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/inaccessible-page/preview',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Page not found or not accessible');
    });

    it('returns 502 when Notion API fails with other error', async () => {
      mockNotionApi.setNextError({ code: 'RATE_LIMITED', message: 'Rate limited' });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/pages/page123/preview',
        headers: validHeaders,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Rate limited');
    });
  });
});
