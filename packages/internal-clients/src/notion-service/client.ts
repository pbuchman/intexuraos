import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  NotionPagePreview,
  NotionTokenContext as SharedNotionTokenContext,
} from '@intexuraos/http-contracts';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
import type {
  NotionServiceClient,
  NotionServiceConfig,
  NotionServiceError,
  NotionTokenContext,
  PagePreview,
} from './types.js';

function extractErrorMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || !('error' in body)) {
    return undefined;
  }

  const error = body.error;
  if (typeof error === 'string') {
    return error;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  return undefined;
}

export function createNotionServiceClient(config: NotionServiceConfig): NotionServiceClient {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  });

  return {
    async getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>> {
      const result = await httpClient.request<SharedNotionTokenContext>({
        path: `/internal/notion/users/${userId}/context`,
        method: 'GET',
        extraHeaders: {
          'content-type': 'application/json',
        },
      });

      if (result.ok) {
        return ok(result.value);
      }

      if (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT') {
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to fetch Notion token from notion-service: ${result.error.message}`,
        });
      }

      if (result.error.code === 'API_ERROR' && result.error.status === 401) {
        return err({
          code: 'UNAUTHORIZED',
          message: 'Internal auth failed when calling notion-service',
        });
      }

      if (result.error.code === 'API_ERROR') {
        return err({
          code: 'DOWNSTREAM_ERROR',
          message: `notion-service returned ${String(result.error.status)}: ${result.error.statusText}`,
        });
      }

      return err({
        code: 'DOWNSTREAM_ERROR',
        message: result.error.message,
      });
    },

    async getPagePreview(
      userId: string,
      pageId: string
    ): Promise<Result<PagePreview, NotionServiceError>> {
      const result = await httpClient.request<NotionPagePreview>({
        path: `/internal/notion/users/${encodeURIComponent(userId)}/pages/${encodeURIComponent(pageId)}/preview`,
        method: 'GET',
        extraHeaders: {
          'content-type': 'application/json',
        },
      });

      if (result.ok) {
        return ok(result.value);
      }

      if (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT') {
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to fetch page preview: ${result.error.message}`,
        });
      }

      if (result.error.code === 'API_ERROR') {
        const message = extractErrorMessage(result.error.body) ?? 'Unknown error';
        if (result.error.status === 404) {
          return err({ code: 'NOT_FOUND', message });
        }
        return err({ code: 'UNAVAILABLE', message });
      }

      return err({
        code: 'UNAVAILABLE',
        message: result.error.message,
      });
    },
  };
}
