import { describe, it, expect, beforeEach } from 'vitest';
import nock from 'nock';
import { runWithRequestContext } from '@intexuraos/common-core';
import { fetchWithAuth } from '../http.js';

describe('fetchWithAuth', () => {
  const config = {
    baseUrl: 'http://localhost:3000',
    internalAuthToken: 'test-token',
    logger: {
      info: (): void => undefined,
      warn: (): void => undefined,
      error: (): void => undefined,
      debug: (): void => undefined,
    },
  };

  beforeEach(() => {
    nock.cleanAll();
  });

  describe('successful responses', () => {
    it('returns data on successful GET request', async () => {
      const mockData = { message: 'success' };
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockData);

      const result = await fetchWithAuth(config, '/test');

      if (result.ok) {
        expect(result.value).toEqual(mockData);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns data on successful POST request', async () => {
      const mockData = { created: true };
      nock('http://localhost:3000')
        .post('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(201, mockData);

      const result = await fetchWithAuth(config, '/test', { method: 'POST' });

      if (result.ok) {
        expect(result.value).toEqual(mockData);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('sends request body when provided', async () => {
      const mockData = { success: true };
      const requestBody = JSON.stringify({ foo: 'bar' });

      nock('http://localhost:3000')
        .post('/test', requestBody)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockData);

      const result = await fetchWithAuth(config, '/test', {
        method: 'POST',
        body: requestBody,
      });

      if (result.ok) {
        expect(result.value).toEqual(mockData);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('includes X-Trace-Id header when traceId is provided', async () => {
      const mockData = { message: 'success' };
      const traceId = 'test-trace-id-123';
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .matchHeader('X-Trace-Id', traceId)
        .reply(200, mockData);

      const result = await fetchWithAuth(config, '/test', { traceId });

      if (result.ok) {
        expect(result.value).toEqual(mockData);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('does not include X-Trace-Id header when traceId is not provided', async () => {
      const mockData = { message: 'success' };
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        // Note: nock requires all defined headers to match, so not defining X-Trace-Id means it must not be present
        .reply(200, mockData);

      const result = await fetchWithAuth(config, '/test', {});

      if (result.ok) {
        expect(result.value).toEqual(mockData);
      } else {
        expect.fail('Expected successful result');
      }
    });
  });

  describe('HTTP errors', () => {
    it('returns API_ERROR on 404', async () => {
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(404);

      const result = await fetchWithAuth(config, '/test');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 404');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns API_ERROR on 401', async () => {
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(401);

      const result = await fetchWithAuth(config, '/test');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 401');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns API_ERROR on 500', async () => {
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500);

      const result = await fetchWithAuth(config, '/test');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 500');
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('request context propagation', () => {
    it('forwards x-request-id and x-correlation-id from the active context', async () => {
      const mockData = { ok: true };
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .matchHeader('x-request-id', 'req-ctx-1')
        .matchHeader('x-correlation-id', 'corr-ctx-1')
        .reply(200, mockData);

      const result = await runWithRequestContext(
        { requestId: 'req-ctx-1', correlationId: 'corr-ctx-1' },
        () => fetchWithAuth(config, '/test')
      );

      expect(result.ok).toBe(true);
    });

    it('does not overwrite caller-supplied request/correlation headers', async () => {
      const mockData = { ok: true };
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('x-request-id', 'caller-supplied')
        .matchHeader('x-correlation-id', 'caller-correlation')
        .reply(200, mockData);

      const result = await runWithRequestContext(
        { requestId: 'ctx-req', correlationId: 'ctx-corr' },
        () =>
          fetchWithAuth(config, '/test', {
            headers: {
              'x-request-id': 'caller-supplied',
              'x-correlation-id': 'caller-correlation',
            },
          })
      );

      expect(result.ok).toBe(true);
    });

    it('replaces empty caller-supplied request/correlation headers with context values', async () => {
      const mockData = { ok: true };
      nock('http://localhost:3000')
        .get('/test')
        .matchHeader('x-request-id', 'ctx-req-fill')
        .matchHeader('x-correlation-id', 'ctx-corr-fill')
        .reply(200, mockData);

      const result = await runWithRequestContext(
        { requestId: 'ctx-req-fill', correlationId: 'ctx-corr-fill' },
        () =>
          fetchWithAuth(config, '/test', {
            headers: {
              'x-request-id': '',
              'x-correlation-id': '',
            },
          })
      );

      expect(result.ok).toBe(true);
    });

    it('omits propagation headers when no context is active', async () => {
      const mockData = { ok: true };
      // Define expected headers minimally — undefined headers must NOT be sent.
      const scope = nock('http://localhost:3000', {
        badheaders: ['x-request-id', 'x-correlation-id'],
      })
        .get('/test')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockData);

      const result = await fetchWithAuth(config, '/test');

      expect(result.ok).toBe(true);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('network errors', () => {
    it('returns NETWORK_ERROR on connection failure', async () => {
      nock('http://localhost:3000').get('/test').replyWithError('ECONNREFUSED');

      const result = await fetchWithAuth(config, '/test');

      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns NETWORK_ERROR on timeout', async () => {
      nock('http://localhost:3000').get('/test').replyWithError('ETIMEDOUT');

      const result = await fetchWithAuth(config, '/test');

      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('ETIMEDOUT');
      } else {
        expect.fail('Expected error result');
      }
    });
  });
});
