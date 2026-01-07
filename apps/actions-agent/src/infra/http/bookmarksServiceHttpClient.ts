import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  BookmarksServiceClient,
  CreateBookmarkRequest,
  CreateBookmarkResponse,
} from '../../domain/ports/bookmarksServiceClient.js';
import pino from 'pino';

export interface BookmarksServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'bookmarksServiceHttpClient',
});

interface ApiResponse {
  success: boolean;
  data?: {
    id: string;
    userId: string;
    url: string;
    title: string | null;
  };
  error?: { code: string; message: string };
}

export function createBookmarksServiceHttpClient(
  config: BookmarksServiceHttpClientConfig
): BookmarksServiceClient {
  return {
    async createBookmark(request: CreateBookmarkRequest): Promise<Result<CreateBookmarkResponse>> {
      const url = `${config.baseUrl}/internal/bookmarks/bookmarks`;

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
        return err(new Error(`Failed to call bookmarks-agent: ${getErrorMessage(error)}`));
      }

      if (!response.ok) {
        logger.error(
          { httpStatus: response.status, statusText: response.statusText },
          'bookmarks-agent returned error'
        );
        return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
      }

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from bookmarks-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from bookmarks-agent'));
      }

      const result: CreateBookmarkResponse = {
        id: body.data.id,
        userId: body.data.userId,
        url: body.data.url,
        title: body.data.title,
      };

      logger.info({ bookmarkId: result.id }, 'Bookmark created successfully');
      return ok(result);
    },
  };
}
