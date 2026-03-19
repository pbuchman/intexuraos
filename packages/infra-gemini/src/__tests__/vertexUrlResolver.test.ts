import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { resolveVertexRedirectUrls } from '../vertexUrlResolver.js';

describe('resolveVertexRedirectUrls', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('resolves Vertex redirect URL to Location header value', async () => {
    const redirectUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';
    const resolvedUrl = 'https://example.com/real-article';

    nock('https://vertexaisearch.cloud.google.com')
      .head('/grounding-api-redirect/abc123')
      .reply(302, '', { Location: resolvedUrl });

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([resolvedUrl]);
  });

  it('returns original URL when no Location header in response', async () => {
    const redirectUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';

    nock('https://vertexaisearch.cloud.google.com')
      .head('/grounding-api-redirect/abc123')
      .reply(200, '');

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([redirectUrl]);
  });

  it('returns original URL on network error', async () => {
    const redirectUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';

    nock('https://vertexaisearch.cloud.google.com')
      .head('/grounding-api-redirect/abc123')
      .replyWithError('Connection refused');

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([redirectUrl]);
  });

  it('returns non-Vertex URLs unchanged without making requests', async () => {
    const normalUrl = 'https://example.com/article';

    const result = await resolveVertexRedirectUrls([normalUrl]);

    expect(result).toEqual([normalUrl]);
  });

  it('handles mixed Vertex and non-Vertex URLs', async () => {
    const vertexUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz';
    const normalUrl = 'https://example.com/article';
    const resolvedUrl = 'https://real-source.com/page';

    nock('https://vertexaisearch.cloud.google.com')
      .head('/grounding-api-redirect/xyz')
      .reply(302, '', { Location: resolvedUrl });

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

    nock('https://vertexaisearch.cloud.google.com')
      .head('/grounding-api-redirect/aaa')
      .reply(302, '', { Location: 'https://resolved1.com' });

    nock('https://vertexaisearch.cloud.google.com')
      .head('/grounding-api-redirect/bbb')
      .reply(302, '', { Location: 'https://resolved2.com' });

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

    nock('https://vertexaisearch.cloud.google.com')
      .head('/grounding-api-redirect/abc123')
      .reply(302, '', { Location: '' });

    const result = await resolveVertexRedirectUrls([redirectUrl]);

    expect(result).toEqual([redirectUrl]);
  });
});
