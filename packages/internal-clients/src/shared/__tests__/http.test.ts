import { describe, it, expect, beforeEach } from 'vitest';
import nock from 'nock';
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
