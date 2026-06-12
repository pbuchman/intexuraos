import { describe, it, expect, beforeEach } from 'vitest';
import nock from 'nock';
import { fetchLinearAgent } from '../../../../infra/http/linear/linear-fetch-util.js';

describe('fetchLinearAgent', () => {
  const baseUrl = 'http://linear-agent:8086';
  const internalAuthToken = 'test-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  it('returns ok with data on 200 with valid envelope', async () => {
    nock(baseUrl)
      .get('/ping')
      .reply(200, { success: true, data: { value: 42 } });

    const result = await fetchLinearAgent<{ value: number }>({
      url: `${baseUrl}/ping`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data).toEqual({ value: 42 });
    }
  });

  it('sends X-Internal-Auth header always', async () => {
    nock(baseUrl)
      .get('/ping')
      .matchHeader('X-Internal-Auth', internalAuthToken)
      .reply(200, { success: true, data: {} });

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/ping`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('ok');
  });

  it('sends X-User-Id header when userId provided', async () => {
    nock(baseUrl)
      .get('/ping')
      .matchHeader('X-Internal-Auth', internalAuthToken)
      .matchHeader('X-User-Id', 'user-1')
      .reply(200, { success: true, data: {} });

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/ping`,
      method: 'GET',
      internalAuthToken,
      userId: 'user-1',
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('ok');
  });

  it('does not send X-User-Id header when userId absent', async () => {
    nock(baseUrl)
      .get('/ping')
      .reply(function () {
        expect(this.req.headers['x-user-id']).toBeUndefined();
        return [200, { success: true, data: {} }];
      });

    await fetchLinearAgent<unknown>({
      url: `${baseUrl}/ping`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });
  });

  it('sends Content-Type and serialized body when body provided', async () => {
    let captured: unknown;
    nock(baseUrl)
      .post('/create')
      .matchHeader('Content-Type', 'application/json')
      .reply(200, function (_uri, requestBody) {
        captured = requestBody;
        return { success: true, data: {} };
      });

    await fetchLinearAgent<unknown>({
      url: `${baseUrl}/create`,
      method: 'POST',
      internalAuthToken,
      body: { foo: 'bar', n: 1 },
      timeoutMs: 1000,
    });

    expect(captured).toEqual({ foo: 'bar', n: 1 });
  });

  it('returns http-error on 404', async () => {
    nock(baseUrl).get('/missing').reply(404, 'Not Found');

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/missing`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('http-error');
    if (result.kind === 'http-error') {
      expect(result.status).toBe(404);
      expect(result.errorText).toBe('Not Found');
    }
  });

  it('returns http-error on 500', async () => {
    nock(baseUrl).get('/boom').reply(500, 'Internal Server Error');

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/boom`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('http-error');
    if (result.kind === 'http-error') {
      expect(result.status).toBe(500);
      expect(result.errorText).toBe('Internal Server Error');
    }
  });

  it('returns http-error on 429', async () => {
    nock(baseUrl).get('/ratelimited').reply(429, 'Too Many Requests');

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/ratelimited`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('http-error');
    if (result.kind === 'http-error') {
      expect(result.status).toBe(429);
    }
  });

  it('returns invalid-body when success is false', async () => {
    nock(baseUrl).get('/bad').reply(200, { success: false });

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/bad`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('invalid-body');
    if (result.kind === 'invalid-body') {
      expect(result.body).toEqual({ success: false });
    }
  });

  it('returns invalid-body when success true but data missing (requireData default true)', async () => {
    nock(baseUrl).get('/bad').reply(200, { success: true });

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/bad`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('invalid-body');
  });

  it('returns ok with data undefined when success true and data missing and requireData false', async () => {
    nock(baseUrl).get('/ok-no-data').reply(200, { success: true });

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/ok-no-data`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
      requireData: false,
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data).toBeUndefined();
    }
  });

  it('returns timeout on abort', async () => {
    nock(baseUrl).get('/slow').delay(500).reply(200, { success: true, data: {} });

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/slow`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 50,
    });

    expect(result.kind).toBe('timeout');
  });

  it('returns network-error on connection failure', async () => {
    nock(baseUrl).get('/neterr').replyWithError('ECONNREFUSED');

    const result = await fetchLinearAgent<unknown>({
      url: `${baseUrl}/neterr`,
      method: 'GET',
      internalAuthToken,
      timeoutMs: 1000,
    });

    expect(result.kind).toBe('network-error');
    if (result.kind === 'network-error') {
      expect(String(result.error)).toContain('ECONNREFUSED');
    }
  });

  it('does not throw — always returns discriminated union', async () => {
    nock(baseUrl).get('/neterr').replyWithError('ECONNREFUSED');

    await expect(
      fetchLinearAgent<unknown>({
        url: `${baseUrl}/neterr`,
        method: 'GET',
        internalAuthToken,
        timeoutMs: 1000,
      })
    ).resolves.toBeDefined();
  });
});
