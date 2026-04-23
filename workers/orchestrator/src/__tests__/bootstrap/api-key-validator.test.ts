import { describe, it, expect, vi } from 'vitest';
import {
  validateWorkerApiKey,
  keySuffix,
  extractErrorChain,
  fetchWithRetry,
  type FetchWithRetryDeps,
} from '../../bootstrap/api-key-validator.js';

describe('validateWorkerApiKey', () => {
  it('accepts a non-empty key without throwing', () => {
    expect(() => validateWorkerApiKey('ANTHROPIC_API_KEY', 'sk-abc123')).not.toThrow();
  });

  it('throws a validation error for an empty string', () => {
    expect(() => validateWorkerApiKey('ANTHROPIC_API_KEY', '')).toThrow(
      /ANTHROPIC_API_KEY is empty/
    );
  });

  it('throws a validation error for a whitespace-only string', () => {
    expect(() => validateWorkerApiKey('LINEAR_API_KEY', '   \n\t')).toThrow(
      /LINEAR_API_KEY is empty or whitespace-only/
    );
  });

  it('names the key in the error message', () => {
    expect(() => validateWorkerApiKey('CUSTOM_KEY', '')).toThrow(/CUSTOM_KEY/);
  });
});

describe('keySuffix', () => {
  it('returns the last four characters for long keys', () => {
    expect(keySuffix('sk-abcdef1234')).toBe('...1234');
  });

  it('returns a placeholder for short keys', () => {
    expect(keySuffix('abc')).toBe('****');
    expect(keySuffix('abcd')).toBe('****');
  });

  it('returns a placeholder for empty keys', () => {
    expect(keySuffix('')).toBe('****');
  });
});

describe('extractErrorChain', () => {
  it('renders a single Error message', () => {
    expect(extractErrorChain(new Error('boom'))).toBe('boom');
  });

  it('includes NodeJS error codes when present', () => {
    const err = new Error('dns fail') as NodeJS.ErrnoException;
    err.code = 'ENOTFOUND';
    expect(extractErrorChain(err)).toBe('dns fail [ENOTFOUND]');
  });

  it('walks the `cause` chain with separators', () => {
    const inner = new Error('inner');
    const outer = new Error('outer', { cause: inner });
    expect(extractErrorChain(outer)).toBe('outer → inner');
  });

  it('handles string throwables', () => {
    expect(extractErrorChain('bare string')).toBe('bare string');
  });

  it('serializes other value types as JSON', () => {
    expect(extractErrorChain({ code: 500, msg: 'bad' })).toBe('{"code":500,"msg":"bad"}');
  });

  it('returns empty string for null', () => {
    expect(extractErrorChain(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(extractErrorChain(undefined)).toBe('');
  });
});

describe('fetchWithRetry', () => {
  function makeDeps(overrides: Partial<FetchWithRetryDeps> = {}): FetchWithRetryDeps {
    return {
      fetch: vi.fn(async () => new Response('ok')),
      sleep: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it('returns the first successful response without retrying', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok'));
    const sleepSpy = vi.fn(async () => undefined);
    const deps = makeDeps({ fetch: fetchSpy, sleep: sleepSpy });

    const resp = await fetchWithRetry('https://test', {}, 3, 100, deps);
    expect(resp.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('retries after a transient failure and sleeps between attempts', async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return new Response('ok');
    });
    const sleepSpy = vi.fn(async () => undefined);
    const deps = makeDeps({ fetch: fetchSpy, sleep: sleepSpy });

    const resp = await fetchWithRetry('https://test', {}, 3, 100, deps);
    expect(resp.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenNthCalledWith(1, 100);
    expect(sleepSpy).toHaveBeenNthCalledWith(2, 200);
  });

  it('throws the final error after exhausting all retries', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('permanent failure');
    });
    const sleepSpy = vi.fn(async () => undefined);
    const deps = makeDeps({ fetch: fetchSpy, sleep: sleepSpy });

    await expect(fetchWithRetry('https://test', {}, 2, 10, deps)).rejects.toThrow(
      /permanent failure/
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the caller-supplied AbortSignal when provided', async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response('ok');
    });
    const deps = makeDeps({ fetch: fetchSpy });

    await fetchWithRetry('https://test', { signal: controller.signal }, 1, 10, deps);
    expect(capturedSignal).toBe(controller.signal);
  });
});
