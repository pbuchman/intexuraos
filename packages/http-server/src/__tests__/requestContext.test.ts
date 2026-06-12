/**
 * Tests for the Fastify `registerRequestContext` integration.
 *
 * Plan §3 acceptance: an inbound `x-request-id` is recoverable inside any
 * route handler via `getRequestId()`; absent header → freshly generated UUID.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRequestContext, getRequestId } from '@intexuraos/common-core';
import {
  buildRequestContext,
  registerRequestContext,
  X_REQUEST_ID,
  X_CORRELATION_ID,
} from '../requestContext.js';

describe('buildRequestContext', () => {
  function fakeRequest(headers: Record<string, string | string[] | undefined>): {
    headers: Record<string, string | string[] | undefined>;
  } {
    return { headers };
  }

  it('populates requestId and correlationId from inbound headers', () => {
    const ctx = buildRequestContext(
      fakeRequest({
        [X_REQUEST_ID]: 'req-abc',
        [X_CORRELATION_ID]: 'corr-xyz',
      }) as unknown as Parameters<typeof buildRequestContext>[0]
    );
    expect(ctx).toEqual({
      requestId: 'req-abc',
      correlationId: 'corr-xyz',
    });
  });

  it('mirrors requestId into correlationId when correlation header is missing', () => {
    const ctx = buildRequestContext(
      fakeRequest({ [X_REQUEST_ID]: 'req-only' }) as unknown as Parameters<
        typeof buildRequestContext
      >[0]
    );
    expect(ctx.correlationId).toBe('req-only');
  });

  it('generates a UUID when no request id is supplied', () => {
    const ctx = buildRequestContext(
      fakeRequest({}) as unknown as Parameters<typeof buildRequestContext>[0]
    );
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.correlationId).toBe(ctx.requestId);
  });

  it('reads the first non-empty entry when the header is an array', () => {
    const ctx = buildRequestContext(
      fakeRequest({ [X_REQUEST_ID]: ['array-id', 'second'] }) as unknown as Parameters<
        typeof buildRequestContext
      >[0]
    );
    expect(ctx.requestId).toBe('array-id');
  });

  it('treats an empty string header as missing', () => {
    const ctx = buildRequestContext(
      fakeRequest({ [X_REQUEST_ID]: '' }) as unknown as Parameters<typeof buildRequestContext>[0]
    );
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falls back to a UUID when the header array is empty or contains only empty entries', () => {
    const fromEmpty = buildRequestContext(
      fakeRequest({ [X_REQUEST_ID]: [] }) as unknown as Parameters<typeof buildRequestContext>[0]
    );
    expect(fromEmpty.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const fromBlank = buildRequestContext(
      fakeRequest({ [X_REQUEST_ID]: [''] }) as unknown as Parameters<typeof buildRequestContext>[0]
    );
    expect(fromBlank.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reads correlation id from a header array', () => {
    const ctx = buildRequestContext(
      fakeRequest({
        [X_REQUEST_ID]: 'r-1',
        [X_CORRELATION_ID]: ['c-1', 'c-2'],
      }) as unknown as Parameters<typeof buildRequestContext>[0]
    );
    expect(ctx.correlationId).toBe('c-1');
  });
});

describe('registerRequestContext (Fastify integration)', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
    registerRequestContext(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes the inbound x-request-id via getRequestId() inside a handler', async () => {
    let observed: string | undefined;
    app.get('/probe', (_req, reply) => {
      observed = getRequestId();
      return reply.send({ ok: true });
    });

    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { [X_REQUEST_ID]: 'inbound-req-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(observed).toBe('inbound-req-1');
  });

  it('generates a UUID when no x-request-id is supplied', async () => {
    let observed: string | undefined;
    app.get('/probe', (_req, reply) => {
      observed = getRequestId();
      return reply.send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/probe' });
    expect(observed).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes correlationId equal to requestId when no x-correlation-id is sent', async () => {
    let ctxObserved: ReturnType<typeof getRequestContext>;
    app.get('/probe', (_req, reply) => {
      ctxObserved = getRequestContext();
      return reply.send({ ok: true });
    });

    await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { [X_REQUEST_ID]: 'edge-req' },
    });

    expect(ctxObserved?.requestId).toBe('edge-req');
    expect(ctxObserved?.correlationId).toBe('edge-req');
  });

  it('isolates contexts across concurrent requests', async () => {
    const seen: (string | undefined)[] = [];
    app.get('/probe/:n', async (request, reply) => {
      // Insert a tiny delay so requests overlap.
      const delay = (request.params as { n: string }).n === '1' ? 10 : 1;
      await new Promise((r) => setTimeout(r, delay));
      seen.push(getRequestId());
      return reply.send({ ok: true });
    });

    await Promise.all([
      app.inject({ method: 'GET', url: '/probe/1', headers: { [X_REQUEST_ID]: 'A' } }),
      app.inject({ method: 'GET', url: '/probe/2', headers: { [X_REQUEST_ID]: 'B' } }),
    ]);

    expect(seen.sort()).toEqual(['A', 'B']);
  });
});
