import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { createWebAgentServiceClient } from '@intexuraos/internal-clients';
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

function normalizeHint(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
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
  const client = createWebAgentServiceClient(config);

  return {
    async generateSummary(
      userId: string,
      content: BookmarkContent
    ): Promise<Result<string, SummaryError>> {
      logger.info({ url: content.url }, 'Fetching page summary via web-agent');

      const title = normalizeHint(content.title);
      const description = normalizeHint(content.description);
      const result = await client.summarizePage({
        url: content.url,
        userId,
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        maxSentences: 20,
        maxReadingMinutes: 3,
      });

      if (!result.ok) {
        return err({
          code: mapErrorCode(result.error.code),
          message: result.error.message,
          transient: result.error.transient,
        });
      }

      logger.info(
        {
          url: content.url,
          wordCount: result.value.wordCount,
          estimatedReadingMinutes: result.value.estimatedReadingMinutes,
        },
        'Page summary fetched successfully'
      );

      return ok(result.value.summary);
    },
  };
}
