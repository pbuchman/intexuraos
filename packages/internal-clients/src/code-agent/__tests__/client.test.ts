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
  it('creates code tasks through the direct internal submit endpoint', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/code/submit', {
        userId: 'user-1',
        prompt: 'Implement feature',
        workerType: 'codex',
        linearIssueId: 'INT-123',
        taskMode: 'execution',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'submitted',
          codeTaskId: 'task-1',
          resourceUrl: '/#/code-tasks/task-1',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
      workerType: 'codex',
      linearIssueId: 'INT-123',
      taskMode: 'execution',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        codeTaskId: 'task-1',
        resourceUrl: '/#/code-tasks/task-1',
      },
    });
  });

  it('returns INVALID_REQUEST when direct code task creation gets a 4xx response', async () => {
    nock(BASE_URL).post('/internal/code/submit').reply(400, 'Bad request');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
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

  it('returns fallback invalid request messages when direct submit 4xx responses omit text', async () => {
    nock(BASE_URL).post('/internal/code/submit').reply(400);

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
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

  it('maps direct code task 424 responses to WORKER_UNAVAILABLE', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit')
      .reply(424, {
        success: false,
        error: {
          code: 'WORKER_NOT_CONFIGURED',
          message: 'Please configure your workers in Settings before submitting code tasks',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'WORKER_UNAVAILABLE',
        message: 'Please configure your workers in Settings before submitting code tasks',
        status: 503,
      },
    });
  });

  it('uses the worker-unavailable fallback when direct submit worker errors omit messages', async () => {
    nock(BASE_URL).post('/internal/code/submit').reply(424, {
      success: false,
      error: {},
    });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'WORKER_UNAVAILABLE',
        message: 'No workers available',
        status: 503,
      },
    });
  });

  it('returns UNKNOWN when cancelTaskWithNonce returns success=false with 200', async () => {
    nock(BASE_URL)
      .post('/internal/code/cancel-with-nonce')
      .reply(200, {
        success: false,
        error: { code: 'FAILED', message: 'Cannot cancel' },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'FAILED: Cannot cancel',
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

  it('returns ok when recompute succeeds with a data envelope', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .reply(200, { success: true, data: null });

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

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('returns INVALID_REQUEST when recompute returns success=false with 200', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .reply(200, {
        success: false,
        error: { code: 'FAILED', message: 'Cannot recompute' },
      });

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
        message: 'FAILED: Cannot recompute',
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

  it('rejects legacy taskId-only direct submit success envelopes', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit')
      .reply(200, {
        success: true,
        data: {
          taskId: 'task-legacy-1',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Invalid response from code-agent',
        status: 200,
      },
    });
  });

  it('rejects invalid direct submit success payloads', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit')
      .reply(200, {
        success: true,
        data: {
          resourceUrl: '/#/code-tasks/missing-id',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Invalid response from code-agent',
        status: 200,
      },
    });
  });

  it('maps direct submit malformed envelopes to UNKNOWN', async () => {
    nock(BASE_URL).post('/internal/code/submit').reply(200, {
      success: true,
    });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Invalid response from code-agent',
      },
    });
  });

  it('maps direct submit transport failures to NETWORK_ERROR', async () => {
    nock(BASE_URL).post('/internal/code/submit').replyWithError('offline');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toContain('Failed to call code-agent');
    }
  });

  it('preserves duplicate task details from direct submit conflicts', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit')
      .reply(409, {
        success: false,
        error: {
          code: 'ACTIVE_TASK_EXISTS',
          message: 'Active task already exists',
          details: {
            existingTaskId: 'task-existing-1',
          },
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DUPLICATE',
        message: 'Active task already exists',
        status: 409,
        existingTaskId: 'task-existing-1',
      },
    });
  });

  it('uses direct submit conflict fallback messages for primitive bodies', async () => {
    nock(BASE_URL).post('/internal/code/submit').reply(409, 'conflict');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DUPLICATE',
        message: 'Task already exists for this request',
        status: 409,
      },
    });
  });

  it('reads string direct submit conflict errors without details', async () => {
    nock(BASE_URL).post('/internal/code/submit').reply(409, {
      success: false,
      error: 'Already queued',
    });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DUPLICATE',
        message: 'Already queued',
        status: 409,
      },
    });
  });

  it('maps direct submit 503 responses to WORKER_UNAVAILABLE', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit')
      .reply(503, {
        success: false,
        error: {
          message: 'No workers available',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'WORKER_UNAVAILABLE',
        message: 'No workers available',
        status: 503,
      },
    });
  });

  it('maps direct submit 5xx responses to UNAVAILABLE', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit')
      .reply(500, {
        success: false,
        error: {
          message: 'boom',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createCodeTask({
      userId: 'user-1',
      prompt: 'Implement feature',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'code-agent unavailable',
        status: 500,
      },
    });
  });

  it('returns ok when cancelTaskWithNonce succeeds with a data envelope', async () => {
    nock(BASE_URL)
      .post('/internal/code/cancel-with-nonce')
      .reply(200, {
        success: true,
        data: {
          cancelled: true,
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({ ok: true, value: { cancelled: true } });
  });

  it('returns ok when legacy cancel responses omit data', async () => {
    nock(BASE_URL).post('/internal/code/cancel-with-nonce').reply(200, {
      success: true,
    });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({ ok: true, value: { cancelled: true } });
  });

  it('maps cancelTaskWithNonce transport failures to NETWORK_ERROR', async () => {
    nock(BASE_URL).post('/internal/code/cancel-with-nonce').replyWithError('offline');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toContain('Failed to call code-agent');
    }
  });

  it.each([
    [404, 'TASK_NOT_FOUND', 'Task not found'],
    [403, 'NOT_OWNER', 'Not owner'],
  ] as const)('maps cancelTaskWithNonce %s responses', async (status, code, message) => {
    nock(BASE_URL).post('/internal/code/cancel-with-nonce').reply(status, {
      success: false,
      error: { message },
    });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: { code, message },
    });
  });

  it.each([
    ['INVALID_NONCE', 'INVALID_NONCE'],
    ['NONCE_EXPIRED', 'NONCE_EXPIRED'],
    ['TASK_NOT_CANCELLABLE', 'TASK_NOT_CANCELLABLE'],
  ] as const)('maps cancelTaskWithNonce %s validation responses', async (serverCode, code) => {
    nock(BASE_URL)
      .post('/internal/code/cancel-with-nonce')
      .reply(400, {
        success: false,
        error: {
          code: serverCode,
          message: 'Cannot cancel',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: { code, message: 'Cannot cancel' },
    });
  });

  it('returns UNKNOWN for unrecognized cancelTaskWithNonce validation codes', async () => {
    nock(BASE_URL)
      .post('/internal/code/cancel-with-nonce')
      .reply(400, {
        success: false,
        error: {
          code: 'SOMETHING_ELSE',
          message: 'Cannot cancel',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message:
          'Code-agent returned unrecognized error code: SOMETHING_ELSE. Original message: Cannot cancel',
      },
    });
  });

  it('returns UNKNOWN for string cancelTaskWithNonce validation errors', async () => {
    nock(BASE_URL).post('/internal/code/cancel-with-nonce').reply(400, {
      success: false,
      error: 'Cannot cancel',
    });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Code-agent returned unrecognized error code: . Original message: Cannot cancel',
      },
    });
  });

  it('returns UNKNOWN for primitive cancelTaskWithNonce validation bodies', async () => {
    nock(BASE_URL).post('/internal/code/cancel-with-nonce').reply(400, 'Cannot cancel');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Code-agent returned unrecognized error code: . Original message: Unknown error',
      },
    });
  });

  it('returns UNKNOWN for unexpected cancelTaskWithNonce statuses', async () => {
    nock(BASE_URL)
      .post('/internal/code/cancel-with-nonce')
      .reply(409, {
        success: false,
        error: {
          message: 'Conflict',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.cancelTaskWithNonce({
      taskId: 'task-1',
      nonce: 'nonce-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Unexpected response: 409',
      },
    });
  });

  it('returns submitToPhase2 success payloads', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(200, {
        success: true,
        data: {
          codeTaskId: 'task-phase-2',
          resourceUrl: '/#/code-tasks/task-phase-2',
          workerLocation: 'queued',
          implementationOf: 'task-plan-1',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        codeTaskId: 'task-phase-2',
        resourceUrl: '/#/code-tasks/task-phase-2',
        workerLocation: 'queued',
        implementationOf: 'task-plan-1',
      },
    });
  });

  it('maps submitToPhase2 transport failures to NETWORK_ERROR', async () => {
    nock(BASE_URL).post('/internal/code/submit-phase2').replyWithError('offline');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toContain('Failed to call code-agent');
    }
  });

  it('maps submitToPhase2 malformed envelopes to UNKNOWN', async () => {
    nock(BASE_URL).post('/internal/code/submit-phase2').reply(200, {
      success: true,
    });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'success=true but no `data`',
      },
    });
  });

  it('maps submitToPhase2 not-found responses', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(404, {
        success: false,
        error: { message: 'Planning task not found' },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TASK_NOT_FOUND',
        message: 'Planning task not found',
      },
    });
  });

  it.each([
    ['invalid_status', 'INVALID_STATUS'],
    ['no_linear_issue', 'NO_LINEAR_ISSUE'],
    ['label_not_ready', 'LABEL_NOT_READY'],
  ] as const)('maps submitToPhase2 serverCode %s responses', async (serverCode, code) => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(400, {
        success: false,
        error: {
          message: 'Cannot submit',
          details: { serverCode },
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code,
        message: 'Cannot submit',
      },
    });
  });

  it('maps submitToPhase2 INVALID_REQUEST errors to INVALID_STATUS', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(400, {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid status',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_STATUS',
        message: 'Invalid status',
      },
    });
  });

  it('maps submitToPhase2 unknown 400 responses to UNKNOWN', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(400, {
        success: false,
        error: {
          code: 'SOMETHING_ELSE',
          message: 'Cannot submit',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Cannot submit',
      },
    });
  });

  it.each([
    ['active_task_exists', 'ACTIVE_TASK_EXISTS', undefined],
    ['already_implemented', 'ALREADY_IMPLEMENTED', 'task-existing-1'],
  ] as const)(
    'maps submitToPhase2 conflict serverCode %s responses',
    async (serverCode, code, existingTaskId) => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(409, {
          success: false,
          error: {
            message: 'Conflict',
            details: {
              serverCode,
              ...(existingTaskId !== undefined ? { existingTaskId } : {}),
            },
          },
        });

      const client = createCodeAgentServiceClient({
        baseUrl: BASE_URL,
        internalAuthToken: 'secret',
        logger,
      });
      const result = await client.submitToPhase2({
        userId: 'user-1',
        taskId: 'task-plan-1',
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code,
          message: 'Conflict',
          ...(existingTaskId !== undefined ? { existingTaskId } : {}),
        },
      });
    }
  );

  it('maps submitToPhase2 already-implemented conflicts without existing task ids', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(409, {
        success: false,
        error: {
          message: 'Already implemented',
          details: {
            serverCode: 'already_implemented',
          },
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'ALREADY_IMPLEMENTED',
        message: 'Already implemented',
      },
    });
  });

  it('maps submitToPhase2 complex task child conflicts explicitly', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(409, {
        success: false,
        error: {
          message: 'No direct children with code-task labels found',
          details: {
            serverCode: 'complex_task_no_qualifying_children',
          },
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'COMPLEX_TASK_NO_QUALIFYING_CHILDREN',
        message: 'No direct children with code-task labels found',
      },
    });
  });

  it('maps submitToPhase2 worker configuration failures', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(503, {
        success: false,
        error: { message: 'Workers unavailable' },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'WORKER_NOT_CONFIGURED',
        message: 'Workers unavailable',
      },
    });
  });

  it('maps submitToPhase2 unexpected statuses to UNKNOWN', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(418, {
        success: false,
        error: { message: 'teapot' },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Unexpected response: 418',
      },
    });
  });

  it('maps submitToPhase2 plan PR merge failures explicitly', async () => {
    nock(BASE_URL)
      .post('/internal/code/submit-phase2')
      .reply(422, {
        success: false,
        error: {
          code: 'PLAN_PR_MERGE_FAILED',
          message: 'Could not merge plan PR',
        },
      });

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.submitToPhase2({
      userId: 'user-1',
      taskId: 'task-plan-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'PLAN_PR_MERGE_FAILED',
        message: 'Could not merge plan PR',
      },
    });
  });

  it('maps recompute transport failures to UNKNOWN', async () => {
    nock(BASE_URL).post('/internal/code/group-summary/recompute').replyWithError('offline');

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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN');
    }
  });

  it('marks recompute transport warnings to skip Sentry capture', async () => {
    nock(BASE_URL).post('/internal/code/group-summary/recompute').replyWithError('offline');

    const client = createCodeAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    await client.notifyGroupSummaryRecompute({
      userId: 'user-1',
      linearIssueId: 'INT-1',
      labels: [{ id: 'label-1', name: 'feature' }],
      sourceTimestamp: '2026-01-01T12:00:00.000Z',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        _skipSentry: true,
        url: `${BASE_URL}/internal/code/group-summary/recompute`,
      }),
      'internal-client network error'
    );
  });

  it('maps recompute server failures to UNAVAILABLE', async () => {
    nock(BASE_URL)
      .post('/internal/code/group-summary/recompute')
      .reply(500, {
        success: false,
        error: { message: 'boom' },
      });

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
        code: 'UNAVAILABLE',
        message: 'code-agent unavailable',
      },
    });
  });
});
