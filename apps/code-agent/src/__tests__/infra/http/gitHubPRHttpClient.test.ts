/**
 * Tests for GitHubPRHttpClient.
 */

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { createGitHubPRHttpClient } from '../../../infra/http/gitHubPRHttpClient.js';

describe('GitHubPRHttpClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  const client = createGitHubPRHttpClient({ timeoutMs: 5000 });

  describe('updatePRTitle', () => {
    it('successfully updates a PR title', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/pulls/42', { title: 'INT-123: new title' })
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { id: 1, title: 'INT-123: new title' });

      const result = await client.updatePRTitle('test-token', 'owner', 'repo', 42, 'INT-123: new title');

      expect(result.ok).toBe(true);
    });

    it('returns UNAUTHORIZED on 401', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/pulls/42')
        .reply(401, { message: 'Bad credentials' });

      const result = await client.updatePRTitle('bad-token', 'owner', 'repo', 42, 'title');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns UNAUTHORIZED on 403', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/pulls/42')
        .reply(403, { message: 'Forbidden' });

      const result = await client.updatePRTitle('token', 'owner', 'repo', 42, 'title');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns NOT_FOUND on 404', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/pulls/999')
        .reply(404, { message: 'Not Found' });

      const result = await client.updatePRTitle('token', 'owner', 'repo', 999, 'title');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns RATE_LIMITED on 429', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/pulls/42')
        .reply(429, { message: 'rate limit exceeded' });

      const result = await client.updatePRTitle('token', 'owner', 'repo', 42, 'title');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns API_ERROR on other status codes', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/pulls/42')
        .reply(500, { message: 'Internal Server Error' });

      const result = await client.updatePRTitle('token', 'owner', 'repo', 42, 'title');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/pulls/42')
        .replyWithError('connection refused');

      const result = await client.updatePRTitle('token', 'owner', 'repo', 42, 'title');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });
});
