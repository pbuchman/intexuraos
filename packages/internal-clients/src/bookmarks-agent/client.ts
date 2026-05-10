import { err, ok, ServiceErrorCodes, type Result } from '@intexuraos/common-core';
import type { BookmarksBookmark, BookmarksCreateBookmarkData } from '@intexuraos/http-contracts';
import { sendInternalRequest } from '../shared/request.js';
import type {
  BookmarksAgentRequestOptions,
  BookmarksAgentServiceClient,
  BookmarksAgentServiceConfig,
  CreateBookmarkError,
  CreateBookmarkRequest,
  CreateBookmarkResponse,
  ForceRefreshBookmarkResponse,
} from './types.js';

interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: {
      existingBookmarkId?: string;
    };
  };
}

interface LegacyCreateBookmarkData {
  id: string;
  userId: string;
  url: string;
  title: string | null;
}

function getTimeoutMs(
  config: BookmarksAgentServiceConfig,
  options: BookmarksAgentRequestOptions | undefined
): number | undefined {
  return options?.timeoutMs ?? config.defaultTimeoutMs;
}

function toCreateBookmarkError(response: Response, body: unknown): CreateBookmarkError {
  if (body === null || typeof body !== 'object') {
    return {
      message: `HTTP ${String(response.status)}: ${response.statusText}`,
    };
  }

  const apiResponse = body as ApiResponse;
  const message =
    apiResponse.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
  const existingBookmarkId = apiResponse.error?.details?.existingBookmarkId;

  return {
    message,
    ...(apiResponse.error?.code !== undefined ? { errorCode: apiResponse.error.code } : {}),
    ...(existingBookmarkId !== undefined && existingBookmarkId !== ''
      ? { existingBookmarkId }
      : {}),
  };
}

function toHttpErrorMessage(response: Response, body: unknown): string {
  if (body === null || typeof body !== 'object') {
    return `HTTP ${String(response.status)}: ${response.statusText}`;
  }

  const apiResponse = body as ApiResponse;
  return apiResponse.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
}

export function createBookmarksAgentServiceClient(
  config: BookmarksAgentServiceConfig
): BookmarksAgentServiceClient {
  return {
    async createBookmark(
      request: CreateBookmarkRequest,
      options?: BookmarksAgentRequestOptions
    ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/bookmarks',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: request,
        timeoutMs: getTimeoutMs(config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err({
          message: `Failed to call bookmarks-agent: ${transport.error.message}`,
          errorCode: ServiceErrorCodes.SERVICE_UNAVAILABLE,
        });
      }

      if (!transport.response.ok) {
        return err(toCreateBookmarkError(transport.response, transport.body));
      }

      const body = transport.body as ApiResponse & {
        data?: BookmarksCreateBookmarkData | LegacyCreateBookmarkData;
      };
      if (!body.success || body.data === undefined) {
        return err({
          message: body.error?.message ?? 'Invalid response from bookmarks-agent',
          ...(body.error?.code !== undefined ? { errorCode: body.error.code } : {}),
        });
      }

      const data = body.data;
      if ('bookmark' in data) {
        return ok({
          id: data.id,
          userId: data.bookmark.userId,
          url: data.bookmark.url,
          title: data.bookmark.title,
        });
      }

      return ok({
        id: data.id,
        userId: data.userId,
        url: data.url,
        title: data.title,
      });
    },

    async forceRefreshBookmark(
      bookmarkId: string,
      options?: BookmarksAgentRequestOptions
    ): Promise<Result<ForceRefreshBookmarkResponse>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: `/internal/bookmarks/${bookmarkId}/force-refresh`,
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        timeoutMs: getTimeoutMs(config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err(new Error(`Failed to call bookmarks-agent: ${transport.error.message}`));
      }

      if (!transport.response.ok) {
        return err(new Error(toHttpErrorMessage(transport.response, transport.body)));
      }

      const body = transport.body as ApiResponse;
      if (!body.success || body.data === undefined) {
        return err(new Error(body.error?.message ?? 'Invalid response from bookmarks-agent'));
      }

      const bookmark = body.data as BookmarksBookmark;
      return ok({
        id: bookmark.id,
        url: bookmark.url,
        status: bookmark.status,
        ogPreview:
          bookmark.ogPreview === null
            ? null
            : {
                title: bookmark.ogPreview.title ?? null,
                description: bookmark.ogPreview.description ?? null,
                image: bookmark.ogPreview.image ?? null,
                siteName: bookmark.ogPreview.siteName ?? null,
                favicon: bookmark.ogPreview.favicon ?? null,
              },
        ogFetchStatus: bookmark.ogFetchStatus,
      });
    },
  };
}
