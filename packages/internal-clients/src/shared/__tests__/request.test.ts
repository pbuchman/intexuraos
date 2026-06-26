import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendInternalRequest } from '../request.js';

describe('sendInternalRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to response.json() when response.text() is unavailable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
    } as unknown as Response);

    const result = await sendInternalRequest({
      baseUrl: 'https://service.example.com',
      path: '/internal/test',
      method: 'GET',
      token: 'secret',
      logger: { warn: () => undefined },
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      response: expect.any(Object) as Response,
      body: { success: true, data: { ok: true } },
      rawText: JSON.stringify({ success: true, data: { ok: true } }),
    });
  });

  it('returns an empty rawText/body payload when neither text() nor json() is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
    } as Response);

    const result = await sendInternalRequest({
      baseUrl: 'https://service.example.com',
      path: '/internal/test',
      method: 'GET',
      token: 'secret',
      logger: { warn: () => undefined },
    });

    expect(result).toEqual({
      ok: true,
      response: expect.any(Object) as Response,
      body: '',
      rawText: '',
    });
  });

  it('uses thrown string values as network error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw 'socket closed';
    });

    const result = await sendInternalRequest({
      baseUrl: 'https://service.example.com',
      path: '/internal/test',
      method: 'GET',
      token: 'secret',
      logger: { warn: () => undefined },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'socket closed',
      },
    });
  });
});
