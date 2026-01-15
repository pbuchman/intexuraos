import { err, ok, type Result } from '@intexuraos/common-core';
import type { LinkPreviewFetcherPort } from '../../domain/linkpreview/ports/linkPreviewFetcher.js';
import type { LinkPreview, LinkPreviewError } from '../../domain/linkpreview/models/LinkPreview.js';
import type { Logger } from 'pino';
import * as cheerio from 'cheerio';

export interface OpenGraphFetcherConfig {
  timeoutMs: number;
  maxResponseSize: number;
  userAgent: string;
}

const DEFAULT_CONFIG: OpenGraphFetcherConfig = {
  timeoutMs: 5000,
  maxResponseSize: 2097152, // 2MB
  userAgent: 'Mozilla/5.0 (compatible; IntexuraOSBot/1.0; +https://intexuraos.cloud)',
};

function extractFavicon($: cheerio.CheerioAPI, baseUrl: string): string | undefined {
  const iconSelectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
  ];

  for (const selector of iconSelectors) {
    const href = $(selector).attr('href');
    if (href !== undefined && href !== '') {
      try {
        return new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }
  }

  try {
    const url = new URL(baseUrl);
    return `${url.origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

function resolveImageUrl(imageUrl: string | undefined, baseUrl: string): string | undefined {
  if (imageUrl === undefined || imageUrl === '') {
    return undefined;
  }

  try {
    return new URL(imageUrl, baseUrl).href;
  } catch {
    return undefined;
  }
}

export class OpenGraphFetcher implements LinkPreviewFetcherPort {
  private readonly config: OpenGraphFetcherConfig;
  private readonly logger: Logger;

  constructor(config: Partial<OpenGraphFetcherConfig> = {}, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  async fetchPreview(url: string): Promise<Result<LinkPreview, LinkPreviewError>> {
    this.logger.info({ url }, 'Starting OpenGraph fetch');

    const controller = new AbortController();
    const timeoutId = setTimeout((): void => {
      this.logger.warn({ url, timeoutMs: this.config.timeoutMs }, 'Request timed out');
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.config.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(
          {
            url,
            status: response.status,
            statusText: response.statusText,
          },
          'HTTP error response'
        );
        return err({
          code: 'FETCH_FAILED',
          message: `HTTP ${String(response.status)}: ${response.statusText}`,
        });
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && parseInt(contentLength, 10) > this.config.maxResponseSize) {
        this.logger.warn(
          {
            url,
            contentLength: parseInt(contentLength, 10),
            maxResponseSize: this.config.maxResponseSize,
          },
          'Response too large (content-length header)'
        );
        return err({
          code: 'TOO_LARGE',
          message: `Response too large: ${contentLength} bytes`,
        });
      }

      this.logger.info({ url, status: response.status }, 'HTTP request successful, reading body');

      const reader = response.body?.getReader();
      if (reader === undefined) {
        this.logger.error({ url }, 'No response body');
        return err({
          code: 'FETCH_FAILED',
          message: 'No response body',
        });
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const readResult = await reader.read();
        if (readResult.done) break;

        const chunk = readResult.value as Uint8Array;
        totalSize += chunk.length;
        if (totalSize > this.config.maxResponseSize) {
          reader.cancel().catch((): void => {
            // Ignore cancel errors
          });
          this.logger.warn(
            {
              url,
              totalSize,
              maxResponseSize: this.config.maxResponseSize,
            },
            'Response exceeded max size during streaming'
          );
          return err({
            code: 'TOO_LARGE',
            message: `Response exceeded ${String(this.config.maxResponseSize)} bytes`,
          });
        }
        chunks.push(chunk);
      }

      this.logger.info({ url, totalSize }, 'Response body read, parsing HTML');

      const html = new TextDecoder().decode(
        chunks.reduce((acc: Uint8Array, chunk: Uint8Array): Uint8Array => {
          const combined = new Uint8Array(acc.length + chunk.length);
          combined.set(acc);
          combined.set(chunk, acc.length);
          return combined;
        }, new Uint8Array(0))
      );

      const $ = cheerio.load(html);

      const ogTitle = $('meta[property="og:title"]').attr('content');
      const ogDescription = $('meta[property="og:description"]').attr('content');
      const ogImage = $('meta[property="og:image"]').attr('content');
      const ogSiteName = $('meta[property="og:site_name"]').attr('content');

      const titleText = $('title').text().trim();
      const title = ogTitle ?? (titleText !== '' ? titleText : undefined);
      const metaDescription = $('meta[name="description"]').attr('content');
      const description = ogDescription ?? metaDescription;

      const preview: LinkPreview = {
        url,
      };

      if (title !== undefined && title !== '') {
        preview.title = title;
      }

      if (description !== undefined && description !== '') {
        preview.description = description;
      }

      const resolvedImage = resolveImageUrl(ogImage, url);
      if (resolvedImage !== undefined) {
        preview.image = resolvedImage;
      }

      if (ogSiteName !== undefined && ogSiteName !== '') {
        preview.siteName = ogSiteName;
      }

      const favicon = extractFavicon($, url);
      if (favicon !== undefined) {
        preview.favicon = favicon;
      }

      this.logger.info(
        {
          url,
          hasTitle: preview.title !== undefined,
          hasDescription: preview.description !== undefined,
          hasImage: preview.image !== undefined,
          hasFavicon: preview.favicon !== undefined,
          hasSiteName: preview.siteName !== undefined,
        },
        'OpenGraph fetch completed successfully'
      );

      return ok(preview);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          this.logger.warn({ url, timeoutMs: this.config.timeoutMs }, 'Request timed out (AbortError)');
          return err({
            code: 'TIMEOUT',
            message: `Request timed out after ${String(this.config.timeoutMs)}ms`,
          });
        }

        this.logger.error({ url, error: error.message }, 'Fetch failed');
        return err({
          code: 'FETCH_FAILED',
          message: error.message,
        });
      }

      this.logger.error({ url }, 'Unknown error during fetch');
      return err({
        code: 'FETCH_FAILED',
        message: 'Unknown error',
      });
    }
  }
}
