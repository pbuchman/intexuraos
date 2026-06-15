import type { Result } from '@intexuraos/common-core';
import type { BookmarksCreateBookmarkRequest } from '@intexuraos/http-contracts';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';

export interface BookmarksAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface BookmarksAgentRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

export type CreateBookmarkRequest = BookmarksCreateBookmarkRequest;

export interface CreateBookmarkResponse {
  id: string;
  userId: string;
  url: string;
  title: string | null;
}

export interface CreateBookmarkError {
  message: string;
  errorCode?: string;
  existingBookmarkId?: string;
}

export interface ForceRefreshBookmarkResponse {
  id: string;
  url: string;
  status: 'draft' | 'active';
  ogPreview: {
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
    favicon: string | null;
  } | null;
  ogFetchStatus: 'pending' | 'processed' | 'failed';
}

export interface BookmarksAgentServiceClient {
  createBookmark(
    request: CreateBookmarkRequest,
    options?: BookmarksAgentRequestOptions
  ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>>;

  forceRefreshBookmark(
    bookmarkId: string,
    options?: BookmarksAgentRequestOptions
  ): Promise<Result<ForceRefreshBookmarkResponse>>;
}
