import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { fetchDispatchMetadata } from '../services/dispatch-metadata-client.js';

describe('fetchDispatchMetadata', () => {
  const codeAgentUrl = 'http://localhost:8080';
  const authToken = 'test-internal-auth-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns dispatch metadata for a successful response', async () => {
    nock(codeAgentUrl)
      .get('/internal/tasks/task-123/dispatch-metadata')
      .matchHeader('x-internal-auth', authToken)
      .reply(200, {
        taskId: 'task-123',
        prompt: 'Resume work',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        agentType: 'execution',
        workerType: 'auto',
        linearIssueId: 'INT-1134',
        webhookSecret: 'secret-123',
        prNumber: 42,
        webhookUrl: 'http://localhost:8086/internal/webhooks/task-complete',
        continuationPrBranch: 'task_existing_pr_branch',
        trackingCommentId: 'comment-123',
      });

    const result = await fetchDispatchMetadata(
      { codeAgentUrl, internalAuthToken: authToken },
      'task-123'
    );

    expect(result).toEqual({
      taskId: 'task-123',
      prompt: 'Resume work',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      agentType: 'execution',
      workerType: 'auto',
      linearIssueId: 'INT-1134',
      webhookSecret: 'secret-123',
      prNumber: 42,
      webhookUrl: 'http://localhost:8086/internal/webhooks/task-complete',
      continuationPrBranch: 'task_existing_pr_branch',
      trackingCommentId: 'comment-123',
    });
  });

  it('returns null for 404 responses', async () => {
    nock(codeAgentUrl)
      .get('/internal/tasks/task-404/dispatch-metadata')
      .matchHeader('x-internal-auth', authToken)
      .reply(404, { success: false });

    const result = await fetchDispatchMetadata(
      { codeAgentUrl, internalAuthToken: authToken },
      'task-404'
    );

    expect(result).toBeNull();
  });

  it('returns null for malformed payloads', async () => {
    nock(codeAgentUrl)
      .get('/internal/tasks/task-bad/dispatch-metadata')
      .matchHeader('x-internal-auth', authToken)
      .reply(200, {
        taskId: 'task-bad',
        prompt: 'Resume work',
      });

    const result = await fetchDispatchMetadata(
      { codeAgentUrl, internalAuthToken: authToken },
      'task-bad'
    );

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('network unavailable'));

    const result = await fetchDispatchMetadata(
      { codeAgentUrl, internalAuthToken: authToken, fetchFn: fetchMock },
      'task-network'
    );

    expect(result).toBeNull();
  });
});
