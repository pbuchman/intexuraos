/**
 * HTTP client for notion-service internal API.
 * Fetches Notion token context and page previews via service-to-service communication.
 */
import { createNotionServiceClient as createInternalNotionServiceClient } from '@intexuraos/internal-clients';
import type {
  NotionServiceError,
  NotionTokenContext,
  PagePreview,
} from '@intexuraos/internal-clients';
export type {
  NotionServiceError,
  NotionTokenContext,
  PagePreview,
} from '@intexuraos/internal-clients';
import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';

export interface NotionServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export interface NotionServiceClient {
  getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>>;
  getPagePreview(
    userId: string,
    pageId: string,
    logger: Logger
  ): Promise<Result<PagePreview, NotionServiceError>>;
}

export function createNotionServiceClient(config: NotionServiceConfig): NotionServiceClient {
  const client = createInternalNotionServiceClient(config);

  return {
    async getNotionToken(
      userId: string
    ): Promise<Result<NotionTokenContext, NotionServiceError>> {
      return await client.getNotionToken(userId);
    },

    async getPagePreview(
      userId: string,
      pageId: string,
      logger: Logger
    ): Promise<Result<PagePreview, NotionServiceError>> {
      logger.debug({ userId, pageId }, 'Fetching page preview from notion-service');
      const result = await client.getPagePreview(userId, pageId);
      if (!result.ok && result.error.code === 'INTERNAL_ERROR') {
        logger.error(
          { error: new Error(result.error.message), userId, pageId },
          'Failed to fetch page preview'
        );
      }
      return result;
    },
  };
}
