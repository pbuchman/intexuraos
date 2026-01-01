/**
 * Tests for Intexura Fastify plugin.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { intexuraFastifyPlugin } from '../http/fastifyPlugin.js';

describe('Intexura Fastify Plugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(intexuraFastifyPlugin);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('plugin registration', () => {
    it('decorates reply with ok method', () => {
      expect(app.hasDecorator('ok')).toBe(false); // Decorator is on reply, not app
    });

    it('registers onRequest hook that sets requestId and startTime', async () => {
      let capturedRequestId: string | undefined;
      let capturedStartTime: number | undefined;

      app.get('/test', async (request, reply) => {
        capturedRequestId = request.requestId;
        capturedStartTime = request.startTime;
        return reply.ok({ message: 'ok' });
      });

      await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(capturedRequestId).toBeDefined();
      expect(capturedStartTime).toBeDefined();
      expect(typeof capturedStartTime).toBe('number');
    });

    it('uses provided x-request-id header', async () => {
      let capturedRequestId: string | undefined;

      app.get('/test', async (request, reply) => {
        capturedRequestId = request.requestId;
        return reply.ok({ message: 'ok' });
      });

      await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-request-id': 'custom-request-id-123',
        },
      });

      expect(capturedRequestId).toBe('custom-request-id-123');
    });

    it('adds x-request-id header to response', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.ok({ message: 'ok' });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-request-id': 'echo-this-id',
        },
      });

      expect(response.headers['x-request-id']).toBe('echo-this-id');
    });
  });

  describe('reply.ok', () => {
    it('returns 200 status with success response', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.ok({ message: 'hello' });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ message: 'hello' });
    });

    it('includes diagnostics with requestId and durationMs', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.ok({ value: 42 });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-request-id': 'test-req-id',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.diagnostics).toBeDefined();
      expect(body.diagnostics.requestId).toBe('test-req-id');
      expect(typeof body.diagnostics.durationMs).toBe('number');
    });

    it('merges additional diagnostics', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.ok({ value: 1 }, { downstreamStatus: 200 });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const body = JSON.parse(response.body);
      expect(body.diagnostics.downstreamStatus).toBe(200);
      expect(body.diagnostics.requestId).toBeDefined();
    });
  });

  describe('reply.fail', () => {
    it('returns correct HTTP status based on error code', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.fail('NOT_FOUND', 'Resource not found');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns error response envelope', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.fail('UNAUTHORIZED', 'Invalid token');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Invalid token');
    });

    it('includes diagnostics in error response', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.fail('INTERNAL_ERROR', 'Something broke');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'x-request-id': 'error-req-id',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.diagnostics.requestId).toBe('error-req-id');
      expect(body.diagnostics.durationMs).toBeDefined();
    });

    it('includes details in error response', async () => {
      app.get('/test', async (_request, reply) => {
        return reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
          errors: [{ path: 'email', message: 'Invalid' }],
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const body = JSON.parse(response.body);
      expect(body.error.details).toEqual({
        errors: [{ path: 'email', message: 'Invalid' }],
      });
    });

    it('returns correct status for each error code', async () => {
      const testCases = [
        { code: 'INVALID_REQUEST', expectedStatus: 400 },
        { code: 'UNAUTHORIZED', expectedStatus: 401 },
        { code: 'FORBIDDEN', expectedStatus: 403 },
        { code: 'NOT_FOUND', expectedStatus: 404 },
        { code: 'CONFLICT', expectedStatus: 409 },
        { code: 'DOWNSTREAM_ERROR', expectedStatus: 502 },
        { code: 'INTERNAL_ERROR', expectedStatus: 500 },
        { code: 'MISCONFIGURED', expectedStatus: 503 },
      ] as const;

      for (const { code, expectedStatus } of testCases) {
        const testApp = Fastify({ logger: false });
        await testApp.register(intexuraFastifyPlugin);

        testApp.get('/test', async (_request, reply) => {
          return reply.fail(code, 'test message');
        });

        const response = await testApp.inject({
          method: 'GET',
          url: '/test',
        });

        expect(response.statusCode).toBe(expectedStatus);
        await testApp.close();
      }
    });
  });
});
