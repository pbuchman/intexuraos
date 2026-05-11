import { afterEach, describe, expect, it, vi } from 'vitest';
import { performHttpFetch } from '../http/fetch.js';

const originalFetch = globalThis.fetch;

describe('performHttpFetch', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('delegates to global fetch with the supplied input and init', async () => {
    const response = new Response('ok', { status: 202 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    globalThis.fetch = fetchMock;

    const init: RequestInit = { method: 'POST', body: 'payload' };
    const result = await performHttpFetch('https://example.test/resource', init);

    expect(result).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/resource', init);
  });
});
