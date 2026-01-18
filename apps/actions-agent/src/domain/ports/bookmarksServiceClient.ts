import type { Result } from '@intexuraos/common-core';

export interface CreateBookmarkRequest {
  userId: string;
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  source: string;
  sourceId: string;
}

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
  ogPreview: { title: string | null; description: string | null; image: string | null; siteName: string | null; favicon: string | null } | null;
  ogFetchStatus: 'pending' | 'processed' | 'failed';
}

export interface BookmarksServiceClient {
  createBookmark(request: CreateBookmarkRequest): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>>;
  forceRefreshBookmark(bookmarkId: string): Promise<Result<ForceRefreshBookmarkResponse>>;
}
