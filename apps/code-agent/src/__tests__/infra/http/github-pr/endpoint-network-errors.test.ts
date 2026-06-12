/**
 * Targeted NETWORK_ERROR coverage for endpoints whose fetch-failure branch
 * is not exercised by the high-level gitHubPRHttpClient.test.ts suite.
 *
 * The refactor moved the try/catch out of each endpoint and into the shared
 * fetchGitHub util. Each endpoint now carries an `if (!result.ok) return result`
 * branch that surfaces NETWORK_ERROR from the util. These tests verify that
 * passthrough for endpoints with no existing NETWORK_ERROR test in the
 * facade-level suite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { createGitHubPRHttpClient } from '../../../../infra/http/gitHubPRHttpClient.js';

const client = createGitHubPRHttpClient({ timeoutMs: 5000 });

describe('endpoint NETWORK_ERROR passthrough', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('getPullRequestCommits returns NETWORK_ERROR on fetch failure', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/pulls/42/commits?per_page=100')
      .replyWithError('connection refused');

    const result = await client.getPullRequestCommits('t', 'owner', 'repo', 42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR');
  });

  it('getPullRequestDetails returns NETWORK_ERROR on fetch failure', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/pulls/42')
      .replyWithError('connection refused');

    const result = await client.getPullRequestDetails('t', 'owner', 'repo', 42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR');
  });

  it('updateIssueComment returns NETWORK_ERROR on fetch failure', async () => {
    nock('https://api.github.com')
      .patch('/repos/owner/repo/issues/comments/12345')
      .replyWithError('connection refused');

    const result = await client.updateIssueComment('t', 'owner', 'repo', 12345, 'body');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR');
  });

  it('getCombinedCheckStatus returns NETWORK_ERROR when only the check-runs fetch fails', async () => {
    // status succeeds, check-runs fails → exercises the !checkRunsResult.ok branch
    nock('https://api.github.com')
      .get('/repos/owner/repo/commits/abc/status')
      .reply(200, { state: 'success', total_count: 1 });
    nock('https://api.github.com')
      .get('/repos/owner/repo/commits/abc/check-runs')
      .replyWithError('connection refused');

    const result = await client.getCombinedCheckStatus('t', 'owner', 'repo', 'abc');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR');
  });
});
