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

  describe('getPullRequestStatus', () => {
    it('returns PR state, mergedAt, and headRef on success', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, {
          state: 'open',
          merged_at: null,
          head: { ref: 'task_existing_pr_branch' },
        });

      const result = await client.getPullRequestStatus('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        });
      }
    });

    it('returns NOT_FOUND on 404', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/404')
        .reply(404, { message: 'Not Found' });

      const result = await client.getPullRequestStatus('test-token', 'owner', 'repo', 404);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .replyWithError('connection refused');

      const result = await client.getPullRequestStatus('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('returns API_ERROR when the PR status response is missing state or head ref', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .reply(200, {
          state: 'draft',
          merged_at: null,
          head: {},
        });

      const result = await client.getPullRequestStatus('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('PR response missing state or head.ref');
      }
    });

    it('parses merged_at into a Date when the PR has already been merged', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/43')
        .reply(200, {
          state: 'closed',
          merged_at: '2026-03-10T09:15:00Z',
          head: { ref: 'task_existing_pr_branch' },
        });

      const result = await client.getPullRequestStatus('test-token', 'owner', 'repo', 43);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('closed');
        expect(result.value.mergedAt?.toISOString()).toBe('2026-03-10T09:15:00.000Z');
        expect(result.value.headRef).toBe('task_existing_pr_branch');
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

      const result = await client.getPullRequestFiles('test-token', 'owner', 'repo', 999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/files?per_page=100')
        .replyWithError('timeout');

      const result = await client.getPullRequestFiles('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('paginates file fetches when Link header has next page', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/files?per_page=100')
        .reply(200, [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0 }], {
          link: '<https://api.github.com/repos/owner/repo/pulls/42/files?per_page=100&page=2>; rel="next"',
        });
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/files?per_page=100&page=2')
        .reply(200, [{ filename: 'b.ts', status: 'added', additions: 5, deletions: 0 }]);

      const result = await client.getPullRequestFiles('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.filename).toBe('a.ts');
        expect(result.value[1]?.filename).toBe('b.ts');
      }
    });

    it('stops pagination when Link header has no next rel', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42/files?per_page=100')
        .reply(200, [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0 }], {
          link: '<https://api.github.com/repos/owner/repo/pulls/42/files?per_page=100&page=1>; rel="last"',
        });

      const result = await client.getPullRequestFiles('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.filename).toBe('a.ts');
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

      const result = await client.getPullRequestCommits('test-token', 'owner', 'repo', 42);

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

      const result = await client.postPRComment('test-token', 'owner', 'repo', 42, 'body');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns RATE_LIMITED on 429', async () => {
      nock('https://api.github.com')
        .post('/repos/owner/repo/issues/42/comments')
        .reply(429, { message: 'rate limit exceeded' });

      const result = await client.postPRComment('test-token', 'owner', 'repo', 42, 'body');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .post('/repos/owner/repo/issues/42/comments')
        .replyWithError('connection refused');

      const result = await client.postPRComment('test-token', 'owner', 'repo', 42, 'body');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('getPullRequestBaseBranch', () => {
    it('returns base branch on success', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { base: { ref: 'development' } });

      const result = await client.getPullRequestBaseBranch('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('development');
      }
    });

    it('returns error on 404', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/999')
        .reply(404, { message: 'Not Found' });

      const result = await client.getPullRequestBaseBranch('test-token', 'owner', 'repo', 999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error when base.ref is missing from response', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .reply(200, { base: {} });

      const result = await client.getPullRequestBaseBranch('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('base.ref');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .replyWithError('connection refused');

      const result = await client.getPullRequestBaseBranch('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('listOpenPullRequestsByBaseBranch', () => {
    it('returns open PRs targeting the requested base branch', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&base=development&per_page=100')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, [
          {
            number: 42,
            title: 'Fix conflict',
            user: { login: 'alice' },
            base: { ref: 'development' },
            head: { ref: 'feature/alice' },
            created_at: '2026-03-14T00:00:00Z',
          },
          {
            number: 43,
            title: 'Second PR',
            user: { login: 'bob' },
            base: { ref: 'development' },
            head: { ref: 'feature/bob' },
            created_at: '2026-03-15T00:00:00Z',
          },
        ]);

      const result = await client.listOpenPullRequestsByBaseBranch(
        'test-token',
        'owner',
        'repo',
        'development'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          {
            number: 42,
            title: 'Fix conflict',
            authorLogin: 'alice',
            baseBranch: 'development',
            headBranch: 'feature/alice',
            createdAt: '2026-03-14T00:00:00Z',
          },
          {
            number: 43,
            title: 'Second PR',
            authorLogin: 'bob',
            baseBranch: 'development',
            headBranch: 'feature/bob',
            createdAt: '2026-03-15T00:00:00Z',
          },
        ]);
      }
    });

    it('paginates open PR listing when GitHub returns a next-page link', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&base=development&per_page=100')
        .reply(200, [
          {
            number: 42,
            title: 'Fix conflict',
            user: { login: 'alice' },
            base: { ref: 'development' },
            head: { ref: 'feature/alice' },
            created_at: '2026-03-14T00:00:00Z',
          },
        ], {
          link: '<https://api.github.com/repos/owner/repo/pulls?state=open&base=development&per_page=100&page=2>; rel="next"',
        });
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&base=development&per_page=100&page=2')
        .reply(200, [
          {
            number: 43,
            title: 'Second PR',
            user: { login: 'bob' },
            base: { ref: 'development' },
            head: { ref: 'feature/bob' },
            created_at: '2026-03-15T00:00:00Z',
          },
        ]);

      const result = await client.listOpenPullRequestsByBaseBranch(
        'test-token',
        'owner',
        'repo',
        'development'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          {
            number: 42,
            title: 'Fix conflict',
            authorLogin: 'alice',
            baseBranch: 'development',
            headBranch: 'feature/alice',
            createdAt: '2026-03-14T00:00:00Z',
          },
          {
            number: 43,
            title: 'Second PR',
            authorLogin: 'bob',
            baseBranch: 'development',
            headBranch: 'feature/bob',
            createdAt: '2026-03-15T00:00:00Z',
          },
        ]);
      }
    });

    it('returns API_ERROR when PR list is missing author login', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&base=development&per_page=100')
        .reply(200, [
          {
            number: 42,
            title: 'Fix conflict',
            user: {},
            base: { ref: 'development' },
            head: { ref: 'feature/alice' },
          },
        ]);

      const result = await client.listOpenPullRequestsByBaseBranch(
        'test-token',
        'owner',
        'repo',
        'development'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('user.login');
      }
    });

    it('returns API_ERROR when PR list is missing number, title, base, head, or created_at data', async () => {
      const cases = [
        [{ title: 'Fix conflict', user: { login: 'alice' }, base: { ref: 'development' }, head: { ref: 'feature/alice' }, created_at: '2026-01-01T00:00:00Z' }, 'number'],
        [{ number: 42, user: { login: 'alice' }, base: { ref: 'development' }, head: { ref: 'feature/alice' }, created_at: '2026-01-01T00:00:00Z' }, 'title'],
        [{ number: 42, title: 'Fix conflict', user: { login: 'alice' }, base: {}, head: { ref: 'feature/alice' }, created_at: '2026-01-01T00:00:00Z' }, 'base.ref'],
        [{ number: 42, title: 'Fix conflict', user: { login: 'alice' }, base: { ref: 'development' }, head: {}, created_at: '2026-01-01T00:00:00Z' }, 'head.ref'],
        [{ number: 42, title: 'Fix conflict', user: { login: 'alice' }, base: { ref: 'development' }, head: { ref: 'feature/alice' } }, 'created_at'],
      ] as const;

      for (const [payload, expectedField] of cases) {
        nock.cleanAll();
        nock('https://api.github.com')
          .get('/repos/owner/repo/pulls?state=open&base=development&per_page=100')
          .reply(200, [payload]);

        const result = await client.listOpenPullRequestsByBaseBranch(
          'test-token',
          'owner',
          'repo',
          'development'
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain(expectedField);
        }
      }
    });

    it('returns NOT_FOUND when GitHub rejects the PR list request', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&base=development&per_page=100')
        .reply(404, { message: 'Not Found' });

      const result = await client.listOpenPullRequestsByBaseBranch(
        'test-token',
        'owner',
        'repo',
        'development'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('getPullRequestDetails', () => {
    it('returns mergeability, author, branches, and body on success', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, {
          number: 42,
          title: 'Fix conflict',
          body: 'PR body',
          mergeable: false,
          mergeable_state: 'dirty',
          user: { login: 'alice' },
          base: { ref: 'development' },
          head: { ref: 'feature/alice', sha: 'abc123' },
        });

      const result = await client.getPullRequestDetails('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          number: 42,
          title: 'Fix conflict',
          body: 'PR body',
          authorLogin: 'alice',
          baseBranch: 'development',
          headBranch: 'feature/alice',
          mergeable: false,
          mergeableState: 'dirty',
          headSha: 'abc123',
        });
      }
    });

    it('allows mergeable to be null while GitHub computes the value', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .reply(200, {
          number: 42,
          title: 'Fix conflict',
          body: null,
          mergeable: null,
          mergeable_state: 'unknown',
          user: { login: 'alice' },
          base: { ref: 'development' },
          head: { ref: 'feature/alice', sha: 'def456' },
        });

      const result = await client.getPullRequestDetails('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergeable).toBeNull();
        expect(result.value.mergeableState).toBe('unknown');
      }
    });

    it('defaults mergeableState to null when GitHub omits it', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .reply(200, {
          number: 42,
          title: 'Fix conflict',
          body: 'PR body',
          mergeable: false,
          user: { login: 'alice' },
          base: { ref: 'development' },
          head: { ref: 'feature/alice', sha: 'ghi789' },
        });

      const result = await client.getPullRequestDetails('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergeableState).toBeNull();
      }
    });

    it('returns API_ERROR when PR details are missing required fields', async () => {
      const cases = [
        [{ title: 'Fix conflict', user: { login: 'alice' }, base: { ref: 'development' }, head: { ref: 'feature/alice', sha: 'abc' } }, 'number'],
        [{ number: 42, user: { login: 'alice' }, base: { ref: 'development' }, head: { ref: 'feature/alice', sha: 'abc' } }, 'title'],
        [{ number: 42, title: 'Fix conflict', user: {}, base: { ref: 'development' }, head: { ref: 'feature/alice', sha: 'abc' } }, 'user.login'],
        [{ number: 42, title: 'Fix conflict', user: { login: 'alice' }, base: {}, head: { ref: 'feature/alice', sha: 'abc' } }, 'base.ref'],
        [{ number: 42, title: 'Fix conflict', user: { login: 'alice' }, base: { ref: 'development' }, head: {} }, 'head.ref'],
        [{ number: 42, title: 'Fix conflict', user: { login: 'alice' }, base: { ref: 'development' }, head: { ref: 'feature/alice' } }, 'head.sha'],
      ] as const;

      for (const [payload, expectedField] of cases) {
        nock.cleanAll();
        nock('https://api.github.com')
          .get('/repos/owner/repo/pulls/42')
          .reply(200, payload);

        const result = await client.getPullRequestDetails('test-token', 'owner', 'repo', 42);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain(expectedField);
        }
      }
    });

    it('returns NOT_FOUND when PR details cannot be fetched', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls/42')
        .reply(404, { message: 'Not Found' });

      const result = await client.getPullRequestDetails('test-token', 'owner', 'repo', 42);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('mergePullRequest', () => {
    it('returns sha and merged flag on success', async () => {
      nock('https://api.github.com')
        .put('/repos/owner/repo/pulls/42/merge', { merge_method: 'merge' })
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { sha: 'abc123', merged: true });

      const result = await client.mergePullRequest('test-token', 'owner', 'repo', 42, 'merge');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ sha: 'abc123', merged: true });
      }
    });

    it('sends commit_title when provided', async () => {
      nock('https://api.github.com')
        .put('/repos/owner/repo/pulls/42/merge', { merge_method: 'merge', commit_title: 'My title' })
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { sha: 'def456', merged: true });

      const result = await client.mergePullRequest('test-token', 'owner', 'repo', 42, 'merge', 'My title');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ sha: 'def456', merged: true });
      }
    });

    it('returns ok with empty sha when PR is already merged (405)', async () => {
      nock('https://api.github.com')
        .put('/repos/owner/repo/pulls/42/merge')
        .reply(405, { message: 'Pull Request is not mergeable' });

      const result = await client.mergePullRequest('test-token', 'owner', 'repo', 42, 'merge');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ sha: '', merged: true });
      }
    });

    it('returns API_ERROR on merge conflict (409)', async () => {
      nock('https://api.github.com')
        .put('/repos/owner/repo/pulls/42/merge')
        .reply(409, { message: 'Merge conflict' });

      const result = await client.mergePullRequest('test-token', 'owner', 'repo', 42, 'merge');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('merge conflict');
      }
    });

    it('returns mapped error on other status codes', async () => {
      nock('https://api.github.com')
        .put('/repos/owner/repo/pulls/42/merge')
        .reply(404, { message: 'Not Found' });

      const result = await client.mergePullRequest('test-token', 'owner', 'repo', 42, 'merge');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .put('/repos/owner/repo/pulls/42/merge')
        .replyWithError('connection refused');

      const result = await client.mergePullRequest('test-token', 'owner', 'repo', 42, 'merge');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('getCombinedCheckStatus', () => {
    it('returns success state', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits/abc123/status')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { state: 'success' });

      const result = await client.getCombinedCheckStatus('test-token', 'owner', 'repo', 'abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('success');
      }
    });

    it('maps failure state', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits/abc123/status')
        .reply(200, { state: 'failure' });

      const result = await client.getCombinedCheckStatus('test-token', 'owner', 'repo', 'abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('failure');
      }
    });

    it('maps error state to failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits/abc123/status')
        .reply(200, { state: 'error' });

      const result = await client.getCombinedCheckStatus('test-token', 'owner', 'repo', 'abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('failure');
      }
    });

    it('maps unknown state to pending', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits/abc123/status')
        .reply(200, { state: 'pending' });

      const result = await client.getCombinedCheckStatus('test-token', 'owner', 'repo', 'abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('pending');
      }
    });

    it('returns error on non-ok response', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits/abc123/status')
        .reply(404, { message: 'Not Found' });

      const result = await client.getCombinedCheckStatus('test-token', 'owner', 'repo', 'abc123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits/abc123/status')
        .replyWithError('connection refused');

      const result = await client.getCombinedCheckStatus('test-token', 'owner', 'repo', 'abc123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('encodes ref with special characters', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits/refs%2Fheads%2Fmain/status')
        .reply(200, { state: 'success' });

      const result = await client.getCombinedCheckStatus('test-token', 'owner', 'repo', 'refs/heads/main');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('success');
      }
    });
  });

  describe('listAllOpenPullRequests', () => {
    it('returns open PRs on success', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&per_page=100&sort=created&direction=asc')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, [
          {
            number: 1,
            title: 'PR 1',
            user: { login: 'alice' },
            base: { ref: 'main' },
            head: { ref: 'feat-1' },
            created_at: '2026-01-01T00:00:00Z',
          },
        ]);

      const result = await client.listAllOpenPullRequests('test-token', 'owner', 'repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          {
            number: 1,
            title: 'PR 1',
            authorLogin: 'alice',
            baseBranch: 'main',
            headBranch: 'feat-1',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]);
      }
    });

    it('paginates when Link header has next page', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&per_page=100&sort=created&direction=asc')
        .reply(200, [
          { number: 1, title: 'PR 1', user: { login: 'alice' }, base: { ref: 'main' }, head: { ref: 'feat-1' }, created_at: '2026-01-01T00:00:00Z' },
        ], {
          link: '<https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100&sort=created&direction=asc&page=2>; rel="next"',
        });
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&per_page=100&sort=created&direction=asc&page=2')
        .reply(200, [
          { number: 2, title: 'PR 2', user: { login: 'bob' }, base: { ref: 'main' }, head: { ref: 'feat-2' }, created_at: '2026-01-02T00:00:00Z' },
        ]);

      const result = await client.listAllOpenPullRequests('test-token', 'owner', 'repo');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.number).toBe(1);
        expect(result.value[1]?.number).toBe(2);
      }
    });

    it('returns error on non-ok response', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&per_page=100&sort=created&direction=asc')
        .reply(404, { message: 'Not Found' });

      const result = await client.listAllOpenPullRequests('test-token', 'owner', 'repo');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/pulls?state=open&per_page=100&sort=created&direction=asc')
        .replyWithError('connection refused');

      const result = await client.listAllOpenPullRequests('test-token', 'owner', 'repo');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('returns API_ERROR when response is missing required fields', async () => {
      const cases = [
        [{ title: 'PR', user: { login: 'a' }, base: { ref: 'main' }, head: { ref: 'f' }, created_at: '2026-01-01T00:00:00Z' }, 'number'],
        [{ number: 1, user: { login: 'a' }, base: { ref: 'main' }, head: { ref: 'f' }, created_at: '2026-01-01T00:00:00Z' }, 'title'],
        [{ number: 1, title: 'PR', base: { ref: 'main' }, head: { ref: 'f' }, created_at: '2026-01-01T00:00:00Z' }, 'user.login'],
        [{ number: 1, title: 'PR', user: { login: 'a' }, head: { ref: 'f' }, created_at: '2026-01-01T00:00:00Z' }, 'base.ref'],
        [{ number: 1, title: 'PR', user: { login: 'a' }, base: { ref: 'main' }, created_at: '2026-01-01T00:00:00Z' }, 'head.ref'],
        [{ number: 1, title: 'PR', user: { login: 'a' }, base: { ref: 'main' }, head: { ref: 'f' } }, 'created_at'],
      ] as const;

      for (const [payload, expectedField] of cases) {
        nock.cleanAll();
        nock('https://api.github.com')
          .get('/repos/owner/repo/pulls?state=open&per_page=100&sort=created&direction=asc')
          .reply(200, [payload]);

        const result = await client.listAllOpenPullRequests('test-token', 'owner', 'repo');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('API_ERROR');
          expect(result.error.message).toContain(expectedField);
        }
      }
    });
  });

  describe('getIssueComment', () => {
    it('returns comment body on success', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/issues/comments/12345')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { id: 12345, body: 'Existing comment body' });

      const result = await client.getIssueComment('test-token', 'owner', 'repo', 12345);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe('Existing comment body');
      }
    });

    it('returns NOT_FOUND on 404', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/issues/comments/99999')
        .reply(404, { message: 'Not Found' });

      const result = await client.getIssueComment('test-token', 'owner', 'repo', 99999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns UNAUTHORIZED on 401', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/issues/comments/12345')
        .reply(401, { message: 'Bad credentials' });

      const result = await client.getIssueComment('bad-token', 'owner', 'repo', 12345);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/issues/comments/12345')
        .replyWithError('connection refused');

      const result = await client.getIssueComment('test-token', 'owner', 'repo', 12345);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('returns empty string when API response has no body field', async () => {
      nock('https://api.github.com')
        .get('/repos/owner/repo/issues/comments/12345')
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { id: 12345 });

      const result = await client.getIssueComment('test-token', 'owner', 'repo', 12345);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe('');
      }
    });
  });

  describe('updateIssueComment', () => {
    it('updates an existing issue comment', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/issues/comments/12345', { body: 'Updated body' })
        .matchHeader('Authorization', 'Bearer test-token')
        .reply(200, { id: 12345 });

      const result = await client.updateIssueComment(
        'test-token',
        'owner',
        'repo',
        12345,
        'Updated body'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.commentId).toBe(12345);
      }
    });

    it('returns NOT_FOUND when the managed comment no longer exists', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/issues/comments/12345')
        .reply(404, { message: 'Not Found' });

      const result = await client.updateIssueComment(
        'test-token',
        'owner',
        'repo',
        12345,
        'Updated body'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns API_ERROR when GitHub omits the updated comment id', async () => {
      nock('https://api.github.com')
        .patch('/repos/owner/repo/issues/comments/12345')
        .reply(200, {});

      const result = await client.updateIssueComment(
        'test-token',
        'owner',
        'repo',
        12345,
        'Updated body'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('comment id');
      }
    });
  });
});
