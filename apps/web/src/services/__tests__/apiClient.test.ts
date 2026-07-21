/**
 * Tests for apiClient service.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseConflictError, type ConflictErrorInfo, apiRequest, ApiError } from '../apiClient'; // @allow-missing-js -- Vite web app uses extensionless imports

describe('parseConflictError', () => {
  describe('Duplicate task pattern', () => {
    it('extracts task ID from duplicate prompt message', () => {
      const message = 'Similar task submitted in last 5 minutes: task_fa7666d5-bdf1-4498-b52b-1c12af89a578';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_fa7666d5-bdf1-4498-b52b-1c12af89a578',
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });

    it('extracts task ID with different format', () => {
      const message = 'Similar task submitted in last 5 minutes: task_abc-123-def-456';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_abc-123-def-456',
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });

    it('handles trailing whitespace in task ID', () => {
      const message = 'Similar task submitted in last 5 minutes: task_xyz-123 ';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_xyz-123 ', // Whitespace preserved as part of capture
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });
  });

  describe('Active task pattern', () => {
    it('extracts task ID from active task message', () => {
      const message = 'Active task already exists for this Linear issue: task_bb7666d5-bdf1-4498-b52b-1c12af89a579';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_bb7666d5-bdf1-4498-b52b-1c12af89a579',
        reason: 'active',
      } satisfies ConflictErrorInfo);
    });

    it('extracts task ID with different format', () => {
      const message = 'Active task already exists for this Linear issue: task_active-987';
      const result = parseConflictError(message);

      expect(result).toEqual({
        taskId: 'task_active-987',
        reason: 'active',
      } satisfies ConflictErrorInfo);
    });
  });

  describe('Retired approval duplicate pattern', () => {
    it('does not parse retired duplicate approval messages', () => {
      const message = 'Duplicate: task_cc7666d5-bdf1-4498-b52b-1c12af89a580';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('does not parse simple retired duplicate approval messages', () => {
      const message = 'Duplicate: task_simple-123';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });
  });

  describe('Unknown message patterns', () => {
    it('returns null for completely unknown message', () => {
      const message = 'Some random error message';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const message = '';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for message without task ID', () => {
      const message = 'Similar task submitted in last 5 minutes:';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for message with similar but different prefix', () => {
      const message = 'Similar task was submitted: task-123';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });

    it('returns null for duplicate message without "Duplicate:" prefix at start', () => {
      const message = 'There is a Duplicate: task-123';
      const result = parseConflictError(message);

      expect(result).toBeNull();
    });
  });

  describe('Pattern matching priority', () => {
    it('matches duplicate pattern first when message could match multiple', () => {
      // This message contains both "Duplicate:" and the duplicate pattern
      const message = 'Similar task submitted in last 5 minutes: task-123 has a Duplicate: something';
      const result = parseConflictError(message);

      // Should match the first pattern (duplicate) since we check in order
      expect(result).toEqual({
        taskId: 'task-123 has a Duplicate: something',
        reason: 'duplicate',
      } satisfies ConflictErrorInfo);
    });
  });
});

describe('apiRequest', () => {
  const baseUrl = 'https://api.example.com';
  const path = '/test';
  const token = 'test-token';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('composes caller cancellation with the request timeout signal', async () => {
    const caller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      receivedSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(
        mockFetchResponse({ success: true, data: { ok: true } }, 200)
      );
    });

    await apiRequest(baseUrl, path, token, { signal: caller.signal });
    caller.abort();

    expect(receivedSignal?.aborted).toBe(true);
  });

  /** Create a minimal fetch Response mock compatible with jsdom. */
  function mockFetchResponse(body: unknown, status: number): Response {
    return {
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  describe('Fastify default error format fallback', () => {
    it('throws ApiError with UNKNOWN code for Fastify-style error response', async () => {
      const fastifyError = {
        message: 'Route GET:/hellscript/writing-config not found',
        error: 'Not Found',
        statusCode: 404,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(fastifyError, 404)
      );

      await expect(apiRequest(baseUrl, path, token)).rejects.toThrow(ApiError);

      try {
        await apiRequest(baseUrl, path, token);
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('UNKNOWN');
        expect(apiErr.message).toBe('Route GET:/hellscript/writing-config not found');
        expect(apiErr.status).toBe(404);
      }
    });

    it('throws ApiError with UNKNOWN code when error field is absent', async () => {
      const fastifyError = {
        message: 'Internal Server Error',
        statusCode: 500,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(fastifyError, 500)
      );

      await expect(apiRequest(baseUrl, path, token)).rejects.toThrow(ApiError);

      try {
        await apiRequest(baseUrl, path, token);
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('UNKNOWN');
        expect(apiErr.message).toBe('Internal Server Error');
        expect(apiErr.status).toBe(500);
      }
    });

    it('throws static malformed response for non-Fastify non-envelope response', async () => {
      const randomResponse = { foo: 'bar' };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(randomResponse, 200)
      );

      await expect(apiRequest(baseUrl, path, token)).rejects.toThrow(ApiError);

      try {
        await apiRequest(baseUrl, path, token);
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('MALFORMED_RESPONSE');
        expect(apiErr.message).toBe('Received an invalid response');
        expect(apiErr.status).toBe(502);
      }
    });
  });

  it.each([
    ['string success flag', { success: 'true', data: { ok: true } }],
    ['numeric success flag', { success: 1, data: { ok: true } }],
    ['missing successful data', { success: true }],
  ])('rejects a %s envelope as a static malformed response', async (_label, payload) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(payload, 200));

    await expect(apiRequest(baseUrl, path, token)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE', status: 502,
    });
  });

  it.each([
    ['missing error', { success: false }],
    ['non-object error', { success: false, error: 'bad' }],
    ['non-string code', { success: false, error: { code: 1, message: 'bad' } }],
    ['non-string message', { success: false, error: { code: 'BAD', message: 1 } }],
    ['unsafe details', { success: false, error: { code: 'BAD', message: 'safe', details: 'private' } }],
  ])('rejects a failure envelope with %s as static malformed response', async (_label, payload) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(payload, 400));

    await expect(apiRequest(baseUrl, path, token)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE', status: 502,
    });
  });

  it('preserves a valid structured failure envelope as ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: false, error: { code: 'BAD_REQUEST', message: 'safe', details: { field: 'value' } } }, 400)
    );

    await expect(apiRequest(baseUrl, path, token)).rejects.toMatchObject({
      code: 'BAD_REQUEST', message: 'safe', status: 400, details: { field: 'value' },
    });
  });

  it('does not fetch when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      apiRequest(baseUrl, path, token, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'ABORTED', status: 499 });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('aborts while a 401 refresh callback is pending without issuing a retry fetch', async () => {
    const controller = new AbortController();
    let resolveRefresh!: (token: string) => void;
    const refreshToken = vi.fn(() => new Promise<string>((resolve) => { resolveRefresh = resolve; }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'ignored' } }, 401)
    );

    const request = apiRequest(baseUrl, path, token, { signal: controller.signal, refreshToken });
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: 'ABORTED', status: 499 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveRefresh('new-token');
  });

  it('aborts an initial fetch through the caller signal', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    const request = apiRequest(baseUrl, path, token, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: 'ABORTED', status: 499 });
  });

  it('does not retry after refresh resolves when the caller aborts before the retry', async () => {
    const controller = new AbortController();
    let resolveRefresh!: (token: string) => void;
    const refreshToken = vi.fn(() => new Promise<string>((resolve) => { resolveRefresh = resolve; }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'ignored' } }, 401)
    );
    const request = apiRequest(baseUrl, path, token, { signal: controller.signal, refreshToken });
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
    resolveRefresh('new-token');
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: 'ABORTED', status: 499 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('removes its caller abort listener after a successful request', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ success: true, data: { ok: true } }, 200));

    await expect(apiRequest<{ ok: boolean }>(baseUrl, path, token, { signal: controller.signal })).resolves.toEqual({ ok: true });

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
