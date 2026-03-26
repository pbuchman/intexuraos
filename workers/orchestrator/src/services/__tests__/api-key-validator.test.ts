import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiKeyValidator } from '../api-key-validator.js';
import type { Logger } from '@intexuraos/common-core';

/* eslint-disable @typescript-eslint/no-empty-function */
const mockLogger: Logger = {
  info(): void {},
  warn(): void {},
  error(): void {},
  debug(): void {},
};

describe('ApiKeyValidator', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return valid for 200 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  });

  it('should return invalid for 401 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-bad' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('401');
  });

  it('should return invalid for 403 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-bad' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('403');
  });

  it('should return valid for 429 rate limit', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(true);
  });

  it('should return valid on network error (optimistic)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network timeout'));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(true);
  });

  it('should return invalid for empty API key', async () => {
    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: '' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('empty');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should cache valid result and not re-fetch', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);

    const result1 = await validator.validate('anthropic');
    const result2 = await validator.validate('anthropic');

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should cache invalid result and not re-fetch', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-bad' }, mockLogger);

    const result1 = await validator.validate('anthropic');
    const result2 = await validator.validate('anthropic');

    expect(result1.valid).toBe(false);
    expect(result2.valid).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should re-validate after cache TTL expires', async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);

    const result1 = await validator.validate('anthropic');
    expect(result1.valid).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    const result2 = await validator.validate('anthropic');
    expect(result2.valid).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should deduplicate concurrent validation calls', async () => {
    let resolvePromise: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    });
    fetchSpy.mockReturnValueOnce(pending);

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);

    const p1 = validator.validate('anthropic');
    const p2 = validator.validate('anthropic');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    resolvePromise!(new Response('{}', { status: 200 }));

    const [result1, result2] = await Promise.all([p1, p2]);
    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should use fallback status text when statusText is empty', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401, statusText: '' }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-bad' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBe('HTTP 401 Unauthorized');
  });

  it('should fall back to Unauthorized when 403 response has empty statusText', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 403, statusText: '' }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-bad' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBe('HTTP 403 Unauthorized');
  });

  it('should use actual statusText when 403 response has non-empty statusText', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 403, statusText: 'Forbidden' }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-bad' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBe('HTTP 403 Forbidden');
  });

  it('should handle non-Error thrown from fetch', async () => {
    fetchSpy.mockRejectedValueOnce('string error');

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(true);
  });

  it('should include cause chain in network error warning log', async () => {
    const warnSpy = vi.fn();
    const loggerWithWarn: Logger = {
      info(): void {},
      warn: warnSpy,
      error(): void {},
      debug(): void {},
    };

    const cause = new Error('connect ECONNREFUSED 34.143.76.2:443') as Error & { code: string };
    cause.code = 'ECONNREFUSED';
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed', { cause }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, loggerWithWarn);
    const result = await validator.validate('anthropic');

    expect(result.valid).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'fetch failed',
        cause: 'connect ECONNREFUSED 34.143.76.2:443 [ECONNREFUSED]',
      }),
      'API key validation request failed (network issue), treating as valid'
    );
  });

  it('should not cache network error results', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network timeout'));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const validator = new ApiKeyValidator({ ANTHROPIC_API_KEY: 'sk-ant-test' }, mockLogger);

    const result1 = await validator.validate('anthropic');
    expect(result1.valid).toBe(true);

    const result2 = await validator.validate('anthropic');
    expect(result2.valid).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
