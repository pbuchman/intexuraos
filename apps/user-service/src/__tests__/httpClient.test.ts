/**
 * Tests for HTTP client utility
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { postFormUrlEncoded, toFormUrlEncodedBody } from '../routes/httpClient.js';
import https from 'node:https';
import { EventEmitter } from 'node:events';

describe('httpClient utilities', () => {
  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });
  afterAll(() => {
    nock.enableNetConnect();
  });
  beforeEach(() => {
    nock.cleanAll();
  });
  describe('toFormUrlEncodedBody', () => {
    it('encodes simple key-value pairs', () => {
      const result = toFormUrlEncodedBody({ foo: 'bar', baz: 'qux' });
      expect(result).toBe('foo=bar&baz=qux');
    });
    it('encodes special characters', () => {
      const result = toFormUrlEncodedBody({ 'key with space': 'value=with&special' });
      expect(result).toBe('key%20with%20space=value%3Dwith%26special');
    });
    it('handles empty object', () => {
      const result = toFormUrlEncodedBody({});
      expect(result).toBe('');
    });
  });
  describe('postFormUrlEncoded', () => {
    it('sends POST request and parses JSON response', async () => {
      nock('https://api.example.com').post('/endpoint').reply(200, { status: 'ok' });
      const result = await postFormUrlEncoded('https://api.example.com/endpoint', 'key=value');
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ status: 'ok' });
    });
    it('handles non-JSON response', async () => {
      nock('https://api.example.com')
        .post('/endpoint')
        .reply(200, 'plain text', { 'Content-Type': 'text/plain' });
      const result = await postFormUrlEncoded('https://api.example.com/endpoint', 'key=value');
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ raw: 'plain text' });
    });
    it('handles malformed JSON response gracefully', async () => {
      nock('https://api.example.com')
        .post('/endpoint')
        .reply(200, '{invalid: json}', { 'Content-Type': 'application/json' });
      const result = await postFormUrlEncoded('https://api.example.com/endpoint', 'key=value');
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ raw: '{invalid: json}' });
    });
    it('handles empty response', async () => {
      nock('https://api.example.com').post('/endpoint').reply(204, '');
      const result = await postFormUrlEncoded('https://api.example.com/endpoint', 'key=value');
      expect(result.status).toBe(204);
      expect(result.body).toBeNull();
    });
    it('handles error status codes', async () => {
      nock('https://api.example.com').post('/endpoint').reply(400, { error: 'bad_request' });
      const result = await postFormUrlEncoded('https://api.example.com/endpoint', 'key=value');
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'bad_request' });
    });
    it('rejects on network error', async () => {
      nock('https://api.example.com').post('/endpoint').replyWithError('Connection refused');
      await expect(
        postFormUrlEncoded('https://api.example.com/endpoint', 'key=value')
      ).rejects.toThrow('Connection refused');
    });
    it('handles URL with explicit port', async () => {
      nock('https://api.example.com:8443').post('/endpoint').reply(200, { status: 'ok' });
      const result = await postFormUrlEncoded('https://api.example.com:8443/endpoint', 'key=value');
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ status: 'ok' });
    });

    it('handles response with undefined statusCode', async () => {
      // Mock the https.request to return a response with undefined statusCode
      const originalRequest = https.request;

      // Create properly typed mock objects
      interface MockRequest extends EventEmitter {
        end: (body: string, encoding: string) => void;
      }

      interface MockResponse extends EventEmitter {
        statusCode?: number;
      }

      type ResponseCallback = (res: MockResponse) => void;

      const mockRequest = vi.fn((_options, callback: ResponseCallback | undefined) => {
        const req = new EventEmitter() as MockRequest;
        req.end = vi.fn((_body: string, _encoding: string): void => {
          // Create a mock response with undefined statusCode (by not setting it)
          const res = new EventEmitter() as MockResponse;
          // Don't set statusCode - leave it undefined to test the ?? 0 fallback

          // Call the callback with our mock response
          if (callback !== undefined) {
            callback(res);
          }

          // Simulate data and end events
          setImmediate(() => {
            res.emit('data', Buffer.from('{"status":"ok"}'));
            res.emit('end');
          });
        });
        return req;
      });

      // Temporarily replace https.request with our mock
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      https.request = mockRequest as any;

      try {
        const result = await postFormUrlEncoded('https://api.example.com/endpoint', 'key=value');
        expect(result.status).toBe(0);
        expect(result.body).toEqual({ status: 'ok' });
      } finally {
        // Restore original
        https.request = originalRequest;
      }
    });
  });
});
