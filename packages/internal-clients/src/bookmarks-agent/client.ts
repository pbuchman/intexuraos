import { err, ok, ServiceErrorCodes, type Result } from '@intexuraos/common-core';
import type { BookmarksBookmark, BookmarksCreateBookmarkData } from '@intexuraos/http-contracts';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
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

function toCreateBookmarkError(
  response: { status: number; statusText: string },
  body: unknown
): CreateBookmarkError {
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

function toHttpErrorMessage(
  response: { status: number; statusText: string },
  body: unknown
): string {
  if (body === null || typeof body !== 'object') {
    return `HTTP ${String(response.status)}: ${response.statusText}`;
  }

  const apiResponse = body as ApiResponse;
  return apiResponse.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
}

function toCreateEnvelopeError(error: {
  code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE';
  message: string;
  body?: unknown;
}): CreateBookmarkError {
  if (error.code === 'ENVELOPE_ERROR') {
    const body = error.body as ApiResponse;
    return {
      message: body.error?.message ?? 'Invalid response from bookmarks-agent',
      ...(body.error?.code !== undefined ? { errorCode: body.error.code } : {}),
    };
  }

  return {
    message: 'Invalid response from bookmarks-agent',
  };
}

function toForceRefreshEnvelopeError(error: {
  code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE';
  message: string;
  body?: unknown;
}): Error {
  if (error.code === 'ENVELOPE_ERROR') {
    const body = error.body as ApiResponse;
    return new Error(body.error?.message ?? 'Invalid response from bookmarks-agent');
  }

  return new Error('Invalid response from bookmarks-agent');
}

export function createBookmarksAgentServiceClient(
  config: BookmarksAgentServiceConfig
): BookmarksAgentServiceClient {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async createBookmark(
      request: CreateBookmarkRequest,
      options?: BookmarksAgentRequestOptions
    ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>> {
      const result = await httpClient.request<
        BookmarksCreateBookmarkData | LegacyCreateBookmarkData
      >({
        path: '/internal/bookmarks',
        method: 'POST',
        body: request,
        timeoutMs: getTimeoutMs(config, options),
        requestId: options?.requestId,
      });

      if (
        !result.ok &&
        (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT')
      ) {
        return err({
          message: `Failed to call bookmarks-agent: ${result.error.message}`,
          errorCode: ServiceErrorCodes.SERVICE_UNAVAILABLE,
        });
      }

      if (!result.ok && result.error.code === 'API_ERROR') {
        return err(
          toCreateBookmarkError(
            { status: result.error.status, statusText: result.error.statusText },
            result.error.body
          )
        );
      }

      if (!result.ok) {
        return err(
          toCreateEnvelopeError(
            result.error as {
              code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE';
              message: string;
              body?: unknown;
            }
          )
        );
      }

      const data = result.value;
      if ('bookmark' in data) {
        return ok({
          id: data.id,
          userId: data.bookmark.userId,
          url: data.bookmark.url,
          ...(data.resourceUrl !== undefined ? { resourceUrl: data.resourceUrl } : {}),
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
      const result = await httpClient.request<BookmarksBookmark>({
        path: `/internal/bookmarks/${bookmarkId}/force-refresh`,
        method: 'POST',
        timeoutMs: getTimeoutMs(config, options),
        requestId: options?.requestId,
      });

      if (
        !result.ok &&
        (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT')
      ) {
        return err(new Error(`Failed to call bookmarks-agent: ${result.error.message}`));
      }

      if (!result.ok && result.error.code === 'API_ERROR') {
        return err(
          new Error(
            toHttpErrorMessage(
              { status: result.error.status, statusText: result.error.statusText },
              result.error.body
            )
          )
        );
      }

      if (!result.ok) {
        return err(
          toForceRefreshEnvelopeError(
            result.error as {
              code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE';
              message: string;
              body?: unknown;
            }
          )
        );
      }

      const bookmark = result.value;
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
