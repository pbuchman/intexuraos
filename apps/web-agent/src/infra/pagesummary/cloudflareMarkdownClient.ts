import { err, ok, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';

export interface CloudflareMarkdownClientConfig {
  accountId: string;
  apiToken: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60000;

export interface PageContentError {
  code: 'FETCH_FAILED' | 'TIMEOUT' | 'INVALID_URL' | 'NO_CONTENT' | 'API_ERROR' | 'RATE_LIMITED';
  message: string;
}

export interface PageContentFetcher {
  fetchPageContent(url: string): Promise<Result<string, PageContentError>>;
}

interface CloudflareApiResponse {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: string[];
  result: unknown;
}

/**
 * Creates a page content fetcher that uses Cloudflare Browser Rendering /markdown endpoint.
 *
 * API: POST /client/v4/accounts/{account_id}/browser-rendering/markdown
 * Auth: Bearer token
 * Docs: https://developers.cloudflare.com/browser-rendering/rest-api/markdown-endpoint/
 */
export function createCloudflareMarkdownClient(
  config: CloudflareMarkdownClientConfig,
  logger: Logger
): PageContentFetcher {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpointUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/browser-rendering/markdown`;

  return {
    async fetchPageContent(url: string): Promise<Result<string, PageContentError>> {
      logger.info({ url }, 'Starting page content fetch via Cloudflare');

      try {
        new URL(url);
      } catch {
        logger.warn({ url }, 'Invalid URL provided');
        return err({
          code: 'INVALID_URL',
          message: `Invalid URL: ${url}`,
        });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout((): void => {
        logger.warn({ url, timeoutMs }, 'Request timed out');
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiToken}`,
          },
          body: JSON.stringify({
            url,
            rejectResourceTypes: ['image', 'media', 'font', 'stylesheet'],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.warn(
            { url, status: response.status, statusText: response.statusText },
            'Cloudflare API error response'
          );

          if (response.status === 429) {
            return err({
              code: 'RATE_LIMITED',
              message: `Cloudflare rate limited: HTTP ${String(response.status)}`,
            });
          }

          return err({
            code: 'API_ERROR',
            message: `Cloudflare API error: HTTP ${String(response.status)}`,
          });
        }

        let data: CloudflareApiResponse;
        try {
          data = (await response.json()) as CloudflareApiResponse;
        } catch (jsonError) {
          logger.error(
            { url, error: getErrorMessage(jsonError) },
            'Invalid JSON response from Cloudflare'
          );
          return err({
            code: 'API_ERROR',
            message: 'Cloudflare returned invalid JSON response',
          });
        }

        if (!data.success) {
          const errorMsg = data.errors[0]?.message ?? 'Cloudflare request failed';
          logger.warn({ url, errors: data.errors }, 'Cloudflare extraction failed');
          return err({
            code: 'FETCH_FAILED',
            message: errorMsg,
          });
        }

        // Result may be a string directly or an object with a markdown field
        const raw =
          typeof data.result === 'string'
            ? data.result
            : typeof data.result === 'object' &&
                data.result !== null &&
                'markdown' in data.result &&
                typeof (data.result as Record<string, unknown>)['markdown'] === 'string'
              ? ((data.result as Record<string, unknown>)['markdown'] as string)
              : undefined;
        const markdown = raw?.trim();

        if (markdown === undefined || markdown === '') {
          logger.info({ url }, 'No markdown content extracted from page');
          return err({
            code: 'NO_CONTENT',
            message: 'No content could be extracted from the page',
          });
        }

        logger.info({ url, contentLength: markdown.length }, 'Page content fetched successfully');

        return ok(markdown);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            logger.warn({ url, timeoutMs }, 'Request timed out (AbortError)');
            return err({
              code: 'TIMEOUT',
              message: `Request timed out after ${String(timeoutMs)}ms`,
            });
          }

          logger.error({ url, error: error.message }, 'Cloudflare request failed');
          return err({
            code: 'FETCH_FAILED',
            message: error.message,
          });
        }

        logger.error({ url }, 'Unknown error during Cloudflare request');
        return err({
          code: 'FETCH_FAILED',
          message: 'Unknown error',
        });
      }
    },
  };
}
