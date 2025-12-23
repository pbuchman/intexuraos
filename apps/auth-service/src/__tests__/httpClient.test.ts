/**
 * Tests for HTTP client utility
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import nock from 'nock';
import { postFormUrlEncoded, toFormUrlEncodedBody } from '../routes/v1/httpClient.js';
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
  });
});
