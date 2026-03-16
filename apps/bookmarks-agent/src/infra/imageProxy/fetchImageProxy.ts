import type { Result } from '@intexuraos/common-core';
import type { ImageProxyPort, ImageProxyError, ImageProxyResult } from '../../domain/ports/imageProxy.js';

export function createFetchImageProxy(): ImageProxyPort {
  return {
    async proxyImage(encodedUrl: string): Promise<Result<ImageProxyResult, ImageProxyError>> {
      let imageUrl: string;
      try {
        imageUrl = decodeURIComponent(encodedUrl);
        const parsed = new URL(imageUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return {
            ok: false,
            error: {
              code: 'INVALID_URL',
              message: 'Only HTTP/HTTPS URLs are allowed',
              httpStatus: 400,
            },
          };
        }
      } catch {
        return {
          ok: false,
          error: { code: 'INVALID_URL', message: 'Invalid URL format', httpStatus: 400 },
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 10000);

      try {
        const response = await fetch(imageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; IntexuraOS/1.0; +https://intexuraos.cloud)',
            Accept: 'image/*',
          },
        });

        if (!response.ok) {
          return {
            ok: false,
            error: {
              code: 'FETCH_FAILED',
              message: `Failed to fetch image: ${String(response.status)}`,
              httpStatus: response.status,
            },
          };
        }

        const contentType = response.headers.get('content-type') ?? 'image/jpeg';
        if (!contentType.startsWith('image/')) {
          return {
            ok: false,
            error: {
              code: 'NOT_AN_IMAGE',
              message: 'URL does not point to an image',
              httpStatus: 400,
            },
          };
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        return { ok: true, value: { buffer, contentType } };
      } catch (error) {
        const isAborted = error instanceof Error && error.name === 'AbortError';
        if (isAborted) {
          return {
            ok: false,
            error: { code: 'TIMEOUT', message: 'Image fetch timed out', httpStatus: 504 },
          };
        }
        return {
          ok: false,
          error: { code: 'PROXY_ERROR', message: 'Failed to proxy image', httpStatus: 500 },
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
