/**
 * Tests for internal routes (/internal/notion/...)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { FakeConnectionRepository } from './fakes.js';
import type { FastifyInstance } from 'fastify';

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeRepo: FakeConnectionRepository;
  const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

  beforeEach(async () => {
    // Set environment variable for internal auth
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;

    fakeRepo = new FakeConnectionRepository();
    setServices({ connectionRepository: fakeRepo });
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('GET /internal/notion/users/:userId/context', () => {
    it('returns 401 when X-Internal-Auth header is missing', async (): Promise<void> => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/context',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async (): Promise<void> => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/context',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns connected=true and token when user is connected', async (): Promise<void> => {
      // Setup: user has connection with token
      fakeRepo.setConnection('user123', {
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
      fakeRepo.setToken('user123', 'secret_notion_token_abc123');

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/context',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { connected: boolean; token: string | null };
      expect(body.connected).toBe(true);
      expect(body.token).toBe('secret_notion_token_abc123');
    });

    it('returns connected=false and token=null when user is not connected', async (): Promise<void> => {
      // Setup: user has connection but disconnected
      fakeRepo.setConnection('user456', {
        connected: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
      fakeRepo.setToken('user456', null);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user456/context',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { connected: boolean; token: string | null };
      expect(body.connected).toBe(false);
      expect(body.token).toBe(null);
    });

    it('returns connected=false and token=null when user has no connection', async (): Promise<void> => {
      // Setup: user never connected (no data in fake repo)

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/never-connected/context',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { connected: boolean; token: string | null };
      expect(body.connected).toBe(false);
      expect(body.token).toBe(null);
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async (): Promise<void> => {
      // Remove the token from environment
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/context',
        headers: {
          'x-internal-auth': 'any-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns connected=false when isConnected fails', async (): Promise<void> => {
      fakeRepo.setFailNextIsConnected(true);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/notion/users/user123/context',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { connected: boolean; token: string | null };
      expect(body.connected).toBe(false);
      expect(body.token).toBe(null);
    });
  });
});
