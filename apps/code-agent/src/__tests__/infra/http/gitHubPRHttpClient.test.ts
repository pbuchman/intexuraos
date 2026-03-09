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

  describe('getPullRequestFiles', () => {
    it('returns file list on success', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/files?per_page=100')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, [
          { filename: 'src/index.ts', status: 'modified', additions: 10, deletions: 2 },
          { filename: 'src/new.ts', status: 'added', additions: 50, deletions: 0 },
        ]);

      const result = await client.getPullRequestFiles('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]).toEqual({
          filename: 'src/index.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
        });
      }
    });

    it('returns NOT_FOUND on 404', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/999/files?per_page=100')
        .reply(404, { message: 'Not Found' });

      const result = await client.getPullRequestFiles('token', 'owner', 'repo', 999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/files?per_page=100')
        .replyWithError('timeout');

      const result = await client.getPullRequestFiles('token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('getPullRequestCommits', () => {
    it('returns commit list on success', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/commits?per_page=100')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, [
          {
            sha: 'abc123',
            commit: { message: 'feat: add feature' },
            author: { login: 'dev-user' },
          },
        ]);

      const result = await client.getPullRequestCommits('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({
          sha: 'abc123',
          message: 'feat: add feature',
          author: 'dev-user',
        });
      }
    });

    it('falls back to unknown when commit author is null', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/commits?per_page=100')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, [
          {
            sha: 'def456',
            commit: { message: 'chore: automated commit' },
            author: null,
          },
        ]);

      const result = await client.getPullRequestCommits('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.author).toBe('unknown');
      }
    });

    it('returns UNAUTHORIZED on 401', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/commits?per_page=100')
        .reply(401, { message: 'Bad credentials' });

      const result = await client.getPullRequestCommits('bad-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('postPRComment', () => {
    it('posts a comment and returns commentId', async () => {
      nock('https://api.github.com')
        .post('/repos/owner/repo/issues/42/comments', { body: 'Review requested' })
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(201, { id: 12345 });

      const result = await client.postPRComment('test-token', 'owner', 'repo', 42, 'Review requested');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.commentId).toBe(12345);
      }
    });

    it('returns UNAUTHORIZED on 403', async () => {
      nock('https://api.github.com')
        .post('/repos/owner/repo/issues/42/comments')
        .reply(403, { message: 'Forbidden' });

      const result = await client.postPRComment('token', 'owner', 'repo', 42, 'body');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns RATE_LIMITED on 429', async () => {
      nock('https://api.github.com')
        .post('/repos/owner/repo/issues/42/comments')
        .reply(429, { message: 'rate limit exceeded' });

      const result = await client.postPRComment('token', 'owner', 'repo', 42, 'body');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .post('/repos/owner/repo/issues/42/comments')
        .replyWithError('connection refused');

      const result = await client.postPRComment('token', 'owner', 'repo', 42, 'body');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });
});
