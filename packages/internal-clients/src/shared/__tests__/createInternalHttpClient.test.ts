import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { runWithRequestId } from '@intexuraos/common-http';
import { runWithRequestContext } from '@intexuraos/common-core';
import { createInternalHttpClient } from '../createInternalHttpClient.js';

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const BASE = 'https://svc.test';

beforeEach(() => {
  nock.cleanAll();
  noopLogger.warn.mockReset();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createInternalHttpClient', () => {
  it('200 OK: POSTs body, sends auth + content-type, unwraps envelope', async () => {
    nock(BASE)
      .post('/internal/foo', { q: 1 })
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('content-type', 'application/json')
      .reply(200, { success: true, data: { y: 2 } });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<{ y: number }>({
      method: 'POST',
      path: '/internal/foo',
      body: { q: 1 },
    });
    expect(result).toEqual({ ok: true, value: { y: 2 } });
  });

  it('propagates X-Request-Id from AsyncLocalStorage', async () => {
    nock(BASE)
      .get('/internal/bar')
      .matchHeader('x-request-id', 'req-xyz')
      .reply(200, { success: true, data: { ok: true } });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await runWithRequestId('req-xyz', async () =>
      client.request<{ ok: boolean }>({
        method: 'GET',
        path: '/internal/bar',
      })
    );
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('prefers request context requestId and forwards correlation id when available', async () => {
    nock(BASE)
      .get('/internal/context')
      .matchHeader('x-request-id', 'ctx-request-id')
      .matchHeader('x-correlation-id', 'ctx-correlation-id')
      .reply(200, { success: true, data: { ok: true } });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await runWithRequestContext(
      { requestId: 'ctx-request-id', correlationId: 'ctx-correlation-id' },
      async () =>
        client.request<{ ok: boolean }>({
          method: 'GET',
          path: '/internal/context',
        })
    );

    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('explicit requestId overrides ALS-provided value', async () => {
    nock(BASE)
      .get('/internal/baz')
      .matchHeader('x-request-id', 'override')
      .reply(200, { success: true, data: 'ok' });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await runWithRequestId('als-id', async () =>
      client.request<string>({
        method: 'GET',
        path: '/internal/baz',
        requestId: 'override',
      })
    );
    expect(result).toEqual({ ok: true, value: 'ok' });
  });

  it('omits content-type header when no body is sent', async () => {
    let observedHeaders: Record<string, string | string[] | undefined> = {};
    nock(BASE)
      .get('/internal/no-body')
      .reply(function () {
        observedHeaders = this.req.headers;
        return [200, { success: true, data: 'ok' }];
      });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<string>({
      method: 'GET',
      path: '/internal/no-body',
    });
    expect(result.ok).toBe(true);
    expect(observedHeaders['content-type']).toBeUndefined();
  });

  it('non-2xx → API_ERROR with status', async () => {
    nock(BASE).get('/e').reply(500, 'boom');

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<unknown>({
      method: 'GET',
      path: '/e',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 500',
        status: 500,
        statusText: 'Internal Server Error',
        rawText: 'boom',
        body: 'boom',
      },
    });
  });

  it('non-2xx API errors preserve parsed body and raw text for domain mappers', async () => {
    nock(BASE)
      .post('/conflict')
      .reply(409, {
        success: false,
        error: {
          code: 'DUPLICATE',
          message: 'Already exists',
          details: { existingTaskId: 'task-existing' },
        },
      });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<unknown>({
      method: 'POST',
      path: '/conflict',
      body: { id: 'task-new' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 409',
        status: 409,
        statusText: 'Conflict',
        rawText:
          '{"success":false,"error":{"code":"DUPLICATE","message":"Already exists","details":{"existingTaskId":"task-existing"}}}',
        body: {
          success: false,
          error: {
            code: 'DUPLICATE',
            message: 'Already exists',
            details: { existingTaskId: 'task-existing' },
          },
        },
      },
    });
  });

  it('AbortError → TIMEOUT when defaultTimeoutMs exceeded', async () => {
    nock(BASE).get('/slow').delay(150).reply(200, { success: true, data: 'ok' });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
      defaultTimeoutMs: 50,
    });
    const result = await client.request<unknown>({
      method: 'GET',
      path: '/slow',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TIMEOUT');
    }
  });

  it('network failure → NETWORK_ERROR', async () => {
    // Allow connection to a closed port to surface a real network error.
    const previous = nock.isActive();
    nock.cleanAll();
    if (previous) nock.restore();
    try {
      const client = createInternalHttpClient({
        baseUrl: 'http://127.0.0.1:1',
        token: 'secret',
        logger: noopLogger,
      });
      const result = await client.request<unknown>({
        method: 'GET',
        path: '/whatever',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
      expect(noopLogger.warn).toHaveBeenCalled();
    } finally {
      nock.activate();
    }
  });

  it("network failure with messageless error → NETWORK_ERROR with 'unknown' message", async () => {
    // fetch can in principle throw any value; if it lacks `.message`, the
    // helper falls back to the literal 'unknown'. Exercises the
    // `error.message ?? 'unknown'` branch.
    const messagelessError: { message?: string } = {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw messagelessError;
    });
    try {
      const client = createInternalHttpClient({
        baseUrl: BASE,
        token: 'secret',
        logger: noopLogger,
      });
      const result = await client.request<unknown>({
        method: 'GET',
        path: '/no-msg',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toBe('unknown');
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('malformed envelope (non-object body) → MALFORMED_ENVELOPE', async () => {
    // Reply with JSON-encoded string so response.json() parses successfully
    // to a primitive that fails the `{success, ...}` shape check.
    nock(BASE).get('/m').reply(200, JSON.stringify('plain string'), {
      'content-type': 'application/json',
    });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<unknown>({
      method: 'GET',
      path: '/m',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_ENVELOPE');
    }
  });

  it('envelope error path → ENVELOPE_ERROR', async () => {
    nock(BASE)
      .get('/err')
      .reply(200, {
        success: false,
        error: { code: 'X', message: 'm' },
      });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<unknown>({
      method: 'GET',
      path: '/err',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ENVELOPE_ERROR');
    }
  });

  it('allows raw object success payloads when explicitly requested', async () => {
    nock(BASE).post('/raw-success').reply(200, {
      cancelled: true,
    });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<{ cancelled: boolean }>({
      method: 'POST',
      path: '/raw-success',
      allowRawSuccess: true,
    });

    expect(result).toEqual({ ok: true, value: { cancelled: true } });
  });

  it('returns the untouched success envelope for a stricter domain decoder', async () => {
    const envelope = {
      success: true,
      data: { status: 'available' },
      diagnostics: { requestId: 'request-1' },
    };
    nock(BASE).get('/strict-envelope').reply(200, envelope);

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<unknown>({
      method: 'GET',
      path: '/strict-envelope',
      responseMode: 'raw',
    });

    expect(result).toEqual({ ok: true, value: envelope });
  });

  it('extraHeaders are propagated to the outbound request', async () => {
    nock(BASE).get('/h').matchHeader('x-foo', 'bar').reply(200, { success: true, data: 'ok' });

    const client = createInternalHttpClient({
      baseUrl: BASE,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<string>({
      method: 'GET',
      path: '/h',
      extraHeaders: { 'x-foo': 'bar' },
    });
    expect(result).toEqual({ ok: true, value: 'ok' });
  });

  it('normalizes a trailing slash on baseUrl', async () => {
    nock(BASE).get('/internal/foo').reply(200, { success: true, data: 'ok' });

    const client = createInternalHttpClient({
      baseUrl: `${BASE}/`,
      token: 'secret',
      logger: noopLogger,
    });
    const result = await client.request<string>({
      method: 'GET',
      path: '/internal/foo',
    });
    expect(result).toEqual({ ok: true, value: 'ok' });
  });
});
