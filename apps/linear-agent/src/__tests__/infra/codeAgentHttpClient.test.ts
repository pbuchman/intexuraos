/**
 * Tests for codeAgentHttpClient.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { createCodeAgentHttpClient, type CodeAgentClient } from '../../infra/http/codeAgentHttpClient.js';

const BASE_URL = 'http://code-agent-test';
const INTERNAL_AUTH_TOKEN = 'test-auth-token';

function createTestClient(timeoutMs = 5000): CodeAgentClient {
  const logger = pino({ level: 'silent' });
  return createCodeAgentHttpClient(
    { baseUrl: BASE_URL, internalAuthToken: INTERNAL_AUTH_TOKEN, timeoutMs },
    logger
  );
}

const validRequest = {
  userId: 'user-123',
  linearIssueId: 'issue-456',
  prompt: 'Fix the bug',
  workerType: 'auto' as const,
  actionId: 'action-789',
  approvalEventId: 'approval-001',
};

describe('createCodeAgentHttpClient', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('successful request', () => {
    it('returns codeTaskId on success', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(200, { success: true, data: { taskId: 'task-abc' } });

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task-abc');
      }
    });
  });

  describe('HTTP error responses', () => {
    it('returns INVALID_REQUEST on 4xx response', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(400, 'Bad request body');

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
        expect(result.error.message).toContain('Bad request body');
      }
    });

    it('returns INVALID_REQUEST on 422 response', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(422, 'Unprocessable entity');

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('returns UNAVAILABLE on 5xx response', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(500, 'Internal server error');

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('code-agent unavailable');
      }
    });

    it('returns UNAVAILABLE on 503 response', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(503, 'Service unavailable');

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });
  });

  describe('invalid response body', () => {
    it('returns UNKNOWN when success=false in response', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(200, { success: false, error: { code: 'SOME_ERROR' } });

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from code-agent');
      }
    });

    it('returns UNKNOWN when data is undefined in response', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(200, { success: true });

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from code-agent');
      }
    });
  });

  describe('network errors', () => {
    it('returns UNKNOWN on network error', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .replyWithError('Connection refused');

      const client = createTestClient();
      const result = await client.triggerCodeTask(validRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });
  });
});

describe('notifyGroupSummaryRecompute', () => {
  const validRecomputeRequest = {
    userId: 'user-123',
    linearIssueId: 'INT-456',
    labels: [
      { id: 'label-1', name: 'ready-to-implement' },
      { id: 'label-2', name: 'feature' },
    ],
    sourceTimestamp: '2026-04-02T12:34:56.000Z',
  };

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('sends correct POST and returns ok(undefined) on 200', async () => {
    let capturedBody: unknown;
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute', (body) => {
        capturedBody = body;
        return true;
      })
      .reply(200, { success: true });

    const client = createTestClient();
    const result = await client.notifyGroupSummaryRecompute(validRecomputeRequest);

    expect(result.ok).toBe(true);
      expect(capturedBody).toEqual({
        userId: 'user-123',
        linearIssueId: 'INT-456',
        labels: [
          { id: 'label-1', name: 'ready-to-implement' },
          { id: 'label-2', name: 'feature' },
        ],
        sourceTimestamp: '2026-04-02T12:34:56.000Z',
      });
  });

  it('sends X-Internal-Auth header', async () => {
    let capturedHeaders: Record<string, string> = {};
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .reply(function () {
        capturedHeaders = this.req.headers as Record<string, string>;
        return [200, { success: true }];
      });

    const client = createTestClient();
    await client.notifyGroupSummaryRecompute(validRecomputeRequest);

    expect(capturedHeaders['x-internal-auth']).toBe(INTERNAL_AUTH_TOKEN);
  });

  it('returns INVALID_REQUEST on 4xx response', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .reply(400, 'Bad request body');

    const client = createTestClient();
    const result = await client.notifyGroupSummaryRecompute(validRecomputeRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(result.error.message).toContain('Bad request body');
    }
  });

  it('returns INVALID_REQUEST on 404 response', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .reply(404, 'Not found');

    const client = createTestClient();
    const result = await client.notifyGroupSummaryRecompute(validRecomputeRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('returns UNAVAILABLE on 5xx response', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .reply(500, 'Internal server error');

    const client = createTestClient();
    const result = await client.notifyGroupSummaryRecompute(validRecomputeRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAVAILABLE');
      expect(result.error.message).toBe('code-agent unavailable');
    }
  });

  it('returns UNKNOWN on network error', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .replyWithError('Connection refused');

    const client = createTestClient();
    const result = await client.notifyGroupSummaryRecompute(validRecomputeRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN');
    }
  });
});
