/**
 * Tests for the private fetchGitHub helper used by the GitHub PR HTTP client.
 *
 * These tests exercise the shared fetch wrapper directly (not through the
 * endpoint methods) so the timeout/auth/body/error-mapping behavior is
 * verified in one place.
 */

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import {
  fetchGitHub,
  parseNextPageUrl,
  mapErrorStatus,
  ensureString,
  GITHUB_API,
} from '../../../../infra/http/github-pr/github-fetch-util.js';

const config = { timeoutMs: 5000 };

describe('fetchGitHub', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('returns ok(response) with 200 and body accessible via json()', async () => {
    nock(GITHUB_API)
      .get('/happy')
      .reply(200, { hello: 'world' });

    const result = await fetchGitHub(`${GITHUB_API}/happy`, { method: 'GET', token: 't' }, config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(true);
      expect(result.value.status).toBe(200);
      const data = (await result.value.json()) as { hello: string };
      expect(data.hello).toBe('world');
    }
  });

  it.each([[404], [401], [403], [429], [500]])('returns ok(response) on non-ok status %i (caller maps)', async (status) => {
    nock(GITHUB_API)
      .get('/status')
      .reply(status, { message: 'err' });

    const result = await fetchGitHub(`${GITHUB_API}/status`, { method: 'GET', token: 't' }, config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(false);
      expect(result.value.status).toBe(status);
    }
  });

  it('returns err NETWORK_ERROR on fetch failure', async () => {
    nock(GITHUB_API)
      .get('/boom')
      .replyWithError('connection refused');

    const result = await fetchGitHub(`${GITHUB_API}/boom`, { method: 'GET', token: 't' }, config);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
    }
  });

  it('returns err NETWORK_ERROR when the default AbortSignal.timeout fires', async () => {
    nock(GITHUB_API)
      .get('/slow')
      .delay(200)
      .reply(200, {});

    const result = await fetchGitHub(
      `${GITHUB_API}/slow`,
      { method: 'GET', token: 't' },
      { timeoutMs: 20 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
    }
  });

  it('sends Authorization Bearer header', async () => {
    nock(GITHUB_API)
      .get('/headers')
      .matchHeader('Authorization', 'Bearer my-token')
      .reply(200, {});

    const result = await fetchGitHub(`${GITHUB_API}/headers`, { method: 'GET', token: 'my-token' }, config);

    expect(result.ok).toBe(true);
  });

  it('sends Accept and X-GitHub-Api-Version headers', async () => {
    nock(GITHUB_API)
      .get('/api-headers')
      .matchHeader('Accept', 'application/vnd.github.v3+json')
      .matchHeader('X-GitHub-Api-Version', '2022-11-28')
      .reply(200, {});

    const result = await fetchGitHub(`${GITHUB_API}/api-headers`, { method: 'GET', token: 't' }, config);

    expect(result.ok).toBe(true);
  });

  it('serializes body as JSON when provided', async () => {
    nock(GITHUB_API)
      .post('/body', { foo: 'bar', n: 1 })
      .matchHeader('Content-Type', 'application/json')
      .reply(200, {});

    const result = await fetchGitHub(
      `${GITHUB_API}/body`,
      { method: 'POST', token: 't', body: { foo: 'bar', n: 1 } },
      config
    );

    expect(result.ok).toBe(true);
  });

  it('omits body when not provided', async () => {
    nock(GITHUB_API)
      .get('/no-body')
      .reply(200, {});

    const result = await fetchGitHub(`${GITHUB_API}/no-body`, { method: 'GET', token: 't' }, config);

    expect(result.ok).toBe(true);
  });

  it('uses a custom signal when provided and aborts before the request completes', async () => {
    nock(GITHUB_API)
      .get('/cancel')
      .delay(500)
      .reply(200, {});

    const controller = new AbortController();
    const promise = fetchGitHub(
      `${GITHUB_API}/cancel`,
      { method: 'GET', token: 't', signal: controller.signal },
      config
    );
    controller.abort();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
    }
  });
});

describe('parseNextPageUrl', () => {
  it('returns null when the link header is null', () => {
    expect(parseNextPageUrl(null)).toBeNull();
  });

  it('returns the next URL when the link header includes rel="next"', () => {
    const link = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"';
    expect(parseNextPageUrl(link)).toBe('https://api.github.com/x?page=2');
  });

  it('returns null when the link header has no next relation', () => {
    const link = '<https://api.github.com/x?page=5>; rel="last"';
    expect(parseNextPageUrl(link)).toBeNull();
  });
});

describe('mapErrorStatus', () => {
  it('maps 401 to UNAUTHORIZED', () => {
    expect(mapErrorStatus(401, 'ctx').code).toBe('UNAUTHORIZED');
  });

  it('maps 403 to UNAUTHORIZED (preserves existing behavior)', () => {
    expect(mapErrorStatus(403, 'ctx').code).toBe('UNAUTHORIZED');
  });

  it('maps 404 to NOT_FOUND and uses context as message', () => {
    const mapped = mapErrorStatus(404, 'PR #42 not found');
    expect(mapped.code).toBe('NOT_FOUND');
    expect(mapped.message).toBe('PR #42 not found');
  });

  it('maps 429 to RATE_LIMITED', () => {
    expect(mapErrorStatus(429, 'ctx').code).toBe('RATE_LIMITED');
  });

  it('maps other statuses to API_ERROR', () => {
    const mapped = mapErrorStatus(500, 'ctx');
    expect(mapped.code).toBe('API_ERROR');
    expect(mapped.message).toContain('500');
  });
});

describe('ensureString', () => {
  it('returns ok with the value when the value is a string', () => {
    const result = ensureString('hello', 'field');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello');
  });

  it('returns err API_ERROR when the value is not a string', () => {
    const result = ensureString(undefined, 'title');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_ERROR');
      expect(result.error.message).toContain('title');
    }
  });

  it('returns err when the value is a number', () => {
    const result = ensureString(42, 'number');
    expect(result.ok).toBe(false);
  });
});
