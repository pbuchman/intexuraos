import { describe, it, expect } from './testUtils.js';
import { setupTestContext } from './testUtils.js';

describe('Image Proxy Routes', () => {
  const ctx = setupTestContext();

  describe('GET /images/proxy', () => {
    it('returns proxied image with correct headers', async () => {
      ctx.imageProxy.setNextResult({
        buffer: Buffer.from('fake-image-data'),
        contentType: 'image/png',
      });

      const encodedUrl = encodeURIComponent('https://example.com/test-image.png');
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/images/proxy?url=${encodedUrl}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('returns 400 for missing url parameter', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/images/proxy',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid URL format', async () => {
      ctx.imageProxy.setNextError({
        code: 'INVALID_URL',
        message: 'Invalid URL format',
        httpStatus: 400,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/images/proxy?url=not-a-valid-url',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_URL');
    });

    it('returns 400 for non-http URL', async () => {
      ctx.imageProxy.setNextError({
        code: 'INVALID_URL',
        message: 'Only HTTP/HTTPS URLs are allowed',
        httpStatus: 400,
      });

      const encodedUrl = encodeURIComponent('ftp://example.com/image.jpg');
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/images/proxy?url=${encodedUrl}`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INVALID_URL');
      expect(body.error.message).toBe('Only HTTP/HTTPS URLs are allowed');
    });

    it('returns 400 for non-image content type', async () => {
      ctx.imageProxy.setNextError({
        code: 'NOT_AN_IMAGE',
        message: 'URL does not point to an image',
        httpStatus: 400,
      });

      const encodedUrl = encodeURIComponent('https://example.com/not-an-image.html');
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/images/proxy?url=${encodedUrl}`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_AN_IMAGE');
    });

    it('returns upstream error status on fetch failure', async () => {
      ctx.imageProxy.setNextError({
        code: 'FETCH_FAILED',
        message: 'Failed to fetch image: 404',
        httpStatus: 404,
      });

      const encodedUrl = encodeURIComponent('https://example.com/missing.jpg');
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/images/proxy?url=${encodedUrl}`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('FETCH_FAILED');
    });

    it('returns 504 on timeout', async () => {
      ctx.imageProxy.setNextError({
        code: 'TIMEOUT',
        message: 'Image fetch timed out',
        httpStatus: 504,
      });

      const encodedUrl = encodeURIComponent('https://example.com/slow-image.jpg');
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/images/proxy?url=${encodedUrl}`,
      });

      expect(response.statusCode).toBe(504);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('TIMEOUT');
      expect(body.error.message).toBe('Image fetch timed out');
    });

    it('returns 500 on network error', async () => {
      ctx.imageProxy.setNextError({
        code: 'PROXY_ERROR',
        message: 'Failed to proxy image',
        httpStatus: 500,
      });

      const encodedUrl = encodeURIComponent('https://example.com/error.jpg');
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/images/proxy?url=${encodedUrl}`,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('PROXY_ERROR');
    });

  });
});
