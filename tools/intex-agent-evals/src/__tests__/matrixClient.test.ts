import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMatrixClient } from '../live/matrixClient.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createMatrixClient', () => {
  it('calls the exact whoami endpoint with bearer auth and accepts documented optional fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        user_id: '@operator:home-dev',
        device_id: 'SYNTHETIC-DEVICE',
        is_guest: false,
      })
    );
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });

    await expect(
      client.whoAmI({
        homeserverUrl: 'https://matrix.synthetic.test/base/path',
        accessToken: 'private-token-sentinel',
      })
    ).resolves.toEqual({ ok: true, userId: '@operator:home-dev' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://matrix.synthetic.test/_matrix/client/v3/account/whoami',
      expect.objectContaining({
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer private-token-sentinel',
        },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('maps HTTP 401 separately and closes every other non-200 status', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'private unauthorized body' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'private unavailable body' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ location: 'private redirect body' }, { status: 302 }));
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });
    const input = {
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    };

    await expect(client.whoAmI(input)).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    await expect(client.whoAmI(input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const redirect = await client.whoAmI(input);
    expect(redirect).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(redirect)).not.toContain('private redirect body');
  });

  it.each([
    [{}, 'missing user ID'],
    [{ user_id: 'operator' }, 'invalid user ID'],
    [{ user_id: '@operator:home-dev', unknown: 'private body sentinel' }, 'unknown key'],
    [{ user_id: '@operator:home-dev', device_id: '' }, 'invalid device ID'],
    [{ user_id: '@operator:home-dev', is_guest: 'false' }, 'invalid guest flag'],
  ] as const)('strictly rejects %s', async (body, _label) => {
    const client = createMatrixClient({
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      timeoutMs: 50,
      maxBytes: 4096,
    });

    const result = await client.whoAmI({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('private body sentinel');
    expect(JSON.stringify(result)).not.toContain('private-token-sentinel');
  });

  it.each([
    [new Response('{not-json', { headers: { 'content-type': 'application/json' } }), 4096],
    [new Response('{}', { headers: { 'content-type': 'text/plain' } }), 4096],
    [jsonResponse({ user_id: '@operator:home-dev' }), 4],
  ] as const)(
    'rejects malformed, wrong-content-type, or oversized bodies',
    async (response, maxBytes) => {
      const client = createMatrixClient({
        fetchImpl: vi.fn<typeof fetch>(async () => response),
        timeoutMs: 50,
        maxBytes,
      });

      await expect(
        client.whoAmI({
          homeserverUrl: 'https://matrix.synthetic.test',
          accessToken: 'private-token-sentinel',
        })
      ).resolves.toEqual({ ok: false, reason: 'invalid_response' });
    }
  );

  it('maps network failure and an invalid homeserver without exposing raw details', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('private network sentinel');
    });
    const client = createMatrixClient({ fetchImpl, timeoutMs: 50, maxBytes: 4096 });

    const network = await client.whoAmI({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    });
    expect(network).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(network)).not.toContain('private network sentinel');

    const invalidUrl = await client.whoAmI({
      homeserverUrl: 'not-a-url',
      accessToken: 'private-token-sentinel',
    });
    expect(invalidUrl).toEqual({ ok: false, reason: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts at the configured timeout and returns only the timeout reason', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('private timeout sentinel', 'AbortError'));
          });
        })
    );
    const client = createMatrixClient({ fetchImpl, timeoutMs: 1, maxBytes: 4096 });

    const result = await client.whoAmI({
      homeserverUrl: 'https://matrix.synthetic.test',
      accessToken: 'private-token-sentinel',
    });

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(JSON.stringify(result)).not.toContain('private timeout sentinel');
  });
});
