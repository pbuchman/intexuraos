/**
 * HTTP client for notion-service internal API.
 * Fetches Notion token context and page previews via service-to-service communication.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';

export interface NotionServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export interface NotionTokenContext {
  connected: boolean;
  token: string | null;
}

export interface PagePreview {
  title: string;
  url: string;
}

export interface NotionServiceError {
  code: 'UNAUTHORIZED' | 'DOWNSTREAM_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'UNAVAILABLE';
  message: string;
}

export interface NotionServiceClient {
  getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>>;
  getPagePreview(userId: string, pageId: string, logger: Logger): Promise<Result<PagePreview, NotionServiceError>>;
}

/**
 * Create a Notion service client.
 */
export function createNotionServiceClient(config: NotionServiceConfig): NotionServiceClient {
  const INTERNAL_AUTH_HEADER = config.internalAuthToken;

  return {
    async getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>> {
      try {
        const url = `${config.baseUrl}/internal/notion/users/${userId}/context`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-internal-auth': INTERNAL_AUTH_HEADER,
            'content-type': 'application/json',
          },
        });

        if (response.status === 401) {
          return err({
            code: 'UNAUTHORIZED',
            message: 'Internal auth failed when calling notion-service',
          });
        }

        if (!response.ok) {
          return err({
            code: 'DOWNSTREAM_ERROR',
            message: `notion-service returned ${String(response.status)}: ${response.statusText}`,
          });
        }

        const data = (await response.json()) as NotionTokenContext;
        return ok(data);
      } catch (error) {
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to fetch Notion token from notion-service: ${getErrorMessage(error)}`,
        });
      }
    },

    async getPagePreview(
      userId: string,
      pageId: string,
      logger: Logger
    ): Promise<Result<PagePreview, NotionServiceError>> {
      const url = `${config.baseUrl}/internal/notion/users/${encodeURIComponent(userId)}/pages/${encodeURIComponent(pageId)}/preview`;

      logger.debug({ userId, pageId }, 'Fetching page preview from notion-service');

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-internal-auth': INTERNAL_AUTH_HEADER,
            'content-type': 'application/json',
          },
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          const message = body.error ?? 'Unknown error';

          if (response.status === 404) {
            return err({ code: 'NOT_FOUND', message });
          }
          return err({ code: 'UNAVAILABLE', message });
        }

        const data = (await response.json()) as { success: true; data: PagePreview };
        return ok(data.data);
      } catch (error) {
        logger.error({ error, userId, pageId }, 'Failed to fetch page preview');
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to fetch page preview: ${getErrorMessage(error)}`,
        });
      }
    },
  };
}
