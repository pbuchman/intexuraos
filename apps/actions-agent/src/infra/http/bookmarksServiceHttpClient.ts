import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage, ServiceErrorCodes } from '@intexuraos/common-core';
import type {
  BookmarksServiceClient,
  CreateBookmarkRequest,
  CreateBookmarkResponse,
  CreateBookmarkError,
  ForceRefreshBookmarkResponse,
} from '../../domain/ports/bookmarksServiceClient.js';
import { type Logger } from 'pino';

export interface BookmarksServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: { existingBookmarkId?: string } };
}

export function createBookmarksServiceHttpClient(
  config: BookmarksServiceHttpClientConfig
): BookmarksServiceClient {
  const { logger } = config;

  return {
    async createBookmark(
      request: CreateBookmarkRequest
    ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>> {
      const url = `${config.baseUrl}/internal/bookmarks`;

      logger.info({ url, userId: request.userId }, 'Creating bookmark via bookmarks-agent');

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify(request),
        });
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call bookmarks-agent');
        return err({
          message: `Failed to call bookmarks-agent: ${getErrorMessage(error)}`,
          errorCode: ServiceErrorCodes.SERVICE_UNAVAILABLE,
        });
      }

      if (!response.ok) {
        let message: string;
        let errorCode: string | undefined;
        let existingBookmarkId: string | undefined;
        try {
          const body = (await response.json()) as ApiResponse;
          errorCode = body.error?.code;
          existingBookmarkId = body.error?.details?.existingBookmarkId;
          message = body.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
        } catch {
          message = `HTTP ${String(response.status)}: ${response.statusText}`;
        }

        logger.error(
          { httpStatus: response.status, message, errorCode, existingBookmarkId },
          'bookmarks-agent returned error'
        );
        return err({
          message,
          ...(errorCode !== undefined && { errorCode }),
          ...(existingBookmarkId !== undefined && existingBookmarkId !== '' && { existingBookmarkId }),
        });
      }

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from bookmarks-agent');
        return err({
          message: body.error?.message ?? 'Invalid response from bookmarks-agent',
          ...(body.error?.code !== undefined && { errorCode: body.error.code }),
        });
      }

      const data = body.data as {
        id: string;
        userId: string;
        url: string;
        title: string | null;
      };
      const result: CreateBookmarkResponse = {
        id: data.id,
        userId: data.userId,
        url: data.url,
        title: data.title,
      };

      logger.info({ bookmarkId: result.id }, 'Bookmark created successfully');
      return ok(result);
    },

    async forceRefreshBookmark(
      bookmarkId: string
    ): Promise<Result<ForceRefreshBookmarkResponse>> {
      const url = `${config.baseUrl}/internal/bookmarks/${bookmarkId}/force-refresh`;

      logger.info({ bookmarkId }, 'Force refreshing bookmark via bookmarks-agent');

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call bookmarks-agent');
        return err(new Error(`Failed to call bookmarks-agent: ${getErrorMessage(error)}`));
      }

      if (!response.ok) {
        let message: string;
        try {
          const body = (await response.json()) as ApiResponse;
          message = body.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
        } catch {
          // Response is not JSON, use status text
          message = `HTTP ${String(response.status)}: ${response.statusText}`;
        }

        logger.error(
          { httpStatus: response.status, message },
          'bookmarks-agent returned error'
        );
        return err(new Error(message));
      }

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from bookmarks-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from bookmarks-agent'));
      }

      const data = body.data as ForceRefreshBookmarkResponse;
      logger.info({ bookmarkId: data.id }, 'Bookmark force refreshed successfully');
      return ok(data);
    },
  };
}
