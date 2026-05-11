import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitTaskMock = vi.fn();

vi.mock('@intexuraos/internal-clients', () => ({
  createCodeAgentServiceClient: vi.fn(() => ({
    submitTask: submitTaskMock,
    cancelTaskWithNonce: vi.fn(),
    submitToPhase2: vi.fn(),
  })),
}));

describe('createCodeAgentHttpClient coverage branches', () => {
  beforeEach(() => {
    submitTaskMock.mockReset();
  });

  it('falls back to the upstream message when submitTask errors have no status', async () => {
    submitTaskMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'upstream rejected the task',
      },
    });

    const { createCodeAgentHttpClient } = await import(
      '../../../infra/http/codeAgentHttpClient.js'
    );

    const client = createCodeAgentHttpClient({
      baseUrl: 'https://code-agent.example.com',
      internalAuthToken: 'secret',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });

    const result = await client.submitTask({
      actionId: 'action-1',
      userId: 'user-1',
      approvalEventId: 'approval-1',
      payload: { prompt: 'Fix it', workerType: 'auto' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'upstream rejected the task',
      },
    });
  });
});
