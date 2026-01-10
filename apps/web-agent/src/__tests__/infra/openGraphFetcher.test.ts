import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { OpenGraphFetcher } from '../../infra/linkpreview/openGraphFetcher.js';

describe('OpenGraphFetcher', () => {
  let fetcher: OpenGraphFetcher;

  beforeAll(() => {
    nock.disableNetConnect();
    fetcher = new OpenGraphFetcher({ timeoutMs: 5000, maxResponseSize: 2097152 });
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('successful extraction', () => {
    it('extracts Open Graph metadata from HTML', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta property="og:title" content="Test Title">
          <meta property="og:description" content="Test Description">
          <meta property="og:image" content="https://example.com/image.jpg">
          <meta property="og:site_name" content="Example Site">
          <title>Fallback Title</title>
        </head>
        <body></body>
        </html>
      `;

      nock('https://example.com').get('/page').reply(200, html, {
        'content-type': 'text/html',
      });

      const result = await fetcher.fetchPreview('https://example.com/page');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Test Title');
        expect(result.value.description).toBe('Test Description');
        expect(result.value.image).toBe('https://example.com/image.jpg');
        expect(result.value.siteName).toBe('Example Site');
        expect(result.value.url).toBe('https://example.com/page');
      }
    });

    it('falls back to title tag when og:title missing', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Page Title</title>
          <meta name="description" content="Meta description">
        </head>
        <body></body>
        </html>
      `;

      nock('https://example.com').get('/').reply(200, html);

      const result = await fetcher.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Page Title');
        expect(result.value.description).toBe('Meta description');
      }
    });

    it('resolves relative image URLs to absolute', async () => {
      const html = `
        <html>
        <head>
          <meta property="og:image" content="/images/og.png">
        </head>
        </html>
      `;

      nock('https://example.com').get('/page').reply(200, html);

      const result = await fetcher.fetchPreview('https://example.com/page');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.image).toBe('https://example.com/images/og.png');
      }
    });

    it('extracts favicon from link tag', async () => {
      const html = `
        <html>
        <head>
          <link rel="icon" href="/favicon.ico">
          <title>Test</title>
        </head>
        </html>
      `;

      nock('https://example.com').get('/').reply(200, html);

      const result = await fetcher.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.favicon).toBe('https://example.com/favicon.ico');
      }
    });

    it('falls back to /favicon.ico when no link tag', async () => {
      const html = `<html lang="en"><head><title>Test</title></head></html>`;

      nock('https://example.com').get('/page').reply(200, html);

      const result = await fetcher.fetchPreview('https://example.com/page');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.favicon).toBe('https://example.com/favicon.ico');
      }
    });

    it('skips invalid favicon href and tries next selector', async () => {
      const html = `
        <html>
        <head>
          <link rel="icon" href="http://[invalid">
          <link rel="shortcut icon" href="/valid-favicon.ico">
          <title>Test</title>
        </head>
        </html>
      `;

      nock('https://example.com').get('/').reply(200, html);

      const result = await fetcher.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.favicon).toBe('https://example.com/valid-favicon.ico');
      }
    });

    it('handles invalid og:image URL gracefully', async () => {
      const html = `
        <html>
        <head>
          <meta property="og:image" content="http://[invalid">
          <title>Test</title>
        </head>
        </html>
      `;

      nock('https://example.com').get('/').reply(200, html);

      const result = await fetcher.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.image).toBeUndefined();
      }
    });

    it('handles HTML with no metadata gracefully', async () => {
      const html = `<html><body>Just text</body></html>`;

      nock('https://example.com').get('/').reply(200, html);

      const result = await fetcher.fetchPreview('https://example.com/');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://example.com/');
        expect(result.value.title).toBeUndefined();
        expect(result.value.description).toBeUndefined();
      }
    });
  });

  describe('error handling', () => {
    it('returns FETCH_FAILED on HTTP 404', async () => {
      nock('https://example.com').get('/missing').reply(404, 'Not Found');

      const result = await fetcher.fetchPreview('https://example.com/missing');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toContain('404');
      }
    });

    it('returns FETCH_FAILED on HTTP 500', async () => {
      nock('https://example.com').get('/error').reply(500, 'Server Error');

      const result = await fetcher.fetchPreview('https://example.com/error');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns FETCH_FAILED on network error', async () => {
      nock('https://example.com').get('/').replyWithError('Connection refused');

      const result = await fetcher.fetchPreview('https://example.com/');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FETCH_FAILED');
      }
    });

    it('returns TOO_LARGE when content-length exceeds limit', async () => {
      nock('https://example.com').get('/large').reply(200, 'x', {
        'content-length': '1000000000',
      });

      const result = await fetcher.fetchPreview('https://example.com/large');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOO_LARGE');
      }
    });

    it('returns TIMEOUT when request times out', async () => {
      vi.useFakeTimers();

      const shortTimeoutFetcher = new OpenGraphFetcher({ timeoutMs: 100 });

      nock('https://example.com').get('/slow').delay(200).reply(200, '<html></html>');

      const resultPromise = shortTimeoutFetcher.fetchPreview('https://example.com/slow');

      await vi.advanceTimersByTimeAsync(150);

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }

      vi.useRealTimers();
    });

    it('returns TOO_LARGE when streaming response exceeds limit (no content-length header)', async () => {
      const smallFetcher = new OpenGraphFetcher({
        timeoutMs: 5000,
        maxResponseSize: 50,
      });

      const largeContent = '<html>'.padEnd(100, 'x') + '</html>';
      nock('https://example.com').get('/large-stream').reply(200, largeContent, {
        'content-type': 'text/html',
      });

      const result = await smallFetcher.fetchPreview('https://example.com/large-stream');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOO_LARGE');
        expect(result.error.message).toContain('exceeded');
      }
    });

    it('returns FETCH_FAILED for unknown non-Error exceptions', async () => {
      const originalFetch = global.fetch;
      global.fetch = (): never => {
        throw 'string-error';
      };

      try {
        const result = await fetcher.fetchPreview('https://example.com/error');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('FETCH_FAILED');
          expect(result.error.message).toBe('Unknown error');
        }
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('returns FETCH_FAILED when response has no body', async () => {
      const originalFetch = global.fetch;
      global.fetch = (): Promise<Response> =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'text/html' }),
          body: null,
        } as Response);

      try {
        const result = await fetcher.fetchPreview('https://example.com/nobody');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('FETCH_FAILED');
          expect(result.error.message).toBe('No response body');
        }
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('configuration', () => {
    it('uses custom user agent', async () => {
      let capturedHeaders: Record<string, string> = {};

      nock('https://example.com')
        .get('/')
        .reply(function () {
          capturedHeaders = this.req.headers as unknown as Record<string, string>;
          return [200, '<html lang="en"></html>'];
        });

      const customFetcher = new OpenGraphFetcher({
        userAgent: 'CustomBot/1.0',
      });

      await customFetcher.fetchPreview('https://example.com/');

      expect(capturedHeaders['user-agent']).toBe('CustomBot/1.0');
    });
  });
});
