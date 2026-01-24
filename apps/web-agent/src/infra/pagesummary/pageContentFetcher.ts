/**
 * Fetches page content using Crawl4AI WITHOUT LLM extraction.
 * Returns raw markdown content for separate summarization.
 */

import { err, ok, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';

export interface PageContentFetcherConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: Omit<PageContentFetcherConfig, 'apiKey'> = {
  baseUrl: 'https://api.crawl4ai.com',
  timeoutMs: 60000,
};

/**
 * Error from page content fetching.
 */
export interface PageContentError {
  code: 'FETCH_FAILED' | 'TIMEOUT' | 'INVALID_URL' | 'NO_CONTENT' | 'API_ERROR';
  message: string;
}

interface Crawl4AIResponse {
  success: boolean;
  url?: string;
  html?: string;
  cleaned_html?: string;
  markdown?: {
    raw_markdown?: string;
  };
  error_message?: string;
  status_code?: number;
  duration_ms?: number;
}

/**
 * Client interface for fetching page content only (no summarization).
 */
export interface PageContentFetcher {
  fetchPageContent(url: string): Promise<Result<string, PageContentError>>;
}

/**
 * Create a page content fetcher with the given configuration.
 */
export function createPageContentFetcher(
  config: Partial<PageContentFetcherConfig> & { apiKey: string },
  logger: Logger
): PageContentFetcher {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    async fetchPageContent(url: string): Promise<Result<string, PageContentError>> {
      logger.info({ url }, 'Starting page content fetch');

      const controller = new AbortController();
      const timeoutId = setTimeout((): void => {
        logger.warn({ url, timeoutMs: fullConfig.timeoutMs }, 'Request timed out');
        controller.abort();
      }, fullConfig.timeoutMs);

      try {
        // Use Crawl4AI WITHOUT LLM extraction - just get the raw markdown
        const payload = {
          url,
          strategy: 'browser',
          bypass_cache: true,
        };

        const response = await fetch(`${fullConfig.baseUrl}/v1/crawl`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': fullConfig.apiKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.warn(
            {
              url,
              status: response.status,
              statusText: response.statusText,
            },
            'Crawl4AI API error response'
          );
          return err({
            code: 'API_ERROR',
            message: `Crawl4AI API error: HTTP ${String(response.status)}`,
          });
        }

        let data: Crawl4AIResponse;
        try {
          data = (await response.json()) as Crawl4AIResponse;
        } catch (jsonError) {
          logger.error({ url, error: getErrorMessage(jsonError) }, 'Invalid JSON response from Crawl4AI');
          return err({
            code: 'API_ERROR',
            message: 'Crawl4AI returned invalid JSON response',
          });
        }

        if (!data.success) {
          logger.warn({ url, error: data.error_message }, 'Crawl4AI crawl failed');
          return err({
            code: 'FETCH_FAILED',
            message: data.error_message ?? 'Crawl4AI crawl failed',
          });
        }

        const markdown = data.markdown?.raw_markdown?.trim();

        logger.debug(
          {
            url,
            hasMarkdown: markdown !== undefined,
            durationMs: data.duration_ms,
          },
          'Crawl4AI response fields'
        );

        if (markdown === undefined || markdown === '') {
          logger.warn({ url }, 'No markdown content extracted from page');
          return err({
            code: 'NO_CONTENT',
            message: 'No content could be extracted from the page',
          });
        }

        logger.info(
          {
            url,
            contentLength: markdown.length,
          },
          'Page content fetched successfully'
        );

        return ok(markdown);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            logger.warn({ url, timeoutMs: fullConfig.timeoutMs }, 'Request timed out (AbortError)');
            return err({
              code: 'TIMEOUT',
              message: `Request timed out after ${String(fullConfig.timeoutMs)}ms`,
            });
          }

          logger.error({ url, error: error.message }, 'Crawl4AI request failed');
          return err({
            code: 'FETCH_FAILED',
            message: error.message,
          });
        }

        logger.error({ url }, 'Unknown error during Crawl4AI request');
        return err({
          code: 'FETCH_FAILED',
          message: 'Unknown error',
        });
      }
    },
  };
}
