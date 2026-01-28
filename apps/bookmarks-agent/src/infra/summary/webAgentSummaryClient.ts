import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  BookmarkSummaryService,
  BookmarkContent,
  SummaryError,
} from '../../domain/ports/bookmarkSummaryService.js';
import type { Logger } from 'pino';

export interface WebAgentSummaryClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

interface PageSummary {
  url: string;
  summary: string;
  wordCount: number;
  estimatedReadingMinutes: number;
}

interface PageSummaryResult {
  url: string;
  status: 'success' | 'failed';
  summary?: PageSummary;
  error?: { code: string; message: string };
}

interface WebAgentSummaryResponse {
  success: boolean;
  data?: {
    result: PageSummaryResult;
    metadata: {
      durationMs: number;
    };
  };
  error?: string;
}

// Transient HTTP errors that should trigger retry:
// 429: Rate limiting - retry after backoff
// 503: Service unavailable - retry after backoff
// 504: Gateway timeout - retry after backoff
// Note: 500 is NOT transient (app bug, won't self-heal)
function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

function isTransientErrorCode(code: string): boolean {
  return code === 'TIMEOUT' || code === 'FETCH_FAILED';
}

function mapErrorCode(code: string): SummaryError['code'] {
  switch (code) {
    case 'NO_CONTENT':
      return 'NO_CONTENT';
    case 'API_ERROR':
    case 'FETCH_FAILED':
    case 'TIMEOUT':
    case 'TOO_LARGE':
    case 'INVALID_URL':
    default:
      return 'GENERATION_ERROR';
  }
}

export function createWebAgentSummaryClient(
  config: WebAgentSummaryClientConfig
): BookmarkSummaryService {
  const logger = config.logger;

  return {
    async generateSummary(
      _userId: string,
      content: BookmarkContent
    ): Promise<Result<string, SummaryError>> {
      const endpoint = `${config.baseUrl}/internal/page-summaries`;

      logger.info({ url: content.url }, 'Fetching page summary via web-agent');

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            url: content.url,
            userId: _userId,
            maxSentences: 20,
            maxReadingMinutes: 3,
          }),
        });
      } catch (error) {
        logger.error({ url: content.url, error: getErrorMessage(error) }, 'Failed to call web-agent summary');
        return err({
          code: 'GENERATION_ERROR',
          message: `Failed to call web-agent: ${getErrorMessage(error)}`,
          transient: true,
        });
      }

      if (!response.ok) {
        logger.error(
          { httpStatus: response.status, statusText: response.statusText },
          'web-agent summary returned error'
        );
        return err({
          code: 'GENERATION_ERROR',
          message: `HTTP ${String(response.status)}: ${response.statusText}`,
          transient: isTransientHttpStatus(response.status),
        });
      }

      const body = (await response.json()) as WebAgentSummaryResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from web-agent summary');
        return err({
          code: 'GENERATION_ERROR',
          message: body.error ?? 'Invalid response from web-agent',
          transient: false,
        });
      }

      const result = body.data.result;

      if (result.status === 'failed') {
        const errorCode = mapErrorCode(result.error?.code ?? 'GENERATION_ERROR');
        const isTransient = isTransientErrorCode(result.error?.code ?? '');
        return err({
          code: errorCode,
          message: result.error?.message ?? 'Unknown error',
          transient: isTransient,
        });
      }

      if (result.summary === undefined) {
        return err({
          code: 'GENERATION_ERROR',
          message: 'No summary in successful result',
          transient: false,
        });
      }

      logger.info(
        {
          url: content.url,
          wordCount: result.summary.wordCount,
          estimatedReadingMinutes: result.summary.estimatedReadingMinutes,
        },
        'Page summary fetched successfully'
      );

      return ok(result.summary.summary);
    },
  };
}
