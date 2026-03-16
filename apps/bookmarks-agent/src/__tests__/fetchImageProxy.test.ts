import { describe, it, expect, afterEach, vi } from 'vitest';
import nock from 'nock';
import { createFetchImageProxy } from '../infra/imageProxy/fetchImageProxy.js';

describe('fetchImageProxy', () => {
  const proxy = createFetchImageProxy();

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns image buffer and content type for valid image URL', async () => {
    const imageData = Buffer.from('fake-image-data');
    nock('https://example.com')
      .get('/test-image.jpg')
      .reply(200, imageData, { 'content-type': 'image/jpeg' });

    const encodedUrl = encodeURIComponent('https://example.com/test-image.jpg');
    const result = await proxy.proxyImage(encodedUrl);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contentType).toBe('image/jpeg');
      expect(result.value.buffer.length).toBeGreaterThan(0);
    }
  });

  it('returns INVALID_URL for malformed URL', async () => {
    const result = await proxy.proxyImage('not-a-valid-url');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_URL');
      expect(result.error.message).toBe('Invalid URL format');
      expect(result.error.httpStatus).toBe(400);
    }
  });

  it('returns INVALID_URL for non-HTTP protocol', async () => {
    const encodedUrl = encodeURIComponent('ftp://example.com/image.jpg');
    const result = await proxy.proxyImage(encodedUrl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_URL');
      expect(result.error.message).toBe('Only HTTP/HTTPS URLs are allowed');
      expect(result.error.httpStatus).toBe(400);
    }
  });

  it('returns FETCH_FAILED when upstream returns non-2xx', async () => {
    nock('https://example.com').get('/missing.jpg').reply(404);

    const encodedUrl = encodeURIComponent('https://example.com/missing.jpg');
    const result = await proxy.proxyImage(encodedUrl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FETCH_FAILED');
      expect(result.error.httpStatus).toBe(404);
    }
  });

  it('returns NOT_AN_IMAGE when content type is not image', async () => {
    nock('https://example.com')
      .get('/page.html')
      .reply(200, '<html></html>', { 'content-type': 'text/html' });

    const encodedUrl = encodeURIComponent('https://example.com/page.html');
    const result = await proxy.proxyImage(encodedUrl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_AN_IMAGE');
      expect(result.error.httpStatus).toBe(400);
    }
  });

  it('defaults to image/jpeg when content-type is missing', async () => {
    const imageData = Buffer.from('fake-image-data');
    nock('https://example.com').get('/image.jpg').reply(200, imageData);

    const encodedUrl = encodeURIComponent('https://example.com/image.jpg');
    const result = await proxy.proxyImage(encodedUrl);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contentType).toBe('image/jpeg');
    }
  });

  it('returns PROXY_ERROR on network error', async () => {
    nock('https://example.com').get('/error.jpg').replyWithError('Network error');

    const encodedUrl = encodeURIComponent('https://example.com/error.jpg');
    const result = await proxy.proxyImage(encodedUrl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROXY_ERROR');
      expect(result.error.httpStatus).toBe(500);
    }
  });

  it('returns TIMEOUT when fetch takes too long', async () => {
    vi.useFakeTimers();

    nock('https://example.com')
      .get('/slow.jpg')
      .delay(15000)
      .reply(200, Buffer.from('image-data'), { 'content-type': 'image/jpeg' });

    const encodedUrl = encodeURIComponent('https://example.com/slow.jpg');
    const resultPromise = proxy.proxyImage(encodedUrl);

    await vi.advanceTimersByTimeAsync(10001);

    const result = await resultPromise;

    vi.useRealTimers();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TIMEOUT');
      expect(result.error.httpStatus).toBe(504);
    }
  });
});
