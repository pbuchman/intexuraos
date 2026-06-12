import type { Result } from '@intexuraos/common-core';
import { createBookmarksAgentServiceClient } from '@intexuraos/internal-clients';
import type {
  BookmarksServiceClient,
  CreateBookmarkError,
  CreateBookmarkRequest,
  CreateBookmarkResponse,
  ForceRefreshBookmarkResponse,
} from '../../domain/ports/bookmarksServiceClient.js';
import type { Logger } from 'pino';

export interface BookmarksServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

export function createBookmarksServiceHttpClient(
  config: BookmarksServiceHttpClientConfig
): BookmarksServiceClient {
  const client = createBookmarksAgentServiceClient(config);

  return {
    async createBookmark(
      request: CreateBookmarkRequest
    ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>> {
      return await client.createBookmark(request);
    },

    async forceRefreshBookmark(bookmarkId: string): Promise<Result<ForceRefreshBookmarkResponse>> {
      return await client.forceRefreshBookmark(bookmarkId);
    },
  };
}
