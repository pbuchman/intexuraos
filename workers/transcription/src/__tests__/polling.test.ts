import { describe, it, expect, vi } from 'vitest';
import { pollUntilComplete, type PollingConfig } from '../polling.js';
import type { SpeechTranscriptionPort } from '../providers/transcription-provider.js';

const mockLogger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const fastConfig: PollingConfig = {
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  maxAttempts: 5,
};

const noopSleep = (): Promise<void> => Promise.resolve();

function makeMockProvider(
  responses: (
    | {
        ok: true;
        value: {
          status: 'running' | 'done' | 'rejected';
          error?: { code: string; message: string };
          apiCall: { timestamp: string; operation: 'poll'; success: boolean };
        };
      }
    | { ok: false; error: { code: string; message: string } }
  )[]
): SpeechTranscriptionPort {
  let callIndex = 0;
  return {
    submitJob: vi.fn(),
    getTranscript: vi.fn(),
    pollJob: vi.fn().mockImplementation(() => {
      const response = responses[callIndex];
      callIndex++;
      return Promise.resolve(
        response ?? {
          ok: true,
          value: {
            status: 'running',
            apiCall: { timestamp: new Date().toISOString(), operation: 'poll', success: true },
          },
        }
      );
    }),
  };
}

function makeApiCall(): { timestamp: string; operation: 'poll'; success: boolean } {
  return { timestamp: new Date().toISOString(), operation: 'poll' as const, success: true };
}

describe('pollUntilComplete', () => {
  it('returns done when job completes on first poll', async () => {
    const provider = makeMockProvider([
      { ok: true, value: { status: 'done', apiCall: makeApiCall() } },
    ]);

    const result = await pollUntilComplete(provider, 'job-123', fastConfig, mockLogger, noopSleep);

    expect(result.status).toBe('done');
  });

  it('returns done after multiple running polls', async () => {
    const provider = makeMockProvider([
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'done', apiCall: makeApiCall() } },
    ]);

    const result = await pollUntilComplete(provider, 'job-123', fastConfig, mockLogger, noopSleep);

    expect(result.status).toBe('done');
    expect(provider.pollJob).toHaveBeenCalledTimes(3);
  });

  it('returns rejected when job is rejected without error', async () => {
    const provider = makeMockProvider([
      { ok: true, value: { status: 'rejected', apiCall: makeApiCall() } },
    ]);

    const result = await pollUntilComplete(provider, 'job-123', fastConfig, mockLogger, noopSleep);

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.error).toBeUndefined();
    }
  });

  it('returns rejected with error when job is rejected with error details', async () => {
    const provider = makeMockProvider([
      {
        ok: true,
        value: {
          status: 'rejected',
          error: { code: 'AUDIO_TOO_SHORT', message: 'Audio is too short' },
          apiCall: makeApiCall(),
        },
      },
    ]);

    const result = await pollUntilComplete(provider, 'job-123', fastConfig, mockLogger, noopSleep);

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.error?.code).toBe('AUDIO_TOO_SHORT');
      expect(result.error?.message).toBe('Audio is too short');
    }
  });

  it('returns timeout when max attempts exceeded', async () => {
    const provider = makeMockProvider([
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
    ]);

    const result = await pollUntilComplete(
      provider,
      'job-123',
      { ...fastConfig, maxAttempts: 5 },
      mockLogger,
      noopSleep
    );

    expect(result.status).toBe('timeout');
    expect(provider.pollJob).toHaveBeenCalledTimes(5);
  });

  it('continues polling on transient errors', async () => {
    const provider = makeMockProvider([
      { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network error' } },
      { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network error' } },
      { ok: true, value: { status: 'done', apiCall: makeApiCall() } },
    ]);

    const result = await pollUntilComplete(provider, 'job-123', fastConfig, mockLogger, noopSleep);

    expect(result.status).toBe('done');
    expect(provider.pollJob).toHaveBeenCalledTimes(3);
  });

  it('times out after all attempts fail with errors', async () => {
    const errorResponses = Array.from({ length: 3 }, () => ({
      ok: false as const,
      error: { code: 'NETWORK_ERROR', message: 'Network error' },
    }));

    const provider = makeMockProvider(errorResponses);

    const result = await pollUntilComplete(
      provider,
      'job-123',
      { ...fastConfig, maxAttempts: 3 },
      mockLogger,
      noopSleep
    );

    expect(result.status).toBe('timeout');
  });

  it('applies exponential backoff between polls', async () => {
    const sleepCalls: number[] = [];
    const mockSleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };

    const provider = makeMockProvider([
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'done', apiCall: makeApiCall() } },
    ]);

    const config: PollingConfig = {
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      maxAttempts: 5,
    };

    await pollUntilComplete(provider, 'job-123', config, mockLogger, mockSleep);

    expect(sleepCalls[0]).toBe(100);
    expect(sleepCalls[1]).toBe(200);
    expect(sleepCalls[2]).toBe(400);
  });

  it('caps delay at maxDelayMs', async () => {
    const sleepCalls: number[] = [];
    const mockSleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };

    const provider = makeMockProvider([
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'running', apiCall: makeApiCall() } },
      { ok: true, value: { status: 'done', apiCall: makeApiCall() } },
    ]);

    const config: PollingConfig = {
      initialDelayMs: 100,
      maxDelayMs: 150,
      backoffMultiplier: 2,
      maxAttempts: 5,
    };

    await pollUntilComplete(provider, 'job-123', config, mockLogger, mockSleep);

    // 100, 150 (capped), 150 (capped), 150 (capped)
    expect(sleepCalls[0]).toBe(100);
    expect(sleepCalls[1]).toBe(150);
    expect(sleepCalls[2]).toBe(150);
  });
});
