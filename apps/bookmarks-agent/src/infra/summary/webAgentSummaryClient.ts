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
            maxSentences: 20,
            maxReadingMinutes: 3,
          }),
        });
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call web-agent summary');
        return err({
          code: 'GENERATION_ERROR',
          message: `Failed to call web-agent: ${getErrorMessage(error)}`,
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
        });
      }

      const body = (await response.json()) as WebAgentSummaryResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from web-agent summary');
        return err({
          code: 'GENERATION_ERROR',
          message: body.error ?? 'Invalid response from web-agent',
        });
      }

      const result = body.data.result;

      if (result.status === 'failed') {
        const errorCode = mapErrorCode(result.error?.code ?? 'GENERATION_ERROR');
        return err({
          code: errorCode,
          message: result.error?.message ?? 'Unknown error',
        });
      }

      if (result.summary === undefined) {
        return err({ code: 'GENERATION_ERROR', message: 'No summary in successful result' });
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
