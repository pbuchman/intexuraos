/**
 * Tests for the IntexuraOSError-aware Fastify error handler.
 *
 * Plan §8 acceptance: 4xx typed → no Sentry, 5xx typed → Sentry,
 * plain Error → generic 500 + Sentry.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { IntexuraOSError, runWithRequestContext } from '@intexuraos/common-core';
import { createErrorHandler } from '../errorHandler.js';

function createMockReply(): {
  reply: FastifyReply;
  statusFn: ReturnType<typeof vi.fn>;
  failFn: ReturnType<typeof vi.fn>;
} {
  const statusFn = vi.fn().mockReturnThis();
  const failFn = vi.fn().mockResolvedValue(undefined);
  const reply = {
    status: statusFn,
    fail: failFn,
  } as unknown as FastifyReply;
  return { reply, statusFn, failFn };
}

function createMockRequest(): {
  request: FastifyRequest;
  logErrorFn: ReturnType<typeof vi.fn>;
} {
  const logErrorFn = vi.fn();
  const request = {
    log: {
      error: logErrorFn,
    },
  } as unknown as FastifyRequest;
  return { request, logErrorFn };
}

describe('createErrorHandler', () => {
  it('returns the typed status, code, message, and details for IntexuraOSError', async () => {
    const handler = createErrorHandler();
    const { reply, statusFn, failFn } = createMockReply();
    const { request } = createMockRequest();

    const err = new IntexuraOSError('NOT_FOUND', 'Resource missing', { id: '42' });

    await handler(err as unknown as FastifyError, request, reply);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(failFn).toHaveBeenCalledWith('NOT_FOUND', 'Resource missing', undefined, { id: '42' });
  });

  it('does NOT call captureException for 4xx IntexuraOSError', async () => {
    const captureException = vi.fn();
    const handler = createErrorHandler({ captureException });
    const { reply } = createMockReply();
    const { request } = createMockRequest();

    const err = new IntexuraOSError('UNAUTHORIZED', 'no token');

    await handler(err as unknown as FastifyError, request, reply);

    expect(captureException).not.toHaveBeenCalled();
  });

  it('calls captureException for 5xx IntexuraOSError', async () => {
    const captureException = vi.fn();
    const handler = createErrorHandler({ captureException });
    const { reply } = createMockReply();
    const { request } = createMockRequest();

    const err = new IntexuraOSError('DOWNSTREAM_ERROR', 'upstream blew up');

    await handler(err as unknown as FastifyError, request, reply);

    expect(captureException).toHaveBeenCalledWith(err);
  });

  it('maps plain Error to a generic 500 INTERNAL_ERROR and calls captureException', async () => {
    const captureException = vi.fn();
    const handler = createErrorHandler({ captureException });
    const { reply, statusFn, failFn } = createMockReply();
    const { request, logErrorFn } = createMockRequest();

    const err = new Error('boom') as FastifyError;

    await handler(err, request, reply);

    expect(statusFn).toHaveBeenCalledWith(500);
    expect(failFn).toHaveBeenCalledWith('INTERNAL_ERROR', 'Internal Server Error');
    expect(captureException).toHaveBeenCalledWith(err);
    expect(logErrorFn).toHaveBeenCalledWith(
      expect.objectContaining({ err, requestId: undefined }),
      'Unhandled error'
    );
  });

  it('logs IntexuraOSError with requestId from request context', async () => {
    const handler = createErrorHandler();
    const { reply } = createMockReply();
    const { request, logErrorFn } = createMockRequest();

    const err = new IntexuraOSError('CONFLICT', 'duplicate');

    await runWithRequestContext({ requestId: 'r-99', correlationId: 'r-99' }, async () => {
      await handler(err as unknown as FastifyError, request, reply);
    });

    expect(logErrorFn).toHaveBeenCalledWith(
      expect.objectContaining({
        err,
        requestId: 'r-99',
        code: 'CONFLICT',
        statusCode: 409,
      }),
      'Request failed'
    );
  });

  it('handles plain Error without captureException option (no throw)', async () => {
    const handler = createErrorHandler();
    const { reply, statusFn, failFn } = createMockReply();
    const { request } = createMockRequest();

    await handler(new Error('boom') as FastifyError, request, reply);

    expect(statusFn).toHaveBeenCalledWith(500);
    expect(failFn).toHaveBeenCalledWith('INTERNAL_ERROR', 'Internal Server Error');
  });

  it('handles 5xx IntexuraOSError without captureException option (no throw)', async () => {
    const handler = createErrorHandler();
    const { reply, statusFn } = createMockReply();
    const { request } = createMockRequest();

    const err = new IntexuraOSError('INTERNAL_ERROR', 'oops');

    await handler(err as unknown as FastifyError, request, reply);

    expect(statusFn).toHaveBeenCalledWith(500);
  });
});
