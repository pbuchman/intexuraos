import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  NotionPagePreview,
  NotionTokenContext as SharedNotionTokenContext,
} from '@intexuraos/http-contracts';
import { unwrapEnvelope } from '../shared/envelope.js';
import { sendInternalRequest } from '../shared/request.js';
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
  const authToken = config.internalAuthToken;

  return {
    async getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: `/internal/notion/users/${userId}/context`,
        method: 'GET',
        token: authToken,
        logger: { warn: () => undefined },
        headers: {
          'content-type': 'application/json',
        },
      });

      if (!transport.ok) {
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to fetch Notion token from notion-service: ${transport.error.message}`,
        });
      }

      if (transport.response.status === 401) {
        return err({
          code: 'UNAUTHORIZED',
          message: 'Internal auth failed when calling notion-service',
        });
      }

      if (!transport.response.ok) {
        return err({
          code: 'DOWNSTREAM_ERROR',
          message: `notion-service returned ${String(transport.response.status)}: ${transport.response.statusText}`,
        });
      }

      const envelope = unwrapEnvelope<SharedNotionTokenContext>(transport.body);
      if (!envelope.ok) {
        return err({
          code: 'DOWNSTREAM_ERROR',
          message: envelope.error.message,
        });
      }

      return ok(envelope.value);
    },

    async getPagePreview(
      userId: string,
      pageId: string
    ): Promise<Result<PagePreview, NotionServiceError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: `/internal/notion/users/${encodeURIComponent(userId)}/pages/${encodeURIComponent(pageId)}/preview`,
        method: 'GET',
        token: authToken,
        logger: { warn: () => undefined },
        headers: {
          'content-type': 'application/json',
        },
      });

      if (!transport.ok) {
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to fetch page preview: ${transport.error.message}`,
        });
      }

      if (!transport.response.ok) {
        const message = extractErrorMessage(transport.body) ?? 'Unknown error';
        if (transport.response.status === 404) {
          return err({ code: 'NOT_FOUND', message });
        }
        return err({ code: 'UNAVAILABLE', message });
      }

      const envelope = unwrapEnvelope<NotionPagePreview>(transport.body);
      if (!envelope.ok) {
        return err({
          code: 'UNAVAILABLE',
          message: envelope.error.message,
        });
      }

      return ok(envelope.value);
    },
  };
}
