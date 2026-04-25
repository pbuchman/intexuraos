/**
 * Routes tests for chat-agent.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { setupFakeServices, resetFakeServices } from './fakes.fixture.js';
import {
  setupJwksServer,
  teardownJwksServer,
  createToken,
} from './testUtils.js';
import type { FakeLlmGenerateClient, FakeEmbeddingRepository, FakeUserServiceClient, FakeGuestRateLimiter } from './fakes.fixture.js';
import type { FastifyInstance } from 'fastify';
import { clearJwksCache } from '@intexuraos/common-http';

describe('chat-agent routes', () => {
  let app: FastifyInstance;
  let fakeServices: {
    embeddingRepository: FakeEmbeddingRepository;
    llmGenerateClient: FakeLlmGenerateClient;
    fakeUserServiceClient: FakeUserServiceClient;
    fakeGuestRateLimiter: FakeGuestRateLimiter;
  };

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  beforeEach(async () => {
    clearJwksCache();
    process.env['NODE_ENV'] = 'test';
    const services = setupFakeServices();
    fakeServices = {
      embeddingRepository: services.embeddingRepository as FakeEmbeddingRepository,
      llmGenerateClient: services.llmGenerateClient,
      fakeUserServiceClient: services.fakeUserServiceClient,
      fakeGuestRateLimiter: services.fakeGuestRateLimiter,
    };
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
      // Health status may be 'down' in tests if Firestore is not available
      expect(['ok', 'degraded', 'down']).toContain(body.status);
      expect(body).toMatchObject({
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
    let authToken: string;

    beforeEach(async () => {
      authToken = await createToken({ sub: 'user-123', email: 'test@example.com' });
    });

    describe('authentication', () => {
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

      it('should return 401 with expired token', async () => {
        const expiredToken = await createToken(
          { sub: 'user-123', email: 'test@example.com' },
          { expiresIn: '-1h' }
        );

        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${expiredToken}`,
          },
          payload: {
            message: 'Hello',
            conversationHistory: [],
          },
        });

        expect(response.statusCode).toBe(401);
      });
    });

    describe('request validation', () => {
      it('should return 400 for missing message field', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            conversationHistory: [],
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should return 400 for empty message', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: '   ',
            conversationHistory: [],
          },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
      });

      it('should return 400 for invalid conversation history role', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Hello',
            conversationHistory: [
              { role: 'invalid', content: 'test' },
            ],
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should accept valid request with minimal fields', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Hello',
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('successful responses', () => {
      it('should return 200 with response data', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'How do I create a todo?',
            conversationHistory: [],
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.response).toBeTruthy();
        expect(body.data.sources).toBeInstanceOf(Array);
        expect(body.data.suggestedAction).toBeDefined();
      });

      it('should include sources from documentation', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'How do I create a todo?',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.sources).toBeInstanceOf(Array);
      });

      it('should handle conversation history', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'And how do I complete it?',
            conversationHistory: [
              { role: 'user', content: 'How do I create a todo?' },
              { role: 'assistant', content: 'Use POST /todos' },
            ],
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
      });
    });

    describe('suggested actions', () => {
      it('should return suggested action when LLM provides one', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Create a todo to buy groceries',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.suggestedAction).toBeDefined();
      });

      it('should handle confirmation flow with pending action', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'yes',
            pendingAction: {
              type: 'create_command',
              payload: { text: 'buy groceries', source: 'pwa-shared' },
              awaitingConfirmation: true,
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.suggestedAction?.awaitingConfirmation).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should return 502 when userServiceClient.getLlmClient fails', async () => {
        // Set the userServiceClient to fail on next getLlmClient call
        fakeServices.fakeUserServiceClient.setFailNext(true);

        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Test error',
          },
        });

        // Should return 502 (DOWNSTREAM_ERROR) for LLM client acquisition errors
        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      });

      it('should return 502 when LLM fails', async () => {
        // Set the LLM client to fail mode
        fakeServices.llmGenerateClient.setFailure(true);

        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Test error',
          },
        });

        // Should return 502 (DOWNSTREAM_ERROR) for LLM errors
        expect(response.statusCode).toBe(502);

        // Reset for other tests
        fakeServices.llmGenerateClient.setFailure(false);
      });
    });

    describe('edge cases', () => {
      it('should handle very long conversation history', async () => {
        const longHistory = Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        }));

        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Next question',
            conversationHistory: longHistory,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should handle message with special characters', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Test with émojis 🎉 and sp€cial char$',
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should handle null pendingAction', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            message: 'Hello',
            pendingAction: null,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });
  });

  describe('POST /chat (guest user)', () => {
    describe('session validation', () => {
      it('should return 401 without guest session header', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          payload: {
            message: 'Hello',
          },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
      });

      it('should return 401 with empty guest session header', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            'x-guest-session': '',
          },
          payload: {
            message: 'Hello',
          },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
      });

    });

    describe('rate limiting', () => {
      it('should return 429 when rate limit exceeded', async () => {
        fakeServices.fakeGuestRateLimiter.setBlock(true, 'Rate limit exceeded. Try again in 30 minutes.');

        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            'x-guest-session': 'guest-session-123',
          },
          payload: {
            message: 'Hello',
          },
        });

        expect(response.statusCode).toBe(429);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('RATE_LIMITED');
        expect(body.error.message).toContain('Rate limit exceeded');
      });
    });

    describe('successful responses', () => {
      it('should return 200 for guest with valid session', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            'x-guest-session': 'guest-session-123',
          },
          payload: {
            message: 'How do I create a todo?',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.response).toBeTruthy();
      });

      it('should handle guest conversation history', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/chat',
          headers: {
            'x-guest-session': 'guest-session-123',
          },
          payload: {
            message: 'What about completing it?',
            conversationHistory: [
              { role: 'user', content: 'How do I create a todo?' },
              { role: 'assistant', content: 'Use POST /todos' },
            ],
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
      });
    });
  });

  describe('IP rate limiting', () => {
    it('returns 429 after exceeding the per-IP request budget on /guest-session', async () => {
      // Budget defined in route schema: 10/min. Use a unique remote address
      // so this test doesn't interfere with the per-IP budgets shared by the
      // other tests in this file.
      const responses: number[] = [];
      for (let i = 0; i < 15; i++) {
        const r = await app.inject({
          method: 'POST',
          url: '/guest-session',
          remoteAddress: '203.0.113.7',
        });
        responses.push(r.statusCode);
      }
      expect(responses.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(responses.filter((s) => s === 200).length).toBeLessThanOrEqual(10);
    });
  });

  describe('GET /docs', () => {
    it('should serve Swagger UI', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs',
      });

      // Swagger UI is served directly at /docs route
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });
  });
});
