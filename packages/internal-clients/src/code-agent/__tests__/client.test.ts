import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodeAgentServiceClient } from '../client.js';
import type { CodeAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://code-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as CodeAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createCodeAgentServiceClient', () => {
  it('returns code task data on submit success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/code/process', {
        actionId: 'action-1',
        userId: 'user-1',
        approvalEventId: 'approval-1',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          codeTaskId: 'task-1',
          resourceUrl: 'https://app.intexuraos.com/code-tasks/task-1',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitTask({
      actionId: 'action-1',
      userId: 'user-1',
      approvalEventId: 'approval-1',
      payload: {
        prompt: 'Fix bug',
        workerType: 'auto',
      },
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        codeTaskId: 'task-1',
        resourceUrl: 'https://app.intexuraos.com/code-tasks/task-1',
      },
    });
  });

  it('accepts legacy submit responses that still return taskId', async () => {
    nock(BASE_URL)
      .post('/internal/code/process')
      .reply(200, {
        success: true,
        data: {
          taskId: 'task-legacy',
          resourceUrl: 'https://app.intexuraos.com/code-tasks/task-legacy',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitTask({
      actionId: 'action-1',
      userId: 'user-1',
      approvalEventId: 'approval-1',
      payload: {
        prompt: 'Fix bug',
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        codeTaskId: 'task-legacy',
        resourceUrl: 'https://app.intexuraos.com/code-tasks/task-legacy',
      },
    });
  });

  it('preserves duplicate submit details', async () => {
    nock(BASE_URL)
      .post('/internal/code/process')
      .reply(409, {
        success: false,
        error: {
          code: 'DUPLICATE',
          message: 'Task already exists for this approval',
          details: {
            existingTaskId: 'existing-task-1',
          },
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitTask({
      actionId: 'action-1',
      userId: 'user-1',
      approvalEventId: 'approval-1',
      payload: {
        prompt: 'Fix bug',
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DUPLICATE',
        message: 'Task already exists for this approval',
        status: 409,
        existingTaskId: 'existing-task-1',
      },
    });
  });

  it('falls back to the unexpected-status message when submitTask gets an empty 4xx body', async () => {
    nock(BASE_URL).post('/internal/code/process').reply(400);

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitTask({
      actionId: 'action-1',
      userId: 'user-1',
      approvalEventId: 'approval-1',
      payload: {
        prompt: 'Fix bug',
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Unexpected response: 400',
        status: 400,
      },
    });
  });

  it('returns INVALID_REQUEST for notifyGroupSummaryRecompute 4xx responses', async () => {
    nock(BASE_URL).post('/internal/code/group-summary/recompute').reply(400, 'Bad request');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.notifyGroupSummaryRecompute({
      userId: 'user-1',
      linearIssueId: 'INT-1',
      labels: [{ id: 'label-1', name: 'feature' }],
      sourceTimestamp: '2026-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Bad request',
        status: 400,
      },
    });
  });

  it('maps timed out notifyGroupSummaryRecompute calls to UNAVAILABLE', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .delay(50)
      .reply(200, { success: true });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1,
    });
    const result = await client.notifyGroupSummaryRecompute({
      userId: 'user-1',
      linearIssueId: 'INT-1',
      labels: [{ id: 'label-1', name: 'feature' }],
      sourceTimestamp: '2026-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'Request timed out',
      },
    });
  });

  it('falls back to the HTTP status text when recompute rejects without a response body', async () => {
    nock(BASE_URL).post('/internal/code/group-summary/recompute').reply(400);

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.notifyGroupSummaryRecompute({
      userId: 'user-1',
      linearIssueId: 'INT-1',
      labels: [{ id: 'label-1', name: 'feature' }],
      sourceTimestamp: '2026-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'HTTP 400: Bad Request',
        status: 400,
      },
    });
  });
});
