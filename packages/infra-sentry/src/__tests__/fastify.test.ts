/**
 * Tests for Fastify error handler integration.
 *
 * Note: Full integration tests require the common-http plugin which adds
 * the reply.fail() method. These tests verify the error handler behavior
 * for the parts we can test without that plugin.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupSentryErrorHandler } from '../fastify.js';
import * as Sentry from '@sentry/node';
import Fastify, { type FastifyInstance, type FastifyError, type FastifyReply } from 'fastify';

// Mock Sentry - must be defined inline to avoid hoisting issues
vi.mock('@sentry/node', () => {
  const mockSetTag = vi.fn();
  const mockSetContext = vi.fn();
  const mockCaptureException = vi.fn();
  return {
    withScope: vi.fn((callback: (scope: unknown) => void) => {
      callback({ setTag: mockSetTag, setContext: mockSetContext });
    }),
    captureException: mockCaptureException,
  };
});

function addMockFailMethod(app: FastifyInstance): void {
  app.decorateReply('fail', function (
    this: FastifyReply,
    _code: string,
    _message: string,
    _diagnostics?: unknown,
    _details?: unknown
  ) {
    return this.send({ error: _code, message: _message, details: _details });
  });
}

describe('setupSentryErrorHandler', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
    addMockFailMethod(app);
    vi.clearAllMocks();
  });

  it('sends error to Sentry with request context', async () => {
    setupSentryErrorHandler(app);

    // Add a route that throws
    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    // Since we don't have the common-http plugin, we get 500 with Fastify's default error
    expect(response.statusCode).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles Sentry failures gracefully', async () => {
    // Make Sentry.withScope throw
    vi.mocked(Sentry.withScope).mockImplementationOnce(() => {
      throw new Error('Sentry failed');
    });

    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    // Error handling should still work even if Sentry fails
    expect(response.statusCode).toBe(500);
  });

  it('handles 404 routes without errors', async () => {
    setupSentryErrorHandler(app);

    const response = await app.inject({
      method: 'GET',
      url: '/nonexistent',
    });

    expect(response.statusCode).toBe(404);
    // 404s are not errors, so Sentry shouldn't be called
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('handles FST_ERR_CTP_INVALID_JSON_BODY error', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error: Partial<FastifyError> = new Error('Invalid JSON');
      error.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(400);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('handles validation error with non-array validation property', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error = new Error('Validation error') as Error & Partial<{ validation: unknown }>;
      // Validation property exists but is not an array
      error.validation = { some: 'object' };
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('handles error without validation property', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error: Partial<FastifyError> = new Error('Some other error');
      error.code = 'SOME_OTHER_CODE';
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('handles validation error with undefined instancePath', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error = new Error('Validation error') as Error & {
        validation: { instancePath?: string; message?: string }[];
      };
      error.validation = [{ message: 'must be string' }];
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(400);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('handles validation error with undefined message', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error = new Error('Validation error') as Error & {
        validation: { instancePath?: string; message?: string }[];
      };
      error.validation = [{ instancePath: '/field' }];
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(400);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('handles validation error with empty instancePath triggering required property regex', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error = new Error('Validation error') as Error & {
        validation: { instancePath?: string; message?: string }[];
      };
      error.validation = [
        { instancePath: '', message: "must have required property 'name'" },
      ];
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(400);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('handles validation error with empty instancePath and undefined message', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error = new Error('Validation error') as Error & {
        validation: { instancePath?: string; message?: string }[];
      };
      error.validation = [{ instancePath: '' }];
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(400);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('handles validation error with both instancePath and message undefined', async () => {
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      const error = new Error('Validation error') as Error & {
        validation: { instancePath?: string; message?: string }[];
      };
      error.validation = [{}];
      throw error;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(400);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe('sanitizeHeaders (via error handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // We can't directly test sanitizeHeaders since it's not exported,
  // but we can verify sensitive headers don't break the error handler

  it('handles requests with authorization header', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer secret-token' },
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with x-internal-auth header', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-internal-auth': 'secret' },
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with cookie header', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { cookie: 'session=secret' },
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with x-api-key header', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'secret-key' },
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with apikey header', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { apikey: 'secret-key' },
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with array header values', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { accept: ['application/json', 'text/plain'] },
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with empty array header values', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async (request) => {
      (request.headers as Record<string, string | string[] | undefined>)['x-custom'] = [];
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with no special headers', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'content-type': 'application/json', 'user-agent': 'test' },
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('handles requests with no headers', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.get('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(500);
    expect(Sentry.withScope).toHaveBeenCalled();
  });

  it('passes request context to Sentry', async () => {
    const app = Fastify({ logger: false });
    setupSentryErrorHandler(app);

    app.post('/test', async () => {
      throw new Error('Test error');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test',
    });

    expect(response.statusCode).toBe(500);

    // Verify withScope was called (which sets the context)
    expect(Sentry.withScope).toHaveBeenCalledWith(expect.any(Function));
  });
});
