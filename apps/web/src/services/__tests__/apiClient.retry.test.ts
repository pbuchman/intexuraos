/**
 * Tests for apiClient X-Request-Id and 401 silent-refresh retry behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiError } from '../apiClient'; // @allow-missing-js -- Vite web app uses extensionless imports

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nonJsonResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

describe('apiRequest X-Request-Id header', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches X-Request-Id matching UUID v4 pattern on every request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { success: true, data: { ok: true } })
    );

    await apiRequest<{ ok: boolean }>('https://api.example.com', '/v1/test', 'token-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-Request-Id']).toBeDefined();
    expect(headers['X-Request-Id']).toMatch(UUID_V4_REGEX);
  });
});

describe('apiRequest 401 silent-refresh retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries once with refreshed token when 401 and refreshToken provided, then succeeds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: true } }));

    const refreshToken = vi.fn().mockResolvedValue('token-new');

    const result = await apiRequest<{ ok: boolean }>(
      'https://api.example.com',
      '/v1/test',
      'token-old',
      { refreshToken }
    );

    expect(result).toEqual({ ok: true });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstHeaders = (fetchSpy.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(firstHeaders['Authorization']).toBe('Bearer token-old');

    const secondInit = fetchSpy.mock.calls[1]?.[1];
    const secondHeaders = (secondInit?.headers ?? {}) as Record<string, string>;
    expect(secondHeaders['Authorization']).toBe('Bearer token-new');
    expect(secondHeaders['X-Request-Id']).toMatch(UUID_V4_REGEX);
    expect(secondInit?.cache).toBe('no-store');
  });

  it('throws ApiError after second 401 even with refresh; refreshToken called only once', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'still expired' } }));

    const refreshToken = vi.fn().mockResolvedValue('token-new');

    await expect(
      apiRequest<unknown>('https://api.example.com', '/v1/test', 'token-old', { refreshToken })
    ).rejects.toBeInstanceOf(ApiError);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on 401 when no refreshToken provided; no retry', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }));

    await expect(
      apiRequest<unknown>('https://api.example.com', '/v1/test', 'token-old')
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves response.status on non-JSON 502 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      nonJsonResponse(502, '<html>Bad Gateway</html>')
    );

    try {
      await apiRequest<unknown>('https://api.example.com', '/v1/test', 'token');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.code).toBe('SERVICE_UNAVAILABLE');
    }
  });
});
