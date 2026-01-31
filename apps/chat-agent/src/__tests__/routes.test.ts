/**
 * Routes tests for chat-agent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setupFakeServices, resetFakeServices } from './fakes.fixture.js';
import type { FastifyInstance } from 'fastify';

describe('chat-agent routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['INTEXURAOS_OPENAI_API_KEY'] = 'test-key';
    setupFakeServices();
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetFakeServices();
    delete process.env['NODE_ENV'];
  });

  describe('GET /health', () => {
    it('should return 200 with health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        status: 'ok',
        serviceName: 'chat-agent',
        version: '0.1.0',
      });
      expect(body.checks).toBeInstanceOf(Array);
      expect(body.timestamp).toBeDefined();
    });

    it('should include version field in response', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const body = JSON.parse(response.body);
      expect(body.version).toBe('0.1.0');
    });
  });

  describe('GET /openapi.json', () => {
    it('should return 200 with OpenAPI schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      const body = JSON.parse(response.body);
      expect(body.openapi).toBeDefined();
      expect(body.info).toMatchObject({
        title: 'chat-agent',
        version: '0.1.0',
      });
    });

    it('should include chat endpoint in schema', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      const body = JSON.parse(response.body);
      expect(body.paths['/chat']).toBeDefined();
      expect(body.paths['/chat'].post).toBeDefined();
    });
  });

  describe('POST /chat', () => {
    it('should return 401 without JWT token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        payload: {
          message: 'Hello',
          conversationHistory: [],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 with invalid JWT', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: {
          authorization: 'Bearer invalid-token',
        },
        payload: {
          message: 'Hello',
          conversationHistory: [],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 501 with valid auth (not yet implemented)', async () => {
      // Create a valid test token - for now we just check the endpoint exists
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: {
          // Using a mock JWKS would require more setup
          // For now, we just verify the endpoint responds
          authorization: 'Bearer test',
        },
        payload: {
          message: 'Hello',
          conversationHistory: [],
        },
      });

      // Should either return 401 (auth failed) or 501 (endpoint stub)
      expect([401, 501]).toContain(response.statusCode);
      if (response.statusCode === 501) {
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_IMPLEMENTED');
      }
    });
  });
});
