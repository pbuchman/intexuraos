import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendInternalRequestMock = vi.fn();

vi.mock('../request.js', () => ({
  sendInternalRequest: sendInternalRequestMock,
}));

describe('fetchWithAuth timeout mapping', () => {
  beforeEach(() => {
    sendInternalRequestMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps TIMEOUT transport failures to NETWORK_ERROR', async () => {
    sendInternalRequestMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Request exceeded 1ms',
      },
    });

    const { fetchWithAuth } = await import('../http.js');
    const result = await fetchWithAuth(
      {
        baseUrl: 'https://service.example.com',
        internalAuthToken: 'secret',
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          debug: () => undefined,
        },
      },
      '/internal/test'
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Request exceeded 1ms',
      },
    });
  });
});
