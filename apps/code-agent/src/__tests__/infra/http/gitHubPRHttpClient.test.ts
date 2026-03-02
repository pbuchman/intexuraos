import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { createGitHubPRHttpClient } from '../../../infra/http/gitHubPRHttpClient.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';

describe('gitHubPRHttpClient', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const token = 'ghp_test-token';
  let client: GitHubPRClient;

  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
    client = createGitHubPRHttpClient({ token, timeoutMs: 5000 }, mockLogger);
  });

  describe('updatePRTitle', () => {
    it('updates PR title successfully', async () => {
      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/42', { title: '[INT-100] Fix auth bug' })
        .matchHeader('Authorization', `Bearer ${token}`)
        .matchHeader('Accept', 'application/vnd.github+json')
        .reply(200, { id: 1, title: '[INT-100] Fix auth bug' });

      const result = await client.updatePRTitle('pbuchman', 'intexuraos', 42, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { owner: 'pbuchman', repo: 'intexuraos', prNumber: 42 },
        'PR title updated'
      );
    });

    it('returns UNAUTHORIZED on 401', async () => {
      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/42')
        .reply(401, 'Bad credentials');

      const result = await client.updatePRTitle('pbuchman', 'intexuraos', 42, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
        expect(result.error.message).toContain('Bad credentials');
      }
    });

    it('returns UNAUTHORIZED on 403', async () => {
      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/42')
        .reply(403, 'Forbidden');

      const result = await client.updatePRTitle('pbuchman', 'intexuraos', 42, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns NOT_FOUND on 404', async () => {
      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/999')
        .reply(404, 'Not Found');

      const result = await client.updatePRTitle('pbuchman', 'intexuraos', 999, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns UNAVAILABLE on 500', async () => {
      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/42')
        .reply(500, 'Internal Server Error');

      const result = await client.updatePRTitle('pbuchman', 'intexuraos', 42, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });

    it('returns UNKNOWN on network error', async () => {
      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/42')
        .replyWithError('Connection refused');

      const result = await client.updatePRTitle('pbuchman', 'intexuraos', 42, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('returns UNAVAILABLE on timeout', async () => {
      const shortTimeoutClient = createGitHubPRHttpClient({ token, timeoutMs: 50 }, mockLogger);

      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/42')
        .delayConnection(200)
        .reply(200, {});

      const result = await shortTimeoutClient.updatePRTitle('pbuchman', 'intexuraos', 42, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toContain('timed out');
      }
    });

    it('returns UNKNOWN on 422 (unprocessable)', async () => {
      nock('https://api.github.com')
        .patch('/repos/pbuchman/intexuraos/pulls/42')
        .reply(422, 'Validation Failed');

      const result = await client.updatePRTitle('pbuchman', 'intexuraos', 42, '[INT-100] Fix auth bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });
  });
});
