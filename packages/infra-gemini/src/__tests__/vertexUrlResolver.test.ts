import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveVertexRedirectUrls } from '../vertexUrlResolver.js';

describe('resolveVertexRedirectUrls', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected fetch call'))
    );
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
  });

  function mockFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
    return globalThis.fetch as ReturnType<typeof vi.fn<typeof fetch>>;
  }

  it('resolves Vertex redirect URL to Location header value', async () => {
    const redirectUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';
    const resolvedUrl = 'https://example.com/real-article';

    mockFetch().mockResolvedValueOnce(
      new Response('', { status: 302, headers: { Location: resolvedUrl } })
    );

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([resolvedUrl]);
    expect(mockFetch()).toHaveBeenCalledWith(redirectUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('returns original URL when no Location header in response', async () => {
    const redirectUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';

    mockFetch().mockResolvedValueOnce(new Response('', { status: 200 }));

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([redirectUrl]);
  });

  it('returns original URL on network error', async () => {
    const redirectUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';

    mockFetch().mockRejectedValueOnce(new Error('Connection refused'));

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([redirectUrl]);
  });

  it('returns non-Vertex URLs unchanged without making requests', async () => {
    const normalUrl = 'https://example.com/article';

    const result = await resolveVertexRedirectUrls([normalUrl]);

    expect(result).toEqual([normalUrl]);
    expect(mockFetch()).not.toHaveBeenCalled();
  });

  it('handles mixed Vertex and non-Vertex URLs', async () => {
    const vertexUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz';
    const normalUrl = 'https://example.com/article';
    const resolvedUrl = 'https://real-source.com/page';

    mockFetch().mockResolvedValueOnce(
      new Response('', { status: 302, headers: { Location: resolvedUrl } })
    );

    const result = await resolveVertexRedirectUrls([vertexUrl, normalUrl]);

    expect(result).toEqual([resolvedUrl, normalUrl]);
  });

  it('returns empty array for empty input', async () => {
    const result = await resolveVertexRedirectUrls([]);

    expect(result).toEqual([]);
  });

  it('handles multiple Vertex redirect URLs', async () => {
    const url1 = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa';
    const url2 = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb';

    mockFetch()
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { Location: 'https://resolved1.com' } })
      )
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { Location: 'https://resolved2.com' } })
      );

    const result = await resolveVertexRedirectUrls([url1, url2]);

    expect(result).toEqual(['https://resolved1.com', 'https://resolved2.com']);
  });

  it('returns invalid URL string unchanged', async () => {
    const invalidUrl = 'not-a-valid-url';

    const result = await resolveVertexRedirectUrls([invalidUrl]);

    expect(result).toEqual([invalidUrl]);
  });

  it('returns original URL when Location header is empty string', async () => {
    const redirectUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';

    mockFetch().mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: '' } }));

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([redirectUrl]);
  });
});
