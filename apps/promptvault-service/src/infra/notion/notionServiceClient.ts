/**
 * HTTP client for notion-service internal API.
 * Fetches Notion token context via service-to-service communication.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';

export interface NotionServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export interface NotionTokenContext {
  connected: boolean;
  token: string | null;
}

export interface NotionServiceError {
  code: 'UNAUTHORIZED' | 'DOWNSTREAM_ERROR' | 'INTERNAL_ERROR';
  message: string;
}

export interface NotionServiceClient {
  getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>>;
}

/**
 * Create a Notion service client.
 */
export function createNotionServiceClient(config: NotionServiceConfig): NotionServiceClient {
  return {
    async getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>> {
      try {
        const url = `${config.baseUrl}/internal/notion/users/${userId}/context`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-internal-auth': config.internalAuthToken,
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
  };
}
